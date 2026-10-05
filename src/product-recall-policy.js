import {tokenizeChinese} from './retrieval.js';

// This is a reranker feature view ONLY; indexed/stored/injected evidence is
// never cropped here. Long legacy records receive the same bounded treatment.
export function rerankDocument(record,body,query,maxChars=720){
 const title=String(record.title??'').slice(0,100),brief=String(record.recallSummary??'').slice(0,220);
 const text=String(body??'');
 const tokens=[...new Set(tokenizeChinese(query).filter(t=>t.length>1))];
 const sentences=text.match(/[^。！？\n]+[。！？]?/gu)??[text];
 const ranked=sentences.map((s,i)=>({i,score:tokens.reduce((n,t)=>n+(s.toLocaleLowerCase().includes(t)?1:0),0)})).sort((a,b)=>b.score-a.score||a.i-b.i);
 const chosen=new Set();let passage='';
 for(const {i} of ranked.slice(0,3))for(const j of [i,i-1,i+1])if(j>=0&&j<sentences.length&&!chosen.has(j)){
  chosen.add(j);const s=sentences[j];
  if(s.length>maxChars){const at=tokens.map(t=>s.toLocaleLowerCase().indexOf(t)).filter(n=>n>=0).sort((a,b)=>a-b)[0]??0;passage+=s.slice(Math.max(0,at-80),Math.max(0,at-80)+maxChars);}
  else passage+=s;
  if(passage.length>=maxChars)break;
 }
 return [title,brief,passage].filter(Boolean).join('\n').slice(0,maxChars);
}

// Per-connection transient circuit, not a persisted setting or a model queue.
// A down optional service should not charge a full timeout for every send.
export function createRecallLaneBackoff({now=Date.now,cooldownMs=30000}={}){
 const lanes=new Map();
 return async function run(key,work,{signal}={}){
  const state=lanes.get(key)??{failures:0,until:0};
  if(now()<state.until)throw Object.assign(new Error('在线检索通道暂时冷却，本轮沿用其他可用结果'),{code:'RECALL_LANE_COOLDOWN'});
  let abort;
  try{
   if(signal?.aborted)throw signal.reason;
   const canceled=new Promise((_,reject)=>{abort=()=>reject(signal.reason);signal?.addEventListener('abort',abort,{once:true});});
   const result=await Promise.race([Promise.resolve().then(work),canceled]);lanes.delete(key);return result;
  }
  catch(error){
   if(error?.code==='TIMEOUT'||error?.details?.reason==='timeout'){
    state.failures++;state.until=state.failures>=2?now()+cooldownMs:0;lanes.set(key,state);
    while(lanes.size>8)lanes.delete(lanes.keys().next().value);
   }
   throw error;
  }
  finally{if(abort)signal?.removeEventListener('abort',abort);}
 };
}
