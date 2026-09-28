export type InspectionScope='status'|'unstaged'|'staged'|'untracked'|'directory'|'file';
const git='git --literal-pathspecs --no-pager --no-optional-locks -c core.quotePath=true -c color.ui=false -c core.fsmonitor=false';
const gitCommands:Record<Exclude<InspectionScope,'directory'|'file'>,string>={
    status:'status --porcelain=v1 --no-renames --untracked-files=all',
    unstaged:'diff --no-ext-diff --no-textconv --no-color --no-renames --submodule=short',
    staged:'diff --cached --no-ext-diff --no-textconv --no-color --no-renames --submodule=short',
    untracked:'ls-files --others --exclude-standard',
};
export function inspectionRequest(scope:InspectionScope,path:string){
    const target=path||'.';
    if(target.length>4096||/[\\:\x00-\x1f\x7f]/.test(target)||target.startsWith('/')||target.split('/').includes('..'))throw new Error('Use a workspace-relative path without parent traversal.');
    if(scope==='file')return {name:'read_file',arguments:{path:target}};
    if(scope==='directory')return {name:'list_directory',arguments:{path:target,recursive:false}};
    const suffix=gitCommands[scope];if(!suffix)throw new Error('Unsupported inspection scope.');
    const quoted=`'${target.replaceAll("'", "'\"'\"'")}'`;
    return {name:'shell',arguments:{command:`${git} ${suffix} -- ${quoted}`}};
}
export function inventorySupports(value:any,name:string){
    if(value?.section!=='tools')return false;
    const inventory=value.value?.inventory??value.value;
    return Array.isArray(inventory)&&inventory.some((item:any)=>item?.name===name&&item.input_schema&&typeof item.input_schema==='object'&&!Array.isArray(item.input_schema));
}
