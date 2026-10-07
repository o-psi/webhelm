export const MAX_PREVIEW_BYTES = 128 * 1024;
export const MAX_PREVIEWS = 6;
export const MAX_PREVIEW_TOTAL = 256 * 1024;
export const PREVIEW_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; worker-src 'none'; manifest-src 'none'";
export const PREVIEW_PERMISSIONS = "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; display-capture 'none'; fullscreen 'none'; payment 'none'; usb 'none'; serial 'none'";
export const PREVIEW_PALETTE = ['background','foreground','muted','muted-foreground','border','primary','primary-foreground','card','card-foreground'] as const;
export type PreviewPalette = Record<string, string>;

export function previewBytes(source: string): number {
    return source.length <= MAX_PREVIEW_BYTES ? new TextEncoder().encode(source).length : Infinity;
}

export function previewDocument(source: string, channel: string, palette: PreviewPalette, interactive = false): string {
    if (!source.trim() || previewBytes(source) > MAX_PREVIEW_BYTES) throw Error('Preview exceeds the 128 KiB document limit.');
    if (!/^[a-f0-9]{32}$/.test(channel)) throw Error('Invalid preview channel.');
    // A template is inert: unlike DOMParser's HTML document, its images/frames cannot fetch while preparing.
    const template = document.createElement('template');
    template.innerHTML = source;
    const clean = (root: DocumentFragment) => {
        for (const node of Array.from(root.querySelectorAll('base,meta,iframe,frame,object,embed,link,script[src]'))) node.remove();
        for (const nested of Array.from(root.querySelectorAll('template'))) clean(nested.content);
    };
    clean(template.content);
    for (const node of Array.from(template.content.querySelectorAll('[autofocus]'))) node.removeAttribute('autofocus');
    let bodyAttributes='';
    if (/^\s*(?:<!doctype\s+html[^>]*>\s*)?<html\b/i.test(source)) {
        const body=/<body\b((?:"[^"]*"|'[^']*'|[^'">])*)>/i.exec(source);
        if(body){
            const holder=document.createElement('template');holder.innerHTML='<div'+body[1]+'></div>';
            const element=holder.content.firstElementChild;
            for(const attribute of Array.from(element?.attributes??[])){
                if(attribute.name==='autofocus')continue;
                bodyAttributes+=` ${attribute.name}="${attribute.value.replace(/[&<>"']/g,value=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[value]!))}"`;
            }
        }
    }
    const initial = JSON.stringify(palette).replaceAll('<', '\\u003c');
    const bootstrap = `(()=>{
        const channel=${JSON.stringify(channel)};
        for(const name of ['RTCPeerConnection','webkitRTCPeerConnection','showOpenFilePicker','showSaveFilePicker','showDirectoryPicker']){
            try{Object.defineProperty(window,name,{value:undefined,writable:false,configurable:false});}catch{}
        }
        const theme=values=>{for(const key of ${JSON.stringify(PREVIEW_PALETTE)})if(typeof values?.[key]==='string')document.documentElement.style.setProperty('--'+key,values[key]);};
        theme(${initial});
        addEventListener('message',event=>{if(event.source===parent&&event.data?.channel===channel&&event.data?.kind==='theme')theme(event.data.palette);});
        let scheduled=false;
        const measure=()=>{if(scheduled)return;scheduled=true;setTimeout(()=>{scheduled=false;parent.postMessage({channel,kind:'height',height:Math.max(document.body?.scrollHeight||0,document.documentElement.scrollHeight)},'*');},100);};
        addEventListener('DOMContentLoaded',()=>{new ResizeObserver(measure).observe(document.body);measure();parent.postMessage({channel,kind:'ready'},'*');});
        addEventListener('error',()=>parent.postMessage({channel,kind:'error'},'*'));
        addEventListener('unhandledrejection',()=>parent.postMessage({channel,kind:'error'},'*'));
    })();`;
    const colors=PREVIEW_PALETTE.map(key=>`--${key}:${(palette[key]||'').replaceAll('<','\\3c ')};`).join('');
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{color-scheme:light dark;${colors}}*{box-sizing:border-box}body{margin:0;padding:16px;font:14px/1.5 system-ui,sans-serif;color:var(--foreground);background:var(--background)}button,input,select,textarea{font:inherit}</style>${interactive?`<script>${bootstrap}</script>`:''}</head><body${bodyAttributes}>${template.innerHTML}</body></html>`;
}

export function previewMessage(event: MessageEvent, owner: Window | null, channel: string): {kind:'ready'|'height'|'error';height?:number} | null {
    if (!owner || event.source !== owner || event.origin !== 'null' || event.data?.channel !== channel) return null;
    if (event.data.kind === 'ready' || event.data.kind === 'error') return {kind:event.data.kind};
    if (event.data.kind !== 'height' || !Number.isSafeInteger(event.data.height) || event.data.height < 0 || event.data.height > 100000) return null;
    return {kind:'height',height:Math.max(180,Math.min(640,event.data.height))};
}
