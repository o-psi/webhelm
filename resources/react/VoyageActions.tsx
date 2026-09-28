import React,{useEffect,useRef,useState} from 'react';
import {sidebarActions} from '../js/sidebar-actions.js';
import {Button} from './components/ui/button';
import {Input} from './components/ui/input';
import {NativeSelect} from './components/ui/native-select';
import {Dialog,DialogContent,DialogTitle} from './components/ui/dialog';
import {DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuLabel,DropdownMenuSeparator,DropdownMenuTrigger} from './components/ui/dropdown-menu';
import {Card,CardContent} from './components/ui/card';
import {Collapsible,CollapsibleContent,CollapsibleTrigger} from './components/ui/collapsible';
import {Alert,AlertDescription} from './components/ui/alert';
import {MoreHorizontalIcon} from 'lucide-react';

export function VoyageActions({connection,voyage,onChanged,portalContainer,accessTrigger=false,triggerLabel}:{connection:any;voyage:any;onChanged:()=>void;portalContainer?:HTMLElement|null;accessTrigger?:boolean;triggerLabel?:string}){
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
    const archived=Boolean(voyage.catalogue?.summary?.archived||voyage.archive);
    const item=(action:string,label:string,destructive=false)=><DropdownMenuItem key={action} variant={destructive?'destructive':'default'} onSelect={()=>void controller.current?.open(latest.current.connection,latest.current.voyage,action)}>{label}</DropdownMenuItem>;
    return <div ref={host} className={accessTrigger?undefined:'voyage-action-host'}>
        {accessTrigger?<Button variant="outline" type="button" aria-label="Review access mode" onClick={()=>void controller.current?.open(latest.current.connection,latest.current.voyage,'access')}>{triggerLabel||'Access mode'}</Button>:<DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" type="button" size="icon-sm" aria-label="Voyage actions" title="Voyage actions"><MoreHorizontalIcon aria-hidden="true"/></Button></DropdownMenuTrigger>
            <DropdownMenuContent portalContainer={portalContainer} data-actions aria-label="Voyage actions" align="end" className="voyage-action-menu min-w-48">
                {item('details','Details')}
                <DropdownMenuSeparator/>
                <DropdownMenuLabel>Manage</DropdownMenuLabel>
                {!archived&&<>{item('rename','Rename')}{item('access','Access mode')}{item('branch','Branch')}</>}{item('archive',archived?'Restore':'Archive')}
                {!archived&&<><DropdownMenuSeparator/><DropdownMenuLabel>Run and history</DropdownMenuLabel>{voyage.active&&item('cancel','Stop run')}{item('compact','Compact context')}{item('clear','Clear conversation',true)}{item('delete','Delete',true)}</>}
            </DropdownMenuContent>
        </DropdownMenu>}
        {container&&<Dialog open={open} onOpenChange={next=>{if(!next){controller.current?.invalidate();setOpen(false);}}}>
            <DialogContent portalContainer={container} showCloseButton={false} className="settings-dialog sidebar-action-dialog w-[440px] sm:max-w-[calc(100vw-2rem)]" onInteractOutside={event=>event.preventDefault()}>
                <form id="sidebar-action-form" ref={node=>{if(node){showResolver.current?.();showResolver.current=null;}}}>
                    <header><DialogTitle asChild><h2 id="sidebar-action-title"/></DialogTitle></header>
                    <p id="sidebar-action-target"/><p id="sidebar-action-status" role="status"/>
                    <div id="sidebar-details-summary" hidden><Card size="sm"><CardContent><dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2"><dt>Name</dt><dd id="sidebar-details-name" className="break-all"/><dt>Process</dt><dd id="sidebar-details-process"/><dt>Latest run</dt><dd id="sidebar-details-run"/><dt>Access</dt><dd id="sidebar-details-access"/><dt>Workspace</dt><dd id="sidebar-details-workspace" className="break-all"/></dl></CardContent></Card></div>
                    <div id="sidebar-details-advanced" hidden><Collapsible><CollapsibleTrigger asChild><Button variant="ghost" type="button">Technical details</Button></CollapsibleTrigger><CollapsibleContent forceMount><pre id="sidebar-action-details"/></CollapsibleContent></Collapsible></div>
                    <label id="sidebar-name-field" hidden>Name<Input id="sidebar-name" maxLength={256}/></label>
                    <label id="sidebar-access-field" hidden>Access mode<NativeSelect id="sidebar-access"><option value="read-only">Read only</option><option value="approval">Approval</option><option value="unrestricted">Full access</option></NativeSelect></label>
                    <Alert id="sidebar-access-review" hidden><AlertDescription id="sidebar-access-summary"/></Alert>
                    <label id="sidebar-branch-field" hidden>Branch through<NativeSelect id="sidebar-branch"/><Button variant="ghost" id="sidebar-branch-more" type="button">Load more branch points</Button></label>
                    <label id="sidebar-retain-field" hidden>Recent messages to retain<Input id="sidebar-retain" type="number" min="0" max="4294967295" defaultValue="128"/></label>
                    <label id="sidebar-confirm-field" hidden><span id="sidebar-confirm-label"/><Input id="sidebar-confirm" autoComplete="off"/></label>
                    <footer><Button variant="ghost" id="sidebar-reconcile" type="button">Check pending receipt</Button><Button variant="outline" id="sidebar-dismiss" type="button">Close</Button><Button id="sidebar-submit" type="submit" disabled>Confirm</Button></footer>
                </form>
            </DialogContent>
        </Dialog>}
    </div>;
}
