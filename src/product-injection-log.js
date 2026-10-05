import { clone, makeId } from './utils.js';
import { PRODUCT_VERSION } from './product-release.js';
import { recordTitle, sourceFloors } from './product-narrative.js';

export const INJECTION_LOG_LIMIT=30;
const STORAGE='injection-log-v1',MAX_CHARS=500000;
const statuses=new Set(['prepared','empty','disabled','stale','unavailable','failed','changed','auxiliary']);
const num=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:0;
const measured=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
const querySource=v=>['chat_source','request_before_rules','request_user'].includes(v)?v:'unknown';
const preparationStats=v=>v&&typeof v==='object'?{...Object.fromEntries(['personaMs','syncMs','sourceMs','recallMs','totalMs','hiddenMs','visibilityChanges'].map(k=>[k,measured(v[k])])),visibilityStart:['visible','hidden'].includes(v.visibilityStart)?v.visibilityStart:'unknown',visibilityEnd:['visible','hidden'].includes(v.visibilityEnd)?v.visibilityEnd:'unknown'}:null;
const budgetStats=v=>v&&typeof v==='object'?Object.fromEntries(['ordinaryUnits','ordinaryLimit','currentUnits','contextOmitted','externalUnits'].map(k=>[k,measured(v[k])])):null;
const str=(v,n)=>typeof v==='string'?v.slice(0,n):'';
const stage=v=>['passed','disabled','fallback','skipped'].includes(v)?v:'disabled';
const stageReason=v=>{
  if(v==='vector search timed out'||v==='timeout')return 'timeout';
  if(v==='shared deadline exceeded'||v==='shared_deadline')return 'shared_deadline';
  if(v==='background_pending')return 'background_pending';
  if(v==='cooldown')return 'cooldown';
  if(v==='invalid_response'||v==='truncated_response'||v==='unknown_duplicate_or_invalid_score')return 'invalid_response';
  if(typeof v==='string'&&/^vector (adapter|result) (returned|is missing|has|contains)/.test(v))return 'invalid_response';
  return v?'other':null;
};
export const INJECTION_DETAIL_LABELS=Object.freeze({source_evidence_omitted:'原文限制片段放不下，整条省略，未退回可能漏条件的短摘要',source_evidence:'附带相关原文片段',full_character:'完整人物档案',current_field:'当前字段',excerpt:'相关正文片段',brief:'召回摘要'});
const array=v=>Array.isArray(v)?v:[];
const reasons=new Set(['人物重要对话','人物身份匹配','人物档案全量','当前属性','关键词匹配','标签匹配','分类检索','语义匹配','人物精确匹配','相关候选','解释已注入知情的明确关联事件','同源约定的原始事件']);
const scores=v=>Object.fromEntries(['keyword','vector','fusion','final'].map(k=>[k,typeof v?.[k]==='number'&&Number.isFinite(v[k])?v[k]:null]));
const personaStats=v=>v&&typeof v==='object'?{replaced:num(v.replaced),supplemental:num(v.supplemental),...(v.coverage?{coverage:Object.fromEntries(['replacedEntries','replacedFragments','restoredFragments','replacedCardFields','rejectedProfiles','owned','shared','unresolved'].map(k=>[k,num(v.coverage[k])]))}:{}),profiles:array(v.profiles).slice(0,100).map(p=>({id:str(p.id,160),name:str(p.name,120),through:num(p.through),chars:num(p.chars),mode:p.mode==='replacement'?'replacement':'supplement'}))}:null;
function storedEntry(e){
  if(!statuses.has(e?.status)||typeof e.id!=='string')return null;
  const safe=injectionEntry({id:str(e.id,160),at:num(e.at),status:e.status,persona:e.persona,query:e.query,text:e.text,budgetUnits:e.budgetUnits,elapsedMs:e.elapsedMs,role:e.role,position:e.position,result:{usedUnits:e.usedUnits,degraded:e.degraded,cards:array(e.selected).filter(c=>c&&typeof c==='object'),trace:{timings:e.timings,vector:{status:e.vector,reason:e.vectorReason,crossActorOmitted:e.vectorCrossActorOmitted},rerank:{status:e.rerank,reason:e.rerankReason},local:{count:e.localCandidates},dictionary:{matched:array(e.dictionary).map(name=>({name}))},tags:{lanes:array(e.tags).map(tag=>({tag}))},packing:{duplicates:e.duplicates,decisions:array(e.decisions).filter(d=>d&&typeof d==='object')}}}});
  return {...safe,personaText:str(e.personaText,100000),personaTextTruncated:Boolean(e.personaTextTruncated),querySource:querySource(e.querySource),queryChars:measured(e.queryChars)??null,preparation:preparationStats(e.preparation),budget:budgetStats(e.budget),evidenceOmitted:Math.max(safe.evidenceOmitted,num(e.evidenceOmitted)),importantDialogues:{count:num(e.importantDialogues?.count),units:num(e.importantDialogues?.units)},quarantinedLinks:num(e.quarantinedLinks),knowledgeContext:knowledgeStats(e.knowledgeContext),eventPacket:packetStats(e.eventPacket),version:str(e.version,30),chars:num(e.chars),contentTruncated:Boolean(e.contentTruncated)||safe.contentTruncated,characters:characterStats(e.characters),selectedCount:num(e.selectedCount)||safe.selectedCount,memorySelected:num(e.memorySelected)};
}
const knowledgeStats=v=>({events:num(v?.events),units:num(v?.units),unresolved:num(v?.unresolved)});
const characterStats=v=>({full:v?.full===true,people:num(v?.people),records:num(v?.records),units:num(v?.units)});
const packetStats=v=>Object.fromEntries(['groups','groupedRecords','sharedLines','beforeChars','afterChars','savedChars'].map(k=>[k,num(v?.[k])]));
export function injectionEntry(input={}){
  const result=input.result??{},trace=result.trace??{};
  return {id:input.id??makeId('injection'),at:input.at??Date.now(),version:PRODUCT_VERSION,status:statuses.has(input.status)?input.status:'failed',
    query:str(input.query,800),querySource:querySource(input.querySource),queryChars:typeof input.query==='string'?input.query.length:0,preparation:preparationStats(input.preparation),budget:budgetStats(trace.budget),text:str(input.text,100000),contentTruncated:typeof input.text==='string'&&input.text.length>100000,
    chars:typeof input.text==='string'?input.text.length:0,usedUnits:num(result.usedUnits),budgetUnits:num(input.budgetUnits),elapsedMs:num(input.elapsedMs),
    persona:personaStats(input.persona),personaText:str(input.persona?.text,100000),personaTextTruncated:typeof input.persona?.text==='string'&&input.persona.text.length>100000,
    characters:characterStats({full:trace.characters?.mode==='full',people:trace.characters?.people?.length,records:trace.characters?.records,units:trace.characters?.units}),selectedCount:array(result.cards).length,memorySelected:num(trace.packing?.memorySelected),
    role:['system','user'].includes(input.role)?input.role:null,position:['start','before_last'].includes(input.position)?input.position:null,
    sent:false,degraded:Boolean(result.degraded),selected:array(result.cards).slice(0,100).map(c=>({id:str(c.id,160),title:str(recordTitle(c),160),category:str(c.category,40),sourceFloors:sourceFloors({...c,sourceRefs:array(c.sourceRefs),sourceFloors:array(c.sourceFloors)}).slice(0,100)})),
    timings:{...Object.fromEntries(['localMs','vectorMs','rerankMs','recallMs'].map(k=>[k,num(trace.timings?.[k])])),...Object.fromEntries(['prepareMs','packingMs','backgroundWaitMs'].map(k=>[k,measured(trace.timings?.[k])]))},
    vector:stage(trace.vector?.status),vectorReason:stageReason(trace.vector?.reason),vectorCrossActorOmitted:num(trace.vector?.crossActorOmitted),rerank:stage(trace.rerank?.status),rerankReason:stageReason(trace.rerank?.reason),localCandidates:num(trace.local?.count),duplicates:num(trace.packing?.duplicates),
    eventPacket:packetStats(trace.packing?.eventPacket),
    importantDialogues:{count:num(trace.importantDialogues?.count),units:num(trace.importantDialogues?.units)},
    knowledgeContext:knowledgeStats({events:trace.knowledgeContext?.eventIds?.length,units:trace.knowledgeContext?.units,unresolved:trace.knowledgeContext?.unresolvedRecordIds?.length}),
    quarantinedLinks:num(trace.evidence?.quarantinedLinks),
    dictionary:(trace.dictionary?.matched??[]).slice(0,12).map(t=>str(t.name,80)),tags:(trace.tags?.lanes??[]).slice(0,12).map(t=>str(t.tag,40)),
    evidenceOmitted:num(trace.packing?.decisions?.filter(d=>d.detail==='source_evidence_omitted').length),
    decisions:(trace.packing?.decisions??[]).slice(0,200).map(d=>({id:str(d.id,160),title:str(d.title,160),status:['selected','duplicate','budget','limit','name_only'].includes(d.status)?d.status:'limit',reason:String(d.reason??'').split('、').filter(r=>reasons.has(r)).join('、'),...(Object.hasOwn(INJECTION_DETAIL_LABELS,d.detail)?{detail:d.detail}:{}),scores:scores(d.scores)})),
  };
}
export function createInjectionLog({workspace,onChange=()=>{}}){
  let entries=[],persistence='not_loaded',queue=Promise.resolve(),writable=false;
  const notify=()=>{try{onChange();}catch{}};
  function trim(){entries=entries.slice(-INJECTION_LOG_LIMIT);while(entries.length>1&&JSON.stringify(entries).length>MAX_CHARS)entries.shift();}
  function persist(){const frozen=clone(entries);queue=queue.catch(()=>{}).then(async()=>{if(!writable)return;try{await workspace.write(STORAGE,{version:1,entries:frozen});persistence='saved';}catch{persistence='failed';}notify();});return queue;}
  return {
    async load(){try{const doc=await workspace.read(STORAGE,{version:1,entries:[]});if(doc?.version!==1||!Array.isArray(doc.entries))throw new Error('invalid');entries=doc.entries.slice(-INJECTION_LOG_LIMIT).map(storedEntry).filter(Boolean);trim();writable=true;persistence='ready';}catch{persistence='unavailable';}notify();},
    append(input){const entry=injectionEntry(input);entries.push(entry);trim();notify();void persist();return entry;},
    get state(){return {entries:clone(entries),persistence,limit:INJECTION_LOG_LIMIT};},
    async remove(id){entries=entries.filter(e=>e.id!==id);notify();await persist();if(!writable||persistence!=='saved')throw new Error('注入日志删除未通过保存确认');},
    async clear(){entries=[];notify();await persist();if(!writable||persistence!=='saved')throw new Error('注入日志清空未通过保存确认');},
    async export({includeContent=false}={}){await queue;return {kind:'shiyi-injection-log',version:1,pluginVersion:PRODUCT_VERSION,persistence,containsStoryContent:includeContent,entries:entries.map(e=>includeContent?clone(e):{id:e.id,at:e.at,version:e.version,status:e.status,sent:false,persona:e.persona?{replaced:e.persona.replaced,supplemental:e.persona.supplemental,...(e.persona.coverage?{coverage:clone(e.persona.coverage)}:{}),profiles:e.persona.profiles.map(({name,...p})=>p)}:null,chars:e.chars,usedUnits:e.usedUnits,budgetUnits:e.budgetUnits,elapsedMs:e.elapsedMs,degraded:e.degraded,querySource:e.querySource,queryChars:e.queryChars,preparation:e.preparation,budget:e.budget,timings:e.timings,vector:e.vector,vectorReason:e.vectorReason,vectorCrossActorOmitted:e.vectorCrossActorOmitted,rerank:e.rerank,rerankReason:e.rerankReason,localCandidates:e.localCandidates,selectedCount:e.selectedCount,evidenceOmitted:e.evidenceOmitted,characters:e.characters,memorySelected:e.memorySelected,duplicates:e.duplicates,knowledgeContext:e.knowledgeContext,importantDialogues:e.importantDialogues,eventPacket:e.eventPacket,quarantinedLinks:e.quarantinedLinks,dictionaryCount:e.dictionary.length,tagCount:e.tags.length})};},
    async flush(){await queue;},
  };
}
