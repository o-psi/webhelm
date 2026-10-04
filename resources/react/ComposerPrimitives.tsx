import React from 'react';
import {Card} from './components/ui/card';
import {Textarea} from './components/ui/textarea';

// Presentation and keyboard semantics only. Callers retain draft and effect ownership.
export function ComposerBox({children}:{children:React.ReactNode}){
    return <Card className="composer-box gap-2 p-3 shadow-sm" size="sm">{children}</Card>;
}
export function ComposerInput({onSend,onDiscover,...props}:Omit<React.ComponentProps<'textarea'>,'onKeyDown'> & {onSend:()=>void;onDiscover?:()=>void}){
    return <Textarea className="border-0 bg-transparent px-0 py-0 shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent" aria-label="Message" {...props} onKeyDown={event=>{
        if(event.nativeEvent.isComposing)return;
        if(event.key==='/'&&onDiscover&&!event.currentTarget.value&&event.currentTarget.selectionStart===0){event.preventDefault();onDiscover();}
        else if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();onSend();}
    }}/>;
}
