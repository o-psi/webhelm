import React,{useEffect,useRef,useState} from 'react';
import {CommandIcon,RefreshCwIcon} from 'lucide-react';
import {Button} from './components/ui/button';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle,DialogTrigger} from './components/ui/dialog';
import {Input} from './components/ui/input';
import type {Tab,Workspace} from './workspace';
import {parseDiscovery,type Catalogue} from './composer-discovery';

export function ComposerDiscovery({tab,workspace,onSettings,onAttach,triggerOpen=false,onTriggerHandled,focusComposer}:{tab:Tab;workspace:Workspace;onSettings:()=>void;onAttach:()=>void;triggerOpen?:boolean;onTriggerHandled?:()=>void;focusComposer?:()=>void}){
    const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[refresh,setRefresh]=useState(0);
    const shortcutFocus=useRef(false);
    const [catalogue,setCatalogue]=useState<Catalogue|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
    const supported=tab.capabilities?.includes('skills_catalog')&& !tab.stale;
    const canRead=tab.scope==='owner'||tab.rights?.includes('workspace_read');
    const runId=tab.snapshot?.run?.run_id||null;
    useEffect(()=>{if(triggerOpen){shortcutFocus.current=true;setOpen(true);onTriggerHandled?.();}},[triggerOpen,onTriggerHandled]);
    useEffect(()=>{
        if(!open)return;
        let current=true;
        setCatalogue(null);setError('');
        if(!supported||!canRead){setLoading(false);return;}
        setLoading(true);
        void Promise.all([
            workspace.read(tab.key,'controls',{run_id:runId,section:'tools'}),
            workspace.read(tab.key,'controls',{run_id:runId,section:'skills'}),
        ]).then(([tools,skills])=>{
            if(current&&(tab.snapshot?.run?.run_id||null)===runId)setCatalogue(parseDiscovery(tools,skills));
            else if(current)setError('The run changed. Refresh discovery.');
        }).catch(reason=>{if(current)setError(reason instanceof Error?reason.message:'Discovery unavailable.');}).finally(()=>{if(current)setLoading(false);});
        return()=>{current=false;};
    },[open,workspace,tab.key,tab.incarnation,runId,supported,canRead,refresh]);
    const search=query.trim().toLocaleLowerCase();
    const match=(...parts:string[])=>!search||parts.some(part=>part.toLocaleLowerCase().includes(search));
    const tools=catalogue?.tools.filter(item=>match(item.name,item.description))||[];
    const skills=catalogue?.skills.filter(item=>match(item.name,item.description,item.path))||[];
    const insert=(text:string)=>{workspace.draft(tab.key,tab.draft.trim()?`${tab.draft.trimEnd()}\n${text}`:text);setOpen(false);};
    const close=()=>{setOpen(false);setQuery('');};
    const firstChoice=()=>document.querySelector<HTMLButtonElement>('[role="dialog"] [data-discovery-choice]:not(:disabled)');
    const navigate=(event:React.KeyboardEvent)=>{
        if(event.key==='ArrowDown'||event.key==='ArrowUp'){
            const choices=[...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] [data-discovery-choice]:not(:disabled)')];
            if(!choices.length)return;
            event.preventDefault();
            const index=choices.indexOf(event.currentTarget as HTMLButtonElement);
            choices[event.key==='ArrowDown'?(index+1)%choices.length:(index+choices.length-1)%choices.length].focus();
        }else if(event.key==='Enter'&&event.currentTarget instanceof HTMLInputElement&&!event.nativeEvent.isComposing){event.preventDefault();firstChoice()?.click();}
    };
    return <Dialog open={open} onOpenChange={next=>next?setOpen(true):close()}><DialogTrigger asChild><Button variant="ghost" type="button" aria-label="Discover actions, tools, and skills" title="Discover actions, tools, and skills"><CommandIcon aria-hidden="true"/></Button></DialogTrigger>
        <DialogContent className="max-h-[85dvh] overflow-hidden sm:max-w-lg" onCloseAutoFocus={event=>{if(shortcutFocus.current){event.preventDefault();shortcutFocus.current=false;focusComposer?.();}}}><DialogHeader><DialogTitle>Composer actions</DialogTitle><DialogDescription>Choose an action or insert a request using tools and skills advertised by this Voyage. Selection never sends the message.</DialogDescription></DialogHeader>
            <Input aria-label="Search actions, tools, and skills" placeholder="Search actions, tools, and skills…" value={query} onChange={event=>setQuery(event.target.value)} onKeyDown={navigate}/>
            <div className="max-h-[50dvh] overflow-y-auto" aria-label="Composer choices">
                <section aria-label="Actions"><h3 className="px-2 text-xs font-medium text-muted-foreground">Actions</h3>{match('voyage settings','settings')&&<Button data-discovery-choice variant="ghost" type="button" className="h-auto w-full justify-start text-left" onKeyDown={navigate} onClick={()=>{close();onSettings();}}>Voyage settings</Button>}{match('attach pictures','pictures')&&<Button data-discovery-choice variant="ghost" type="button" className="h-auto w-full justify-start text-left" onKeyDown={navigate} onClick={()=>{close();onAttach();}}>Attach pictures</Button>}</section>
                {!supported?<p className="p-2 text-sm text-muted-foreground" role="status">This Vessel does not advertise tool and skill discovery for this connection.</p>:!canRead?<p className="p-2 text-sm text-muted-foreground" role="status">Workspace read permission is needed to discover skills.</p>:<>
                    {loading&&<p className="p-2 text-sm text-muted-foreground" role="status">Reading Voyage discovery…</p>}
                    {error&&<p className="p-2 text-sm text-destructive" role="alert">{error}</p>}
                    {catalogue&&<><p className="p-2 text-xs text-muted-foreground">Tools: {catalogue.toolSource==='builtin_preflight'?'built-in preview for the next run':'active run inventory'} · Skills: next run{catalogue.incomplete?' · Skill discovery incomplete':''}. Availability and execution still require Voyage policy checks.</p>
                        <section aria-label="Skills"><h3 className="px-2 text-xs font-medium text-muted-foreground">Skills</h3>{catalogue.canRead?skills.map(item=><Button data-discovery-choice key={item.path} variant="ghost" type="button" className="h-auto w-full justify-start whitespace-normal py-2 text-left" onKeyDown={navigate} onClick={()=>insert(`Use the ${JSON.stringify(item.name)} filesystem skill at ${JSON.stringify(item.path)} for this task.`)}><span className="min-w-0"><span className="block font-medium">{item.name}</span><span className="block break-all text-xs text-muted-foreground">{item.description}{item.scope?` · ${item.scope}`:' · executing user'}</span></span></Button>):null}{!skills.length&&<p className="p-2 text-sm text-muted-foreground">No matching readable skills advertised.</p>}</section>
                        <section aria-label="Tools"><h3 className="px-2 text-xs font-medium text-muted-foreground">Tools</h3>{tools.map(item=><Button data-discovery-choice key={item.name} variant="ghost" type="button" className="h-auto w-full justify-start whitespace-normal py-2 text-left" onKeyDown={navigate} onClick={()=>insert(`Use the ${JSON.stringify(item.name)} tool to `)}><span className="min-w-0"><span className="block font-medium">{item.name}</span>{item.description&&<span className="block text-xs text-muted-foreground">{item.description}</span>}</span></Button>)}{!tools.length&&<p className="p-2 text-sm text-muted-foreground">No matching tools advertised.</p>}</section>
                    </>}
                </>}
            </div>
            <div className="flex justify-end"><Button variant="outline" size="sm" type="button" disabled={loading||!supported||!canRead} onClick={()=>setRefresh(value=>value+1)}><RefreshCwIcon aria-hidden="true"/>Refresh</Button></div>
        </DialogContent></Dialog>;
}
