import React,{useRef,useState} from 'react';
import {Button} from './components/ui/button';
import {MoreHorizontalIcon} from 'lucide-react';
import {DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuTrigger} from './components/ui/dropdown-menu';

export function ProfileActions({name,isDefault,disabled,onEdit,onDuplicate,onDefault,onDelete}:{name:string;isDefault:boolean;disabled:boolean;onEdit:()=>void;onDuplicate:()=>void;onDefault:()=>void;onDelete:()=>void}){
    const trigger=useRef<HTMLButtonElement>(null);
    const [open,setOpen]=useState(false);
    const choose=(action:()=>void)=>{setOpen(false);action();};
    return <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild><Button ref={trigger} variant="ghost" size="icon" type="button" className="profile-actions-trigger" aria-label={`Actions for ${name}`} title={`Actions for ${name}`} disabled={disabled}><MoreHorizontalIcon aria-hidden="true"/></Button></DropdownMenuTrigger>
        <DropdownMenuContent portalContainer={trigger.current?.closest<HTMLElement>('[data-slot="dialog-content"]')} align="end" aria-label={`Actions for ${name}`} className="profile-actions-menu">
            <DropdownMenuItem asChild onSelect={()=>choose(onEdit)}><Button variant="ghost" type="button" className="w-full justify-start">Edit</Button></DropdownMenuItem>
            <DropdownMenuItem asChild onSelect={()=>choose(onDuplicate)}><Button variant="ghost" type="button" className="w-full justify-start">Duplicate</Button></DropdownMenuItem>
            <DropdownMenuItem asChild disabled={isDefault} onSelect={()=>choose(onDefault)}><Button variant="ghost" type="button" className="w-full justify-start" disabled={isDefault}>{isDefault?'Default profile':'Make default'}</Button></DropdownMenuItem>
            <DropdownMenuItem asChild variant="destructive" onSelect={()=>choose(onDelete)}><Button variant="ghost" type="button" className="w-full justify-start text-destructive hover:text-destructive">Delete</Button></DropdownMenuItem>
        </DropdownMenuContent>
    </DropdownMenu>;
}
