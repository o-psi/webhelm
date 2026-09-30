import type {Tab,Workspace} from './workspace';

export type MessagePoint = {index:number;revision:number;incarnation:string};
export type MessageDraftReview = MessagePoint & {key:string;vessel:string;session:string;text:string;draft:string;pictureIds:string[];historicalPictures:number};
export type DraftPlacement = 'append'|'replace';
const maximum=65536;

export function messagePoint(tab:Tab,message:any):MessagePoint{
    if(tab.stale||tab.busy||tab.draftLoading||!tab.incarnation||message?.role!=='user'||!Number.isSafeInteger(message.message_index)||message.message_index<0||message.message_index>4294967295||!Number.isSafeInteger(tab.snapshot?.revision)||tab.snapshot.revision<0||tab.snapshot.session_id!==tab.session)throw new Error('Reconnect and review the current message first.');
    return {index:message.message_index,revision:tab.snapshot.revision,incarnation:tab.incarnation};
}
function samePoint(tab:Tab,point:MessagePoint){
    if(tab.stale||tab.busy||tab.draftLoading||tab.incarnation!==point.incarnation||tab.snapshot?.revision!==point.revision||tab.snapshot.session_id!==tab.session)throw new Error('The conversation changed. Reopen this message before preparing a draft.');
}
function messageText(message:any){
    if(message.projection_truncated)throw new Error('Read the complete message before editing it.');
    if(Array.isArray(message.parts)&&message.parts.length)return message.parts.filter((part:any)=>part.type==='text').map((part:any)=>typeof part.text==='string'?part.text:'').join('\n');
    if(typeof message.content==='string')return message.content;
    if(Array.isArray(message.content))return message.content.filter((part:any)=>part?.type==='text').map((part:any)=>typeof part.text==='string'?part.text:'').join('\n');
    throw new Error('Complete message text is unavailable.');
}
export async function reviewMessageDraft(workspace:Workspace,tab:Tab,message:any):Promise<MessageDraftReview>{
    const point=messagePoint(tab,message),draft=tab.draft,pictureIds=tab.pictures.map(picture=>picture.id);
    if(workspace.tabs.get(tab.key)!==tab)throw new Error('The voyage changed. Reopen the message.');
    if(message.projection_truncated)await workspace.expand(tab.key,point.index);
    samePoint(tab,point);
    if(workspace.tabs.get(tab.key)!==tab)throw new Error('The voyage changed. Reopen the message.');
    const canonical=tab.snapshot.messages?.find((entry:any)=>entry.message_index===point.index);
    if(canonical?.role!=='user')throw new Error('The selected user message is unavailable.');
    const text=messageText(canonical);
    if(new TextEncoder().encode(text).length>maximum)throw new Error('This message exceeds the 64 KiB composer limit.');
    const parts=Array.isArray(canonical.parts)?canonical.parts:Array.isArray(canonical.content)?canonical.content:[];
    return {...point,key:tab.key,vessel:tab.vessel,session:tab.session,text,draft,pictureIds,historicalPictures:parts.filter((part:any)=>part?.type==='image').length};
}
export function placeMessageDraft(workspace:Workspace,tab:Tab,review:MessageDraftReview,text:string,placement:DraftPlacement){
    samePoint(tab,review);
    if(workspace.tabs.get(review.key)!==tab||tab.key!==review.key||tab.vessel!==review.vessel||tab.session!==review.session)throw new Error('The voyage changed. Reopen the message.');
    const canonical=tab.snapshot.messages?.find((message:any)=>message.message_index===review.index);
    if(canonical?.role!=='user'||messageText(canonical)!==review.text)throw new Error('The selected message changed. Reopen it before preparing a draft.');
    if(tab.draft!==review.draft||tab.pictures.length!==review.pictureIds.length||tab.pictures.some((picture,index)=>picture.id!==review.pictureIds[index]))throw new Error('Your composer changed while editing. Reopen the message to keep the latest draft and pictures.');
    if(placement!=='append'&&placement!=='replace')throw new Error('Choose how to prepare the draft.');
    const prepared=placement==='append'&&review.draft.length?`${review.draft}\n\n${text}`:text;
    if(!prepared.trim()&&tab.pictures.length===0)throw new Error('Add message text before preparing the draft.');
    if(new TextEncoder().encode(prepared).length>maximum)throw new Error('The prepared draft exceeds 64 KiB. Shorten the text before preparing it.');
    workspace.draft(review.key,prepared);
    if(tab.draft!==prepared)throw new Error('The composer is unavailable. Your draft was not replaced.');
    return prepared;
}
