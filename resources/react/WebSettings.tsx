import React from 'react';
import {AttentionPolicySettings} from './AttentionPolicySettings';
import {Button} from './components/ui/button';
import {Card,CardContent,CardDescription,CardHeader,CardTitle} from './components/ui/card';
import {Dialog,DialogContent,DialogTitle} from './components/ui/dialog';
import {ExternalLinkIcon,MonitorIcon,UserRoundIcon,XIcon} from 'lucide-react';

export type WebSettingsPage = 'account' | 'appearance' | 'inbox';
export type WebAccount = {
    tenantId?: string;
    accountName?: string; accountEmail?: string; plan?: string; vesselLimit?: number;
    vessels: {id:string}[]; paidThrough?: string | null; billingEnabled?: boolean;
    billingCheckoutUrl?: string; billingPortalUrl?: string | null;
};

function CheckoutButton({url, plan, interval, label}: {url:string; plan:'basic'|'pro'; interval:'month'|'year'; label:string}) {
    const token = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || '';
    return <form action={url} method="post"><input type="hidden" name="_token" value={token}/><input type="hidden" name="plan" value={plan}/><input type="hidden" name="interval" value={interval}/><Button variant={interval==='year'?'default':'outline'} size="sm" type="submit">{label}</Button></form>;
}

export function WebSettings({account,page,onPageChange,appearance,onAppearanceChange,onManageVessels,onClose}: {
    account:WebAccount; page:WebSettingsPage; onPageChange:(page:WebSettingsPage)=>void;
    appearance:string; onAppearanceChange:(mode:string)=>void; onManageVessels:()=>void; onClose:()=>void;
}) {
    const limit = account.vesselLimit ?? 64;
    const count = account.vessels.length;
    return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent showCloseButton={false} className="settings-dialog web-settings-dialog w-[min(760px,calc(100vw-24px))] max-w-none gap-0 p-0 sm:max-w-none" aria-labelledby="web-settings-title">
        <header className="flex items-center gap-3 border-b px-5 py-4"><DialogTitle asChild><h2 id="web-settings-title" className="flex-1 text-base font-semibold">Settings</h2></DialogTitle><Button variant="ghost" size="icon" type="button" aria-label="Close settings" onClick={onClose}><XIcon aria-hidden="true"/></Button></header>
        <div className="grid min-h-0 sm:grid-cols-[190px_minmax(0,1fr)]">
            <nav className="flex flex-wrap gap-1 border-b p-3 sm:flex-col sm:flex-nowrap sm:border-r sm:border-b-0" aria-label="Settings pages">
                <Button variant={page==='account'?'secondary':'ghost'} type="button" className="justify-start" aria-current={page==='account'?'page':undefined} onClick={()=>onPageChange('account')}><UserRoundIcon aria-hidden="true"/>HelmWeb Account</Button>
                <Button variant={page==='appearance'?'secondary':'ghost'} type="button" className="justify-start" aria-current={page==='appearance'?'page':undefined} onClick={()=>onPageChange('appearance')}><MonitorIcon aria-hidden="true"/>Appearance</Button>
                <Button variant={page==='inbox'?'secondary':'ghost'} type="button" className="justify-start" aria-current={page==='inbox'?'page':undefined} onClick={()=>onPageChange('inbox')}>Inbox</Button>
            </nav>
            <div className="max-h-[min(70dvh,620px)] min-h-0 space-y-4 overflow-y-auto p-5">
                {page==='account' && <section aria-label="HelmWeb Account" className="space-y-4">
                    <div><h3 className="text-lg font-semibold">HelmWeb Account</h3><p className="text-sm text-muted-foreground">{account.accountName || account.accountEmail || 'Your account'}{account.accountEmail && account.accountName ? ` · ${account.accountEmail}` : ''}</p></div>
                    <Card className="gap-2"><CardHeader><CardTitle className="capitalize">{account.billingEnabled ? `${account.plan || 'free'} plan` : 'Vessel connections'}</CardTitle><CardDescription>{count} of {limit} Vessel connections used{account.billingEnabled && account.paidThrough && account.plan !== 'free' ? ` · Paid through ${new Date(account.paidThrough).toLocaleDateString()}` : ''}</CardDescription></CardHeader><CardContent><Button variant="outline" type="button" onClick={onManageVessels}>Manage Vessels</Button></CardContent></Card>
                    {account.billingEnabled && account.plan === 'free' && account.billingCheckoutUrl && <div className="grid gap-3 md:grid-cols-2" aria-label="HelmWeb plans">{([['basic',16,3,30],['pro',64,9,90]] as const).map(([plan,capacity,monthly,annual])=><Card key={plan} className="gap-2"><CardHeader><CardTitle className="capitalize">{plan} · {capacity} Vessels</CardTitle><CardDescription>${monthly}/month or ${annual}/year. Annual is 10 months’ price.</CardDescription></CardHeader><CardContent className="flex flex-wrap gap-2"><CheckoutButton url={account.billingCheckoutUrl!} plan={plan} interval="month" label="Monthly"/><CheckoutButton url={account.billingCheckoutUrl!} plan={plan} interval="year" label="Annual"/></CardContent></Card>)}</div>}
                    {account.billingEnabled && account.plan !== 'free' && account.billingPortalUrl && <a className="inline-flex items-center gap-1 text-sm underline underline-offset-2" href={account.billingPortalUrl} target="_blank" rel="noopener noreferrer">Manage billing in Stripe <ExternalLinkIcon className="size-3" aria-hidden="true"/></a>}
                    {!account.billingEnabled && <p className="text-sm text-muted-foreground">Paid plans are being prepared. Your current connection allowance is shown above.</p>}
                    <p className="text-xs text-muted-foreground">If your plan limit falls, Helm Web keeps the Vessels you put first in Manage Vessels. Voyages already running on their hosts continue.</p>
                </section>}
                {page==='inbox' && <AttentionPolicySettings tenantId={account.tenantId}/>}
                {page==='appearance' && <section aria-label="Appearance" className="space-y-4"><div><h3 className="text-lg font-semibold">Appearance</h3><p className="text-sm text-muted-foreground">Choose how Helm Web looks in this browser.</p></div><div className="grid gap-2">{(['light','dark','system'] as const).map(mode=><Button key={mode} variant={appearance===mode?'secondary':'outline'} type="button" className="justify-start capitalize" aria-pressed={appearance===mode} onClick={()=>onAppearanceChange(mode)}>{mode}</Button>)}</div></section>}
            </div>
        </div>
    </DialogContent></Dialog>;
}
