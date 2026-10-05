import { clone, stableStringify, sha256 } from './utils.js';
import { ValidationError } from './errors.js';
import { compareStoryTimes, preciseStoryTime } from './temporal.js';
import { hasSpeechEvidence } from './memory-evidence.js';
import { normalizeInnerLife } from './character-journal.js';

const unique=values=>[...new Map(values.map(v=>[stableStringify(v),clone(v)])).values()];
export function mergeEventDetails(previous,next){
  const merged={...clone(previous),...clone(next)};
  for(const key of ['sourceRefs','sourceFloors','participants','entities','tags','keyDialogues','viewpoints']){
    if(Array.isArray(previous[key])||Array.isArray(next[key]))merged[key]=unique([...(previous[key]??[]),...(next[key]??[])]);
  }
  const timeObject=t=>{
    if(typeof t==='string')return {occurredAt:t};
    if(!t||t.kind==='unknown')return {};
    const {date,...other}=t;
    return date&&!other.occurredAt?{...other,occurredAt:other.time?{date,time:other.time}:date}:other;
  };
  const beforeTime=timeObject(previous.temporal),afterTime=timeObject(next.temporal);
  merged.temporal={...beforeTime,...Object.fromEntries(Object.entries(afterTime).filter(([,v])=>v!=null&&v!==''))};
  for(const key of ['occurredAt','assertedAt','plannedFor','actualAt','date'])if(key in beforeTime||key in afterTime)merged.temporal[key]=preciseStoryTime(beforeTime[key],afterTime[key]);
  if(!next.location&&previous.location)merged.location=previous.location;
  // Retain complementary sentences without turning one event into many cards.
  // Explicit later corrections remain visible alongside the earlier occurrence.
  const before=String(previous.description??previous.content??''),after=String(next.description??next.content??'');
  const sentences=s=>s.match(/[^。！？\n]+[。！？]?/g)??[];
  if(before&&after&&!after.includes(before))merged.description=unique([...sentences(before),...sentences(after)]).join('');
  else merged.description=after||before;
  // A previous short view must not hide the newer outcome. The same-call model
  // must emit a revised brief; otherwise use the full materialized narrative.
  merged.recallSummary=next.recallSummary||null;
  return merged;
}

function occurrenceDate(e){const t=e.temporal;return typeof t==='string'?t:t?.occurredAt??t?.date;}
function linkCompatible(a,b){
  const x=occurrenceDate(a),y=occurrenceDate(b);
  return compareStoryTimes(x,y)==='compatible';
}
export function exactEventDuplicate(a,b){
  if(!linkCompatible(a,b))return false;
  const body=e=>String(e.description??e.content??'').trim();
  return body(a)&&body(a)===body(b)&&['state','epistemicStatus','perspective','subject','object','location'].every(k=>stableStringify(a[k])===stableStringify(b[k]))&&(a.sourceRefs??[]).some(x=>(b.sourceRefs??[]).some(y=>stableStringify(x)===stableStringify(y)));
}

/** Resolve only explicit links to events actually shown in this request (or
 * earlier events in this output). Similar topic/tags alone never imply identity. */
