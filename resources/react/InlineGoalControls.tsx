import React,{useState} from 'react';
import {Button} from './components/ui/button';
import {Input} from './components/ui/input';
import {defaultGoalLimits,validGoalLimits,type GoalLimits} from './goals';

export function InlineGoalControls({objective,current,limits:initial=defaultGoalLimits,onApply,onClose}:{objective?:string;current?:any;limits?:GoalLimits;onApply:(limits:GoalLimits)=>Promise<void>;onClose:()=>void}){
 const [limits,setLimits]=useState({...initial}),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 return <section className="grid gap-2 rounded-lg border p-3" aria-label="Goal review">
 <h3>Goal {objective?'review':'status'}</h3><p className="whitespace-pre-wrap break-words">{objective||current?.objective||'No goal set.'}</p>
 {current&&<p>{current.status} · Runs {current.usage?.runs||0} / {current.limits?.runs}</p>}
 {objective&&<><p>Save paused. Automatic continuation is not authorized.</p>{Object.entries(limits).map(([name,value])=><label key={name}>{name.replaceAll('_',' ')}<Input type="number" value={value} min={1} disabled={busy} onChange={event=>setLimits({...limits,[name]:Number(event.target.value)})}/></label>)}<label><input type="checkbox" checked={consent} onChange={event=>setConsent(event.target.checked)}/>I reviewed these finite limits{current?' and consent to replacing the current goal':''}.</label><Button type="button" disabled={busy||!consent||!validGoalLimits(limits)} onClick={()=>{setBusy(true);void onApply(limits).catch(reason=>setError(String(reason instanceof Error?reason.message:reason))).finally(()=>setBusy(false));}}>Save paused goal</Button></>}
 {error&&<p role="alert">{error}</p>}<Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Close goal review</Button></section>;
}
