import test from 'node:test';
import assert from 'node:assert/strict';
import {DraftSlot,BrowserDrafts,type Draft,type DraftRepository,type SavedDraft} from '../resources/react/drafts';
import {Workspace} from '../resources/react/workspace';
class Repository implements DraftRepository{
    values=new Map<string,SavedDraft>();writes=0;fail=false;
    async read(key:string){return this.values.get(key)??null;}
    async write(key:string,revision:string|null,value:Draft|null){
        if(this.fail)throw new Error('Storage full');
        assert.equal(this.values.get(key)?.revision??null,revision,'conflicting draft');
        this.writes++;const next=String(this.writes);
        if(value)this.values.set(key,{revision:next,value});else this.values.delete(key);
        return value?next:null;
    }
}
const wait=()=>new Promise(resolve=>setTimeout(resolve,0));
test('reload restores exact text and prepared pictures without persisting runtime authority',async()=>{
    const repo=new Repository(),file=new File(['png-fixture'],'prepared.png',{type:'image/png'});
    const first=new DraftSlot(repo,'voyage',()=>{});await first.loaded();
    first.set({text:'Literal <draft>\n界',pictures:[file]});await first.flush();
    const second=new DraftSlot(repo,'voyage',()=>{});await second.loaded();
    assert.equal(second.value.text,'Literal <draft>\n界');assert.equal(await second.value.pictures[0].text(),'png-fixture');
    assert.equal(second.value.pictures[0].name,'prepared.png');assert.equal(second.value.delivery,undefined);
    assert.equal(repo.writes,1,'restoration has no write or send');
    const other=new DraftSlot(repo,'other-voyage',()=>{});await other.loaded();assert.equal(other.value.text,'');
});
test('concurrent tabs refuse stale writes and preserve both local and saved drafts',async()=>{
    const repo=new Repository(),first=new DraftSlot(repo,'same',()=>{}),second=new DraftSlot(repo,'same',()=>{});
    await Promise.all([first.loaded(),second.loaded()]);first.set({text:'First saved',pictures:[]});await first.flush();
    second.set({text:'Second local',pictures:[]});await assert.rejects(second.flush(),/conflicting draft/);
    assert.equal(second.value.text,'Second local');assert.equal(repo.values.get('same')?.value.text,'First saved');assert.equal(second.unsaved,true);
});
test('rapid edits serialize and retain edits made while a save is pending',async()=>{
    const repo=new Repository();let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
    const write=repo.write.bind(repo);repo.write=async(...args)=>{await gate;return write(...args);};
    const slot=new DraftSlot(repo,'same',()=>{});await slot.loaded();slot.set({text:'First',pictures:[]});await wait();slot.set({text:'Latest',pictures:[]});release();await slot.flush();
    assert.equal(repo.values.get('same')?.value.text,'Latest');assert.equal(slot.unsaved,false);
});
test('send marks retained content before effects and discard removes only its own revision',async()=>{
    const repo=new Repository(),slot=new DraftSlot(repo,'same',()=>{});await slot.loaded();slot.set({text:'Possibly sent',pictures:[]});await slot.sending();
    const reopened=new DraftSlot(repo,'same',()=>{});await reopened.loaded();assert.equal(reopened.value.delivery,'review');assert.equal(reopened.value.text,'Possibly sent');
    await slot.discard();assert.equal(repo.values.has('same'),false);assert.equal(slot.unsaved,false);
});
test('storage failure preserves text and a later explicit retry saves it',async()=>{
    const repo=new Repository(),slot=new DraftSlot(repo,'same',()=>{});await slot.loaded();repo.fail=true;
    slot.set({text:'Keep locally',pictures:[]});await assert.rejects(slot.flush(),/Storage full/);assert.equal(slot.value.text,'Keep locally');assert.equal(slot.unsaved,true);
    repo.fail=false;await slot.retry();assert.equal(repo.values.get('same')?.value.text,'Keep locally');
});
test('unavailable browser storage is visible and never silently claims to save',async()=>{
    const repo=new BrowserDrafts('tenant',()=>{throw new Error('disabled');}),slot=new DraftSlot(repo,'draft',()=>{});await slot.loaded();
    assert.match(slot.message,/unavailable/);slot.set({text:'Unsent',pictures:[]});await assert.rejects(slot.flush(),/unavailable/);assert.equal(slot.value.text,'Unsent');
});
test('workspace waits for hydration, restores voyage-scoped content, and sends nothing',async()=>{
    const repo=new Repository(),key=JSON.stringify(['v','s']);repo.values.set(key,{revision:'a',value:{text:'Restored text',pictures:[new File(['p'],'p.png',{type:'image/png'})],delivery:'review'}});
    const workspace=new Workspace(()=>new Map(),repo);workspace.open('v','s','Voyage');assert.equal(workspace.tabs.get(key)?.draftLoading,true);
    workspace.draft(key,'premature overwrite');await workspace.restoreDraft(key);
    const tab=workspace.tabs.get(key)!;assert.equal(tab.draft,'Restored text');assert.equal(tab.pictures.length,1);assert.equal(tab.pictures[0].name,'p.png');assert.equal(tab.draftLoading,false);assert.equal(repo.writes,0);
    const other=workspace.open('other-vessel','s','Other');await workspace.restoreDraft(other);assert.equal(workspace.tabs.get(other)?.draft,'');
    workspace.draft(key,'Edited after restore');await workspace.saveDrafts();workspace.close();assert.equal(repo.values.get(key)?.value.text,'Edited after restore');
});


test('empty cleared draft feedback is quiet without hiding review or failed storage',async()=>{
 const {showDraftFeedback}=await import('../resources/react/drafts');
 const slot={message:'Draft cleared on this browser.',storageFailed:false,value:{text:'',pictures:[]}};
 assert.equal(showDraftFeedback(slot),false);
 assert.equal(showDraftFeedback({...slot,storageFailed:true}),true);
 assert.equal(showDraftFeedback({...slot,value:{...slot.value,delivery:'review' as const}}),true);
 assert.equal(showDraftFeedback({...slot,message:'Draft storage unavailable'}),true);
 assert.equal(showDraftFeedback({...slot,value:{text:'unsent',pictures:[]}}),true);
});


test('real DraftSlot storage failure remains visible through readonly observation',async()=>{
 const {showDraftFeedback}=await import('../resources/react/drafts');
 const repository=new Repository();repository.fail=true;
 const slot=new DraftSlot(repository,'failed-clear',()=>{});
 await assert.rejects(slot.discard(),/Storage full/);
 assert.equal(slot.storageFailed,true);
 assert.equal(showDraftFeedback(slot),true);
 assert.match(slot.message,/Storage full/);
});
