import {DraftSlot,type DraftRepository} from './drafts';
import React, {useEffect, useRef, useState} from 'react';
import {ArrowUpIcon,PaperclipIcon,Settings2Icon,XIcon} from 'lucide-react';
import {Button} from './components/ui/button';
import {Card} from './components/ui/card';
import {Input} from './components/ui/input';
import {SelectCombobox} from './components/ui/select-combobox';
import {Textarea} from './components/ui/textarea';
import {WorkspacePicker} from './WorkspacePicker';
import {sameAccount,profileSettings,profileSummary} from '../js/execution-profiles.js';
import {Creation,accountChoices,vesselRead} from './settings';
import {preparePicture,MAX_PICTURE_BYTES,MAX_PICTURES} from './prepare-picture';

export type NewVoyageMessage = {text:string; pictures:File[]; access:'read-only'|'approval'|'unrestricted'; send:boolean; applyAccess:boolean};
export type RecoveryDraft = {vessel:string; workspace:string; text:string; hasPictures:boolean; source:string};

export function NewVoyage({fleet,tenant,drafts,onDraftChange,hidden,resetToken,reloadToken,recovery,onCreated,onAdvanced}:{fleet:any;tenant:string;drafts?:DraftRepository;onDraftChange?:(present:boolean)=>void;hidden:boolean;resetToken:number;reloadToken:number;recovery?:RecoveryDraft|null;onCreated:(vessel:string,process:any,message:NewVoyageMessage)=>Promise<void>|void;onAdvanced:(location:{vessel:string;workspace:string})=>void}){
    const connections=[...fleet.connections.values()] as any[];
    const [,refreshDraft]=useState(0);
    const [draftSlot]=useState(()=>drafts?new DraftSlot(drafts,'new-voyage',()=>refreshDraft(value=>value+1)):null);
    const [draftReady,setDraftReady]=useState(!draftSlot);
    const previousReset=useRef(resetToken);
    const currentRecovery=useRef(recovery);currentRecovery.current=recovery;

    const [vessel,setVessel]=useState<string>(()=>connections.find(item=>item.client)?.id||connections[0]?.id||'');
    const connection=fleet.connections.get(vessel);
    const [caps,setCaps]=useState<any>(null),[path,setPath]=useState(''),[catalogue,setCatalogue]=useState<any>(null),[accounts,setAccounts]=useState<any[]>([]),[profileId,setProfileId]=useState('');
    const [choicesFor,setChoicesFor]=useState<{vessel:string;path:string;client:any;reloadToken:number}|null>(null);
    const [modelOptions,setModelOptions]=useState<any[]>([]),[modelChoicesFor,setModelChoicesFor]=useState<string|null>(null);
    const [modelChoice,setModelChoice]=useState<string|null>(null),[reasoningChoice,setReasoningChoice]=useState<string|null>(null);
    const [text,setText]=useState(''),[pictures,setPictures]=useState<File[]>([]),[access,setAccess]=useState<NewVoyageMessage['access']>('approval');
    const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[preparing,setPreparing]=useState(false);
    const input=useRef<HTMLTextAreaElement>(null),pictureInput=useRef<HTMLInputElement>(null),creation=useRef<Creation|null>(null),capsGeneration=useRef(0),profilesGeneration=useRef(0),modelsGeneration=useRef(0);
    const profile=catalogue?.profiles?.find((item:any)=>item.id===profileId);
    const profileAccount=accounts.find(item=>sameAccount(item.binding,profile?.account));
    const selectedModel=modelChoice||profile?.model||'';
    const selectedReasoning=reasoningChoice===null?(modelChoice?'':profile?.reasoning_effort||''):reasoningChoice;
    const modelContext=profile&&profileAccount?.ready?JSON.stringify([vessel,path,profile.id,profileAccount.binding,connection?.client===choicesFor?.client?choicesFor?.reloadToken:null]):null;
    const modelsReady=modelContext!==null&&modelChoicesFor===modelContext;
    const currentModel=modelOptions.find(item=>item.id===selectedModel);
    useEffect(()=>{if(!hidden)input.current?.focus();},[hidden]);
    useEffect(()=>{onDraftChange?.(Boolean(text||pictures.length));},[text,pictures,onDraftChange]);
    useEffect(()=>{
        const leaving=(event:BeforeUnloadEvent)=>{if(draftSlot&&(draftSlot.value.text||draftSlot.value.pictures.length)){event.preventDefault();event.returnValue='';}};
        window.addEventListener('beforeunload',leaving);return()=>window.removeEventListener('beforeunload',leaving);
    },[draftSlot]);
    useEffect(()=>{
        if(previousReset.current===resetToken)return;
        previousReset.current=resetToken;
        setText('');setPictures([]);setNotice('');draftSlot?.set({text:'',pictures:[]});
    },[resetToken]);
    useEffect(()=>{
        if(!draftSlot)return;
        let active=true;
        void draftSlot.loaded().then(()=>{
            if(!active)return;
            if(!currentRecovery.current){setText(draftSlot.value.text);setPictures(draftSlot.value.pictures);
                if(draftSlot.value.destination){setVessel(draftSlot.value.destination.vessel);setPath(draftSlot.value.destination.workspace);}}
            setDraftReady(true);
        });
        return()=>{active=false;};
    },[draftSlot]);
    useEffect(()=>{
        if(draftReady)draftSlot?.set({text,pictures,destination:{vessel,workspace:path},delivery:draftSlot.value.delivery});
    },[text,pictures,vessel,path,draftReady]);
    useEffect(()=>{
        if(!recovery)return;
        setVessel(recovery.vessel);setPath(recovery.workspace);setText(recovery.text);setPictures([]);setNotice('');
    },[recovery]);
    useEffect(()=>{
        const epoch=++capsGeneration.current;
        setCaps(null);setCatalogue(null);setAccounts([]);setChoicesFor(null);
        if(!connection?.client){setNotice(connection?'Vessel is offline.':'Connect a Vessel to begin.');return;}
        setNotice('Loading Vessel choices…');
        void vesselRead(connection,'capabilities').then(value=>{
            if(epoch!==capsGeneration.current||connection.client!==fleet.connections.get(vessel)?.client)return;
            if(value.vessel_id!==connection.vessel_id)throw new Error('Vessel identity changed.');
            if(!value.features?.includes('execution_profiles'))throw new Error('This Vessel needs an update. Open Manage Vessels to review maintenance.');
            if(value.scope!=='owner'&&(!value.rights?.includes('create')||!value.rights?.includes('account_use')))throw new Error('This connection cannot create a voyage with this account.');
            setCaps(value);setPath(current=>value.scope==='owner'?current||value.workspaces?.[0]?.path||'':value.workspaces?.some((choice:any)=>choice.path===current)?current:value.workspaces?.[0]?.path||'');setNotice('');
        }).catch(error=>{if(epoch===capsGeneration.current)setNotice(error instanceof Error?error.message:'Vessel unavailable.');});
        return()=>{capsGeneration.current++;};
    },[vessel,connection?.client]);
    useEffect(()=>{
        const epoch=++profilesGeneration.current;
        setCatalogue(null);setAccounts([]);setChoicesFor(null);
        if(!caps||!path.startsWith('/')||!connection?.client)return;
        const timer=window.setTimeout(()=>{
            void Promise.all([vesselRead(connection,'profiles',{workspace:path}),vesselRead(connection,'accounts',{workspace:path,transport:null})]).then(([profiles,accountCatalogue])=>{
                if(epoch!==profilesGeneration.current||connection.client!==fleet.connections.get(vessel)?.client)return;
                setCatalogue(profiles);setAccounts(accountChoices(accountCatalogue));setChoicesFor({vessel,path,client:connection.client,reloadToken});
                setProfileId(current=>profiles.profiles?.some((item:any)=>item.id===current)?current:profiles.default_profile_id||profiles.profiles?.[0]?.id||'');
                setNotice('');
            }).catch(error=>{if(epoch===profilesGeneration.current)setNotice(error instanceof Error?error.message:'Profiles unavailable.');});
        },180);
        return()=>{window.clearTimeout(timer);profilesGeneration.current++;};
    },[caps,path,vessel,connection?.client,reloadToken]);
    useEffect(()=>{setModelChoice(null);setReasoningChoice(null);},[profileId,path,vessel]);
    useEffect(()=>{
        const epoch=++modelsGeneration.current;setModelOptions([]);setModelChoicesFor(null);
        if(!profile||!profileAccount?.ready||!connection?.client||!modelContext)return;
        void vesselRead(connection,'account_models',{workspace:path,account:profileAccount.binding}).then(value=>{
            if(epoch!==modelsGeneration.current||connection.client!==fleet.connections.get(vessel)?.client||!sameAccount(value.account,profileAccount.binding))return;
            setModelOptions(value.models||[]);setModelChoicesFor(modelContext);
        }).catch(()=>{/* Saved profiles can still be used when model discovery is unavailable. */});
        return()=>{modelsGeneration.current++;};
    },[modelContext,connection?.client]);
    const pending=(()=>{try{creation.current??=new Creation(localStorage,tenant);return {records:creation.current.pending(),error:false};}catch{return {records:[],error:true};}})();
    const validOverride=!modelChoice&&!reasoningChoice||modelsReady&&Boolean(currentModel)&&(!selectedReasoning||currentModel.reasoning_efforts?.includes(selectedReasoning));
    const canCreate=Boolean(draftReady&&!busy&&!preparing&&!pending.error&&!pending.records.some((record:any)=>record.vessel===vessel)&&connection?.client&&caps&&path.startsWith('/')&&(caps.scope==='owner'||caps.workspaces?.some((choice:any)=>choice.path===path))&&choicesFor?.vessel===vessel&&choicesFor.path===path&&choicesFor.client===connection.client&&choicesFor.reloadToken===reloadToken&&profile&&profileAccount?.ready&&validOverride);
    const canSend=canCreate&&(caps.scope==='owner'||caps.rights?.includes('execute'));
    const hasMessage=Boolean(text.trim()||pictures.length);
    async function addPictures(files:File[]){
        if(!files.length||busy||preparing||!draftReady)return;
        setPreparing(true);
        try{
            let total=pictures.reduce((count,file)=>count+file.size,0);
            const prepared:File[]=[];
            for(const file of files){
                if(pictures.length+prepared.length>=MAX_PICTURES)throw new Error('At most four pictures per message.');
                const result=await preparePicture(file,MAX_PICTURE_BYTES-total);
                const ready=new File([result.blob],result.name,{type:result.blob.type});
                total+=ready.size;prepared.push(ready);
            }
            setPictures(current=>[...current,...prepared]);setNotice('');
        }catch(error){setNotice(error instanceof Error?error.message:'Picture unavailable.');}
        finally{setPreparing(false);}
    }
    async function create(send:boolean){
        if(!canCreate||send&&(!canSend||!hasMessage))return;
        if(send&&new TextEncoder().encode(text).length>65536){setNotice('Message must be 65536 UTF-8 bytes or fewer.');return;}
        setBusy(true);setNotice('Checking the selected Vessel and profile…');
        try{
            const client=connection.client, selected=profile, selectedRevision=catalogue.revision;
            const [latestCaps,latestCatalogue,latestAccounts]=await Promise.all([
                vesselRead(connection,'capabilities'),vesselRead(connection,'profiles',{workspace:path}),vesselRead(connection,'accounts',{workspace:path,transport:null}),
            ]);
            if(connection.client!==client||latestCaps.vessel_id!==connection.vessel_id||!latestCaps.features?.includes('execution_profiles')||latestCaps.scope!=='owner'&&(!latestCaps.rights?.includes('create')||!latestCaps.rights?.includes('account_use')))throw new Error('Vessel authority changed. Review the draft before sending.');
            if(latestCaps.scope!=='owner'&&!latestCaps.workspaces?.some((choice:any)=>choice.path===path))throw new Error('This workspace is no longer permitted. Choose a current workspace before sending.');
            const currentProfile=latestCatalogue.profiles?.find((item:any)=>item.id===selected.id);
            if(latestCatalogue.revision!==selectedRevision||!currentProfile||JSON.stringify(profileSettings(currentProfile))!==JSON.stringify(profileSettings(selected)))throw new Error('Saved profiles changed. Review the selected profile before sending.');
            if(!accountChoices(latestAccounts).some((item:any)=>item.ready&&sameAccount(item.binding,currentProfile.account)))throw new Error('The selected account is unavailable. Choose another profile.');
            const settings=profileSettings(currentProfile);
            if(modelChoice!==null||reasoningChoice!==null){
                const latestModels=await vesselRead(connection,'account_models',{workspace:path,account:settings.account});
                if(!sameAccount(latestModels.account,settings.account))throw new Error('Account identity changed. Review model choices.');
                const chosen=latestModels.models?.find((item:any)=>item.id===selectedModel);
                if(!chosen||selectedReasoning&&!chosen.reasoning_efforts?.includes(selectedReasoning))throw new Error('Model or reasoning choices changed. Review them before sending.');
                settings.model=selectedModel;settings.reasoning_effort=selectedReasoning||null;
                if(modelChoice!==null)settings.service_tier=null;
            }
            creation.current??=new Creation(localStorage,tenant);
            await draftSlot?.sending();
            const process=await creation.current.start(connection,path,settings);
            await onCreated(vessel,process,{text,pictures:[...pictures],access,send,applyAccess:true});
        }catch(error){setNotice(error instanceof Error?error.message:'Creation unavailable.');}
        finally{setBusy(false);}
    }
    async function reconcile(record:any){
        if(busy)return;setBusy(true);
        try{
            creation.current??=new Creation(localStorage,tenant);
            const target=fleet.connections.get(record.vessel),process=await creation.current.reconcile(target,record);
            if(process)await onCreated(target.id,process,{text,pictures:[...pictures],access,send:false,applyAccess:false});
            else setNotice('Creation was not admitted. Review the draft before trying again.');
        }catch(error){setNotice(error instanceof Error?error.message:'Creation receipt unavailable.');}
        finally{setBusy(false);}
    }
    return <section className={`new-voyage col-start-1 row-start-1 min-h-0 overflow-auto px-4 py-10 ${hidden?'hidden':'flex'}`} hidden={hidden} aria-label="New voyage">
        <div className="new-voyage-content m-auto w-full max-w-3xl">
            <h1 className="mb-6 text-center text-3xl font-medium tracking-tight">What should we work on?</h1>
            {recovery&&<div className="new-voyage-recovery mx-auto mb-4 max-w-2xl rounded-lg border p-3 text-sm" role="status"><strong>Continue from {recovery.source}</strong><p className="mb-0 mt-1">The earlier action may have happened. Review this draft before sending; repeating the same request could duplicate work. The original receipt remains in its voyage.{recovery.hasPictures?' Reattach any pictures you still need.':''}</p></div>}
            <form className="composer" aria-label="New voyage composer" onSubmit={event=>{event.preventDefault();void create(true);}} onPaste={event=>{if(event.clipboardData.files.length){event.preventDefault();void addPictures([...event.clipboardData.files]);}}} onDragOver={event=>{if(event.dataTransfer.types.includes('Files'))event.preventDefault();}} onDrop={event=>{if(event.dataTransfer.files.length){event.preventDefault();void addPictures([...event.dataTransfer.files]);}}}>
                <Card className="composer-box gap-2 p-3 shadow-sm" size="sm">
                    {notice&&<p className="composer-feedback" role="status">{notice}</p>}
                    {draftSlot&&<div className="composer-feedback" role="status"><p>{draftSlot.message}</p>{draftSlot.value.delivery==='review'&&<p>This draft may already belong to a created voyage. Check creation and the conversation before sending again.</p>}{(text||pictures.length>0)&&<Button variant="ghost" size="sm" type="button" disabled={busy||!draftReady} onClick={()=>{setText('');setPictures([]);void draftSlot.discard().catch(()=>{});}}>Discard draft</Button>}</div>}
                    {pending.error&&<p className="composer-feedback" role="alert">Recovery storage is unavailable. Creating a voyage is disabled.</p>}
                    {pictures.length>0&&<div className="new-voyage-pictures flex flex-wrap gap-2">{pictures.map((picture,index)=><div className="flex max-w-40 items-center gap-1 rounded-md border px-2 text-xs" key={`${picture.name}:${index}`}><span className="truncate" title={picture.name}>{picture.name}</span><Button variant="ghost" size="icon-xs" type="button" aria-label={`Remove ${picture.name}`} disabled={busy} onClick={()=>setPictures(current=>current.filter((_,i)=>i!==index))}><XIcon aria-hidden="true"/></Button></div>)}</div>}
                    <Textarea ref={input} className="border-0 bg-transparent px-0 py-0 shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent" aria-label="Message" rows={3} value={text} disabled={busy||!draftReady} onChange={event=>setText(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();void create(true);}}} placeholder="Ask for changes, send follow-ups, or attach pictures"/>
                    <Input ref={pictureInput} type="file" className="hidden" accept="image/png,image/jpeg,image/webp,image/heic,image/heif,.heic,.heif" multiple hidden onChange={event=>{const files=[...(event.target.files||[])];event.target.value='';void addPictures(files);}}/>
                    <div className="new-voyage-primary"><div className="new-voyage-inference">
                        <label className="new-voyage-choice"><span className="sr-only">Model</span><SelectCombobox value={selectedModel} disabled={busy||!modelsReady} onChange={event=>{setModelChoice(event.target.value);setReasoningChoice('');}}>{!modelsReady&&<option value={selectedModel}>{selectedModel||'Loading models…'}</option>}{modelsReady&&modelOptions.map((item:any)=><option key={item.id} value={item.id}>{item.display_name||item.id}</option>)}</SelectCombobox></label>
                        <label className="new-voyage-choice"><span className="sr-only">Reasoning</span><SelectCombobox value={selectedReasoning} disabled={busy||!modelsReady||!currentModel} onChange={event=>setReasoningChoice(event.target.value)}><option value="">Default</option>{[...new Set<string>([...(currentModel?.reasoning_efforts||[]),...(selectedReasoning?[selectedReasoning]:[])])].map(value=><option key={value} value={value}>{value}</option>)}</SelectCombobox></label>
                        <label className="new-voyage-choice"><span className="sr-only">Access</span><SelectCombobox value={access} disabled={busy} onChange={event=>setAccess(event.target.value as NewVoyageMessage['access'])}><option value="read-only">Read only</option><option value="approval">Approval</option><option value="unrestricted">Full access</option></SelectCombobox></label>
                    </div><div className="new-voyage-send-actions"><Button variant="ghost" size="icon" type="button" aria-label="Attach pictures" title="Attach pictures" disabled={busy||preparing} onClick={()=>pictureInput.current?.click()}><PaperclipIcon aria-hidden="true"/></Button><Button type="submit" size="icon" aria-label="Send" title="Send message" disabled={!canSend||!hasMessage}><ArrowUpIcon aria-hidden="true"/><span className="sr-only">{busy?'Working…':'Send'}</span></Button></div></div>
                </Card>
                <div className="new-voyage-context">
                    <label>Vessel<SelectCombobox value={vessel} disabled={busy} onChange={event=>{setVessel(event.target.value);setPath('');setProfileId('');}}>{connections.map(item=><option key={item.id} value={item.id}>{item.name}{!item.client?' · offline':''}</option>)}</SelectCombobox></label>
                    <div className="grid min-w-0 gap-[3px]"><span className="text-[11px] text-muted-foreground">Workspace</span><WorkspacePicker key={`${tenant}:${vessel}:${connection?.vessel_id}`} tenant={tenant} vessel={JSON.stringify([vessel,connection?.vessel_id])} vesselName={connection?.name||'Vessel'} value={path} choices={caps?.workspaces||[]} allowCustom={caps?.scope==='owner'} disabled={busy||!caps} onChoose={setPath}/></div>
                    <label>Profile<SelectCombobox value={profileId} disabled={busy||!catalogue} onChange={event=>setProfileId(event.target.value)}>{!catalogue&&<option value="">Loading profiles…</option>}{(catalogue?.profiles||[]).map((item:any)=><option key={item.id} value={item.id}>{item.name} · {item.model}</option>)}</SelectCombobox></label>
                </div>
                <div className="new-voyage-secondary"><small className="new-voyage-account" title={profile?profileSummary(profile,accounts):''}>{profile?(profileAccount?.label||'Account unavailable')+' · '+(modelChoice?'Model override for this voyage':'Saved profile')+(modelChoice?' · service tier resets to provider default':''):''}</small><Button variant="ghost" type="button" disabled={busy||!connection?.client||!path.startsWith('/')||!caps?.features?.includes('execution_profiles')} onClick={()=>onAdvanced({vessel,workspace:path})}><Settings2Icon aria-hidden="true"/>Manage profiles</Button><Button variant="ghost" type="button" disabled={!canCreate} onClick={()=>void create(false)}>Create without message</Button></div>
                <small className="new-voyage-hint">Send creates a voyage and confirms access before starting your message.</small>
            </form>
            {pending.records.length>0&&<div className="new-voyage-recovery mx-auto mt-4 flex max-w-2xl flex-wrap items-center gap-2 rounded-lg border p-3 text-sm"><p className="mb-0 w-full">Creation outcome needs review. Your draft is kept; no message will be sent during recovery.</p>{pending.records.map((record:any)=><Button variant="outline" key={record.key} disabled={busy} onClick={()=>void reconcile(record)}>Check creation · {fleet.connections.get(record.vessel)?.name||'Vessel'}</Button>)}</div>}
        </div>
    </section>;
}
