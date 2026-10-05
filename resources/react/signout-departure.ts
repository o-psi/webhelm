// A confirmed form submit may consume one departure event, shared by both
// composer guards. Content and execution journals are never changed here.
export class SignoutDeparture {
    private armed=false;
    private timer:ReturnType<typeof setTimeout>|undefined;
    private allowed=new WeakSet<Event>();
    reset=()=>{this.armed=false;if(this.timer!==undefined)clearTimeout(this.timer);this.timer=undefined;};
    submit(form:HTMLFormElement){
        this.reset();
        let observed:SubmitEvent|undefined;
        const submitting=(event:SubmitEvent)=>{observed=event;this.armed=true;};
        form.addEventListener('submit',submitting,{once:true});
        try{form.requestSubmit();}catch(error){this.reset();throw error;}
        finally{form.removeEventListener('submit',submitting);}
        // requestSubmit performs validation and dispatch synchronously. Cancelled
        // submission must not authorize even a same-turn unrelated departure.
        if(!observed||(observed as SubmitEvent).defaultPrevented){this.reset();return;}
        // A failed/stalled navigation cannot permanently disable protection.
        this.timer=setTimeout(this.reset,1000);
    }
    permits(event:Event){
        if(this.allowed.has(event))return true;
        if(!this.armed)return false;
        this.allowed.add(event);this.reset();return true;
    }
}
