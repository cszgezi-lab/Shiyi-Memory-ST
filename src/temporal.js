import { clone, normalizeText, stableStringify } from './utils.js';

export const TEMPORAL_FIELDS = Object.freeze(['assertedAt', 'occurredAt', 'plannedFor', 'actualAt', 'anchorRef']);

export function hasStoryTime(value) {
  if(value==null)return false;
  if(typeof value==='string')return Boolean(value.trim())&&!/^(?:unknown|null|未明确|原文未明确|未知|不详)$/i.test(value.trim());
  if(typeof value!=='object'||Array.isArray(value)||value.kind==='unknown')return false;
  return ['date','time','period','raw','occurredAt','assertedAt','plannedFor','actualAt','start','end'].some(k=>hasStoryTime(value[k]));
}

// Precision is an interval, not string equality. No real-world clock, locale
// parsing or guessed year is used; unparseable periods remain unverified.
export function storyTimeRange(value) {
  if(!hasStoryTime(value))return null;
  if(typeof value==='object'){
    if(value.start!=null&&value.end!=null){const a=storyTimeRange(value.start),b=storyTimeRange(value.end);return joinTimeRange(a,b);}
    value=value.date?`${value.date}${value.time?' '+value.time:value.period?' '+value.period:''}`:value.raw??value.period??value.occurredAt;
  }
  if(typeof value!=='string')return null;
  const text=value.trim().replace(/年|月/g,'-').replace(/日|号/g,'').replace(/\//g,'-').replace(/：/g,':');
  // Explicit end points only. Do not infer a next day for a reversed clock.
  const interval=/^(\d{4}-\d{1,2}-\d{1,2})\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:[-–—~～至到])\s*((?:\d{4}-\d{1,2}-\d{1,2}\s+)?\d{1,2}:\d{2}(?::\d{2})?)$/.exec(text);
  if(interval)return joinTimeRange(storyTimeRange(`${interval[1]} ${interval[2]}`),storyTimeRange(/^\d{4}-/.test(interval[3])?interval[3]:`${interval[1]} ${interval[3]}`));
  const m=/^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})?)?)?)?(?:\s*([\u3400-\u9fff]{1,12}))?$/.exec(text);
  if(!m)return null;
  const year=Number(m[1]),month=Number(m[2]??1),day=Number(m[3]??1),hour=Number(m[4]??0),minute=Number(m[5]??0),second=Number(m[6]??0),millisecond=Number((m[7]??'').padEnd(3,'0'));
  const startDate=new Date(0);startDate.setUTCFullYear(year,month-1,day);startDate.setUTCHours(hour,minute,second,millisecond);
  if(startDate.getUTCFullYear()!==year||startDate.getUTCMonth()!==month-1||startDate.getUTCDate()!==day||hour>23||minute>59||second>59)return null;
  const endDate=new Date(startDate);
  if(!m[2])endDate.setUTCFullYear(year+1);else if(!m[3])endDate.setUTCMonth(month);else if(!m[4])endDate.setUTCDate(day+1);
  const precision=m[7]?'millisecond':m[6]?'second':m[4]?'minute':m[3]?'day':m[2]?'month':'year';
  const start=startDate.getTime(),end=m[4]?start+(m[7]?1:m[6]?1000:60000):endDate.getTime();
  let offset=null;
  if(m[8]){
    const z=m[8]==='Z'?null:/^([+-])(\d{2}):?(\d{2})$/.exec(m[8]);
    if(z&&(Number(z[2])>14||Number(z[3])>59||Number(z[2])===14&&Number(z[3])!==0))return null;
    offset=z?(z[1]==='-'?-1:1)*(Number(z[2])*60+Number(z[3]))*60000:0;
  }
  return {start,end,offset,precision,qualifier:m[9]??null};
}

function joinTimeRange(a,b){
  if(!a||!b||a.offset!==b.offset||b.start<a.start)return null;
  return {start:a.start,end:b.end,offset:a.offset,precision:'range',qualifier:null};
}

export function storyDateOf(value){
  const time=storyTimeRange(value);
  if(!time||['year','month'].includes(time.precision))return null;
  const start=new Date(time.start).toISOString().slice(0,10),end=new Date(time.end-1).toISOString().slice(0,10);
  return start===end?start:null;
}