export function resolveEventMerges(bundle,relevantRecords={}, {deferUnresolved=false,stageCrossBatch=false,onDeferred=()=>{}}={}){
  const external=new Set((relevantRecords.events??[]).map(e=>e.id));
  const known=new Map((relevantRecords.events??[]).map(e=>[e.id,e])),aliases=new Map(),output=[];
  for(const [eventIndex,event] of (bundle.events??[]).entries()){
    let target=event.mergeInto;
    // A returned durable ID must not silently bypass the post-save merge lane.
    if(stageCrossBatch&&!target&&external.has(event.id))target=event.id;
    if(stageCrossBatch&&!target){
      const prior=(relevantRecords.events??[]).find(p=>['identityKey','eventIdentity','occurrenceId','occurrenceKey','canonicalId','sameOccurrenceId'].some(k=>event[k]&&event[k]===p[k])||['sourceEventId','sameEventAs','sameAs','duplicateOf','repeatsEvent','sameOccurrenceAs'].some(k=>event[k]===p.id));
      if(prior)target=prior.id;
    }
    if(target){
      const prior=known.get(aliases.get(target)??target);
      const relation=prior?compareStoryTimes(occurrenceDate(prior),occurrenceDate(event)):null;
      const reason=!prior?'event_merge_target_missing':relation==='conflict'?'event_merge_time_conflict':relation==='unresolved'?'event_merge_time_unresolved':null;
      if(stageCrossBatch&&(external.has(target)||reason)||reason==='event_merge_time_unresolved'&&deferUnresolved){
        // Preserve both sourced accounts without treating an unparseable date
        // as either the same occurrence or a proven contradiction.
        const previousId=event.id;
        const stamp=sha256({operationId:bundle.operationId,eventIndex,id:previousId,target}).slice(0,24);
        event.id=`tmp-merge-review-${stamp}`;aliases.set(previousId,event.id);
        event.mergeReview={status:'pending',reason:reason?.replace('event_merge_','')??'post_save',targetId:prior?.id??target,targetTitle:prior?.title??'',previousTime:clone(prior?occurrenceDate(prior):null),proposedTime:clone(occurrenceDate(event))};
        for(const key of ['mergeInto','identityKey','eventIdentity','sourceEventId','occurrenceId','occurrenceKey','canonicalId','sameOccurrenceId','sameEventAs','sameAs','duplicateOf','repeatsEvent','sameOccurrenceAs'])delete event[key];
        if(!stageCrossBatch){
          bundle.conflicts??=[];
          bundle.conflicts.push({id:`tmp-merge-note-${stamp}`,eventRef:event.id,description:'此条记录请求与已有事件合并，但两种时间表述尚无法确认一致；本条已独立保存，旧事件未改动。请核对发生时间后再合并。',sourceRefs:clone(event.sourceRefs)});
        }
        output.push(event);known.set(event.id,event);onDeferred({eventIndex,reason:reason??'event_merge_deferred'});continue;
      }
      if(reason)throw new ValidationError(!prior?'事件合并目标未提供':relation==='conflict'?'事件发生时间冲突':'事件时间尚不能确认一致',{validationIssueCount:1,validationIssues:[{path:`events[${eventIndex}].mergeInto`,reason}]});
      const canonical=aliases.get(target)??target;
      aliases.set(event.id,canonical);event.id=canonical;
      // Do not accept a new model-generated identity in place of the checked link.
      delete event.identityKey;delete event.eventIdentity;
      if(prior.identityKey)event.identityKey=prior.identityKey;
      else if(prior.eventIdentity)event.eventIdentity=prior.eventIdentity;
      delete event.mergeInto;
    }
    const index=output.findIndex(e=>e.id===event.id||exactEventDuplicate(e,event));
    if(index>=0){aliases.set(event.id,output[index].id);output[index]=mergeEventDetails(output[index],event);}
    else output.push(event);
    known.set(event.id,output.find(e=>e.id===(aliases.get(event.id)??event.id))??event);
  }
  bundle.events=output;
  for(const category of Object.keys(bundle))if(Array.isArray(bundle[category]))for(const row of bundle[category]){
    for(const key of ['eventRef','eventId','sourceEventId','completionOf','correctionOf'])if(aliases.has(row[key]))row[key]=aliases.get(row[key]);
    for(const key of ['eventRefs','eventIds'])if(Array.isArray(row[key]))row[key]=[...new Set(row[key].map(id=>aliases.get(id)??id))];
  }
  return bundle;
}

