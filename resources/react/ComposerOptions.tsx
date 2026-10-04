import React from 'react';
import {ChevronDownIcon} from 'lucide-react';
import {Button} from './components/ui/button';
import {DropdownMenu,DropdownMenuContent,DropdownMenuRadioGroup,DropdownMenuRadioItem,DropdownMenuTrigger} from './components/ui/dropdown-menu';

export type ComposerOptionName='Account'|'Model'|'Service tier'|'Reasoning'|'Access';
export function ComposerOptionTrigger({name,label,className,...props}:React.ComponentProps<typeof Button>&{name:ComposerOptionName;label:string}){
    return <Button variant="ghost" type="button" aria-label={`${name}: ${label}`} className={['composer-option-trigger',className].filter(Boolean).join(' ')} {...props}><span className="composer-option-label">{label}</span><ChevronDownIcon aria-hidden="true"/></Button>;
}
// Stateless presentation: controllers supply observed choices, authority and effects.
export function ComposerChoice({name,value,options,disabled,onChange,children}:{name:ComposerOptionName;value:string;options:{value:string;label:string;disabled?:boolean}[];disabled:boolean;onChange:(value:string)=>void;children?:React.ReactNode}){
    const selected=options.find(item=>item.value===value);
    return <DropdownMenu><DropdownMenuTrigger asChild><ComposerOptionTrigger name={name} label={selected?.label||value||'Unavailable'} disabled={disabled}/></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuRadioGroup value={value} onValueChange={onChange}>{options.map(item=><DropdownMenuRadioItem key={item.value} value={item.value} disabled={disabled||item.disabled}>{item.label}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup>{children}</DropdownMenuContent></DropdownMenu>;
}
export function ComposerOptions({children,className}:{children:React.ReactNode;className?:string}){
    return <div aria-label="Composer settings" className={['composer-settings',className].filter(Boolean).join(' ')}>{children}</div>;
}
