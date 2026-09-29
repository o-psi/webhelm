import test from 'node:test';
import assert from 'node:assert/strict';
import {Workspace} from '../resources/react/workspace.ts';
import {IntentJournal} from '../resources/js/vessel-client.js';
import {assertGoalReview,defaultGoalLimits,goalState,goalText,reviewGoal,validateGoalAction,validGoalLimits,validGoalObjective,type Goal,type GoalAction} from '../resources/react/goals.ts';

const goal=():Goal=>({id:'goal-a',session_id:'a',objective:'Verify the outcome',status:'paused',continuation_authorized:false,limits:{...defaultGoalLimits},usage:{runs:1,input_tokens:12,output_tokens:8,elapsed_ms:100,no_progress_runs:0,unmeasured_runs:0},stop_reason:'user_paused'});
const snapshot=()=>({session_id:'a',revision:4,observation_cursor:7,messages:[],run:{state:'idle'},goal:{revision:2,goal:goal()}});
class Storage {
    data=new Map<string,string>();
    get length(){return this.data.size;}
    key(index:number){return [...this.data.keys()][index]??null;}
    getItem(key:string){return this.data.get(key)??null;}
    setItem(key:string,value:string){this.data.set(key,value);}
    removeItem(key:string){this.data.delete(key);}
}
async function fixture(){
    const storage=new Storage(),commands:any[]=[],state=snapshot();
    let mode='applied',scope='owner',listener:((event:any)=>void)|undefined;
    const reply=(result:unknown)=>({protocol:1,outcome_unknown:false,result:{session_id:'a',incarnation:'process-a',result}});
    const client={async exchange({command:c}:any):Promise<any>{
        commands.push(c);
        if(c.op==='snapshot')return reply(structuredClone(state));
        if(c.op==='capabilities')return {protocol:1,outcome_unknown:false,result:{scope,rights:['history','execute']}};
        if(c.op==='decisions')return reply([]);
        if(mode==='lost')throw new Error('Lost response');
        return reply({command_id:c.command_id,status:mode==='malformed'?'applied':mode,goal_revision:3,goal_id:mode==='malformed'?'foreign':c.action?.action==='set'?c.command_id:c.action?.action==='clear'?null:'goal-a'});
    },subscribe(_s:string,_i:string,_c:number,next:(event:any)=>void){listener=next;return()=>{listener=undefined;};}};
    const connection={id:'vessel',name:'Vessel',client,journal:new IntentJournal(storage,'tenant:vessel'),voyages:[],status:'Connected'};
    const workspace=new Workspace(()=>new Map([['vessel',connection]]));
    const key=workspace.open('vessel','a','A');await workspace.refresh(key);await new Promise(setImmediate);
    return {workspace,key,tab:workspace.tabs.get(key)!,commands,storage,state,mode:(v:string)=>{mode=v;},scope:(v:string)=>{scope=v;},emit:(event:any)=>listener?.(event)};
}

test('Goal review pins session, incarnation and Goal revision while tolerating conversation checkpoints',()=>{
    const state=snapshot(),review=reviewGoal(state,'one');
    state.revision++;assert.doesNotThrow(()=>assertGoalReview(review,state,'one'));
    for(const [changed,incarnation] of [[{...state,session_id:'b'},'one'],[state,'two'],[{...state,goal:{...state.goal,revision:3}},'one'],[{...state,goal:{revision:2,goal:null}},'one']] as const){
        assert.throws(()=>assertGoalReview(review,changed,incarnation),/changed since review/);
    }
    state.goal.goal.objective='changed';assert.equal(review.state.goal?.objective,'Verify the outcome');
});

test('Goal validation bounds UTF-8, finite limits and exhausted or unknown usage',()=>{
    assert.equal(validGoalObjective('é'.repeat(4096)),true);assert.equal(validGoalObjective('é'.repeat(4097)),false);
    for(const text of ['', '   ', 'secret\u001b[31m', 'hidden\u0085'])assert.equal(validGoalObjective(text),false);
    assert.equal(goalText('<img>\u202e\u001b'),'<img>');
    for(const [field,value] of [['runs',Infinity],['tokens',0],['elapsed_ms',999],['no_progress_runs',11],['runs',1.5]])assert.equal(validGoalLimits({...defaultGoalLimits,[field]:value}),false);
    for(const change of [{unmeasured_runs:1},{runs:20},{input_tokens:200000},{elapsed_ms:3600000},{no_progress_runs:3}]){
        const current=goal();Object.assign(current.usage,change);
        assert.throws(()=>validateGoalAction({revision:2,goal:current},{action:'resume',goal_id:current.id}),/cannot resume/);
    }
    const state=snapshot().goal;
    assert.throws(()=>validateGoalAction(state,{action:'set',objective:'New outcome',limits:defaultGoalLimits,replace_goal_id:null,continue_automatically:false}),/replacement/);
    assert.equal(goalState({...snapshot(),goal:{...state,goal:{...goal(),usage:{...goal().usage,input_tokens:-1}}}}),null);
    assert.equal(goalState({session_id:'a'}),null);
});