const sceneMarker=/(?:当前(?:剧情|故事|场景)?(?:时间|日期|时段)|(?:故事|场景)(?:时间|日期|时段)|<time\b|\[时间\]|🕒|🕐|🕰)/i;
const periods='凌晨|清晨|早晨|早上|上午|中午|午后|下午|傍晚|黄昏|晚上|夜晚|深夜';
const sceneDatePattern=new RegExp(`\\d{4}(?:年|[-/])\\d{1,2}(?:月|[-/])\\d{1,2}(?:日|号)?(?:[ T\\s]*(?:${periods})?[ T\\s]*\\d{1,2}[:：]\\d{2}(?::\\d{2})?(?:\\s*[-–—~～至到]\\s*\\d{1,2}[:：]\\d{2}(?::\\d{2})?)?|[ \\t]*(?:${periods}))?`,'g');
const clockPattern=/\d{1,2}[:：]\d{2}(?::\d{2})?(?:\s*[-–—~～至到]\s*\d{1,2}[:：]\d{2}(?::\d{2})?)?/;
const inquiry=/(?:还记得|記不記得|记不记得|是否记得|你记得|您记得|(?:回忆|回顾|記得|记得)[^。\n]*[吗嗎？?]|(?:过去|之前|当时|那天|那次|旧事)[^。\n]*(?:[吗嗎？?]|那件事)|(?:到现在|至今|距今|距离|距離|自从|自從)[^。\n]*(?:多久|多长|多長|多少(?:天|日|周|週|月|年)|几(?:天|日|周|月|年)))/;
const plans=/(?:预计|預計|计划|計劃|打算|约定|約定|预定|預定|预期|将于|將於)/;
const nonCurrent=/(?:预计|預計|计划|計劃|打算|约定|約定|预定|預定|预期|将于|將於|曾经|曾經|当时|當時|过去|過去|从前|去年|昨天|昨日|明天|后天|那天|那时|那時|那件事|那次|旧事|舊事|往事|当年|當年|发生过|發生過)/;
const flashback=/(?:进入|進入|转入|轉入|切入|开始|開始|进行|進行)[^。\n]{0,8}(?:回忆|回憶|倒叙|倒敘|闪回|閃回)|(?:^|[。\n；;])\s*(?:回忆|回憶|倒叙|倒敘|闪回|閃回)|(?:时间|時間)(?:倒转|倒轉|倒流)/;
const jump=/(?:第二天|次日|翌日|(?:[一二三四五六七八九十百两兩\d]+|数|數|几|幾)(?:个|個)?(?:天|日|周|週|星期|月|年)(?:之)?后|(?:一年|一月|一天)前|时间[跳倒]转|時間[跳倒]轉|(?:过了|過了|跨过|跨過|越过|越過|已过|已過|到了)\s*(?:午夜|零点|零點)|(?:午夜|零点|零點)(?:过后|過後|之后|之後)|(?:^|[,，]\s*)(?:明天|后天)(?:[，,。]|继续|繼續|来到|來到))/;
const emptyClock=status=>({date:null,status,source:'scene'});

function clockDetails(raw,date){
  const period=raw.match(new RegExp(periods))?.[0],time=raw.match(clockPattern)?.[0]?.replace(/：/g,':').replace(/\s*/g,'').replace(/\b(\d{1,2}):/g,(_,hour)=>`${hour.padStart(2,'0')}:`);
  if(time&&!storyTimeRange(`${date} ${time}`))return null;
  return {raw,...(time?{time}:{}),...(period?{period}:{}),precision:time?( /[-–—~～至到]/.test(time)?'range':time.split(':').length===3?'second':'minute'):period?'period':'day'};
}

