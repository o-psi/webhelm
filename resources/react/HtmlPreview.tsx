import React, {useEffect, useRef, useState} from 'react';
import {Button} from './components/ui/button';
import {Dialog,DialogContent,DialogDescription,DialogTitle} from './components/ui/dialog';
import {PREVIEW_PALETTE,PREVIEW_PERMISSIONS,previewDocument,previewMessage,type PreviewPalette} from './html-preview-document';

function palette(): PreviewPalette {
    const style = getComputedStyle(document.documentElement);
    return Object.fromEntries(PREVIEW_PALETTE.map(key=>[key,style.getPropertyValue('--'+key).trim()]));
}

export function HtmlPreviewFrame({source,identity,interactive=true,expanded=false,heightLimit=320}: {source:string;identity:string;interactive?:boolean;expanded?:boolean;heightLimit?:number}) {
    const frame = useRef<HTMLIFrameElement>(null);
    const loads = useRef(0);
    const [documentHtml,setDocumentHtml] = useState(''),[height,setHeight] = useState(320),[status,setStatus] = useState('Loading preview…');
    useEffect(()=>{
        let lastHeightAt=0,failed=false;
        loads.current=0;
        const channel=crypto.randomUUID().replaceAll('-','');
        setStatus('Loading preview…'); setHeight(heightLimit);
        const receive=(event:MessageEvent)=>{
            const value=previewMessage(event,frame.current?.contentWindow??null,channel);
            if(!value)return;
            if(value.kind==='ready'&&!failed)setStatus('');
            if(value.kind==='error'){failed=true;setStatus('A preview script reported an error. ');}
            if(value.kind==='height'&&Date.now()-lastHeightAt>=100){lastHeightAt=Date.now();setHeight(Math.min(heightLimit,value.height!));}
        };
        const theme=()=>{if(interactive)frame.current?.contentWindow?.postMessage({channel,kind:'theme',palette:palette()},'*');else setDocumentHtml(previewDocument(source,channel,palette(),false));};
        const observer=new MutationObserver(theme);
        const timer=interactive?window.setTimeout(()=>setStatus(value=>value==='Loading preview…'?'Preview did not finish loading. ':value),5000):0;
        try {
            const html=previewDocument(source,channel,palette(),interactive);
            if(interactive)window.addEventListener('message',receive);
            observer.observe(document.documentElement,{attributes:true,attributeFilter:['class','style']});
            setDocumentHtml(html);
        } catch (error) {setStatus(error instanceof Error?error.message:'Preview unavailable.');setDocumentHtml('');}
        return()=>{window.clearTimeout(timer);window.removeEventListener('message',receive);observer.disconnect();};
    },[source,identity,interactive,heightLimit]);
    return <div className="html-preview-document">{documentHtml&&<iframe ref={frame} sandbox={interactive?'allow-scripts':''} allow={PREVIEW_PERMISSIONS} referrerPolicy="no-referrer" srcDoc={documentHtml} onLoad={()=>{if(!interactive)setStatus('');else if(loads.current++>0)setStatus('Preview navigation was refused. ');}} title="HTML preview" style={{height:expanded?'70dvh':height}}/>}<p role="status" className="text-xs text-muted-foreground" hidden={!status}>{status}</p></div>;
}

export function HtmlPreview({source,identity,title="Visual reply",height=320}: {source:string;identity:string;title?:string;height?:number}) {
    const [expanded,setExpanded]=useState(false);
    return <section className="html-preview" aria-label="Visual reply">
        <header className="flex items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{title}</span><Button variant="ghost" size="sm" onClick={()=>setExpanded(true)}>Expand</Button></header>
        <HtmlPreviewFrame source={source} identity={identity} heightLimit={height}/>
        <Dialog open={expanded} onOpenChange={setExpanded}><DialogContent className="html-preview-expanded"><DialogTitle>{title}</DialogTitle><DialogDescription>Close to return to the conversation.</DialogDescription>{expanded&&<HtmlPreviewFrame source={source} identity={identity} heightLimit={height} expanded/>}</DialogContent></Dialog>
    </section>;
}
