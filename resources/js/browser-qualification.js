// This page is a third, nonviewer coordinator. It never opens a Vessel socket,
// runs host commands, retries effects or polls during a measured window.
export function installQualificationForm(root,{fetch:requestFetch=globalThis.fetch}={}){
 const request=root.querySelector('#qualification-request'),status=root.querySelector('#qualification-status'),input=root.querySelector('#qualification-response'),button=root.querySelector('#qualification-submit');
 const attempted=new Set();let current=null,busy=false;
 root.querySelector('#qualification-refresh').addEventListener('click',async()=>{
  if(busy)return;busy=true;
  try{const response=await requestFetch(root.dataset.requestUrl,{credentials:'same-origin',headers:{Accept:'application/json'}});
   if(!response.ok)throw Error();const result=await response.json();current=result.request;
   request.textContent=JSON.stringify(result,null,2);input.value='';button.disabled=!current||attempted.has(current.id);
   status.textContent=!current?'No unanswered request is available.':attempted.has(current.id)?'This request was already submitted. Observe publication or refusal; do not repeat it.':'Use only locally reduced fixture observations. No credentials, commands, paths or URLs.';
  }catch{current=null;button.disabled=true;status.textContent='Fixture request unavailable. Recheck this registered job; no response was sent.';}finally{busy=false;}
 });
 root.querySelector('#qualification-form').addEventListener('submit',async event=>{
  event.preventDefault();if(!current||busy||attempted.has(current.id))return;
  let response;try{response=JSON.parse(input.value);}catch{status.textContent='Enter the fixed response JSON for the issued request.';return;}
  if(!response||response.id!==current.id||response.digest!==current.digest){status.textContent='Response does not match the issued request.';return;}
  const body=JSON.stringify({response});
  if(new TextEncoder().encode(body).length>65536||attempted.size>=64){status.textContent='Fixture response exceeds its bound.';return;}
  attempted.add(current.id);busy=true;button.disabled=true;
  try{const reply=await requestFetch(root.dataset.responseUrl,{method:'POST',credentials:'same-origin',headers:{Accept:'application/json','Content-Type':'application/json','X-CSRF-TOKEN':root.ownerDocument.querySelector('meta[name=csrf-token]').content},body});
   if(!reply.ok)throw Error();const result=await reply.json();if(result.accepted!==true)throw Error();
   input.value='';status.textContent='Response queued once. Read status to observe original mailbox publication before claiming acceptance.';
  }catch{status.textContent='Response is unconfirmed or refused. Read its status before another action; this submission will not repeat.';}finally{busy=false;}
 });
 button.disabled=true;
}
const root=globalThis.document?.getElementById('browser-qualification');
if(root)installQualificationForm(root);