function sceneClockDetails(text=''){
  // A date spoken about an event is not the scene's clock. Quoted text and
  // reasoning are excluded before detecting either anchors or time jumps.
  const clean=String(text).replace(/<(think|thinking)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/```[\s\S]*?```/g,'').replace(/^\s*>.*$/gm,'').replace(/“[^”]*”|‘[^’]*’|「[^」]*」|『[^』]*』|"[^"\n]*"|'[^'\n]*'/g,'');
  const units=[...clean.matchAll(/[^。！？!?\n；;]+[。！？!?]?/g)];
  const values=[],invalidations=[];let partial=null,invalidDate=false;
  for(const unit of units){
    const body=unit[0],isInquiry=inquiry.test(body),past=!isInquiry?body.match(flashback):null,isPastScene=Boolean(past);
    const shifts=isInquiry?[]:[...body.matchAll(new RegExp(jump.source,'g'))].filter(match=>{
      const prefix=body.slice(0,match.index),head=prefix.slice(Math.max(prefix.lastIndexOf(','),prefix.lastIndexOf('，'))+1);
      return !plans.test(head)&&!/(?:提到|说起|說起|谈到|談到|听说|聽說|记得|記得|想到|想起|考虑|考慮|等待|等到)/.test(head);
    });
    const shift=shifts.at(-1);
    if(isPastScene||shift)invalidations.push(unit.index+Math.max(past?.index??-1,shift?.index??-1));
    if(isInquiry)continue;
    const matches=[...body.matchAll(sceneDatePattern)];
    let priorEnd=0;
    for(let i=0;i<matches.length;i++){
      const match=matches[i],head=body.slice(priorEnd,match.index),tail=body.slice(match.index+match[0].length,matches[i+1]?.index??body.length);
      priorEnd=match.index+match[0].length;
      // A marker applies only to its own date, not a later plan on that line.
      const explicit=sceneMarker.test(head)&&!nonCurrent.test(head);
      if(!explicit&&(nonCurrent.test(head)||nonCurrent.test(tail)||isPastScene))continue;
      const date=storyDateOf(match[0].match(/^\d{4}(?:年|[-/])\d{1,2}(?:月|[-/])\d{1,2}(?:日|号)?/)?.[0]);
      const details=date&&clockDetails(match[0],date);
      if(!details){if(explicit)invalidDate=true;continue;}
      values.push({date,...details,explicit,index:unit.index+match.index});
    }
    if(!matches.length&&sceneMarker.test(body)&&!nonCurrent.test(body)&&!isPastScene&&!shift){
      const raw=body.slice(body.search(sceneMarker));
      const detail=clockDetails(raw,'2000-01-01');
      if(detail&&(detail.time||detail.period))partial=detail;
      else if(/\d/.test(raw))invalidDate=true;
    }
  }
  const boundary=invalidations.length?Math.max(...invalidations):-1;
  const later=values.filter(value=>value.index>boundary),anchors=later.filter(value=>value.explicit);
  const selected=anchors.length?anchors:later,dates=[...new Set(selected.map(value=>value.date))];
  if(dates.length===1){const {explicit,index,...value}=selected.at(-1);return {clock:{...value,status:'known',source:'scene'},partial};}
  if(dates.length>1||invalidDate||boundary>=0)return {clock:emptyClock('ambiguous'),partial:null};
  return {clock:emptyClock('unknown'),partial};
}

/** Only authentic live-scene text supplies "now", never recalled maximums.
 * Historical questions/plans are skipped; an undated jump blocks older dates. */
export function sceneClock(text=''){return sceneClockDetails(text).clock;}

export function sceneClockFromMessages(messages=[],{fallbackDate}={}){
  let partial=null;
  const applyPartial=clock=>{
    if(!partial)return clock;
    // A clock going backwards does not prove that midnight has passed.
    if(partial.time&&clock.time&&/^\d{1,2}:\d{2}$/.test(partial.time)&&/^\d{1,2}:\d{2}$/.test(clock.time)){
      const minute=value=>value.split(':').reduce((h,m)=>h*60+Number(m),0);
      if(minute(partial.time)<minute(clock.time))return emptyClock('ambiguous');
    }
    const {time,period,...base}=clock;
    return {...base,...partial,raw:`${clock.date} ${[partial.period,partial.time].filter(Boolean).join(' ')}`};
  };
  for(const message of [...messages].reverse()){
    if(message.role==='system')continue;
    const body=message.text??message.content??'';
    if(typeof body!=='string')continue;
    const details=sceneClockDetails(body);
    if(details.clock.status==='ambiguous')return details.clock;
    if(details.clock.status==='known')return applyPartial(details.clock);
    partial??=details.partial;
  }
  const date=typeof fallbackDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(fallbackDate)?storyDateOf(fallbackDate):null;
  return date?applyPartial({date,raw:fallbackDate,status:'known',source:'manual',precision:'day'}):emptyClock('unknown');
}

