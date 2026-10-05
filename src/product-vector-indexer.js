import { sha256,yieldLocalWork } from './utils.js';
import { splitDocument } from './product-workspace.js';
import { vectorNorm, validVectorEntry } from './product-vector-cache.js';
import { ShiyiError, PersistenceError } from './errors.js';
import { providerEnvelopeFailure, productFailure } from './product-feedback.js';
import { vectorStorageArtifact,openVectorCollection } from './product-vector-storage.js';
import {diagnosticRequestId,errorDiagnostics} from './diagnostics.js';

const fail = (code, details) => new ShiyiError('向量索引未完成', code, details);
export const vectorJobKey = key => `${key}-jobs-v1`;
export const vectorStagingKey = key => `${key}-rebuild-v1`;
export const vectorResponseKey = key => `${key}-response-jobs-v1`;
export function normalizeVectorJobs(raw) {
  return raw?.version === 1 ? {version:1, failures:raw.failures??{}, parts:raw.parts??{}, blocked:raw.blocked??null,rebuilding:raw.rebuilding===true} : {version:1,failures:{},parts:{},blocked:null,rebuilding:false};
}
export function vectorFailure(card, jobs, hash=c=>sha256(c.text)) { const entry=jobs.failures?.[card.id];return entry?.hash===hash(card)?entry:null; }
export function vectorFailureCounts(cards, entries, jobs, hash=c=>sha256(c.text)) {
  const pending=cards.filter(c=>entries.get(c.id)?.hash!==hash(c));
  return {failed:pending.filter(c=>vectorFailure(c,jobs,hash)).length,blocked:jobs.blocked};
}
export function vectorRetryDelay(issue,now=Date.now()) {
  if(!issue)return 0;
  if(![408,425,429,500,502,503,504].includes(issue.status)&&!['TIMEOUT','network.request_failed','NETWORK_ERROR'].includes(issue.code))return null;
  const delay=Math.min(900000,30000*2**Math.min(5,Math.max(0,(issue.attempts??1)-1)));
  return Math.max(0,(issue.retryAt??((issue.at??now)+delay))-now);
}

/** A missing index is unambiguous only for a single input. Never guess which
 * memory owns a vector in a malformed multi-input response. */
export function embeddingVectors(response, expected) {
  if(response?.error)throw providerEnvelopeFailure(response);
  const data=response?.data;
  if(!Array.isArray(data)||data.length!==expected)throw fail('VECTOR_RESPONSE_COUNT',{requestItems:expected,receivedVectors:Array.isArray(data)?data.length:0});
  const ordered=[...data].sort((a,b)=>(a?.index??0)-(b?.index??0));
  if(ordered.some((e,i)=>e?.index!==i&&!(expected===1&&e?.index==null)))throw fail('VECTOR_RESPONSE_INDEX',{requestItems:expected});
  const dimension=ordered[0]?.embedding?.length;
  if(ordered.some(e=>!vectorNorm(e?.embedding)||e.embedding.length!==dimension))throw fail('VECTOR_RESPONSE_INVALID',{requestItems:expected});
  return ordered.map(e=>e.embedding);
}

/** Derived index checkpoint, independent of summary commits. Source text is
 * never shortened or rewritten. Long cards retain every segment for max-cosine
 * recall; the first vector also keeps older index readers compatible. */
