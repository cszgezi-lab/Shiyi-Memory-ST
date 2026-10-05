import {clone,sha256} from './utils.js';
import {personaIdentity,foldName} from './persona-identity.js';
import {personaAttentionWeight} from './persona-casting.js';
import {personaRefinementRequest,parsePersonaRefinement} from './persona-refinement.js';

const empty=()=>({version:1,queue:[],last:{},status:'idle',message:''});
export const personaFactSettingsHash=settings=>sha256(Object.fromEntries(Object.entries(settings).filter(([key])=>key.startsWith('dynamicPersona')||/^(?:api|endpoint|model)/i.test(key)||['narrativeExtraction','aliases'].includes(key))));
const interrupted=()=>Object.assign(new Error('事实核查已让出前台'),{code:'CANCELED'});
const stale=()=>Object.assign(new Error('事实核查依据已变化'),{code:'SOURCE_INVALIDATED'});
const same=(a,b)=>a.key===b.key;

/** Select one PRESENT, accepted change, not every person or a lexical romance
 * trigger. Cooldown counts dispatch attempts too, including failed requests. */
export function selectPersonaFactualReview(profiles,changed,messages,state={}){
  if(!messages.length)return null;
  const floors=new Set(messages.map(m=>m.index)),end=messages.at(-1).index;
  const present=new Set(personaIdentity({previous:profiles}).mentions(messages.map(m=>m.text).join('\n')).map(p=>p.key));
  return profiles.filter(p=>{
    const c=p.composition,last=state.last?.[p.id];
    return changed.includes(p.id)&&p.through===end&&!p.deleted&&!p.locked&&!p.manual&&!p.protected&&!p.casting?.playerControlled&&
      c?.changeCheck?.status==='changed'&&!c.pendingRevision&&!c.pendingOnly&&!c.pendingEdits?.length&&present.has(foldName(p.name))&&
      (last===undefined||p.through-last>=10)&&
      ((c.development??[]).some(d=>floors.has(d.floor))||(c.noteChanges??[]).some(n=>floors.has(n.evidence?.floor)))&&
      !(state.queue??[]).some(t=>(t.profileId??t.id)===p.id&&t.through===p.through);
  }).sort((a,b)=>personaAttentionWeight(b.casting)-personaAttentionWeight(a.casting)||String(a.id).localeCompare(String(b.id)))[0]??null;
}

/** Optional post-save fact checking. The caller never awaits it in the primary
 * update/recall path. A durable dispatch marker is written BEFORE asking the
 * shared provider client. There is deliberately no request retry method. */