// Attach exact speaking occurrences from this frozen request. Repeated words
// within the supplied event range retain all proven sources, not a guessed date.
// A relationship may span many floors; its quoted words need their own source.
export function bindDialogueSources(record,{sources=[],sourceRefs=[],sourceFloorIndices=[]}={}){
  if(!Array.isArray(record.keyDialogues))return record;
  const same=(a,b)=>a.sourceId===b.sourceId&&a.fragmentId===b.fragmentId;
  const quotes=record.keyDialogues.map(q=>{
    if(!q||typeof q.text!=='string'||!q.text||typeof q.speaker!=='string')return q;
    const explicit=q.sourceRefs??(q.sourceId?[{sourceId:q.sourceId,...(q.fragmentId?{fragmentId:q.fragmentId}:{})}]:null);
    const pool=explicit? sources.filter(s=>Array.isArray(explicit)&&explicit.some(r=>same(r,s)&&['hash','contentHash','version','swipeId'].every(k=>r[k]===undefined||sourceRefs.some(b=>same(b,r)&&b[k]===r[k])))) : sources;
    const found=pool.filter(s=>hasSpeechEvidence(s.text,q.text,q.speaker));
    const inParent=found.filter(s=>(record.sourceRefs??[]).some(r=>same(r,s)));
    const chosen=explicit?found:inParent.length?inParent:found;
    if(!chosen.length||chosen.length>1&&!explicit&&!inParent.length)return {...q,sourceRefs:[],sourceFloors:[],sourceBinding:'unresolved'};
    const canonical=chosen.map(src=>sourceRefs.filter(r=>same(r,src)));
    if(canonical.some(refs=>refs.length!==1))return {...q,sourceRefs:[],sourceFloors:[],sourceBinding:'unresolved'};
    return {...q,sourceRefs:clone(canonical.flat()),sourceFloors:sourceFloorIndices.filter(r=>chosen.some(src=>same(r,src))).map(r=>r.index),sourceBinding:'exact-speech-v1'};
  });
  return {...record,keyDialogues:quotes,sourceRefs:unique([...(record.sourceRefs??[]),...quotes.flatMap(q=>q?.sourceBinding==='exact-speech-v1'?q.sourceRefs:[])])};
}

export function bindCharacterDetails(record,evidence){
  const result={...record};
  if(record.keyDialogues!==undefined){
    const rows=Array.isArray(record.keyDialogues)?record.keyDialogues:[];
    result.keyDialogues=rows.filter(q=>q&&q.sourceBinding!=='unresolved'&&typeof q.text==='string'&&q.text.length>0&&q.text.length<=12000&&typeof q.speaker==='string'&&q.speaker.length<=160&&hasSpeechEvidence(evidence,q.text,q.speaker)).map(q=>({speaker:q.speaker,text:q.text,...Object.fromEntries(['to','context','meaning'].filter(k=>typeof q[k]==='string'&&q[k].length<=4000&&(k!=='to'||evidence.includes(q[k]))).map(k=>[k,q[k]])),...(q.sourceBinding==='exact-speech-v1'?{sourceRefs:clone(q.sourceRefs),sourceFloors:clone(q.sourceFloors)}:{}),status:q.status==='historical'?'historical':'active'}));
    if(result.keyDialogues.length!==rows.length)result.detailWarnings={...result.detailWarnings,rejectedDialogues:rows.length-result.keyDialogues.length};
  }
  if(record.innerLife!==undefined){
    result.innerLife=typeof(record.subject??record.person??record.entity)==='string'&&(record.subject??record.person??record.entity).trim()?normalizeInnerLife(record.innerLife):null;
    if(!result.innerLife)result.detailWarnings={...result.detailWarnings,invalidInnerLife:true};
    if(result.innerLife&&record.epistemicStatus==='inferred')result.innerLife.basis='inferred';
  }
  if(record.viewpoints!==undefined)result.viewpoints=(Array.isArray(record.viewpoints)?record.viewpoints:[]).filter(v=>v&&typeof v.holder==='string'&&evidence.includes(v.holder)&&typeof v.content==='string'&&v.content.length<=2000).slice(0,8).map(v=>({holder:v.holder,content:v.content,...Object.fromEntries(['target','context','basis'].filter(k=>typeof v[k]==='string'&&v[k].length<=2000).map(k=>[k,v[k]]))}));
  return result;
}
