import {qualitySourceSegments} from './source-evidence.js';
import {clone,isPlainObject} from './utils.js';
import {narrativeReading} from './narrative-reading.js';

const sourceCache=new WeakMap();
function partsFor(source){
  const id=source.sourceId??source.id,cached=sourceCache.get(source);
  if(cached&&cached.text===source.text&&cached.id===id)return cached.parts;
  const parts=qualitySourceSegments({...source,id});sourceCache.set(source,{text:source.text,id,parts});return parts;
}
function readingFor(source,config){
  partsFor(source);const cached=sourceCache.get(source),key=typeof config==='string'?config:JSON.stringify(config);
  if(cached.readingKey!==key){cached.reading=narrativeReading({...source,id:source.sourceId??source.id},config);cached.readingKey=key;}
  return cached.reading;
}

// Transport-only source view: one copy of each narrative, no extra AI call or
// database. IDs are scoped to the exact source/fragment; raw storage stays raw.
export function summaryKnowledgeSources(messages=[],config=''){
  return messages.map(message=>{
    const parts=partsFor(message);
    if(config||/<\/?sy_(?:context|private)\b/i.test(message.text??'')){
      const reading=readingFor(message,config??'');
      const knowledgeCues=reading.parts.filter(p=>/sy_private|不知情|不知道|未读|心里|内心|告诉|告知|听见|读完|得知|说[：:]|回答[：:]/.test(p.text)).map(p=>p.part);
      const view={...message,text:reading.chunks.map(p=>`${p.part?`〔p${p.part}〕`:''}${p.text}`).join('\n'),...(knowledgeCues.length?{knowledgeCues}:{}),...(reading.warnings.length?{readingWarnings:reading.warnings}:{})};
      Object.defineProperty(view,'_reading',{value:{stats:reading.stats}});return view;
    }
    const knowledgeCues=parts.flatMap((p,i)=>/不知情|不知道|尚不知|没.{0,8}(?:看|听|读)|未(?:读|获告知)|不等于|才首次|才知道|才被|心里|内心|闭.{0,8}眼|捂.{0,8}耳|告诉|告知|听见|听清|听完|读完|得知|说[：:]|回答[：:]/.test(p.text)?[i+1]:[]);
    return {...message,text:parts.map((p,i)=>`〔p${i+1}〕${p.text}`).join(''),...(knowledgeCues.length?{knowledgeCues}:{})};
  });
}

// A known display part is not a host fragment. Resolve only inside a unique,
// whole source; genuine host fragments, foreign IDs and unknown parts survive
// unchanged for the ordinary source validator to reject.
export function normalizeNarrativePartRef(ref,sources){
  if(!isPlainObject(ref)||typeof ref.fragmentId!=='string'||!/^p[1-9]\d*$/.test(ref.fragmentId))return ref;
  const matches=sources.filter(s=>(s.id??s.sourceId)===ref.sourceId);
  if(matches.length!==1||matches[0].fragmentId!=null||!partsFor(matches[0])[Number(ref.fragmentId.slice(1))-1])return ref;
  const {fragmentId,...whole}=ref;return whole;
}

export const SUMMARY_KNOWLEDGE_EVIDENCE_RULE='原文text中的〔p1〕等是程序段号，不是剧情，段号在每个sourceId/fragmentId内独立编号。知情优先填写acquisitionEvidence:{holder:[{sourceId,fragmentId(仅原文有时),part:数字段号}],content:[{sourceId,fragmentId(仅原文有时),part:数字段号}],access:"该人物实际获知范围与限制"}。holder选择确定获知者/受话者的语境段，可含前文代词指向；content选择具体命题及获知行为段。只能引用本条sourceRefs中的来源，不引用别人的知情或规划。两个数组都不能为空；不要复制长引文，程序回填原文。先判断能看到/听到/读到什么，再写knowledge：闭眼捂耳不能亲历过程，未读通知不能知道内容，看见结果不等于知道行为人，旁白或他人内心不等于角色知道；推断用suspected，转述保留说法，明确不知情用explicitly_unaware，未提及者不要硬造记录。access不是自由编造的解释，必须由所引上下文支持。保留关键事实，不为减少校对而省略知情/不知情；日期、渠道真正未知可填null/unknown而不补造。兼容旧acquisitionEvidence:{quote:逐字原文}；引用代词时提供holder语境，不强求姓名与获知内容在同一句。其他模块按完整正文正常提取，quote不含程序段号。';