export function createPersonaFactualReview({settings,getScope,getProfiles,getState,saveState,readRange,client,commit,canRun,notify=()=>{},now=Date.now}){
  let job=null,timer=null,disposed=false,halted=null,serial=Promise.resolve();
  const state=()=>getState()??empty();
  const optedIn=()=>settings().dynamicPersonaEnabled&&settings().dynamicPersonaFactReviewEnabled;
  const current=bound=>bound===getScope()&&bound?.isCurrent();
  const allowed=()=>!disposed&&halted!==getScope()&&optedIn()&&canRun();
  const clearTimer=()=>{clearTimeout(timer);timer=null;};
  // Read fresh state inside this short storage transaction, never while waiting
  // for a model. Enqueue/cancel/completion must not overwrite one another.
  const mutate=(bound,fn)=>{
    const run=serial.catch(()=>{}).then(async()=>{if(!current(bound))return;const next=fn(state());if(next)await saveState(next,bound);});
    serial=run;return run;
  };
  const updateTask=(bound,task,patch,extra={})=>mutate(bound,s=>s.queue?.some(t=>same(t,task))?{...s,...extra,queue:s.queue.map(t=>same(t,task)?{...t,...patch,updatedAt:now()}:t)}:null);
  async function enqueue(changed,messages){
    if(disposed||!optedIn())return;
    const bound=getScope();if(!current(bound)||!messages?.length)return;
    // This is the actual completed primary batch, including every supplied
    // source unit. Never invent a fresh last-ten window for a different batch.
    const source=clone(messages),sourceHash=sha256(source);
    if(source.some((m,i)=>!Number.isSafeInteger(m.index)||typeof m.text!=='string'||i>0&&m.index<=source[i-1].index))return;
    await mutate(bound,s=>{
      if(!optedIn()||(s.queue??[]).some(t=>t.sourceHash===sourceHash))return;
      const profile=selectPersonaFactualReview(getProfiles(),changed,source,s);if(!profile)return;
      const profileHash=sha256(profile),task={id:profile.id,profileId:profile.id,key:sha256([profile.id,profile.through,profileHash,sourceHash]),through:profile.through,profileHash,sourceHash,settingsHash:personaFactSettingsHash(settings()),startIndex:source[0].index,endIndex:source.at(-1).index,status:'pending',attempts:0,createdAt:now()};
      const queue=(s.queue??[]).map(t=>(t.profileId??t.id)===profile.id&&t.status==='pending'?{...t,status:'stale'}:t);
      return {...s,queue:[...queue,task].slice(-100),status:'waiting',message:'本批主要变化已保存；已排队一次可选事实核查'};
    });
    wake();
  }
  function wake(){
    if(!allowed()||job||timer||!(state().queue??[]).some(t=>['pending','candidate','dispatching'].includes(t.status)))return;
    timer=setTimeout(()=>{timer=null;void process().catch(()=>{});},150);timer.unref?.();
  }
  async function interrupt({preservePending=false}={}){
    clearTimer();job?.controller.abort();const bound=getScope(),running=job?.done;
    if(!preservePending)await mutate(bound,s=>(s.queue??[]).some(t=>t.status==='pending')?{...s,queue:s.queue.map(t=>t.status==='pending'?{...t,status:'skipped',message:'已让出前台，未调用模型'}:t),status:'waiting',message:'可选事实核查已暂停；主档案保留'}:null).catch(()=>{halted=bound;});
    await running;
  }
  async function process(){
    if(!allowed()||job)return;clearTimer();
    const task=(state().queue??[]).find(t=>['pending','candidate','dispatching'].includes(t.status));if(!task)return;
    const bound=getScope(),controller=new AbortController();let settle;
    const own={controller,bound,done:new Promise(resolve=>{settle=resolve;})};job=own;
    const guard=()=>{if(disposed||controller.signal.aborted||!current(bound)||!optedIn()||!canRun())throw interrupted();};
    const validProfile=()=>{const p=getProfiles().find(p=>p.id===(task.profileId??task.id));if(!p||p.deleted||p.locked||p.manual||p.protected||sha256(p)!==task.profileHash)throw stale();return p;};
    const validate=async()=>{guard();validProfile();if(personaFactSettingsHash(settings())!==task.settingsHash)throw stale();const range=await readRange(task);guard();const p=validProfile();if(personaFactSettingsHash(settings())!==task.settingsHash||sha256(range.messages)!==task.sourceHash)throw stale();return {profile:p,range};};
    notify({busy:true,status:'checking'});
    try{
      // An interrupted provider may have billed even though its response was
      // never saved. Treat that result as unknown, never silently send again.
      if(!task.patch&&(task.dispatchStarted||task.attempts>0)){
        await updateTask(bound,task,{status:'uncertain'},{status:'skipped',message:'上次核查已发出但未保存完整结果；不重发，主档案保留'});return;
      }
      const {profile,range}=await validate();let patch=task.patch;
      if(!patch){
        const config=clone(settings()),request=personaRefinementRequest(profile,range.messages,config.dynamicPersonaInputUnits,{factOnly:true});
        if(request.scope.omittedFloors)throw Object.assign(new Error('完整原批超出核查预算'),{code:'PERSONA_REVIEW_BUDGET'});
        await updateTask(bound,task,{status:'dispatching',dispatchStarted:now(),attempts:1},{last:{...(state().last??{}),[task.profileId??task.id]:task.through},status:'running',message:'正在核查本批派生事实；不阻塞聊天或召回'});
        guard();
        const persisted=state().queue?.find(t=>same(t,task));if(!persisted||persisted.status!=='dispatching'||persisted.attempts!==1)throw interrupted();
        const response=await client().chatCompletions({model:config.dynamicPersonaModel,messages:request.messages,stream:true,...(config.dynamicPersonaOutputTokens>0?{max_tokens:config.dynamicPersonaOutputTokens}:{})},{signal:controller.signal});
        await validate();
        patch={...parsePersonaRefinement(response,profile,request),scope:request.scope};
        await updateTask(bound,task,{status:'candidate',patch:clone(patch),responseSavedAt:now()},{status:'candidate',message:'事实核查候选已保存；尚未应用'});
      }
      await validate();
      // commit owns the atomic profile/checkpoint transaction and revalidates
      // the persisted candidate. Retrying this storage operation costs no API.
      await commit(task,clone(patch),bound,{signal:controller.signal});
      if(state().queue?.find(t=>same(t,task))?.status!=='applied')await updateTask(bound,task,{status:'applied',appliedAt:now()},{status:'saved',message:'本批事实核查已完成；主档案与来源保持可追溯'});
    }catch(error){
      if(!current(bound)||disposed)return;
      const saved=state().queue?.find(t=>same(t,task));if(!saved)return;
      if(saved.status==='applied')return;
      const canceled=controller.signal.aborted||error.code==='CANCELED',invalidated=error.code==='SOURCE_INVALIDATED';
      // A durable response remains recoverable after a commit/storage failure.
      // Do not spin on it; restart/rebind permits a zero-call commit attempt.
      const candidate=Boolean(saved.patch)&&!invalidated;
      if(candidate&&!canceled)halted=bound;
      const status=candidate?'candidate':invalidated?'stale':saved.attempts>0&&canceled?'uncertain':canceled?'skipped':'failed';
      try{await updateTask(bound,task,{status},{status:candidate?'candidate':status,message:candidate?'候选已保存但尚未应用；主档案保留，恢复时无需再次请求':invalidated?'档案、来源或设置已变化；旧核查未应用':canceled?'可选核查已让出前台；不重新请求，主档案保留':'本次可选核查未完成；不自动重试，主档案保留'});}
      catch{halted=bound;notify({status:'storage_failed',message:'核查进度未能保存；已停止本聊天的可选核查，主档案保留'});}
    }finally{
      if(job===own)job=null;settle();notify({busy:false});wake();
    }
  }
  return {enqueue,wake,process,interrupt,async dispose(){disposed=true;clearTimer();job?.controller.abort();await job?.done;},get busy(){return Boolean(job);}};
}
