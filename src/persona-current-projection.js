import {personaCompositionText,compactPersonaParts} from './persona-composition.js';
import {qualitySourceSegments} from './source-evidence.js';

// Derived views only. The saved source, DIY prose and immutable checkpoints
// remain recoverable. Do not guess semantic equivalence between different facts.
const cache=new WeakMap(),frameCache=new WeakMap();
const stagePattern=/(?:国中|初中|高中|大学)[一二三四1-4]年级/g;
const sameStage=s=>s.replace('国中','初中').replace(/[1234]/g,c=>'一二三四'[Number(c)-1]);
export function personaTimelineFrame(records={},endFloor=Infinity){
 const cached=frameCache.get(records);if(cached?.endFloor===endFloor)return cached.frame;
 let frame=null;
 for(const row of records.summaryView??[]){
  if(!Number.isSafeInteger(row.floorIndex)||row.floorIndex>endFloor)continue;
  const text=row.originalSource?.text??'';
  // Only an explicit global narrative frame, never a guessed age, isolated
  // school mention, a date calculation, or a character remembering school.
  const pattern=/(?:所有角色|所有人物|当前叙事时点|当前时间线)[^\n。]{0,50}?((?:国中|初中|高中|大学)[一二三四1-4]年级)/u;
  if(!/所有角色|所有人物|当前叙事时点|当前时间线/.test(text))continue;
  for(const line of qualitySourceSegments({text}).flatMap(s=>s.text.split(/[。！？\n]/u))){
    if(/如果|假如|假设|要是|是否|并非|不是|不在|[“”「」『』]/u.test(line))continue;
    const match=pattern.exec(line);
    if(!match&&!/(?:当前叙事时点|当前时间线)\s*(?:[:：]|切换|转到|回到|进入)/u.test(line))continue;
    if(!frame||row.floorIndex>=frame.floor)frame={stage:match?.[1]??null,floor:row.floorIndex};
  }
 }
 const result=frame?.stage?frame:null;
 frameCache.set(records,{endFloor,frame:result});return result;
}
export function applyUserDirectives(profile){
  const lines=Array.isArray(profile?.userDirectives)?profile.userDirectives.map(item=>String(item??'').trim()).filter(Boolean):[];
  if(!lines.length)return profile;
  const head=`【强调】\n这里的句子优先于原书、语料和后文概括。冲突时只照这里做。\n${lines.join('\n')}`;
  const tail=`【强调 · 收束】\n和上面的档案冲突时，仍以这几句为准：\n${lines.join('\n')}`;
  let text=String(profile.text??'');
  if(text.startsWith(head))text=text.slice(head.length).replace(/^\n+/u,'');
  if(text.endsWith(tail))text=text.slice(0,-tail.length).replace(/\n+$/u,'');
  return {...profile,text:[head,text,tail].filter(Boolean).join('\n\n')};
}
export function projectCurrentPersona(profile,frame=null){
 if(!profile?.composition||profile.manual||profile.locked)return applyUserDirectives(profile);
 const cached=cache.get(profile),frameKey=frame?`${frame.floor}:${frame.stage}`:'';
 if(cached?.frameKey===frameKey)return cached.profile;
 const c=profile.composition,parts=compactPersonaParts(c.parts??[]),duplicates=(c.parts??[]).length-parts.length;
 const seen=new Set(parts.filter(p=>p.source==='chat'&&p.text.trim().length>=8).map(p=>p.text.trim()));
 // Notes must remain a CURRENT snapshot. Remove only literal repeats, never
 // similarity-based omissions of new conditions, names, dates or negation.
 const notes=String(c.notes??'').split(/(?<=[。！？])|\n/u).filter(t=>!seen.has(t.trim())).join('\n');
 const composition={...c,parts,notes};
 let text=personaCompositionText(composition,{hasSources:Boolean(profile.bindings?.length)});
 if(frame){
  text=text.split('\n').map(line=>{
   const stages=line.match(stagePattern)??[];
   if(!stages.some(s=>sameStage(s)!==sameStage(frame.stage)))return line;
   if(/原卡默认|原设定时点|并非当前|不是当前|历史|倒叙|此前|当时/.test(line))return line;
   // Qualify a conflicting snapshot, without silently inventing replacement
   // ages/schools or editing the underlying original-book/DIY value.
   return `〔非当前时点的设定参考〕${line.replace(/当前/g,'原设定')}`;
  }).join('\n');
  text=`【当前叙事时点：${frame.stage}；第${frame.floor}楼明确指定。以下不同学段/年龄属于原设定参考，不据此改变当前场景；不推算未说明的年龄。】\n${text}`;
 }
 const projected=applyUserDirectives({...profile,composition,text,projection:{version:1,duplicateParts:duplicates,timeline:frame}});
 cache.set(profile,{frameKey,profile:projected});return projected;
}
