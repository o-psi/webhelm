import React,{useId,useRef,useState} from 'react';
import {Button} from './components/ui/button';
import {Input} from './components/ui/input';
import {Textarea} from './components/ui/textarea';
import {Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle} from './components/ui/dialog';
import type {Tab,Workspace} from './workspace';
import {defaultGoalLimits,goalLimitReached,goalState,goalStopText,goalText,reviewGoal,validGoalLimits,validGoalObjective,type GoalAction,type GoalLimits,type GoalReview,type GoalStatus} from './goals';

type Mode='view'|'edit'|'replace'|'clear';
const labels:Record<GoalStatus,string>={active:'Active',paused:'Paused',complete:'Complete',blocked:'Blocked',limited:'Limit reached',needs_attention:'Needs attention'};
const count=(n:number)=>n.toLocaleString();

export function GoalPanel({tab,workspace}:{tab:Tab;workspace:Workspace}){
    const toggle=useRef<HTMLButtonElement>(null);
    const id=useId(),[open,setOpen]=useState(false),[mode,setMode]=useState<Mode>('view'),[review,setReview]=useState<GoalReview|null>(null);
    const [objective,setObjective]=useState(''),[limits,setLimits]=useState<GoalLimits>({...defaultGoalLimits}),[automatic,setAutomatic]=useState(false),[confirmed,setConfirmed]=useState(false),[error,setError]=useState(''),[saving,setSaving]=useState(false);
    const state=goalState(tab.snapshot),goal=state?.goal;
    const active=['accepted','running','awaiting_decision','cancel_requested','starting','cancelling'].includes(tab.snapshot?.run?.state);
    const owner=workspace.permitted(tab,'goal_update'),ready=owner&&workspace.actionable(tab,'goal_update')&&!tab.snapshot?.lifecycle?.archived&&!tab.snapshot?.lifecycle?.deleted;
    const idle=!active&&!tab.snapshot?.pending_cleanup_run;
    const canResume=goal&&goal.status!=='active'&&goal.status!=='complete'&&!goalLimitReached(goal)&&!goal.usage.unmeasured_runs;
    function begin(next:Mode){
        try{
            const current=reviewGoal(tab.snapshot,tab.incarnation);
            setReview(current);setMode(next);setError('');setConfirmed(false);setAutomatic(false);
            setObjective(next==='edit'?current.state.goal?.objective||'':'');
            setLimits({...((next==='edit'&&current.state.goal)?current.state.goal.limits:defaultGoalLimits)});
            setOpen(true);
        }catch(reason){tab.notice=reason instanceof Error?reason.message:'Goal unavailable.';workspace.changed();}
    }
    async function apply(action:GoalAction,binding=review){
        if(!binding||saving)return;
        setSaving(true);setError('');
        try{
            const applied=await workspace.goalUpdate(tab.key,binding,action);
            if(applied){setOpen(false);setReview(null);}
            else setError(tab.notice||'The goal change was not confirmed. Review the current goal and receipt before trying again.');
        }catch(reason){setError(reason instanceof Error?reason.message:'Goal change unavailable.');}
        finally{setSaving(false);}
    }
    function control(action:'pause'|'resume'){
        try{
            const current=reviewGoal(tab.snapshot,tab.incarnation);
            if(!current.state.goal)return;
            setReview(current);setMode('view');setOpen(true);
            void apply({action,goal_id:current.state.goal.id},current);
        }catch(reason){setError(reason instanceof Error?reason.message:'Goal change unavailable.');}
    }
    function submit(event:React.FormEvent){
        event.preventDefault();if(!review)return;
        const previous=review.state.goal;
        if(mode==='clear'){
            if(previous&&confirmed)void apply({action:'clear',goal_id:previous.id});
        }else if(mode==='edit'){
            if(previous)void apply({action:'edit',goal_id:previous.id,objective,limits});
        }else if(!previous||confirmed){
            void apply({action:'set',objective,limits,replace_goal_id:previous?.id??null,continue_automatically:automatic});
        }
    }
    const editing=mode==='edit'||mode==='replace',previous=review?.state.goal;
    const valid=mode==='clear'?confirmed:validGoalObjective(objective)&&validGoalLimits(limits)&&(mode!=='replace'||!previous||confirmed);
    if(!state){
        return tab.snapshot?.goal===undefined?null:<p className="px-4 text-sm text-muted-foreground" role="status">Goal state unavailable. Refresh the voyage.</p>;
    }
    return <div className="mx-auto w-full max-w-4xl shrink-0 px-4 py-2" aria-label="Voyage goal">
        <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm">
            <Button ref={toggle} variant="ghost" size="sm" type="button" className="shrink-0" onClick={()=>begin(goal?'view':'replace')} disabled={!goal&&(!ready||!idle)}>{goal?`Goal · ${labels[goal.status]}`:'Set goal'}</Button>
            {goal&&<><span className="min-w-0 flex-1 truncate" title={goalText(goal.objective)}>{goalText(goal.objective)}</span><span className="shrink-0 text-xs text-muted-foreground">{count(goal.usage.runs)} / {count(goal.limits.runs)} runs · {goal.usage.unmeasured_runs?'at least ':''}{count(goal.usage.input_tokens+goal.usage.output_tokens)} tokens</span></>}
            {goal?.status==='active'&&<Button variant="outline" size="sm" type="button" disabled={!ready||saving} onClick={()=>control('pause')}>Pause goal</Button>}
            {canResume&&<Button variant="outline" size="sm" type="button" disabled={!ready||!idle||saving} onClick={()=>begin('view')}>Review and resume</Button>}
            {tab.stale&&<span className="text-xs text-muted-foreground">Last observed state</span>}
        </div>
        <Dialog open={open} onOpenChange={next=>{if(!saving)setOpen(next);}}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl" onCloseAutoFocus={event=>{event.preventDefault();toggle.current?.focus();}}>
            <DialogHeader><DialogTitle>{mode==='view'?'Voyage goal':mode==='edit'?'Edit goal':mode==='clear'?'Clear goal':previous?'Replace goal':'Set goal'}</DialogTitle><DialogDescription>{mode==='edit'?'Edits retain usage and pause continuation. Review the result before resuming.':mode==='clear'?'Clearing removes the current goal. Existing run receipts remain.':mode==='replace'?'Choose an outcome and finite limits. Automatic continuation requires your consent.':'The Voyage owns this goal and its execution on the Vessel.'}</DialogDescription></DialogHeader>
            {mode==='view'?(goal?<div className="grid gap-4">
                <p className="whitespace-pre-wrap break-words">{goalText(goal.objective)}</p>
                <p role="status"><strong>{labels[goal.status]}</strong> · {goalStopText(goal)}</p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm"><dt>Runs</dt><dd>{count(goal.usage.runs)} / {count(goal.limits.runs)}</dd><dt>Tokens</dt><dd>{goal.usage.unmeasured_runs?'At least ':''}{count(goal.usage.input_tokens+goal.usage.output_tokens)} / {count(goal.limits.tokens)}</dd><dt>Execution time</dt><dd>{count(Math.ceil(goal.usage.elapsed_ms/1000))} / {count(goal.limits.elapsed_ms/1000)} seconds</dd><dt>Without progress</dt><dd>{goal.usage.no_progress_runs} / {goal.limits.no_progress_runs} turns</dd></dl>
                {goal.usage.unmeasured_runs>0&&<p className="text-sm">Usage is incomplete for {goal.usage.unmeasured_runs} run(s). Resuming cannot establish a fresh allowance; replacement requires an explicit new budget.</p>}
                {goal.assessment&&<details className="rounded-lg border p-3"><summary>Recorded model assessment</summary><div className="mt-3 grid gap-2 text-sm"><p className="whitespace-pre-wrap break-words">{goalText(goal.assessment.report.summary)}</p><ul className="list-disc pl-5">{goal.assessment.report.evidence.map((entry,index)=><li className="break-words" key={index}>{goalText(entry.conclusion)}</li>)}</ul><p className="text-muted-foreground">Evidence is linked to observed tool results. The assessment of the objective is the model’s.</p></div></details>}
                {!owner&&<p className="text-sm text-muted-foreground">Goal changes require owner access.</p>}
                {!idle&&<p className="text-sm text-muted-foreground">Pause stops future continuation. Use Stop run to cancel current execution; editing waits for cleanup.</p>}
                <div className="flex flex-wrap gap-2">{goal.status==='active'&&<Button type="button" disabled={!ready||saving} onClick={()=>control('pause')}>Pause goal</Button>}{canResume&&<Button type="button" disabled={!ready||!idle||saving} onClick={()=>void apply({action:'resume',goal_id:goal.id})}>Resume within these limits</Button>}{goal.status!=='complete'&&<Button variant="outline" type="button" disabled={!ready||!idle||saving} onClick={()=>begin('edit')}>Edit objective or limits</Button>}<Button variant="outline" type="button" disabled={!ready||!idle||saving} onClick={()=>begin('replace')}>Replace goal</Button><Button variant="ghost" type="button" disabled={!ready||!idle||saving} onClick={()=>begin('clear')}>Clear goal</Button></div>
            </div>:<p>No current goal. Close and reopen to create one.</p>):<form className="grid gap-4" onSubmit={submit}>
                {previous&&(mode==='replace'||mode==='clear')&&<div className="grid gap-2 rounded-lg border p-3 text-sm"><p>Current goal · {labels[previous.status]}</p><p className="max-h-32 overflow-auto whitespace-pre-wrap break-words">{goalText(previous.objective)}</p><label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)} disabled={saving}/>{mode==='clear'?'Clear this goal.':'Replace this goal and begin a new budget.'}</label></div>}
                {editing&&<><label className="grid gap-2" htmlFor={`${id}-objective`}>Objective<Textarea id={`${id}-objective`} rows={4} maxLength={8192} value={objective} onChange={event=>setObjective(event.target.value)} disabled={saving} placeholder="Describe the outcome and how to verify it"/></label><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{([
                    ['runs','Maximum runs',1,1000,1],['tokens','Total token limit',1,10000000,1],['elapsed_ms','Execution time (seconds)',1,86400,0.001],['no_progress_runs','Turns without progress',1,10,1],
                ] as const).map(([field,label,min,max,step])=><label key={field} className="grid gap-1 text-sm" htmlFor={`${id}-${field}`}>{label}<Input id={`${id}-${field}`} type="number" min={min} max={max} step={step} value={Number.isFinite(limits[field])?(field==='elapsed_ms'?limits[field]/1000:limits[field]):''} onChange={event=>setLimits({...limits,[field]:event.target.value===''?NaN:(field==='elapsed_ms'?Math.round(Number(event.target.value)*1000):Number(event.target.value))})} disabled={saving}/></label>)}</div>{mode==='replace'&&<label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={automatic} onChange={event=>setAutomatic(event.target.checked)} disabled={saving}/>Continue automatically within these limits, even while Helm is disconnected.</label>}<p className="text-xs text-muted-foreground">Token usage can exceed the limit during an in-flight request. This is not a billing cap.</p></>}
                <DialogFooter><Button variant="outline" type="button" disabled={saving} onClick={()=>setOpen(false)}>Cancel</Button><Button type="submit" disabled={!ready||!idle||saving||!valid}>{saving?'Applying…':mode==='clear'?'Clear goal':mode==='edit'?'Save and pause':automatic?'Start goal':'Save paused goal'}</Button></DialogFooter>
            </form>}
            {error&&<p className="text-sm text-destructive" role="alert">{error}</p>}
        </DialogContent></Dialog>
    </div>;
}
