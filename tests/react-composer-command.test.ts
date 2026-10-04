import test from 'node:test';
import assert from 'node:assert/strict';
import {parseComposerCommand,dispatchComposerCommand} from '../resources/react/composer-command';
import {completeNewVoyage} from '../resources/react/new-voyage-delivery';
import {defaultGoalLimits} from '../resources/react/goals';

test('only literal goal command boundaries intercept inference',()=>{
    assert.deepEqual(parseComposerCommand('/goal'),{kind:'goal-status'});
    assert.deepEqual(parseComposerCommand('/goal   '),{kind:'goal-status'});
    assert.deepEqual(parseComposerCommand('/goal Build safely'),{kind:'goal-set',objective:'Build safely'});
    for(const text of ['/goals','Explain /goal',' /goal','/goalkeeper'])assert.equal(parseComposerCommand(text).kind,'message');
});
function fixture(){
    const calls:string[]=[];
    const tab:any={snapshot:{session_id:'s',access:'approval',goal:{revision:0,goal:null}},incarnation:'i',stale:false};
    const workspace:any={tabs:new Map([['k',tab]]),refresh:async()=>{calls.push('read');},restoreDraft:async()=>{},draft:()=>{},goalUpdate:async(_key:any,_review:any,action:any)=>{calls.push('goal');assert.equal(action.continue_automatically,false);},actionable:()=>true,permitted:()=>true,act:async()=>{calls.push('inference');}};
    return {workspace,calls};
}
test('status and objective only read and open explicit paused review',async()=>{
    const {workspace,calls}=fixture();const reviews:any[]=[];
    await dispatchComposerCommand(workspace,'k','/goal',{onGoalReview:value=>reviews.push(value)});
    await dispatchComposerCommand(workspace,'k','/goal Build',{onGoalReview:value=>reviews.push(value)});
    assert.deepEqual(calls,['read','read']);assert.equal(reviews[0].action,undefined);
    assert.equal(reviews[1].action.continue_automatically,false);assert.equal(reviews[1].action.replace_goal_id,null);
});
test('new goal delivery uses fresh metadata only and recovery never replays',async()=>{
    const {workspace,calls}=fixture();const message:any={text:'/goal Build',pictures:[],access:'approval',send:true,applyAccess:true,goalIntent:{objective:'Build',limits:defaultGoalLimits,replace_goal_id:null,continue_automatically:false}};
    await completeNewVoyage(workspace,'k',message);assert.deepEqual(calls,['read','goal']);
    calls.length=0;await completeNewVoyage(workspace,'k',{...message,send:false,applyAccess:false});assert.deepEqual(calls,['read']);
});

test('uncertain payload guards compare exact prepared content and refuse cold journal ambiguity',async()=>{
    const {Workspace}=await import('../resources/react/workspace');
    const entries=[{op:'submit',command_id:'unknown',session_id:'s'}];
    const connection:any={client:{},journal:{entries:()=>entries}};
    const workspace=new Workspace(()=>new Map([['v',connection]]));
    const tab:any={key:'k',vessel:'v',session:'s',incarnation:'i',snapshot:{},freshAt:Date.now(),stale:false,busy:false,draft:'Exact text',pictures:[{name:'image.png',base64:'preparedbytes'}]};
    assert.equal(workspace.actionable(tab,'submit'),false,'cold journal cannot prove payload distinctness');
    (workspace as any).messagePayloads.set(JSON.stringify(['k','i','unknown']),JSON.stringify([tab.draft,tab.pictures.map((p:any)=>[p.name,p.base64])]));
    assert.equal(workspace.actionable(tab,'submit'),false,'unchanged uncertain payload');
    tab.pictures[0].base64='differentpreparedbytes';
    assert.equal(workspace.actionable(tab,'submit'),true,'fresh distinct prepared picture permitted');
    tab.incarnation='different';assert.equal(workspace.actionable(tab,'submit'),false,'fingerprint never crosses incarnation');
});

test('actual creation receipt precedes fresh access-confirmed goal metadata and uncertain resolution never applies',async()=>{
    const {Creation}=await import('../resources/react/settings');
    const data=new Map<string,string>();
    const storage:any={get length(){return data.size;},key:(i:number)=>[...data.keys()][i]||null,getItem:(k:string)=>data.get(k)||null,setItem:(k:string,v:string)=>data.set(k,v),removeItem:(k:string)=>data.delete(k)};
    const commands:any[]=[];let uncertain=false;
    const connection:any={id:'v',vessel_id:'vessel',voyages:[],client:{exchange:async({command}:any)=>{
        commands.push(command);
        if(command.op==='start_account'&&uncertain)return {protocol:1,outcome_unknown:true};
        const process={session_id:command.session_id,workspace:'/work',incarnation:'i'};
        return {protocol:1,outcome_unknown:false,result:command.op==='resolve_start_account'?{command_id:command.command_id,session_id:command.session_id,status:'created',process}:process};
    }}};
    const creation=new Creation(storage,'tenant');
    const process=await creation.start(connection,'/work',{account:{account_id:'a'}});
    const {workspace,calls}=fixture();workspace.tabs.get('k').snapshot.session_id=process.session_id;
    workspace.tabs.get('k').snapshot.access='read-only';
    workspace.act=async(_key:string,op:string)=>{calls.push(op);workspace.tabs.get('k').snapshot.access='approval';return true;};
    const message:any={text:'/goal Build',pictures:[],access:'approval',send:true,applyAccess:true,goalIntent:{objective:'Build',limits:defaultGoalLimits,replace_goal_id:null,continue_automatically:false}};
    await completeNewVoyage(workspace,'k',message);
    assert.deepEqual(calls,['read','set_access','read','goal']);assert.equal(creation.pending().length,0);
    uncertain=true;await assert.rejects(()=>creation.start(connection,'/work',{}),/confirm/);
    const retained=creation.pending()[0];
    await assert.rejects(()=>creation.start(connection,'/work',{}),/unconfirmed/);
    await creation.reconcile(connection,retained);
    calls.length=0;await completeNewVoyage(workspace,'k',{...message,send:false,applyAccess:false});
    assert.deepEqual(calls,['read']);assert.equal(commands.filter(c=>c.op==='start_account').length,2);
    assert.equal(message.goalIntent.objective,'Build');
});
