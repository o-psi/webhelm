import test from 'node:test';
import assert from 'node:assert/strict';
import {voyageList,filterVoyages,cardStatus,sidebarGroups,voyageGroup} from '../resources/react/presentation.ts';
const voyage=(id:string,state:string,date='2026-09-01T00:00:00Z')=>({session_id:id,name:id,state:'live',catalogue:{summary:{run_state:state,last_turn_end:date}}});
test('active voyages stay above newer completed voyages across all Vessels',()=>{
 const connections=[{id:'a',name:'A',voyages:[voyage('completed','completed','2026-09-20T00:00:00Z'),voyage('running','running')]},{id:'b',name:'B',voyages:[voyage('waiting','waiting'),voyage('starting','starting'),voyage('blocked','blocked'),voyage('cancelling','cancelling')]}];
 assert.deepEqual(voyageList(connections).map(v=>v.session_id),['running','blocked','cancelling','starting','waiting','completed']);
 assert.equal(voyageList(connections,'completed')[0].session_id,'completed');
});
test('fresh snapshots immediately promote starts and demote finished voyages',()=>{
 const connections=[{id:'a',name:'A',voyages:[voyage('old-run','running','2026-09-20T00:00:00Z'),voyage('new-run','idle')]}];
 const snapshotFor=(_:any,v:any)=>({run:{state:v.session_id==='old-run'?'completed':'running'}});
 assert.deepEqual(voyageList(connections,'',snapshotFor).map(v=>v.session_id),['new-run','old-run']);
});
test('terminal lifecycle and stopped processes are not pinned by old run metadata',()=>{
 const stopped={...voyage('stopped','running'),state:'stopped'};
 const archived=voyage('archived','running');(archived.catalogue.summary as any).archived=true;
 const connections=[{id:'a',name:'A',voyages:[stopped,archived,voyage('active','running')]}];
 assert.deepEqual(voyageList(connections).map(v=>[v.session_id,v.active]),[['active',true],['archived',false],['stopped',false]]);
});
test('Vessel and status filters retain only matching voyages',()=>{
 const archived=voyage('archived','completed');(archived.catalogue.summary as any).archived=true;
 const connections=[{id:'a',name:'A',voyages:[voyage('working','running'),archived]},{id:'b',name:'B',voyages:[voyage('idle','completed')]}];
 const all=voyageList(connections);
 assert.deepEqual(filterVoyages(all,'a','active').map(v=>v.session_id),['working']);
 assert.deepEqual(filterVoyages(all,'all','archived').map(v=>v.session_id),['archived']);
 assert.deepEqual(filterVoyages(all,'b','available').map(v=>v.session_id),['idle']);
});
test('suspended voyage shows its last run without claiming the process is running',()=>{
 const item={...voyage('s','completed'),state:'suspended'};
 assert.deepEqual(cardStatus(item,true),{label:'Last run completed',detail:'Suspended process',tone:'muted',animated:false});
 assert.equal(cardStatus(item,false).label,'Offline');
});
test('attention stays visible while older settled voyages collapse without hiding the selected one',()=>{
 const connections=[{id:'a',name:'A',voyages:[voyage('done-1','completed','2026-09-20T00:00:00Z'),voyage('done-2','completed','2026-09-19T00:00:00Z'),voyage('done-3','completed','2026-09-18T00:00:00Z'),voyage('failed','failed'),voyage('running','running'),voyage('waiting','awaiting_decision')]}];
 const all=voyageList(connections);
 const groups=sidebarGroups(all,JSON.stringify(['a','done-3']),()=>({decisions:0,pendingReceipts:0}),1);
 assert.deepEqual(groups.attention.map(v=>v.session_id),['failed','waiting']);
 assert.deepEqual(groups.working.map(v=>v.session_id),['running']);
 assert.deepEqual(groups.recent.map(v=>v.session_id),['done-1','done-3']);
 assert.deepEqual(groups.settled.map(v=>v.session_id),['done-2']);
 assert.equal(voyageGroup({...all.find(v=>v.session_id==='done-1'),observed:{run:{state:'completed'}}},0,1),'attention','an exact pending receipt promotes the open voyage');
});
