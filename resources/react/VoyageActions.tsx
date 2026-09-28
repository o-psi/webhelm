import React,{useEffect,useRef,useState} from 'react';
import {sidebarActions} from '../js/sidebar-actions.js';
import {Button} from './components/ui/button';
import {Input} from './components/ui/input';
import {NativeSelect} from './components/ui/native-select';
import {Dialog,DialogContent,DialogTitle} from './components/ui/dialog';
import {DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuTrigger} from './components/ui/dropdown-menu';

const actions={rename:'Rename',access:'Access mode',archive:'Archive / Restore',branch:'Branch',cancel:'Cancel run',compact:'Compact context',clear:'Clear conversation',delete:'Delete',details:'Details'};
export function VoyageActions({connection,voyage,onChanged,portalContainer}:{connection:any;voyage:any;onChanged:()=>void;portalContainer?:HTMLElement|null}){
    const host=useRef<HTMLDivElement>(null),controller=useRef<ReturnType<typeof sidebarActions>|null>(null),showResolver=useRef<(()=>void)|null>(null);
    const latest=useRef({connection,voyage,onChanged});latest.current={connection,voyage,onChanged};
    const [container,setContainer]=useState<HTMLDivElement|null>(null),[open,setOpen]=useState(false);
    useEffect(()=>setContainer(host.current),[]);
    useEffect(()=>{
        if(!container)return;
        const adapter=sidebarActions(container,{changed:()=>latest.current.onChanged(),modal:()=>({show:()=>new Promise<void>(resolve=>{showResolver.current=resolve;setOpen(true);}),close:()=>setOpen(false)})});
        controller.current=adapter;
        return()=>{adapter.invalidate();showResolver.current?.();showResolver.current=null;controller.current=null;};
    },[container,connection.id,voyage.session_id]);
    return <div ref={host} className="voyage-action-host">
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" type="button" size="icon-sm" aria-label="Voyage actions" title="Voyage actions">⋯</Button></DropdownMenuTrigger>
            <DropdownMenuContent portalContainer={portalContainer} data-actions aria-label="Voyage actions" align="end" className="voyage-action-menu">
                {Object.entries(actions).map(([action,label])=><DropdownMenuItem key={action} asChild variant={['clear','delete'].includes(action)?'destructive':'default'} onSelect={()=>void controller.current?.open(latest.current.connection,latest.current.voyage,action)}><Button variant="ghost" type="button">{label}</Button></DropdownMenuItem>)}
            </DropdownMenuContent>
        </DropdownMenu>
        {container&&<Dialog open={open} onOpenChange={next=>{if(!next){controller.current?.invalidate();setOpen(false);}}}>
            <DialogContent portalContainer={container} showCloseButton={false} className="settings-dialog sidebar-action-dialog" onInteractOutside={event=>event.preventDefault()}>
                <form id="sidebar-action-form" ref={node=>{if(node){showResolver.current?.();showResolver.current=null;}}}>
                    <header><DialogTitle asChild><h2 id="sidebar-action-title"/></DialogTitle></header>
                    <p id="sidebar-action-target"/><p id="sidebar-action-status" role="status"/>
                    <pre id="sidebar-action-details" hidden/>
                    <label id="sidebar-name-field" hidden>Name<Input id="sidebar-name" maxLength={256}/></label>
                    <label id="sidebar-access-field" hidden>Access mode<NativeSelect id="sidebar-access"><option value="read-only">Read only</option><option value="approval">Approval</option><option value="unrestricted">Full access</option></NativeSelect></label>
                    <label id="sidebar-branch-field" hidden>Branch through<NativeSelect id="sidebar-branch"/><Button variant="ghost" id="sidebar-branch-more" type="button">Load more branch points</Button></label>
                    <label id="sidebar-retain-field" hidden>Recent messages to retain<Input id="sidebar-retain" type="number" min="0" max="4294967295" defaultValue="128"/></label>
                    <label id="sidebar-confirm-field" hidden><span id="sidebar-confirm-label"/><Input id="sidebar-confirm" autoComplete="off"/></label>
                    <footer><Button variant="ghost" id="sidebar-reconcile" type="button">Check pending receipt</Button><Button variant="outline" id="sidebar-dismiss" type="button">Close</Button><Button id="sidebar-submit" type="submit" disabled>Confirm</Button></footer>
                </form>
            </DialogContent>
        </Dialog>}
    </div>;
}
