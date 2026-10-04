import React from 'react';

/** Presentation only: provider labels never replace the exact submitted ID. */
export function modelLabel(model:{id:string;display_name?:string}|undefined,fallback:string){
    return model?.display_name?.trim()||model?.id||fallback;
}
export function ModelLabel({model}:{model:{id:string;display_name?:string;is_default?:boolean}}){
    const label=modelLabel(model,model.id);
    return <span className="min-w-0 flex-1"><span className="block truncate">{label}</span>{label!==model.id&&<span className="block truncate text-xs font-normal text-muted-foreground">{model.id}</span>}{model.is_default&&<span className="block text-xs text-muted-foreground">Provider default</span>}</span>;
}
