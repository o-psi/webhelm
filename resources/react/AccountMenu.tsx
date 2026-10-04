import React from 'react';
import {UserRoundIcon} from 'lucide-react';
import {Button} from './components/ui/button';
import {DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuLabel,DropdownMenuRadioGroup,DropdownMenuRadioItem,DropdownMenuSeparator,DropdownMenuTrigger} from './components/ui/dropdown-menu';

type AccountMenuProps = {
    name?: string;
    email?: string;
    appearance: string;
    onAppearanceChange: (value: string) => void;
    onAccount: () => void;
    onAppearanceSettings: () => void;
    onConnections: () => void;
    onLogout: () => void;
    portalContainer?: HTMLElement | null;
};

export function AccountMenu({name,email,appearance,onAppearanceChange,onAccount,onAppearanceSettings,onConnections,onLogout,portalContainer}: AccountMenuProps) {
    return <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="icon-button" aria-label="Account and appearance"><UserRoundIcon aria-hidden="true"/></Button></DropdownMenuTrigger>
        <DropdownMenuContent portalContainer={portalContainer} side="top" align="end" className="w-64">
            <DropdownMenuLabel><span className="block break-words">{name || 'Account'}</span>{email && <span className="block break-words text-xs font-normal text-muted-foreground">{email}</span>}</DropdownMenuLabel>
            <DropdownMenuSeparator/>
            <DropdownMenuItem onSelect={onAccount}>HelmWeb Account</DropdownMenuItem>
            <DropdownMenuItem onSelect={onConnections}>Vessel connections</DropdownMenuItem>
            <DropdownMenuSeparator/>
            <DropdownMenuLabel>Appearance</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={appearance} onValueChange={onAppearanceChange} aria-label="Appearance">
                <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuItem onSelect={onAppearanceSettings}>Appearance settings</DropdownMenuItem>
            <DropdownMenuSeparator/>
            <DropdownMenuItem onSelect={onLogout}>Sign out</DropdownMenuItem>
        </DropdownMenuContent>
    </DropdownMenu>;
}
