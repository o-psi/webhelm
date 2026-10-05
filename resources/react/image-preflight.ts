import {sameAccount} from '../js/execution-profiles.js';
export function requireImageModel(catalogue:any,account:any,model:string){
 if(!sameAccount(catalogue?.account,account))throw Error('Image model catalogue account changed. Review the selected account.');
 const selected=catalogue.models?.find((item:any)=>item.id===model);
 if(!selected||!Array.isArray(selected.input_modalities)||!selected.input_modalities.every((value:any)=>typeof value==='string')||!selected.input_modalities.includes('image'))throw Error('Selected model has no confirmed image input metadata. Remove pictures or select an image-capable model.');
}