export function compareStoryTimes(a,b) {
  if(!hasStoryTime(a)||!hasStoryTime(b))return 'compatible';
  if(stableStringify(a)===stableStringify(b))return 'compatible';
  const x=storyTimeRange(a),y=storyTimeRange(b);
  if(!x||!y)return 'unresolved';
  const zoned=x.offset!==null&&y.offset!==null;
  if(Math.max(x.start-(zoned?x.offset:0),y.start-(zoned?y.offset:0))>=Math.min(x.end-(zoned?x.offset:0),y.end-(zoned?y.offset:0)))return 'conflict';
  if(x.qualifier&&y.qualifier&&x.qualifier!==y.qualifier||x.qualifier&&['minute','second','millisecond'].includes(y.precision)||y.qualifier&&['minute','second','millisecond'].includes(x.precision))return 'unresolved';
  return 'compatible';
}

export function preciseStoryTime(previous,next) {
  if(!hasStoryTime(next))return clone(previous??null);
  const a=storyTimeRange(previous),b=storyTimeRange(next);
  if(a&&b&&compareStoryTimes(previous,next)==='compatible'&&(a.end-a.start<b.end-b.start||a.end-a.start===b.end-b.start&&a.qualifier&&!b.qualifier))return clone(previous);
  return clone(next);
}

/** Keep asserted/story/planned/actual times separate; never collapse them to createdAt. */
export function normalizeTemporalFact(value = {}, { sourceRefs = [] } = {}) {
  const input = value && typeof value === 'object' ? value : { raw: value };
  return {
    assertedAt: input.assertedAt ?? null,
    occurredAt: input.occurredAt ?? null,
    plannedFor: input.plannedFor ?? null,
    actualAt: input.actualAt ?? null,
    anchorRef: input.anchorRef ?? null,
    raw: input.raw ?? (typeof value === 'string' ? value : null),
    sourceRefs: clone(input.sourceRefs ?? sourceRefs),
    certainty: input.certainty ?? (input.occurredAt ? 'asserted' : 'unknown'),
  };
}

function identityOf(record) {
  return record?.identityKey ?? record?.eventIdentity ?? record?.id ?? record?.event?.id ?? null;
}

/** Conflicting story times are diagnostic candidates; they do not rewrite either source. */
export function detectTemporalConflicts(records = []) {
  const groups = new Map();
  for (const record of records) {
    const identity = identityOf(record);
    if (!identity) continue;
    const temporal = normalizeTemporalFact(record.temporal ?? record.storyTime ?? record.event?.storyTime ?? {});
    const value = stableStringify({ occurredAt: temporal.occurredAt, plannedFor: temporal.plannedFor, actualAt: temporal.actualAt });
    const group = groups.get(identity) ?? [];
    group.push({ recordId: record.id, sourceRefs: clone(record.sourceRefs ?? []), value, temporal });
    groups.set(identity, group);
  }
  const conflicts = [];
  for (const [identity, values] of groups) {
    if (new Set(values.map((value) => value.value)).size > 1) conflicts.push({ type: 'temporal_conflict', identity, evidence: values });
  }
  return conflicts;
}

/** Return an event together with completion/correction/cancel/resolution dependants. */
export function collectLifecycleDependencies(eventId, records = []) {
  const wanted = new Set([eventId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of records) {
      const refs = [record.eventRef, record.eventId, record.aboutEventId, record.completionOf, record.canceledEventId, record.cancelationOf, record.resolutionOf, record.correctionOf, record.supersedes, ...(record.eventRefs ?? []), ...(record.followUps ?? []).flatMap((item) => [item.eventRef, item.eventId, item.aboutEventId].filter(Boolean))].filter(Boolean);
      if (refs.some((ref) => wanted.has(ref)) && record.id && !wanted.has(record.id)) { wanted.add(record.id); changed = true; }
    }
  }
  return records.filter((record) => wanted.has(record.id) || wanted.has(record.eventRef) || wanted.has(record.eventId)).map(clone);
}

const VALID_STATES = new Set(['proposed', 'attempted', 'accepted', 'completed', 'declined', 'canceled']);

/** State updates require evidence; a date passing alone never completes/cancels a commitment. */
export function applyLifecycleTransition(previous, next, { sourceRefs = [], explicit = false } = {}) {
  const current = previous?.state ?? previous?.status ?? null;
  const requested = next?.state ?? next?.status;
  if (!VALID_STATES.has(requested)) return { accepted: false, reason: 'invalid_state', value: clone(previous) };
  if (!explicit && (!Array.isArray(sourceRefs) || sourceRefs.length === 0)) return { accepted: false, reason: 'evidence_required', value: clone(previous) };
  return { accepted: true, previousState: current, state: requested, value: clone(next), sourceRefs: clone(sourceRefs) };
}
