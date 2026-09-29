export type Tool={name:string;description:string};
export type Skill={name:string;description:string;path:string;scope:string|null};
export type Catalogue={tools:Tool[];skills:Skill[];toolSource:string;skillExecution:string;incomplete:boolean;canRead:boolean};

function safeText(value:unknown,limit:number):string{return typeof value==='string'?value.slice(0,limit).replace(/[\u0000-\u001f\u007f]/g,' '):'';}
export function parseDiscovery(tools:any,skills:any):Catalogue {
    if(tools?.section!=='tools'||skills?.section!=='skills'||!skills.value||!Array.isArray(skills.value.skills))throw new Error('Voyage returned an invalid discovery catalogue.');
    const inventory=Array.isArray(tools.value)?tools.value:tools.value?.inventory;
    if(!Array.isArray(inventory))throw new Error('Voyage returned an invalid tool inventory.');
    return {
        tools:inventory.slice(0,256).flatMap((item:any)=>{const name=safeText(item?.name,128);return name?[{name,description:safeText(item?.description,320)}]:[];}),
        skills:skills.value.skills.slice(0,128).flatMap((item:any)=>{const name=safeText(item?.name,128),path=safeText(item?.path,4096);return name&&path.startsWith('/')?[{name,path,description:safeText(item?.description,320),scope:typeof item?.scope==='string'?safeText(item.scope,4096):null}]:[];}),
        toolSource:safeText(tools.value?.source,64)||safeText(tools.execution,64)||'active',
        skillExecution:safeText(skills.execution,64),
        incomplete:skills.value.discovery_incomplete===true,
        canRead:skills.value.can_read===true,
    };
}
