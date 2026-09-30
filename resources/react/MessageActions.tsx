import React,{useEffect,useRef,useState} from 'react';
import {PencilIcon} from 'lucide-react';
import {Button} from './components/ui/button';
import {Textarea} from './components/ui/textarea';
import {NativeSelect} from './components/ui/native-select';
import {Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle} from './components/ui/dialog';
import {VoyageActions} from './VoyageActions';
import {messagePoint,placeMessageDraft,reviewMessageDraft,type DraftPlacement,type MessageDraftReview} from './message-draft';
import type {Tab,Workspace} from './workspace';

export function MessageActions({tab,workspace,message,connection,voyage,active,onPrepared}:{tab:Tab;workspace:Workspace;message:any;connection?:any;voyage?:any;active:boolean;onPrepared:()=>void}){
    const [open,setOpen]=useState(false),[review,setReview]=useState<MessageDraftReview|null>(null),[text,setText]=useState(''),[placement,setPlacement]=useState<DraftPlacement>('append'),[busy,setBusy]=useState(false),[error,setError]=useState('');
    const epoch=useRef(0),prepared=useRef(false),activeRef=useRef(active),editTrigger=useRef<HTMLButtonElement>(null);activeRef.current=active;
    const close=()=>{epoch.current++;setOpen(false);setBusy(false);};
    useEffect(()=>{if(!active)close();return()=>{epoch.current++;};},[active]);
    if(message.role!=='user'||!Number.isSafeInteger(message.message_index))return null;
    let point;try{point=messagePoint(tab,message);}catch{/* The visible action explains its unavailable state. */}
    const begin=async()=>{
        const mine=++epoch.current;prepared.current=false;setOpen(true);setBusy(true);setError('');setReview(null);
        try{
            const next=await reviewMessageDraft(workspace,tab,message);
            if(mine!==epoch.current||!activeRef.current)return;
            setReview(next);setText(next.text);setPlacement(next.draft?'append':'replace');
        }catch(reason){if(mine===epoch.current)setError(reason instanceof Error?reason.message:'The message could not be prepared.');}
        finally{if(mine===epoch.current)setBusy(false);}
    };
    const apply=()=>{
        if(!review||busy||!activeRef.current)return;
        try{placeMessageDraft(workspace,tab,review,text,placement);prepared.current=true;close();}
        catch(reason){setError(reason instanceof Error?reason.message:'The draft could not be prepared.');}
    };
    return <div className="flex flex-wrap justify-end gap-1 pt-2">
        <Button ref={editTrigger} variant="ghost" size="sm" type="button" disabled={!point||!active} title={!point?'Reconnect and review the current message first.':'Prepare an edited message as an unsent draft'} onClick={()=>void begin()}><PencilIcon aria-hidden="true"/><span>Edit as draft</span></Button>
        {connection&&voyage&&point&&<VoyageActions connection={connection} voyage={voyage} onChanged={()=>workspace.connectionChanged()} branchBoundary={point} branchTrigger disabled={!active}/>}
        <Dialog open={open} onOpenChange={next=>{if(!next)close();}}><DialogContent onCloseAutoFocus={event=>{event.preventDefault();if(!activeRef.current)return;if(prepared.current){prepared.current=false;onPrepared();}else editTrigger.current?.focus();}}>
            <DialogHeader><DialogTitle>Edit message as a draft</DialogTitle><DialogDescription>Prepare this text in the composer, then review it before sending. The saved conversation remains available.</DialogDescription></DialogHeader>
            {busy&&<p role="status">Reading complete message…</p>}
            {review&&<>
                <label className="grid gap-2 text-sm">Message text<Textarea aria-label="Edited message text" value={text} onChange={event=>setText(event.target.value)} rows={8}/></label>
                {review.draft&&<label className="grid gap-2 text-sm">Composer text<NativeSelect aria-label="Prepare edited message" value={placement} onChange={event=>setPlacement(event.target.value as DraftPlacement)}><option value="append">Keep my draft and add this text</option><option value="replace">Replace my draft text</option></NativeSelect></label>}
                <p className="text-sm text-muted-foreground">{review.pictureIds.length?`${review.pictureIds.length} currently attached picture${review.pictureIds.length===1?' stays':'s stay'} in the composer.`:'No currently attached pictures will be changed.'}</p>
                {review.historicalPictures>0&&<p className="text-sm text-muted-foreground">Pictures from this earlier message stay in its history. Add the pictures you want to include in the new draft.</p>}
            </>}
            {error&&<p role="alert" className="text-sm">{error}</p>}
            <DialogFooter><Button variant="outline" type="button" onClick={close}>Cancel</Button><Button type="button" disabled={!review||busy} onClick={apply}>{review?.draft&&placement==='append'?'Add to draft':review?.draft?'Replace draft text':'Prepare draft'}</Button></DialogFooter>
        </DialogContent></Dialog>
    </div>;
}