export async function buildVectorIndex({cards, workspace, key, client, check=()=>{}, signal, background=false, rebuild=false, ids=null, diagnostic=()=>{}, progress=()=>{},maxRequests=Infinity,now=()=>Date.now()}) {
  const jobs=normalizeVectorJobs(await workspace.read(vectorJobKey(key),null));check();
  const startRebuild=rebuild&&!jobs.rebuilding;
  if(startRebuild){jobs.rebuilding=true;jobs.parts={};jobs.failures={};}
  // Publish a rebuilt space only when it is complete; interruption leaves the
  // previous coherent space available for recall and the staging space resumable.
  const writeKey=jobs.rebuilding?vectorStagingKey(key):key;
  const collection=await openVectorCollection(workspace,writeKey,{check,empty:startRebuild,persist:(name,value)=>persist(name,value)});check();
  let index=collection.entries;
  const hashes=new Map(cards.map(c=>[c.id,sha256(c.text)]));
  const validIds=new Set();const dimensions=new Set();
  for(const [i,card]of cards.entries()){
    const entry=index[card.id],valid=collection.paged?entry?.dimension>0&&entry.parts?.length:validVectorEntry(entry);
    if(entry?.hash===hashes.get(card.id)&&valid){validIds.add(card.id);dimensions.add(entry.dimension??entry.vector.length);}
    if(i%32===31){await yieldLocalWork();check();}
  }
  const complete=c=>validIds.has(c.id);
  const selected=c=>!ids||ids.includes(c.id);
  let requests=0,splitRequests=0;
  const selectedCards=cards.filter(c=>selected(c)&&!complete(c));
  if(!selectedCards.length&&!jobs.rebuilding)return {total:cards.length,indexed:validIds.size,pending:cards.length-validIds.size,failed:0,requests:0,level:'success'};
  const previousBlock=jobs.blocked;
  if(background&&jobs.blocked&&vectorRetryDelay(jobs.blocked,now())!==0)return {level:'warning',blocked:true};
  jobs.blocked=null;
  for(const [id,f]of Object.entries(jobs.failures))if(!hashes.has(id)||hashes.get(id)!==f.hash)delete jobs.failures[id];
  for(const [id,p]of Object.entries(jobs.parts))if(!hashes.has(id)||hashes.get(id)!==p.hash)delete jobs.parts[id];
  const todo=selectedCards.filter(c=>!background||!vectorFailure(c,jobs)||vectorRetryDelay(vectorFailure(c,jobs),now())===0);
  const snapshot=()=>({total:cards.length,indexed:validIds.size,pending:cards.length-validIds.size,failed:cards.filter(c=>!complete(c)&&jobs.failures[c.id]?.hash===hashes.get(c.id)).length,requests,blocked:jobs.blocked,rebuilding:jobs.rebuilding});
  const persist=async(name,value)=>{
    check();
    try{await workspace.write(name,value,{returnValue:false});}
    catch(error){
      check();
      const details={storageArtifact:vectorStorageArtifact(name),storageStage:error?.details?.storageStage??'unknown',indexedItems:validIds.size,pendingItems:cards.length-validIds.size};
      diagnostic('vector_storage_failed',{...errorDiagnostics(error),...details,code:'PERSISTENCE_ERROR'},'error');
      throw new PersistenceError('向量索引保存校验失败',{...details,causeError:error});
    }
    check();
  };
  const saveJobs=()=>persist(vectorJobKey(key),jobs);
  const recordFailure=(card,error)=>{
    const f=productFailure(error),previous=jobs.failures[card.id];
    jobs.failures[card.id]={hash:hashes.get(card.id),code:f.code,...(f.status?{status:f.status}:{}),...(error?.details?.upstreamHint?{upstreamHint:error.details.upstreamHint}:{}),attempts:(previous?.attempts??0)+1,at:now()};
  };
  const work=[],plans=new Map();
  const response=await workspace.read(vectorResponseKey(key),null);check();
  const received=new Map(!startRebuild&&response?.version===1&&response.rebuilding===jobs.rebuilding&&Array.isArray(response.items)?response.items.map(p=>[`${p.cardId}:${p.part}`,p]):[]);
  // Character chunks are deliberately conservative, not advertised as exact
  // tokenizer limits. Smaller embedding models may still reject an input.
  const maxChars=/bge-large-(?:zh|en)-v1\.5|bce-embedding-base_v1/i.test(client.profile.model)?240:1800;
  for(const [cardIndex,card]of todo.entries()){
    if(cardIndex%16===15){await yieldLocalWork();check();}
    const chunks=splitDocument(String(card.text??''),{maxChars});
    if(!card.text?.trim()||chunks.length>256){recordFailure(card,fail(card.text?.trim()?'VECTOR_INPUT_TOO_LARGE':'VECTOR_INPUT_EMPTY'));continue;}
    const inputs=chunks.map(p=>({text:p.text,hash:sha256(p.text)}));
    plans.set(card.id,inputs);
    const old=jobs.parts[card.id];
    const parts=old?.hash===hashes.get(card.id)&&old.inputs?.length===inputs.length?old:{hash:hashes.get(card.id),inputs:inputs.map(p=>({hash:p.hash}))};
    jobs.parts[card.id]=parts;
    for(let i=0;i<inputs.length;i++){
      if(parts.inputs[i]?.hash!==inputs[i].hash)parts.inputs[i]={hash:inputs[i].hash};
      const cached=received.get(`${card.id}:${i}`);
      if(cached?.cardHash===hashes.get(card.id)&&cached.textHash===inputs[i].hash&&vectorNorm(cached.vector))parts.inputs[i].vector=cached.vector;
      if(!vectorNorm(parts.inputs[i].vector))work.push({card,part:i,text:inputs[i].text});
    }
  }
  if(startRebuild)await persist(writeKey,{});
  await saveJobs();progress(snapshot());
  const publishReady=async()=>{
    const changed=[];
    const changes={};
    for(const card of todo){
      const parts=jobs.parts[card.id]?.inputs,plan=plans.get(card.id);
      if(!plan||parts?.length!==plan.length||!parts.every((p,i)=>p.hash===plan[i].hash&&vectorNorm(p.vector)))continue;
      const vectors=parts.map(p=>p.vector),dimension=vectors[0].length;
      if(vectors.some(v=>v.length!==dimension)||[...dimensions].some(d=>d!==dimension))throw fail('VECTOR_DIMENSION_MISMATCH',{vectorDimensions:dimension});
      changes[card.id]={hash:hashes.get(card.id),vector:vectors[0],...(vectors.length>1?{segments:vectors}:{})};changed.push(card.id);dimensions.add(dimension);
    }
    if(changed.length){
      await collection.commit(changes);index=collection.entries;
      for(const id of changed)validIds.add(id);
      for(const card of todo)if(complete(card)){delete jobs.parts[card.id];delete jobs.failures[card.id];plans.delete(card.id);}
      await saveJobs();
    }
  };
  let fatal=null,consecutiveInputFailures=0;
  async function send(batch){
    check();requests++;const started=Date.now(),details={requestNumber:requests,requestItems:batch.length,inputChars:batch.reduce((n,x)=>n+x.text.length,0),longestInputChars:Math.max(...batch.map(x=>x.text.length)),modelRole:'embedding'};
    details.requestId=diagnosticRequestId();details.purpose='embeddings';diagnostic('request',details);
    let vectors;
    try{
      const response=await client.embeddings({model:client.profile.model,input:batch.map(x=>x.text),encoding_format:'float'},{signal,requestId:details.requestId,purpose:'embeddings'});check();
      diagnostic('response',{...details,receivedVectors:Array.isArray(response?.data)?response.data.length:0,elapsedMs:Date.now()-started});
      vectors=embeddingVectors(response,batch.length);
      const dimension=vectors[0].length;
      const staged=Object.values(jobs.parts).flatMap(p=>p.inputs??[]).filter(p=>vectorNorm(p.vector));
      if([...dimensions].some(d=>d!==dimension)||staged.some(p=>p.vector.length!==dimension))throw fail('VECTOR_DIMENSION_MISMATCH',{vectorDimensions:dimension});
    }catch(error){
      check();const f=productFailure(error);
      diagnostic('vector_failed',{...details,...errorDiagnostics(error),code:f.code,...(f.status?{status:f.status}:{}),elapsedMs:Date.now()-started},'warning');
      // Input/batch incompatibility can be isolated without resubmitting a
      // successful item. Global service errors stop immediately, not N retries.
      if(batch.length>1&&splitRequests<32&&([400,413,422].includes(f.status)||['VECTOR_RESPONSE_COUNT','VECTOR_RESPONSE_INDEX'].includes(f.code))){
        splitRequests++;diagnostic('vector_split',{requestItems:batch.length},'warning');
        const middle=Math.ceil(batch.length/2);await send(batch.slice(0,middle));if(!fatal)await send(batch.slice(middle));return;
      }
      for(const card of new Map(batch.map(x=>[x.card.id,x.card])).values())recordFailure(card,error);
      if([400,413,422].includes(f.status))consecutiveInputFailures++;
      if(![400,413,422].includes(f.status)||consecutiveInputFailures>=3){
        const attempts=(previousBlock?.attempts??0)+1;
        jobs.blocked={code:f.code,...(f.status?{status:f.status}:{}),...(error?.details?.upstreamHint?{upstreamHint:error.details.upstreamHint}:{}),at:now(),attempts,retryAt:now()+Math.max(Math.min(900000,30000*2**Math.min(5,attempts-1)),Number(error?.details?.retryAfterMs)||0)};fatal=error;
      }
      await saveJobs();progress(snapshot());return;
    }
    consecutiveInputFailures=0;
    // One bounded response journal per profile; confirmed before mutating the
    // long-lived progress/index documents. A failed checkpoint can resume from
    // this journal after restart, using exact content hashes, never row position.
    const receivedResponse={version:1,rebuilding:jobs.rebuilding,items:batch.map((item,i)=>({cardId:item.card.id,cardHash:hashes.get(item.card.id),part:item.part,textHash:sha256(item.text),vector:vectors[i]}))};
    if(new TextEncoder().encode(JSON.stringify(receivedResponse)).length>8*1024*1024)throw fail('VECTOR_RESPONSE_INVALID',{requestItems:batch.length});
    await persist(vectorResponseKey(key),receivedResponse);
    batch.forEach((item,i)=>{jobs.parts[item.card.id].inputs[item.part].vector=vectors[i];});
    await saveJobs();await publishReady();progress(snapshot());
    diagnostic('vector_commit',{indexedItems:snapshot().indexed,pendingItems:snapshot().pending,failedItems:snapshot().failed,vectorDimensions:vectors[0].length});
    await new Promise(resolve=>setTimeout(resolve,0));check();
  }
  await publishReady();
  for(let offset=0;offset<work.length&&!fatal&&requests<maxRequests;){
    const batch=[];let chars=0;
    while(offset<work.length&&batch.length<16&&(batch.length===0||chars+work[offset].text.length<=6000)){const item=work[offset++];batch.push(item);chars+=item.text.length;}
    await send(batch);
  }
  const result=snapshot();progress(result);
  if(fatal)throw Object.assign(fatal,{details:{...fatal.details,indexedItems:result.indexed,pendingItems:result.pending,failedItems:result.failed}});
  if(todo.some(c=>!complete(c))&&requests<maxRequests)throw fail('VECTOR_INDEX_INCOMPLETE',{indexedItems:result.indexed,pendingItems:result.pending,failedItems:result.failed});
  if(jobs.rebuilding&&cards.every(complete)){await persist(key,collection.document);jobs.rebuilding=false;await saveJobs();}
  await workspace.remove?.(vectorResponseKey(key)).catch(()=>{});
  return {...result,level:result.pending?'info':'success'};
}
