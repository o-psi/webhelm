import {defaultGoalLimits,reviewGoal,validGoalObjective,type GoalAction,type GoalLimits,type GoalReview} from './goals';
import type {Workspace} from './workspace';
export type ComposerGoalIntent={objective:string;limits:GoalLimits;continue_automatically:false;replace_goal_id:null};
export function parseComposerCommand(text:string):{kind:'message'}|{kind:'goal-status'}|{kind:'goal-set';objective:string}{
    const match=/^\/goal(?:\s+([\s\S]*))?$/.exec(text);
    if(!match)return {kind:'message'};
    const objective=(match[1]||'').trim();return objective?{kind:'goal-set',objective}:{kind:'goal-status'};
}
export type ComposerGoalReview={review:GoalReview;objective?:string;action?:GoalAction};
export async function dispatchComposerCommand(workspace:Workspace,key:string,text:string,{onGoalReview}:{onGoalReview:(value:ComposerGoalReview)=>void}){
    const parsed=parseComposerCommand(text);if(parsed.kind==='message')return {handled:false};
    if(parsed.kind==='goal-set'&&!validGoalObjective(parsed.objective))throw Error('Objective must contain 1–8192 UTF-8 bytes and no control characters.');
    await workspace.refresh(key);const tab=workspace.tabs.get(key);
    if(!tab||tab.stale)throw Error('Refresh the voyage before reviewing its goal.');
    const review=reviewGoal(tab.snapshot,tab.incarnation);
    onGoalReview(parsed.kind==='goal-status'?{review}:{review,objective:parsed.objective,action:{action:'set',objective:parsed.objective,limits:{...(review.state.goal?.limits||defaultGoalLimits)},replace_goal_id:review.state.goal?.id||null,continue_automatically:false}});
    return {handled:true,review};
}
