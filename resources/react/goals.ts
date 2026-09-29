export type GoalLimits={runs:number;tokens:number;elapsed_ms:number;no_progress_runs:number};
export type GoalUsage={runs:number;input_tokens:number;output_tokens:number;elapsed_ms:number;no_progress_runs:number;unmeasured_runs:number};
export type GoalStatus='active'|'paused'|'complete'|'blocked'|'limited'|'needs_attention';
export type Goal={id:string;session_id:string;objective:string;status:GoalStatus;continuation_authorized:boolean;limits:GoalLimits;usage:GoalUsage;stop_reason:string|null;assessment?:{run_id:string;evidence_sha256:string;report:{outcome:'complete'|'blocked';summary:string;evidence:{call_id:string;conclusion:string}[]}}};
export type GoalState={revision:number;goal:Goal|null};
export type GoalReview={session:string;incarnation:string;state:GoalState};
export type GoalAction={action:'set';objective:string;limits:GoalLimits;replace_goal_id:string|null;continue_automatically:boolean}|{action:'edit';goal_id:string;objective:string;limits:GoalLimits}|{action:'pause'|'resume'|'clear';goal_id:string};
export const defaultGoalLimits:GoalLimits={runs:20,tokens:200000,elapsed_ms:3600000,no_progress_runs:3};
const integer=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>=0;
export function validGoalLimits(value:any):value is GoalLimits{
    return Boolean(value&&integer(value.runs)&&value.runs>=1&&value.runs<=1000&&integer(value.tokens)&&value.tokens>=1&&value.tokens<=10000000&&integer(value.elapsed_ms)&&value.elapsed_ms>=1000&&value.elapsed_ms<=86400000&&integer(value.no_progress_runs)&&value.no_progress_runs>=1&&value.no_progress_runs<=10);
}
export const goalText=(value:string)=>value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,'');
export function validGoalObjective(value:string){return Boolean(value.trim()&&new TextEncoder().encode(value).length<=8192&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value));}
export function goalState(snapshot:any):GoalState|null{
    const state=snapshot?.goal;
    if(!state||!integer(state.revision)||!Object.hasOwn(state,'goal'))return null;
    if(state.goal===null)return {revision:state.revision,goal:null};
    const goal=state.goal;
    if(typeof goal.id!=='string'||!goal.id||goal.session_id!==snapshot.session_id||typeof goal.objective!=='string'||!validGoalObjective(goal.objective)||!['active','paused','complete','blocked','limited','needs_attention'].includes(goal.status)||typeof goal.continuation_authorized!=='boolean'||!validGoalLimits(goal.limits)||!goal.usage)return null;
    if(!['runs','input_tokens','output_tokens','elapsed_ms','no_progress_runs','unmeasured_runs'].every(key=>integer(goal.usage[key])))return null;
    if(goal.stop_reason!==null&&typeof goal.stop_reason!=='string')return null;
    const assessment=goal.assessment;
    if(assessment!=null&&(typeof assessment.run_id!=='string'||typeof assessment.evidence_sha256!=='string'||!['complete','blocked'].includes(assessment.report?.outcome)||typeof assessment.report?.summary!=='string'||!Array.isArray(assessment.report?.evidence)||assessment.report.evidence.length>16||!assessment.report.evidence.every((e:any)=>typeof e.call_id==='string'&&typeof e.conclusion==='string')))return null;
    return {revision:state.revision,goal};
}
export function reviewGoal(snapshot:any,incarnation:string|null):GoalReview{
    const state=goalState(snapshot);
    if(!state||!incarnation)throw new Error('Goal state is unavailable. Refresh the voyage before acting.');
    return {session:snapshot.session_id,incarnation,state:structuredClone(state)};
}
export function assertGoalReview(review:GoalReview,snapshot:any,incarnation:string|null){
    const current=goalState(snapshot);
    if(!current||snapshot.session_id!==review.session||incarnation!==review.incarnation||current.revision!==review.state.revision||current.goal?.id!==review.state.goal?.id)throw new Error('The goal changed since review. Close and reopen it before applying changes.');
    return current;
}
export function goalLimitReached(goal:Goal){const {usage:u,limits:l}=goal;return u.runs>=l.runs||u.input_tokens+u.output_tokens>=l.tokens||u.elapsed_ms>=l.elapsed_ms||u.no_progress_runs>=l.no_progress_runs;}
export function goalStopText(goal:Goal){
    const reasons:Record<string,string>={user_paused:'Paused by you. The current run can still finish.',user_input:'New input stopped automatic continuation. Review the goal before resuming.',run_limit:'Run limit reached.',token_limit:'Token limit reached.',time_limit:'Execution time limit reached.',no_progress:'Stopped after repeated turns without progress.',interrupted:'Execution was interrupted. Review its outcome before resuming.',cancelled:'The run was stopped.',authority_revoked:'Continuation authority is no longer available.',approval_required:'A decision needs your attention. Review the goal before resuming.',provider_failure:'The provider did not finish successfully.',usage_unknown:'Usage is incomplete. A replacement goal requires an explicit new budget.',unresolved_effects:'Previous work or cleanup is not yet confirmed.'};
    return goal.stop_reason?reasons[goal.stop_reason]||'The goal needs review before continuing.':goal.status==='complete'?'Completed with a recorded model assessment.':goal.status==='blocked'?'Blocked; review the recorded assessment.':goal.status==='active'?'Continues on the Vessel within the limits, including while Helm is disconnected.':'Automatic continuation is paused.';
}
export function validateGoalAction(state:GoalState,action:GoalAction){
    if(action.action==='set'){
        if(action.replace_goal_id!==(state.goal?.id??null))throw new Error('Confirm replacement of the current goal.');
    }else if(!state.goal||state.goal.id!==action.goal_id)throw new Error('The goal identity changed.');
    if(action.action==='set'||action.action==='edit'){
        if(!validGoalObjective(action.objective))throw new Error('Objective must contain 1–8192 UTF-8 bytes and no control characters.');
        if(!validGoalLimits(action.limits))throw new Error('Goal limits are outside the supported range.');
    }
    if(action.action==='resume'&&state.goal&&(goalLimitReached(state.goal)||state.goal.usage.unmeasured_runs>0||state.goal.status==='complete'))throw new Error('This goal cannot resume. Review its limits or explicitly replace it with a new budget.');
}

export function goalReceipt(value:any,expected?:{state:GoalState;action:GoalAction;command:string}){
    if(!value||value.status!=='applied'||!integer(value.goal_revision)||value.goal_revision<1||!(value.goal_id===null||typeof value.goal_id==='string'&&value.goal_id.length>0))return false;
    if(!expected)return true;
    const id=expected.action.action==='set'?expected.command:expected.action.action==='clear'?null:expected.action.goal_id;
    return value.goal_revision===expected.state.revision+1&&value.goal_id===id;
}
