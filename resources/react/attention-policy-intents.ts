export type Policy = 'three_days'|'seven_days'|'off';
export type PolicyIntent = {tenant:string; operation_id:string; expected_revision:number; stale_policy:Policy; state:'prepared'};
export const isUuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export const isPolicy=(value:unknown):value is Policy=>['three_days','seven_days','off'].includes(value as string);
export function validIntent(value:any,tenant:string):value is PolicyIntent {
    return value?.tenant===tenant&&isUuid(value.operation_id)&&Number.isSafeInteger(value.expected_revision)&&value.expected_revision>=0&&value.expected_revision<=1e9&&isPolicy(value.stale_policy)&&value.state==='prepared'&&Object.keys(value).length===5;
}
// Metadata-only HTTP intents, not Vessel commands or composer persistence.
export class PolicyIntents {
    private prefix:string;
    constructor(private storage:Storage,private tenant:string){if(!isUuid(tenant))throw Error('Account unavailable.');this.prefix=`helm-web:policy:${tenant}:`;}
    read():PolicyIntent[]{
        if(this.storage.length>4096)throw Error('Policy journal cannot be safely inspected.');
        const result:PolicyIntent[]=[];
        for(let i=0;i<this.storage.length;i++){
            const key=this.storage.key(i);if(!key?.startsWith(this.prefix))continue;
            const text=this.storage.getItem(key);if(!text||text.length>512)throw Error('Policy journal invalid. Do not resend.');
            const value=JSON.parse(text);if(!validIntent(value,this.tenant)||key!==this.prefix+value.operation_id)throw Error('Policy journal invalid. Do not resend.');
            result.push(value);
        }
        if(result.length>8)throw Error('Policy journal full. Reconcile retained receipts.');
        return result;
    }
    prepare(intent:PolicyIntent){
        if(!validIntent(intent,this.tenant)||this.read().length)throw Error('Reconcile outstanding policy receipts first.');
        const key=this.prefix+intent.operation_id,text=JSON.stringify(intent);
        this.storage.setItem(key,text);
        if(this.storage.getItem(key)!==text)throw Error('Policy intent could not be retained. Nothing sent.');
    }
    settle(intent:PolicyIntent){
        const key=this.prefix+intent.operation_id,text=this.storage.getItem(key);
        if(text&&JSON.stringify(JSON.parse(text))===JSON.stringify(intent))this.storage.removeItem(key);
    }
}
