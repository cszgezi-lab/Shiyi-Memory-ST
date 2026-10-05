import {clone,stableStringify} from './utils.js';
import {storyTimeRange,storyDateOf} from './temporal.js';
import {qualitySourceSegments} from './source-evidence.js';

const same=(a,b)=>a.sourceId===b.sourceId&&a.fragmentId===b.fragmentId;
const fullDate='\\d{4}(?:年|[-/])\\d{1,2}(?:月|[-/])\\d{1,2}(?:日|号)?';
const clock='\\d{1,2}[:：]\\d{2}(?::\\d{2})?';
const historical=/回忆|回想|追忆|倒叙|梦中|梦见|昨天|昨日|前天|去年|当年|上周|计划|预计|预定|预约|打算|明天|明日|后天|将于|如果|假如|届时/;
const stamp=(date,time)=>`${date.slice(0,4)}年${Number(date.slice(5,7))}月${Number(date.slice(8,10))}日${time}`;
const normalizeClock=time=>time.replace('：',':').split(':').map((s,i)=>i? s.padStart(2,'0'):String(Number(s))).join(':');

/** Conservative scene headers only; no model-supplied dates, wall clock or
 * guessed jumps. Clock-only prefixes inherit an explicitly dated adjacent floor.
 * Used as constraints, not as a substitute for event/flashback interpretation. */
export function sourceTimeline(sources=[],indices=[]){
  const list=sources.map(s=>({...s,index:indices.find(i=>same(i,s))?.index})).sort((a,b)=>(a.index??Infinity)-(b.index??Infinity));
  let date=null,lastIndex=null;const timeline=[];
  for(const source of list){
    const text=qualitySourceSegments({id:source.sourceId,text:source.text}).map(s=>s.text).join('').trim();
    if(!Number.isSafeInteger(source.index)||lastIndex!==null&&source.index!==lastIndex+1)date=null;
    lastIndex=source.index;
    const header=text.match(new RegExp(`^\\s*(?:【?(?:当前(?:场景)?时间|场景时间|故事时间|时间)[:：]\\s*)?(${fullDate})(?:[ T\\s]*(${clock}))?`));
    const clockOnly=text.match(new RegExp(`^\\s*(${clock})(?=\\s|[，,。；;]|$)`));
    if(header)date=storyDateOf(header[1]);
    else if(!clockOnly)date=null;
    const time=header?.[2]??clockOnly?.[1];
    if(!date||!time||!storyTimeRange(`${date} ${time.replace('：',':')}`))continue;
    const body=text.slice((header??clockOnly)[0].length).replace(/^[，,。\s]+/,'');
    timeline.push({...source,text,date,time:normalizeClock(time),stamp:stamp(date,time.replace('：',':')),body});
  }
  return timeline;
}

function overlapsAction(a,b,names=[]){
  const clean=s=>names.reduce((s,n)=>typeof n==='string'&&n?s.replaceAll(n,''):s,String(s)).replace(new RegExp(`${fullDate}|${clock}`,'g'),'').replace(/[\s\p{P}\p{N}]/gu,'');
  a=clean(a);b=clean(b);const terms=new Set();for(let i=0;i<a.length-4;i++)terms.add(a.slice(i,i+5));
  return [...terms].some(t=>b.includes(t));
}

/** Repair only a conflicting DATE attached to the exact same unique scene
 * clock AND shared action evidence. Different clocks, dates explicitly in the
 * source, flashbacks/plans and ambiguous repeated clocks are left untouched. */
export function reconcileSourceTimes(record,category,timeline=[]){
  const next=clone(record);delete next.timeCorrections;
  if(typeof next.location==='string'&&/^(?:null|undefined|unknown)$/i.test(next.location.trim()))next.location=null;
  if(!['events','commitmentChanges','summaryView'].includes(category))return next;
  const proof=timeline.filter(s=>(record.sourceRefs??[]).some(r=>same(r,s)));
  if(!proof.length)return next;
  const corrections=[];
  function corrected(value,path,action){
    if(typeof value!=='string')return value;
    if(/\dT\d|\d:\d{2}(?:Z|[+-]\d{2}:?\d{2})/.test(value))return value;
    const pattern=new RegExp(`(${fullDate}|\\d{1,2}月\\d{1,2}日|\\d{1,2}日)[ T\\s]*(${clock})`,'g');
    return value.replace(pattern,(found,rawDate,rawTime,offset)=>{
      const rangeStart=Math.max(value.lastIndexOf('。',offset-1),value.lastIndexOf('；',offset-1),value.lastIndexOf('\n',offset-1))+1;
      const rangeEnd=value.slice(offset).search(/[。；\n]/),clause=value.slice(rangeStart,rangeEnd<0?value.length:offset+rangeEnd);
      if(historical.test(clause)||historical.test(action))return found;
      const names=[...(Array.isArray(record.participants)?record.participants:[]),record.subject,record.person];
      const matches=proof.filter(s=>s.time===normalizeClock(rawTime)&&!historical.test(s.body.split(/[。；\n]/)[0])&&overlapsAction(action||clause,s.body,names));
      if(matches.length!==1)return found;
      const source=matches[0];
      const full=storyDateOf(rawDate),monthDay=rawDate.match(/^(\d{1,2})月(\d{1,2})日$/),dayOnly=rawDate.match(/^(\d{1,2})日$/);
      const agrees=full?full===source.date:monthDay?Number(monthDay[1])===Number(source.date.slice(5,7))&&Number(monthDay[2])===Number(source.date.slice(8,10)):dayOnly?Number(dayOnly[1])===Number(source.date.slice(8,10)):true;
      if(agrees)return found;
      // An explicitly stated target date elsewhere may describe a different
      // occurrence at the same clock, not a date typo. Never overwrite it.
      const otherDate=full??(monthDay?`${source.date.slice(0,4)}-${monthDay[1].padStart(2,'0')}-${monthDay[2].padStart(2,'0')}`:`${source.date.slice(0,8)}${dayOnly[1].padStart(2,'0')}`);
      if(proof.some(s=>[...s.text.matchAll(new RegExp(`(${fullDate})[ T\\s]*(${clock})`,'g'))].some(m=>storyDateOf(m[1])===otherDate&&normalizeClock(m[2])===normalizeClock(rawTime))))return found;
      const to=stamp(source.date,rawTime.replace('：',':'));
      corrections.push({path,from:found,to,sourceId:source.sourceId,...(source.fragmentId?{fragmentId:source.fragmentId}:{}),method:'source-clock-v1'});return to;
    });
  }
  for(const field of ['description','text','recallSummary'])if(typeof next[field]==='string')next[field]=corrected(next[field],field,'');
  if(next.temporal&&typeof next.temporal==='object'){
    const action=category==='commitmentChanges'?next.content:next.description??next.text??'';
    for(const field of ['actualAt','occurredAt'])if(typeof next.temporal[field]==='string')next.temporal[field]=corrected(next.temporal[field],`temporal.${field}`,action);
  }
  if(corrections.length)next.timeCorrections=[...new Map(corrections.map(c=>[stableStringify(c),c])).values()];
  return next;
}
