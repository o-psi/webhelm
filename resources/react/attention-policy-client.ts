import {isPolicy,isUuid,type PolicyIntent,type Policy} from './attention-policy-intents';
export type PolicyView={stale_policy:Policy;revision:number;eligibility:{effect:'disabled'|'unavailable';reason:string;automatic_settlement:false}};
export function policyView(value:any):value is PolicyView {
    return isPolicy(value?.stale_policy)&&Number.isSafeInteger(value.revision)&&value.revision>=0&&value.revision<=1e9
        &&value.eligibility?.automatic_settlement===false&&value.eligibility.effect===(value.stale_policy==='off'?'disabled':'unavailable')
        &&value.eligibility.reason===(value.stale_policy==='off'?'policy_off':'authoritative_work_and_obligation_facts_unavailable');
}
export type PolicyOutcome={status:200|409|422;body:any};
export function outcome(value:any,intent:PolicyIntent):value is PolicyOutcome {
    if(value?.body?.operation_id!==intent.operation_id)return false;
    if(value.status===200)return policyView(value.body)&&value.body.revision===intent.expected_revision+1&&value.body.stale_policy===intent.stale_policy;
    if(value.status===409)return value.body.error==='revision_conflict'&&policyView(value.body.current)&&value.body.current.revision!==intent.expected_revision;
    return value.status===422&&value.body.error==='invalid_policy_request';
}
export class PolicyClient {
    private generation=0;private controllers=new Set<AbortController>();private authorized=true;
    constructor(private fetcher:typeof fetch=fetch){}
    close(){this.generation++;for(const controller of this.controllers)controller.abort();this.controllers.clear();}
    private async request(path:string,method='GET',body?:unknown){
        if(!this.authorized)throw Error('Sign in again to inspect the retained receipt.');
        const generation=this.generation,controller=new AbortController();this.controllers.add(controller);
        const timer=setTimeout(()=>controller.abort(),8000);
        try{
            const token=method==='PATCH'&&typeof document!=='undefined'?document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content:undefined;
            if(method==='PATCH'&&!token)throw Error('Policy request unavailable. Nothing sent.');
            const response=await this.fetcher(path,{method,credentials:'same-origin',cache:'no-store',signal:controller.signal,
                headers:{Accept:'application/json',...(body?{'Content-Type':'application/json','X-CSRF-TOKEN':token!}:{})},...(body?{body:JSON.stringify(body)}:{})});
            if(generation!==this.generation)throw Error('Policy context changed. Retained receipt must be checked.');
            if(response.status===401||response.status===403){this.authorized=false;this.close();throw Error('Sign in again to inspect the retained receipt.');}
            const reader=response.body?.getReader();if(!reader)throw Error('Policy response unavailable.');
            const chunks:Uint8Array[]=[];let bytes=0;
            while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>8192){await reader.cancel();throw Error('Policy response exceeds limit.');}chunks.push(part.value);}
            if(generation!==this.generation)throw Error('Policy context changed.');
            const data=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}
            return {status:response.status,body:JSON.parse(new TextDecoder().decode(data))};
        }finally{clearTimeout(timer);this.controllers.delete(controller);}
    }
    async read(){const result=await this.request('/console/attention-policy');if(result.status!==200||!policyView(result.body))throw Error('Policy state unconfirmed.');return result.body;}
    async save(intent:PolicyIntent){if(!isUuid(intent.operation_id))throw Error('Policy identity unavailable.');const result=await this.request('/console/attention-policy','PATCH',{operation_id:intent.operation_id,expected_revision:intent.expected_revision,stale_policy:intent.stale_policy});if(!outcome(result,intent))throw Error('Policy outcome unknown. Check original receipt.');return result;}
    async receipt(intent:PolicyIntent){const result=await this.request(`/console/attention-policy/receipts/${intent.operation_id}`);
        if(result.status===404&&result.body?.error==='receipt_not_found'&&result.body?.outcome==='unknown'&&result.body?.retry_with_new_identity===false)return null;
        if(result.status!==200||!outcome(result.body,intent))throw Error('Policy receipt unconfirmed.');return result.body as PolicyOutcome;
    }
}
