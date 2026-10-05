import {reviewGoal} from './goals';
import type {ComposerGoalIntent} from './composer-command';
import type {Workspace} from './workspace';
import type {NewVoyageMessage} from './NewVoyage';

// The draft crosses the creation boundary only after an exact start receipt.
// Every later effect stops when its own observed state is unavailable.
export async function completeNewVoyage(workspace:Workspace,key:string,message:NewVoyageMessage & {goalIntent?:ComposerGoalIntent}){
    if(message.goalIntent&&message.pictures.length)throw Error('Goal commands do not accept pictures. Your draft and pictures are kept.');
    await workspace.restoreDraft(key);
    workspace.draft(key,message.text);
    await workspace.refresh(key);
    const tab=workspace.tabs.get(key);
    if(!tab)return;
    if(message.pictures.length&&!await workspace.attach(key,message.pictures)){
        tab.notice='Some pictures could not be prepared. Review the retained draft before sending.';
        workspace.changed();return;
    }
    const contentGeneration=tab.contentGeneration;
    if(!message.applyAccess)return;
    if(!workspace.actionable(tab)||!workspace.permitted(tab,'set_access')){
        tab.notice='Voyage created. Access could not be reviewed yet; your message is unsent.';
        workspace.changed();return;
    }
    if(tab.snapshot.access!==message.access){
        const changed=await workspace.act(key,'set_access',{access:message.access});
        await workspace.refresh(key);
        if(!changed||tab.snapshot?.access!==message.access){
            tab.notice='Voyage created, but the chosen access mode is not confirmed. Your message is unsent. Check the access receipt.';
            workspace.changed();return;
        }
    }
    if(message.goalIntent){
        // Recovery transfers intent only. Never replay either creation or metadata.
        if(!message.send||!message.applyAccess)return;
        const review=reviewGoal(tab.snapshot,tab.incarnation);
        if(review.state.goal)throw Error('Review the existing goal before applying this retained intent.');
        const applied=await workspace.goalUpdate(key,review,{action:'set',...message.goalIntent});
        if(applied){workspace.clearContent(key,contentGeneration);await workspace.saveDrafts();}
        return;
    }
    if(!message.send)return;
    if(!workspace.actionable(tab)||!workspace.permitted(tab,'submit')){
        tab.notice='Voyage created with the chosen access mode. Your message is unsent; review its status before sending.';
        workspace.changed();return;
    }
    await workspace.act(key,'submit');
}
