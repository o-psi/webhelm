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
// Keep tombstones for CAS (including create/clear ABA), but bound their lifetime
// allocation per window. 1024 identities allows 16x the active composition cap;
// 8 KiB UTF-8 fits JSON voyage keys without accepting arbitrary-sized metadata.
const maxKeys=1024, maxKeyBytes=8192;
function validateKey(key:string){
    if(typeof key!=='string'||!key.length||new TextEncoder().encode(key).length>maxKeyBytes)throw new Error('Composition key exceeds the supported window metadata limit.');
}
function size(value:Draft){
    const text=new TextEncoder().encode(value.text).length;
    if(text>65536||value.pictures.length>MAX_PICTURES||value.pictures.some(file=>!(file instanceof Blob)||!file.size||!['image/png','image/jpeg','image/webp'].includes(file.type)||typeof file.name!=='string'||file.name.length>512))throw new Error('Draft exceeds the supported message or picture limits.');
    const pictures=value.pictures.reduce((total,file)=>total+file.size,0);
    if(pictures>MAX_PICTURE_BYTES)throw new Error('Draft pictures exceed 4 MiB.');
    if(value.destination&&(typeof value.destination.vessel!=='string'||value.destination.vessel.length>256||typeof value.destination.workspace!=='string'||value.destination.workspace.length>4096))throw new Error('Invalid draft destination.');
    if(value.delivery!==undefined&&value.delivery!=='review')throw new Error('Invalid draft delivery state.');
    return text+pictures;
}
// Adapted from PR66 f5ae7bfb: volatile ownership, retaining bounds and CAS.
export class BrowserDrafts implements DraftRepository {
    private values=new Map<string,SavedDraft>();
    private revisions=new Map<string,string>();
    constructor(tenant:string,_factory?:()=>IDBFactory){
        if(!tenant||tenant.length>256)throw new Error('Draft account is unavailable.');
    }
    async read(key:string){validateKey(key);const record=this.values.get(key);return record?{revision:record.revision,value:{...record.value,destination:record.value.destination?{...record.value.destination}:undefined,pictures:[...record.value.pictures]}}:this.revisions.has(key)?{revision:this.revisions.get(key)!,value:{text:'',pictures:[]}}:null;}
    async write(key:string,revision:string|null,value:Draft|null){
        validateKey(key);
        if(!this.revisions.has(key)&&this.revisions.size>=maxKeys)throw new Error('Window composition identity limit reached. Copy unsent work before opening a new window; existing compositions remain available.');
        if((this.revisions.get(key)??null)!==revision)throw new Error('This composition changed. Keep your current input and review before replacing it.');
        const bytes=value?size(value):0;
        const others=[...this.values.entries()].filter(([id])=>id!==key);
        if(value&&(others.length>=maxDrafts||others.reduce((total,[,record])=>total+size(record.value),bytes)>maxTotal))throw new Error('Window composition limit reached. Keep your current input and discard another composition first.');
        const next=crypto.randomUUID();this.revisions.set(key,next);
        if(!value){this.values.delete(key);return next;}this.values.set(key,{revision:next,value:{...value,destination:value.destination?{...value.destination}:undefined,pictures:[...value.pictures]}});return next;
    }
}
const empty=():Draft=>({text:'',pictures:[]});
export class DraftSlot {
    value=empty(); loading=true; message='' ;
    private revision:string|null=null;
    private generation=0;
    private contentVersion=0;
    get contentGeneration(){return this.contentVersion;}
    private saved=0;
    private writing?:Promise<void>;
    private ready:Promise<void>;
    private failed=false;
    get storageFailed(){return this.failed;}
    constructor(private repository:DraftRepository,private key:string,private changed:()=>void){
        this.ready=repository.read(key).then(record=>{
            this.revision=record?.revision??null;
            if(!this.generation&&record)this.value=record.value;
            this.loading=false;this.message='';this.changed();
        }).catch(error=>{this.loading=false;this.failed=true;this.message=String(error instanceof Error?error.message:error);this.changed();});
    }
    get unsaved(){return this.generation!==this.saved;}
    async loaded(){await this.ready;}
    async discard(){this.set(empty());await this.retry();}
    set(value:Draft,content=true){if(content)this.contentVersion++;this.value={...value,pictures:[...value.pictures]};this.generation++;void this.flush().catch(()=>{});}
    async flush():Promise<void>{
        await this.ready;
        if(this.failed)throw new Error(this.message);
        if(this.writing){await this.writing;return this.flush();}
        if(this.saved===this.generation)return;
        this.writing=(async()=>{
            while(this.saved!==this.generation){
                const generation=this.generation,value=this.value;
                this.message='';this.changed();
                const nonempty=value.text.length||value.pictures.length;
                this.revision=await this.repository.write(this.key,this.revision,nonempty?value:null);
                this.saved=generation;this.message='';this.changed();
            }
        })();
        try{await this.writing;}catch(error){this.failed=true;this.message=error instanceof Error?error.message:'Draft could not be saved.';this.changed();throw error;}
        finally{this.writing=undefined;}
    }
    async sending(){this.set({...this.value,delivery:'review'},false);await this.flush();}
    async retry(){this.failed=false;await this.flush();}
}

/** Hide only empty successful-clear feedback, never review or storage failures. */
export function showDraftFeedback(slot:{message:string;storageFailed?:boolean;value:Draft}){
    return slot.storageFailed||slot.value.delivery==='review'||Boolean(slot.value.text||slot.value.pictures.length)||Boolean(slot.message&&slot.message!=='Draft cleared on this browser.');
}
