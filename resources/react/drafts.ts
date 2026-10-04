// Window-local composer content only. Runtime receipt journals stay separate.
export type Draft = {text:string; pictures:File[]; destination?:{vessel:string;workspace:string}; delivery?:'review'};
export type SavedDraft = {revision:string; value:Draft};
export interface DraftRepository {
    read(key:string):Promise<SavedDraft|null>;
    write(key:string,revision:string|null,value:Draft|null):Promise<string|null>;
}
// Volatile state only. Never open, migrate or delete legacy IndexedDB drafts.
export class BrowserDrafts implements DraftRepository {
    private values=new Map<string,SavedDraft>();
    constructor(_tenant:string,_factory?:()=>IDBFactory){}
    async read(key:string){return this.values.get(key)??null;}
    async write(key:string,_revision:string|null,value:Draft|null){
        if(!value){this.values.delete(key);return null;}
        const revision=crypto.randomUUID();
        this.values.set(key,{revision,value:{...value,pictures:[...value.pictures]}});
        return revision;
    }
}
const empty=():Draft=>({text:'',pictures:[]});
export class DraftSlot {
    value=empty(); loading=true; message='';
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
            this.loading=false;this.message='';this.changed();
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
                this.message='';this.changed();
                const nonempty=value.text.length||value.pictures.length;
                this.revision=await this.repository.write(this.key,this.revision,nonempty?value:null);
                this.saved=generation;this.message='';this.changed();
            }
        })();
        try{await this.writing;}catch(error){this.failed=true;this.message=error instanceof Error?error.message:'Draft could not be saved.';this.changed();throw error;}
        finally{this.writing=undefined;}
    }
    async sending(){this.set({...this.value,delivery:'review'});await this.flush();}
    async retry(){this.failed=false;await this.flush();}
}