test('Goal updates require fresh owner authority, exact review and an idle boundary except Pause',async()=>{
    const f=await fixture();try{
        const review=reviewGoal(f.tab.snapshot,f.tab.incarnation),action:GoalAction={action:'resume',goal_id:'goal-a'};
        f.scope('scoped');await f.workspace.refresh(f.key);
        await assert.rejects(f.workspace.goalUpdate(f.key,review,action),/owner/);
        f.scope('owner');await f.workspace.refresh(f.key);f.tab.stale=true;
        await assert.rejects(f.workspace.goalUpdate(f.key,review,action),/fresh/);
        f.tab.stale=false;f.tab.snapshot.goal.revision++;
        await assert.rejects(f.workspace.goalUpdate(f.key,review,action),/changed/);
        f.tab.snapshot.goal.revision--;f.tab.snapshot.run.state='running';f.tab.snapshot.pending_cleanup_run='r';
        await assert.rejects(f.workspace.goalUpdate(f.key,review,action),/cleanup/);
        assert.equal(f.commands.filter(c=>c.op==='goal_update').length,0);
        assert.equal(await f.workspace.goalUpdate(f.key,review,{action:'pause',goal_id:'goal-a'}),true);
        assert.equal(f.commands.filter(c=>c.op==='goal_update').length,1);
    }finally{f.workspace.close();}
});

test('Goal set sends the reviewed action once with canonical command fences and preserves composer draft',async()=>{
    const f=await fixture();try{
        f.workspace.draft(f.key,'Unsent conversation');
        const review=reviewGoal(f.tab.snapshot,f.tab.incarnation);
        f.tab.snapshot.revision=5;
        const action:GoalAction={action:'set',objective:'Private new objective',limits:defaultGoalLimits,replace_goal_id:'goal-a',continue_automatically:false};
        assert.equal(await f.workspace.goalUpdate(f.key,review,action),true);
        const [command]=f.commands.filter(c=>c.op==='goal_update');
        assert.deepEqual(command.action,action);assert.equal(command.expected_revision,5);assert.equal(command.incarnation,'process-a');assert.equal(command.session_id,'a');assert.ok(command.command_id);
        assert.equal(f.storage.length,0);assert.equal(f.tab.draft,'Unsent conversation');
    }finally{f.workspace.close();}
});

test('lost and malformed Goal receipts retain only identity; reconnect observes without replay',async()=>{
    for(const mode of ['lost','malformed']){
        const f=await fixture();try{
            f.mode(mode);
            await f.workspace.goalUpdate(f.key,reviewGoal(f.tab.snapshot,f.tab.incarnation),{action:'set',objective:'Private objective never in local storage',limits:defaultGoalLimits,replace_goal_id:'goal-a',continue_automatically:true});
            assert.equal(f.storage.length,1);assert.doesNotMatch([...f.storage.data.values()].join(''),/Private objective|tokens|continue_automatically/);
            assert.match(f.tab.notice,/can’t confirm/);assert.equal(f.workspace.actionable(f.tab,'goal_update'),false);
            f.mode('unknown_after_restart');await f.workspace.reconcile(f.key);
            assert.equal(f.storage.length,1);assert.match(f.tab.notice,/after a restart/);
            f.mode('not_admitted');await f.workspace.reconcile(f.key);
            assert.equal(f.storage.length,0);assert.match(f.tab.notice,/not applied/);
            assert.equal(f.commands.filter(c=>c.op==='goal_update').length,1);
            assert.equal(new Set(f.commands.filter(c=>['goal_update','receipt'].includes(c.op)).map(c=>c.command_id)).size,1);
        }finally{f.workspace.close();}
    }
});

test('Goal metadata only invalidates the view; canonical reads provide objective and assessment',async()=>{
    const f=await fixture();try{
        const old=f.tab.snapshot.goal.goal.objective;
        // A Goal observation contains no objective authority, including injected fields.
        f.state.goal.goal.objective='Canonical new objective';f.state.revision=5;f.state.observation_cursor=8;
        const event={protocol:1,session_id:'a',incarnation:'process-a',outcome_unknown:false,result:{projection:'public-v2',cursor:8,latest_cursor:8,events:[{cursor:8,session_id:'a',revision:5,kind:'goal',payload:{objective:'Injected objective',status:'complete'}}]}};
        f.emit(event);assert.equal(f.tab.snapshot.goal.goal.objective,old);
        await f.workspace.refresh(f.key);await new Promise(setImmediate);
        assert.equal(f.tab.snapshot.goal.goal.objective,'Canonical new objective');assert.equal(f.tab.snapshot.goal.goal.status,'paused');
        const reads=f.commands.filter(c=>c.op==='snapshot').length;
        f.emit(event);await new Promise(setImmediate);
        assert.equal(f.commands.filter(c=>c.op==='snapshot').length,reads);
        assert.equal(f.commands.some(c=>c.op==='goal_update'),false);
    }finally{f.workspace.close();}
});
