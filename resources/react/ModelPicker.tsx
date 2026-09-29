import React,{useState} from 'react';
import {CheckIcon,RefreshCwIcon,StarIcon} from 'lucide-react';
import {Button} from './components/ui/button';
import {Input} from './components/ui/input';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle,DialogTrigger} from './components/ui/dialog';

const preferenceKey='helm:model-favorites:v1';
export function readModelFavorites():string[]{
    try{const value=JSON.parse(localStorage.getItem(preferenceKey)||'[]');return Array.isArray(value)?[...new Set(value.filter((id):id is string=>typeof id==='string'&&id.length>0&&id.length<=256))].slice(0,64):[];}catch{return [];}
}
export function matchingModels(models:any[],query:string){
    const terms=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return models.filter(model=>terms.every(term=>`${model.display_name||''} ${model.id}`.toLocaleLowerCase().includes(term)));
}
export function ModelPicker({trigger,open,onOpenChange,models,current,provider,loading,error,disabled,onChoose,onRefresh}:{trigger:React.ReactNode;open:boolean;onOpenChange:(open:boolean)=>void;models:any[];current:string;provider:string;loading:boolean;error:string;disabled:boolean;onChoose:(id:string)=>void;onRefresh:()=>void}){
    const [query,setQuery]=useState(''),[favorites,setFavorites]=useState(readModelFavorites);
    const matches=matchingModels(models,query);
    const groups=[{name:'Favorites',models:matches.filter(model=>favorites.includes(model.id))},{name:provider,models:matches.filter(model=>!favorites.includes(model.id))}];
    function favorite(id:string){setFavorites(previous=>{const next=previous.includes(id)?previous.filter(value=>value!==id):[id,...previous].slice(0,64);try{localStorage.setItem(preferenceKey,JSON.stringify(next));}catch{}return next;});}
    function navigate(event:React.KeyboardEvent,fromSearch=false){
        if(!['ArrowDown','ArrowUp'].includes(event.key))return;
        const choices=[...event.currentTarget.closest('[role="dialog"]')!.querySelectorAll<HTMLButtonElement>('[data-model-choice]:not(:disabled)')];
        if(!choices.length)return;event.preventDefault();
        const index=choices.indexOf(event.currentTarget as HTMLButtonElement);
        choices[fromSearch?(event.key==='ArrowDown'?0:choices.length-1):(index+(event.key==='ArrowDown'?1:choices.length-1))%choices.length].focus();
    }
    return <Dialog open={open} onOpenChange={next=>{onOpenChange(next);if(!next)setQuery('');}}><DialogTrigger asChild>{trigger}</DialogTrigger><DialogContent className="max-h-[85dvh] overflow-hidden sm:max-w-lg"><DialogHeader><DialogTitle>Choose model</DialogTitle><DialogDescription>Choose the model for the next run. Reasoning and service tier reset to that model’s defaults.</DialogDescription></DialogHeader>
        <Input aria-label="Search models" placeholder="Search models…" value={query} onChange={event=>setQuery(event.target.value)} onKeyDown={event=>navigate(event,true)}/>
        <div className="flex items-center justify-between gap-2 text-sm"><span className="min-w-0 truncate text-muted-foreground" title={current}>Current: {current||'Not selected'}</span><Button type="button" size="sm" variant="ghost" disabled={loading||disabled} onClick={onRefresh}><RefreshCwIcon aria-hidden="true"/>Refresh</Button></div>
        {loading&&<p role="status" className="text-sm text-muted-foreground">Refreshing model choices…</p>}
        {error&&<div role="alert" className="flex items-center justify-between gap-2 text-sm"><span>{error}</span><Button type="button" size="sm" variant="outline" disabled={loading||disabled} onClick={onRefresh}>Retry</Button></div>}
        <div className="min-h-0 max-h-[45dvh] overflow-y-auto" aria-label="Available models" aria-busy={loading}>{groups.filter(group=>group.models.length).map(group=><section key={group.name} aria-label={group.name} className="mb-3"><h3 className="mb-1 px-2 text-xs font-medium text-muted-foreground">{group.name}</h3>{group.models.map(model=><div key={model.id} className="flex items-center gap-1"><Button data-model-choice type="button" variant={model.id===current?'secondary':'ghost'} className="h-auto min-w-0 flex-1 justify-start py-2 text-left" aria-pressed={model.id===current} disabled={disabled||loading||Boolean(error)} onKeyDown={navigate} onClick={()=>onChoose(model.id)}><span className="min-w-0 flex-1"><span className="block truncate">{model.display_name||model.id}</span>{model.display_name&&model.display_name!==model.id&&<span className="block truncate text-xs font-normal text-muted-foreground">{model.id}</span>}</span>{model.id===current&&<CheckIcon aria-label="Current model"/>}</Button><Button type="button" size="icon" variant="ghost" aria-pressed={favorites.includes(model.id)} aria-label={`${favorites.includes(model.id)?'Remove':'Save'} ${model.display_name||model.id} ${favorites.includes(model.id)?'from':'to'} favorites`} onClick={()=>favorite(model.id)}><StarIcon aria-hidden="true" className={favorites.includes(model.id)?'fill-current':undefined}/></Button></div>)}</section>)}
            {!loading&&!error&&!matches.length&&<p className="p-2 text-sm text-muted-foreground">{query?'No models match your search.':'No models are available for this account.'}</p>}
        </div>
    </DialogContent></Dialog>;
}
