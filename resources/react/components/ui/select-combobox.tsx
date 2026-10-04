import * as React from 'react';
import {Popover} from 'radix-ui';
import {CheckIcon,ChevronsUpDownIcon,SearchIcon} from 'lucide-react';
import {cn} from 'cn';
import {Button} from './button';
import {Input} from './input';

type Props=Omit<React.ComponentProps<'select'>,'size'|'multiple'> & {size?:'sm'|'default'};
type Choice={index:number;value:string;label:string;group:string;disabled:boolean};
type Snapshot={choices:Choice[];index:number;disabled:boolean;label:string};

// The backing select retains existing React/form and imperative-controller contracts.
// Only the searchable Radix popup is presented to users.
export function SelectCombobox({className,size='default',ref:forwardedRef,...props}:Props){
    const select=React.useRef<HTMLSelectElement>(null),trigger=React.useRef<HTMLButtonElement>(null),search=React.useRef<HTMLInputElement>(null),list=React.useRef<HTMLDivElement>(null);
    const id=React.useId();
    const [state,setState]=React.useState<Snapshot>({choices:[],index:-1,disabled:Boolean(props.disabled),label:props['aria-label']||'Choose option'});
    const [open,setOpen]=React.useState(false),[query,setQuery]=React.useState(''),[active,setActive]=React.useState(0);
    const sync=React.useCallback(()=>{
        const node=select.current;if(!node)return;
        const labelText=(label:HTMLElement)=>{
            // Accessible names include sr-only text; unlike tooltip detection, it is meaningful.
            // Read live text without constructing detached custom elements.
            const walker=node.ownerDocument.createTreeWalker(label,node.ownerDocument.defaultView!.NodeFilter.SHOW_TEXT);
            let text='';
            while(walker.nextNode()){
                const child=walker.currentNode;
                if(!child.parentElement?.closest('[data-slot="select-combobox-wrapper"],select,button,svg,[hidden],[inert],[aria-hidden="true"]'))text+=child.textContent||'';
            }
            return text.trim();
        };
        const label=node.getAttribute('aria-label')||node.getAttribute('aria-labelledby')?.split(/\s+/).map(key=>(()=>{const label=node.ownerDocument.getElementById(key);return label?labelText(label):'';})()).join(' ')||[...node.labels||[]].map(labelText).join(' ')||'Choose option';
        const next:Snapshot={index:node.selectedIndex,disabled:node.matches(':disabled'),label,choices:[...node.options].filter(option=>!option.hidden&&!option.closest('optgroup')?.hidden).map(option=>({index:option.index,value:option.value,label:option.text,group:option.closest('optgroup')?.label||'',disabled:option.disabled||Boolean(option.closest('optgroup')?.disabled)}))};
        setState(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next);
    },[]);
    React.useLayoutEffect(sync);
    React.useEffect(()=>{
        const node=select.current;if(!node)return;
        let disposed=false,queued=false;
        const queue=()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;if(!disposed)sync();});};
        const observer=new node.ownerDocument.defaultView!.MutationObserver(queue);observer.observe(node,{subtree:true,childList:true,characterData:true,attributes:true});
        // Controller assignments do not emit change events or attribute mutations.
        const prototype=node.ownerDocument.defaultView!.HTMLSelectElement.prototype;
        for(const property of ['value','selectedIndex'] as const){
            const descriptor=Object.getOwnPropertyDescriptor(prototype,property)!;
            Object.defineProperty(node,property,{configurable:true,get(){return descriptor.get!.call(node);},set(value){descriptor.set!.call(node,value);queue();}});
        }
        const focus=node.focus;node.focus=options=>trigger.current?.focus(options);
        node.addEventListener('change',queue);sync();
        return()=>{disposed=true;observer.disconnect();node.removeEventListener('change',queue);node.focus=focus;delete (node as any).value;delete (node as any).selectedIndex;};
    },[sync]);
    React.useEffect(()=>{if(state.disabled)setOpen(false);},[state.disabled]);
    const terms=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const choices=state.choices.filter(choice=>terms.every(term=>`${choice.label} ${choice.group}`.toLocaleLowerCase().includes(term)));
    const enabled=choices.filter(choice=>!choice.disabled),activeChoice=enabled[Math.min(active,enabled.length-1)];
    React.useEffect(()=>{if(open)list.current?.querySelector('[data-active="true"]')?.scrollIntoView?.({block:'nearest'});},[open,activeChoice?.index,query]);
    const selected=state.choices.find(choice=>choice.index===state.index);
    function choose(choice:Choice){
        const node=select.current,option=node?.options[choice.index];
        if(!node||node.matches(':disabled')||!option||option.disabled||option.closest('optgroup')?.disabled||option.hidden||option.closest('optgroup')?.hidden||option.value!==choice.value||option.text!==choice.label){sync();return;}
        if(node.selectedIndex!==choice.index){
            node.selectedIndex=choice.index;
            node.dispatchEvent(new node.ownerDocument.defaultView!.Event('change',{bubbles:true}));
        }
        sync();setOpen(false);setQuery('');
    }
    function navigate(event:React.KeyboardEvent<HTMLInputElement>){
        if(event.nativeEvent.isComposing)return;
        if(['ArrowDown','ArrowUp'].includes(event.key)){
            event.preventDefault();if(enabled.length)setActive((Math.min(active,enabled.length-1)+(event.key==='ArrowDown'?1:enabled.length-1))%enabled.length);
        }else if(event.key==='Enter'){
            event.preventDefault();if(activeChoice)choose(activeChoice);
        }
    }
    return <div data-slot="select-combobox-wrapper" data-size={size} className={cn('relative w-full min-w-0',className)}>
        <select {...props} ref={node=>{select.current=node;if(typeof forwardedRef==='function')forwardedRef(node);else if(forwardedRef)forwardedRef.current=node;}} data-slot="select-binding" hidden aria-hidden="true" tabIndex={-1}/>
        <Popover.Root open={open} onOpenChange={next=>{if(!state.disabled)setOpen(next);setQuery('');setActive(0);}}>
            <Popover.Trigger asChild><Button ref={trigger} type="button" variant="outline" data-slot="select-combobox-trigger" aria-label={state.label} aria-invalid={props['aria-invalid']} aria-describedby={props['aria-describedby']} disabled={state.disabled} title={selected?.label||state.label} className={cn('w-full min-w-0 justify-between font-normal',size==='sm'&&'h-7 text-xs')}><span className="min-w-0 flex-1 truncate text-left">{selected?.label||'Choose…'}</span><ChevronsUpDownIcon aria-hidden="true" className="text-muted-foreground"/></Button></Popover.Trigger>
            <Popover.Portal container={select.current?.closest<HTMLElement>('[role="dialog"]')||undefined}><Popover.Content align="start" sideOffset={6} collisionPadding={12} aria-label={`Choose ${state.label.toLocaleLowerCase()}`} onOpenAutoFocus={event=>{event.preventDefault();search.current?.focus();}} className="z-50 flex w-[22rem] max-w-[calc(100vw-1.5rem)] max-h-[var(--radix-popover-content-available-height)] flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-md outline-none">
                <div className="border-b p-3"><p className="mb-2 text-xs text-muted-foreground">{state.label}</p><div className="relative"><SearchIcon aria-hidden="true" className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground"/><Input ref={search} role="combobox" aria-label={`Search ${state.label.toLocaleLowerCase()}`} aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list" aria-activedescendant={activeChoice?`${id}-option-${activeChoice.index}`:undefined} placeholder="Search choices…" className="pl-8" value={query} onChange={event=>{setQuery(event.target.value);setActive(0);}} onKeyDown={navigate}/></div></div>
                <div ref={list} id={`${id}-list`} role="listbox" aria-label={state.label} className="min-h-24 max-h-64 overflow-y-auto p-1">
                    {choices.map((choice,index)=><React.Fragment key={choice.index}>{choice.group&&choice.group!==choices[index-1]?.group&&<p className="mb-1 px-2 pt-2 text-xs font-medium text-muted-foreground">{choice.group}</p>}<div id={`${id}-option-${choice.index}`} role="option" aria-selected={choice.index===state.index} aria-disabled={choice.disabled} data-active={choice.index===activeChoice?.index} className={cn('flex items-center gap-2 rounded-md px-2 py-2 text-sm',choice.disabled?'text-muted-foreground opacity-50':choice.index===activeChoice?.index&&'bg-accent text-accent-foreground')} onMouseDown={event=>event.preventDefault()} onMouseMove={()=>{if(!choice.disabled)setActive(enabled.indexOf(choice));}} onClick={()=>choose(choice)}><span className="min-w-0 flex-1 break-words">{choice.label}</span>{choice.index===state.index&&<CheckIcon aria-label="Selected choice" className="size-4 shrink-0"/>}</div></React.Fragment>)}
                    {!choices.length&&<p role="status" className="m-0 p-3 text-sm text-muted-foreground">{query?'No matching choices.':'No choices available.'}</p>}
                </div>
            </Popover.Content></Popover.Portal>
        </Popover.Root>
    </div>;
}
