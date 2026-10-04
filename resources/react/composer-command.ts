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
    if(workspace.tabs.get(key)?.pictures.length)throw Error('Goal commands do not accept pictures. Your draft and pictures are kept.');
    if(parsed.kind==='goal-set'&&!validGoalObjective(parsed.objective))throw Error('Objective must contain 1–8192 UTF-8 bytes and no control characters.');
    await workspace.refresh(key);const tab=workspace.tabs.get(key);
    if(!tab||tab.stale)throw Error('Refresh the voyage before reviewing its goal.');
    const review=reviewGoal(tab.snapshot,tab.incarnation);
    if(parsed.kind==='goal-status')onGoalReview({review});
    else {
        const goal=review.state.goal;
        // Ordinary assignment changes metadata only. Editing preserves the
        // observed identity, limits and usage; fresh goals are explicitly paused.
        const action:GoalAction=goal
            ?{action:'edit',goal_id:goal.id,objective:parsed.objective,limits:{...goal.limits}}
            :{action:'set',objective:parsed.objective,limits:{...defaultGoalLimits},replace_goal_id:null,continue_automatically:false};
        const applied=await workspace.goalUpdate(key,review,action);
        return {handled:true,review,applied:Boolean(applied)};
    }
    return {handled:true,review};
}
