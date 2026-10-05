/** Timers may be suspended with a mobile page. Recheck wall time on resume;
 * this does not claim to execute while the WebView/process is suspended.
 */
export function scheduleDeadline(ms, callback, {now=()=>Date.now(),setTimer=setTimeout,clearTimer=clearTimeout,targets=[globalThis.document,globalThis.window]}={}) {
  const started=now(),deadline=started+Math.max(0,ms);
  const sources=[...new Set(targets.filter(t=>typeof t?.addEventListener==='function'))];
  let timer,active=true,backgroundSeen=sources.some(t=>t.hidden===true||t.visibilityState==='hidden');
  const cleanup=()=>{
    if(!active)return;active=false;clearTimer(timer);
    for(const target of sources)for(const type of ['visibilitychange','pageshow','focus'])target.removeEventListener(type,check);
  };
  function check(){
    if(!active)return;
    backgroundSeen ||= sources.some(t=>t.hidden===true||t.visibilityState==='hidden');
    const remaining=deadline-now();
    if(remaining>0){clearTimer(timer);timer=setTimer(check,remaining);return;}
    const elapsedMs=Math.max(0,now()-started),timerLagMs=Math.max(0,elapsedMs-ms);
    cleanup();callback({elapsedMs,timerLagMs,...(backgroundSeen?{backgroundSeen:true}:{})});
  }
  for(const target of sources)for(const type of ['visibilitychange','pageshow','focus'])target.addEventListener(type,check);
  timer=setTimer(check,Math.max(0,ms));
  return cleanup;
}
