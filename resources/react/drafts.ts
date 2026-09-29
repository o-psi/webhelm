// Browser-local composer content only. Runtime authority and receipt journals
// stay separate; hydration can never send a request or restore an approval.
import {MAX_PICTURE_BYTES, MAX_PICTURES} from './prepare-picture';
export type Draft = {text:string; pictures:File[]; destination?:{vessel:string;workspace:string}; delivery?:'review'};
export type SavedDraft = {revision:string; value:Draft};
export interface DraftRepository {
    read(key:string):Promise<SavedDraft|null>;
    write(key:string,revision:string|null,value:Draft|null):Promise<string|null>;
}
const maxDrafts=64, maxTotal=32*1024*1024;
function size(value:Draft){
    const text=new TextEncoder().encode(value.text).length;
    if(text>65536||value.pictures.length>MAX_PICTURES||value.pictures.some(file=>!(file instanceof Blob)||!file.size||!['image/png','image/jpeg','image/webp'].includes(file.type)||typeof file.name!=='string'||file.name.length>512))throw new Error('Draft exceeds the supported message or picture limits.');
    const pictures=value.pictures.reduce((total,file)=>total+file.size,0);
    if(pictures>MAX_PICTURE_BYTES)throw new Error('Draft pictures exceed 4 MiB.');
    if(value.destination&&(typeof value.destination.vessel!=='string'||value.destination.vessel.length>256||typeof value.destination.workspace!=='string'||value.destination.workspace.length>4096))throw new Error('Invalid draft destination.');
    if(value.delivery!==undefined&&value.delivery!=='review')throw new Error('Invalid draft delivery state.');
    return text+pictures;
}
function validate(record:any):SavedDraft|null{
    if(record==null)return null;
    if(typeof record.revision!=='string'||record.revision.length>64||typeof record.value?.text!=='string'||!Array.isArray(record.value.pictures))throw new Error('Saved draft is unreadable. Your current text is kept here.');
    size(record.value);return record;
}
export class BrowserDrafts implements DraftRepository {
    private opening?:Promise<IDBDatabase>;
    constructor(private tenant:string,private factory:()=>IDBFactory=()=>indexedDB){
        if(!tenant||tenant.length>256)throw new Error('Draft account is unavailable.');
    }
    private database(){
        if(!this.opening)this.opening=new Promise<IDBDatabase>((resolve,reject)=>{
            let request:IDBOpenDBRequest;
            try{request=this.factory().open(`helm-composer:${this.tenant}`,1);}catch{reject(new Error('Draft storage is unavailable. Keep this page open to retain your work.'));return;}
            let expired=false;
            const timer=setTimeout(()=>{expired=true;reject(new Error('Draft storage is busy. Keep this page open.'));},5000);
            request.onupgradeneeded=()=>request.result.createObjectStore('drafts');
            request.onerror=()=>{clearTimeout(timer);reject(new Error('Draft storage is unavailable. Keep this page open.'));};
            request.onblocked=()=>{expired=true;clearTimeout(timer);reject(new Error('Draft storage is busy in another tab.'));};
            request.onsuccess=()=>{clearTimeout(timer);const db=request.result;if(expired){db.close();return;}db.onversionchange=()=>{db.close();this.opening=undefined;};resolve(db);};
        }).catch(error=>{this.opening=undefined;throw error;});
        return this.opening;
    }
    async read(key:string){
        const db=await this.database();
        return new Promise<SavedDraft|null>((resolve,reject)=>{
            const tx=db.transaction('drafts','readonly'),read=tx.objectStore('drafts').get(key);
            let result:SavedDraft|null=null,error:unknown;
            const timer=setTimeout(()=>tx.abort(),5000);
            read.onsuccess=()=>{try{result=validate(read.result);}catch(reason){error=reason;tx.abort();}};
            tx.oncomplete=()=>{clearTimeout(timer);resolve(result);};
            tx.onabort=tx.onerror=()=>{clearTimeout(timer);reject(error||new Error('Saved draft could not be read. Keep this page open.'));};
        });
    }
    async write(key:string,revision:string|null,value:Draft|null){
        const bytes=value?size(value):0,db=await this.database();
        return new Promise<string|null>((resolve,reject)=>{
            const tx=db.transaction('drafts','readwrite'),store=tx.objectStore('drafts'),read=store.get(key);
            let next:string|null=null,error:unknown;
            const timer=setTimeout(()=>tx.abort(),5000);
            const fail=(message:string)=>{error=new Error(message);tx.abort();};
            read.onsuccess=()=>{
                if((read.result?.revision??null)!==revision){fail('Another tab saved this draft. Your text is kept here; copy it before reloading.');return;}
                if(!value){store.delete(key);return;}
                // One transaction bounds all stored content without reading any
                // other account's database or evicting an unsent draft.
                let total=0,count=0;const cursor=store.openCursor();
                cursor.onsuccess=()=>{
                    const current=cursor.result;
                    if(current){if(current.key!==key){count++;total+=current.value.bytes??maxTotal;}current.continue();return;}
                    if(count>=maxDrafts||total+bytes>maxTotal){fail('Saved drafts are full. Clear a draft you no longer need; your text is kept here.');return;}
                    next=crypto.randomUUID();store.put({revision:next,value,bytes},key);
                };
            };
            tx.oncomplete=()=>{clearTimeout(timer);resolve(next);};
            tx.onabort=tx.onerror=()=>{clearTimeout(timer);reject(error||new Error('Draft could not be saved. Storage may be full or unavailable; keep this page open.'));};
        });
    }
}
const empty=():Draft=>({text:'',pictures:[]});
export class DraftSlot {
    value=empty(); loading=true; message='Restoring draft…';
    private revision:string|null=null;
    private generation=0;
    private saved=0;
    private writing?:Promise<void>;
    private ready:Promise<void>;
    private failed=false;
    constructor(private repository:DraftRepository,private key:string,private changed:()=>void){
        this.ready=repository.read(key).then(record=>{
            this.revision=record?.revision??null;
            if(!this.generation&&record)this.value=record.value;
            this.loading=false;this.message=record?'Restored draft on this browser. Review before sending.':'';this.changed();
        }).catch(error=>{this.loading=false;this.failed=true;this.message=String(error instanceof Error?error.message:error);this.changed();});
    }
    get unsaved(){return this.generation!==this.saved;}
    async loaded(){await this.ready;}
    async discard(){this.set(empty());await this.retry();}
    set(value:Draft){this.value={...value,pictures:[...value.pictures]};this.generation++;void this.flush().catch(()=>{});}
    async flush():Promise<void>{
        await this.ready;
        if(this.failed)throw new Error(this.message);
        if(this.writing){await this.writing;return this.flush();}
        if(this.saved===this.generation)return;
        this.writing=(async()=>{
            while(this.saved!==this.generation){
                const generation=this.generation,value=this.value;
                this.message='Saving draft…';this.changed();
                const nonempty=value.text.length||value.pictures.length;
                this.revision=await this.repository.write(this.key,this.revision,nonempty?value:null);
                this.saved=generation;this.message=nonempty?'Draft saved on this browser.':'Draft cleared on this browser.';this.changed();
            }
        })();
        try{await this.writing;}catch(error){this.failed=true;this.message=error instanceof Error?error.message:'Draft could not be saved.';this.changed();throw error;}
        finally{this.writing=undefined;}
    }
    async sending(){this.set({...this.value,delivery:'review'});await this.flush();}
    async retry(){this.failed=false;await this.flush();}
}
