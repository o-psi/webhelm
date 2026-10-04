import React,{useState} from 'react';
import {ComposerInput} from './ComposerPrimitives';
import {PaperclipIcon,CommandIcon} from 'lucide-react';
import {Button} from './components/ui/button';

/** One surface for both adapters; callers own drafts, effects and policy. */
export function ComposerSurface({children,configuration,recovery,toolbar,input,onAttach,onDiscover,attachDisabled,discoverDisabled}:{children:React.ReactNode;configuration?:React.ReactNode;recovery?:React.ReactNode;toolbar?:React.ReactNode;input?:React.ComponentProps<typeof ComposerInput>;onAttach?:()=>void;onDiscover?:()=>void;attachDisabled?:boolean;discoverDisabled?:boolean}){
 const [configOpen,setConfigOpen]=useState(false),[recoveryOpen,setRecoveryOpen]=useState(false);
 return <div className="composer-surface rounded-xl border bg-background p-3">
  {children}
  {input&&<ComposerInput {...input} rows={2} placeholder="Ask anything…"/>}
  <div className="composer-surface-footer flex min-w-0 flex-wrap items-center gap-2 border-t pt-2">
   <Button type="button" variant="ghost" size="icon" aria-label="Attach pictures" disabled={attachDisabled||!onAttach} onClick={onAttach}><PaperclipIcon aria-hidden="true"/></Button>
   <Button type="button" variant="ghost" size="icon" aria-label="Discover actions, tools, skills, and files" disabled={discoverDisabled||!onDiscover} onClick={onDiscover}><CommandIcon aria-hidden="true"/></Button>
   {toolbar}
   <Button type="button" variant="ghost" size="sm" aria-expanded={configOpen} onClick={()=>setConfigOpen(!configOpen)}>Configure</Button>
   {recovery&&<Button type="button" variant="ghost" size="sm" aria-expanded={recoveryOpen} onClick={()=>setRecoveryOpen(!recoveryOpen)}>Review pending work</Button>}
  </div>
  {configOpen&&<div className="min-w-0 border-t pt-3" aria-label="Composer configuration">{configuration}</div>}
  {recoveryOpen&&<div className="min-w-0 border-t pt-3" aria-label="Pending work review">{recovery}</div>}
 </div>;
}
