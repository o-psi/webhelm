import test from 'node:test';
import assert from 'node:assert/strict';
import {BrowserDrafts,DraftSlot} from '../resources/react/drafts';
import {Workspace} from '../resources/react/workspace';

test('composers never open legacy storage and retain pictures only in window memory',async()=>{
 let opens=0;
 const factory=()=>{opens++;throw new Error('Legacy storage must remain untouched');};
 const repository=new BrowserDrafts('account',factory);
 const picture=new File(['picture'],'p.png',{type:'image/png'});
 const slot=new DraftSlot(repository,'voyage',()=>{});await slot.loaded();
 slot.set({text:'Unsent text',pictures:[picture]});await slot.flush();
 assert.equal(slot.message,'');assert.equal(opens,0);
 const sameWindow=new DraftSlot(repository,'voyage',()=>{});await sameWindow.loaded();
 assert.equal(sameWindow.value.text,'Unsent text');assert.equal(sameWindow.value.pictures[0],picture);
 for(const account of ['account','other-account']){
  const reloaded=new DraftSlot(new BrowserDrafts(account,factory),'voyage',()=>{});await reloaded.loaded();
  assert.deepEqual(reloaded.value,{text:'',pictures:[]});
 }
 assert.equal(opens,0);
 await slot.discard();assert.equal(await repository.read('voyage'),null);
});

test('switching voyage tabs retains composition without touching receipt journals or storage',async()=>{
 let reads=0,writes=0;
 const journal={entries:()=>[],put:async()=>{writes++;}};
 const repository=new BrowserDrafts('account',()=>{throw new Error('storage accessed');});
 const connections=new Map();
 const workspace=new Workspace(()=>connections,repository);
 connections.set('v',{id:'v',name:'Vessel',client:{},journal,voyages:[],status:'ready'});
 const first=workspace.open('v','first','First');await workspace.restoreDraft(first);
 workspace.draft(first,'Unsent');await workspace.saveDrafts();
 const second=workspace.open('v','second','Second');await workspace.restoreDraft(second);
 workspace.draft(second,'Other');await workspace.saveDrafts();
 assert.equal(workspace.tabs.get(first)?.draft,'Unsent');assert.equal(workspace.tabs.get(second)?.draft,'Other');
 assert.equal(writes,0);
 workspace.close();
 const reloaded=new Workspace(()=>connections,new BrowserDrafts('account'));
 const key=reloaded.open('v','first','First');await reloaded.restoreDraft(key);
 assert.equal(reloaded.tabs.get(key)?.draft,'');reloaded.close();
});
