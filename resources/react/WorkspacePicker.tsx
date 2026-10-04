import React,{useEffect,useId,useRef,useState} from 'react';
import {Popover} from 'radix-ui';
import {CheckIcon,ChevronsUpDownIcon,FolderIcon,SearchIcon,StarIcon} from 'lucide-react';
import {Button} from './components/ui/button';
import {Input} from './components/ui/input';

type WorkspaceChoice={path:string;name:string};
type Preferences={recent:string[];pinned:string[]};
const validPath=(path:unknown):path is string=>typeof path==='string'&&path.startsWith('/')&&path.length<=4096&&!/[\u0000\r\n]/.test(path);
const pathName=(path:string)=>path.split('/').filter(Boolean).at(-1)||'/';
function readPreferences(key:string):Preferences{
    try{
        const value=JSON.parse(localStorage.getItem(key)||'{}');
        const paths=(items:unknown)=>Array.isArray(items)?[...new Set(items.filter(validPath))].slice(0,20):[];
        return {recent:paths(value.recent),pinned:paths(value.pinned)};
    }catch{return {recent:[],pinned:[]};}
}

export function WorkspacePicker({tenant,vessel,vesselName,value,choices,allowCustom,disabled,onChoose}:{tenant:string;vessel:string;vesselName:string;value:string;choices:WorkspaceChoice[];allowCustom:boolean;disabled:boolean;onChoose:(path:string)=>void}){
    const storageKey=`helm:workspaces:v1:${JSON.stringify([tenant,vessel])}`;
    const [preferences,setPreferences]=useState(()=>readPreferences(storageKey));
    const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[active,setActive]=useState(0);
    const search=useRef<HTMLInputElement>(null),list=useRef<HTMLDivElement>(null),id=useId();
    useEffect(()=>{setPreferences(readPreferences(storageKey));setOpen(false);setQuery('');},[storageKey]);
    useEffect(()=>{if(disabled)setOpen(false);},[disabled]);
    const authorized=new Map(choices.filter(choice=>validPath(choice.path)).map(choice=>[choice.path,choice]));
    const available=new Map(authorized);
    if(allowCustom){
        for(const path of [...preferences.pinned,...preferences.recent,value].filter(validPath)){
            if(!available.has(path))available.set(path,{path,name:pathName(path)});
        }
    }
    const terms=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const matches=[...available.values()].filter(choice=>terms.every(term=>`${choice.name} ${choice.path}`.toLocaleLowerCase().includes(term)));
    const groups=[
        {name:'Pinned',items:matches.filter(choice=>preferences.pinned.includes(choice.path))},
        {name:'Recent',items:matches.filter(choice=>!preferences.pinned.includes(choice.path)&&preferences.recent.includes(choice.path))},
        {name:'Workspaces',items:matches.filter(choice=>!preferences.pinned.includes(choice.path)&&!preferences.recent.includes(choice.path))},
    ];
    const custom=query.trim();
    if(allowCustom&&validPath(custom)&&!available.has(custom))groups.push({name:'Use a folder path',items:[{path:custom,name:pathName(custom)}]});
    const items=groups.flatMap(group=>group.items);
    const activeIndex=Math.min(active,items.length-1);
    useEffect(()=>{if(open)list.current?.querySelector('[data-active="true"]')?.scrollIntoView?.({block:'nearest'});},[activeIndex,open]);
    function save(next:Preferences){setPreferences(next);try{localStorage.setItem(storageKey,JSON.stringify(next));}catch{/* Selection works without preference storage. */}}
    function choose(path:string){
        if(disabled||!validPath(path)||!allowCustom&&!authorized.has(path))return;
        save({...preferences,recent:[path,...preferences.recent.filter(item=>item!==path)].slice(0,20)});
        onChoose(path);setOpen(false);setQuery('');
    }
    function navigate(event:React.KeyboardEvent<HTMLInputElement>){
        if(event.nativeEvent.isComposing)return;
        if(['ArrowDown','ArrowUp'].includes(event.key)){
            event.preventDefault();if(items.length)setActive((activeIndex+(event.key==='ArrowDown'?1:items.length-1))%items.length);
        }else if(event.key==='Enter'){
            event.preventDefault();if(items[activeIndex])choose(items[activeIndex].path);
        }
    }
    const current=available.get(value),canPin=validPath(value)&&(allowCustom||authorized.has(value)),pinned=preferences.pinned.includes(value);
    let optionIndex=0;
    return <Popover.Root open={open} onOpenChange={next=>{if(!disabled)setOpen(next);setQuery('');setActive(0);}}>
        <Popover.Trigger asChild><Button variant="outline" type="button" disabled={disabled} aria-label="Workspace" title={value||'Choose workspace'} className="w-full min-w-0 justify-between font-normal"><FolderIcon aria-hidden="true"/><span className="min-w-0 flex-1 truncate text-left">{value||'Choose workspace'}</span><ChevronsUpDownIcon aria-hidden="true" className="text-muted-foreground"/></Button></Popover.Trigger>
        <Popover.Portal><Popover.Content align="start" sideOffset={6} collisionPadding={12} aria-label="Choose workspace" onOpenAutoFocus={event=>{event.preventDefault();search.current?.focus();}} className="z-50 flex w-[22rem] max-w-[calc(100vw-1.5rem)] max-h-[var(--radix-popover-content-available-height)] flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-md outline-none">
            <div className="border-b p-3"><p className="mb-2 truncate text-xs text-muted-foreground">Workspaces on {vesselName}</p><div className="relative"><SearchIcon aria-hidden="true" className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground"/><Input ref={search} role="combobox" aria-label="Search workspaces" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list" aria-activedescendant={items[activeIndex]?`${id}-option-${activeIndex}`:undefined} placeholder={allowCustom?'Search or enter an absolute path…':'Search workspaces…'} className="pl-8" value={query} onChange={event=>{setQuery(event.target.value);setActive(0);}} onKeyDown={navigate}/></div></div>
            <div ref={list} id={`${id}-list`} role="listbox" aria-label="Workspaces" className="min-h-24 max-h-64 min-w-0 overflow-y-auto p-1">
                {groups.filter(group=>group.items.length).map(group=><div key={group.name} role="group" aria-label={group.name}><p className="mb-1 px-2 pt-2 text-xs font-medium text-muted-foreground">{group.name}</p>{group.items.map(choice=>{
                    const index=optionIndex++;
                    return <div key={choice.path} id={`${id}-option-${index}`} role="option" aria-selected={choice.path===value} data-active={index===activeIndex} className={`flex min-w-0 items-center gap-2 rounded-md px-2 py-2 text-sm ${index===activeIndex?'bg-accent text-accent-foreground':''}`} onMouseDown={event=>event.preventDefault()} onMouseMove={()=>setActive(index)} onClick={()=>choose(choice.path)}><FolderIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground"/><span className="min-w-0 flex-1"><span className="block font-medium">{choice.name}</span><span className="block break-all text-xs text-muted-foreground">{choice.path}</span></span>{choice.path===value&&<CheckIcon aria-label="Selected workspace" className="size-4 shrink-0"/>}</div>;
                })}</div>)}
                {!items.length&&<p role="status" className="m-0 p-3 text-sm text-muted-foreground">{query?'No matching workspaces.':'No workspaces are available.'}{allowCustom?' Enter an absolute folder path.':''}</p>}
            </div>
            <div className="flex items-center justify-between gap-2 border-t p-2"><span className="min-w-0 truncate text-xs text-muted-foreground" title={value}>{current?.name||'Choose a workspace'}</span><Button type="button" size="sm" variant="ghost" disabled={!canPin} aria-pressed={pinned} onClick={()=>save({...preferences,pinned:pinned?preferences.pinned.filter(path=>path!==value):[value,...preferences.pinned].slice(0,20)})}><StarIcon aria-hidden="true" className={pinned?'fill-current':undefined}/>{pinned?'Unpin':'Pin workspace'}</Button></div>
        </Popover.Content></Popover.Portal>
    </Popover.Root>;
}
