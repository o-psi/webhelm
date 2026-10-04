import React,{useState} from 'react';
import {Button} from './components/ui/button';

/** One surface for both adapters; callers own drafts, effects and policy. */
export function ComposerSurface({children,configuration,recovery}:{children:React.ReactNode;configuration?:React.ReactNode;recovery?:React.ReactNode}){
 const [configOpen,setConfigOpen]=useState(false),[recoveryOpen,setRecoveryOpen]=useState(false);
 return <div className="composer-surface rounded-xl border bg-background p-3">
  {children}
  <div className="flex min-w-0 items-center gap-2 border-t pt-2">
   <Button type="button" variant="ghost" size="sm" aria-expanded={configOpen} onClick={()=>setConfigOpen(!configOpen)}>Configure</Button>
   {recovery&&<Button type="button" variant="ghost" size="sm" aria-expanded={recoveryOpen} onClick={()=>setRecoveryOpen(!recoveryOpen)}>Review pending work</Button>}
  </div>
  {configOpen&&<div className="min-w-0 border-t pt-3" aria-label="Composer configuration">{configuration}</div>}
  {recoveryOpen&&<div className="min-w-0 border-t pt-3" aria-label="Pending work review">{recovery}</div>}
 </div>;
}