// Holder context and disclosure may straddle adjacent supplied floors. Repair
// a missing bookkeeping ref only when EVERY cited part is valid in this batch;
// never infer knowledge, expand to unseen chat, or accept a model hash/version.
export function completeSummaryKnowledgeRefs(record,sources,nativeRefs,options={}){
 const proof=record.acquisitionEvidence;
 if(!isPlainObject(proof)||!Array.isArray(proof.holder)||!Array.isArray(proof.content))return record;
 const refs=[...(record.sourceRefs??[])],same=(a,b)=>a.sourceId===b.sourceId&&(a.fragmentId??null)===(b.fragmentId??null);
 for(const input of [...proof.holder,...proof.content]){
  const ref=normalizeNarrativePartRef(input,sources);
  if(!isPlainObject(ref))return record;
  const candidates=nativeRefs.filter(r=>same(r,ref));
  if(candidates.length!==1)return record;
  if(!refs.some(r=>same(r,ref)))refs.push(clone(candidates[0]));
 }
 const candidate={...record,sourceRefs:refs};
 const bound=bindSummaryKnowledge(candidate,sources,r=>r,options);
 return bound.knowledgeReview===null?candidate:record;
}

// Provenance checks, NOT a claim of local natural-language entailment. The
// model judges perception in the main extraction; this verifies its citations.
export function bindSummaryKnowledge(record,sources,legacyBind,{readingConfig=''}={}){
  const proof=record.acquisitionEvidence;
  if(!isPlainObject(proof)||!('holder' in proof||'content' in proof)){
    if(!readingConfig)return legacyBind(record,sources.map(s=>s.text).join('\n'));
    // Legacy quotations still use the established holder/length checks. Only
    // truly contiguous offered bytes can substantiate the quote: neither a
    // deleted gap nor another source may be joined into invented evidence.
    if(typeof proof?.quote==='string')for(const source of sources){
      const runs=[];
      for(const s of [...readingFor(source,readingConfig).segments].sort((a,b)=>a.start-b.start)){
        const last=runs.at(-1);
        if(last&&s.start<=last.end)last.end=Math.max(last.end,s.end);
        else runs.push({start:s.start,end:s.end});
      }
      for(const {start,end}of runs){
        const text=source.text.slice(start,end);
        if(!text.includes(proof.quote))continue;
        // The reader already excluded unsafe spans; do not apply the legacy
        // first-content-wrapper selection again to this exact visible run.
        const bound=legacyBind(record,text,{narrativeText:text});
        if(bound.acquisitionEvidence)return bound;
      }
    }
    return legacyBind(record,'');
  }
  const pending=reason=>({...record,acquisitionEvidence:null,knowledgeReview:{status:'pending',reason}});
  if(typeof proof.access!=='string'||!proof.access.trim()||proof.access.length>2000)return pending('acquisition_access_missing');
  const same=(a,b)=>a.sourceId===b.sourceId&&(a.fragmentId??null)===(b.fragmentId??null);
  const cache=new Map();
  const resolve=list=>{
    if(!Array.isArray(list)||!list.length||list.length>24)throw Error('acquisition_reference_invalid');
    return list.flatMap(input=>{
      const ref=normalizeNarrativePartRef(input,sources);
      if(!isPlainObject(ref)||(Object.keys(ref).some(k=>!['sourceId','fragmentId','part'].includes(k))))throw Error('acquisition_reference_invalid');
      const candidates=sources.filter(s=>same(s,ref));
      if(candidates.length!==1||!record.sourceRefs?.some(r=>same(r,ref)))throw Error('acquisition_source_mismatch');
      const source=candidates[0];let parts=cache.get(source);
      if(!parts){parts=partsFor(source);cache.set(source,parts);}
      const part=typeof ref.part==='string'&&/^p?[1-9]\d*$/.test(ref.part)?Number(ref.part.replace(/^p/,'')):ref.part;
      const p=Number.isSafeInteger(part)&&part>0?parts[part-1]:null;
      if(!p||source.text.slice(p.start,p.end)!==p.text)throw Error('acquisition_reference_invalid');
      const offered=readingConfig?readingFor(source,readingConfig).parts.find(p=>p.part===part)?.slices:[p];
      if(!offered?.length)throw Error('acquisition_reference_invalid');
      return offered.filter(s=>s.text.replace(/<[^>]*>/g,'').trim()).map(s=>({sourceId:source.sourceId,...(source.fragmentId?{fragmentId:source.fragmentId}:{}),part,start:s.start,end:s.end,quote:s.text}));
    });
  };
  try{
    const holder=resolve(proof.holder),content=resolve(proof.content);
    if(!holder.length||!content.length)return pending('acquisition_reference_invalid');
    return {...record,knowledgeReview:null,acquisitionEvidence:{method:'summary-source-parts-v1',person:record.person,access:proof.access.trim(),quote:holder[0].quote,holder:clone(holder),content:clone(content)}};
  }catch(error){return pending(error.message);}
}
