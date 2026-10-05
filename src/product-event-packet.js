import { recallGuardSignature } from './product-recall-packing.js';

const sharedLine=/^(参与人物|地点|故事时间|事件发生|作出表述|原定|实际发生|状态|性质|知情|后续)：/u;
function eventKey(record){
  if(record.category==='events')return record.id;
  if(record.category==='knowledge'||record.category==='entityFactChanges')return null;
  const ids=[...new Set([record.eventRef,record.eventId,...(record.eventRefs??[]),...(record.relatedEvents??[]).map(e=>e.id)].filter(Boolean))];
  return ids.length===1?ids[0]:null;
}

/** Presentation only: never rewrites memory, scores or knowledge ownership.
 * Exact repeated metadata is factored only within a verified event link AND
 * an identical temporal/knowledge/persona guard. Different accounts remain.
 * Unlinked, multi-event and worldbook records are deliberately independent. */
export function compileEventPacket(entries){
  const groups=new Map();
  for(const entry of entries){
    const key=eventKey(entry.record),id=key?`event:${key}`:`record:${entry.record.id}`;
    if(!groups.has(id))groups.set(id,[]);
    groups.get(id).push(entry);
  }
  let sharedLines=0,groupedRecords=0;
  const parts=[];
  for(const group of groups.values()){
    if(group.length===1||group.some(e=>e.record.mergedParts?.length)||
      group.some(e=>recallGuardSignature(e.record)!==recallGuardSignature(group[0].record))){
      parts.push(group.map(e=>e.text).join('\n\n'));continue;
    }
    const seenByGuard=new Map();let removed=0;
    const texts=group.map(({record,text})=>{
      const signature=recallGuardSignature(record),seen=seenByGuard.get(signature)??new Set();
      seenByGuard.set(signature,seen);
      const metadata=[];
      const lines=text.split('\n').filter(line=>{
        if(!sharedLine.test(line))return true;
        if(seen.has(line)){removed++;return false;}
        metadata.push(line);return true;
      });
      // Only inherit from earlier records, never from an earlier subsection
      // in the same record (which might describe a different perspective).
      metadata.forEach(line=>seen.add(line));
      return lines.join('\n');
    });
    const original=group.map(e=>e.text).join('\n\n');
    const factored=['[同一事件；后项省略的共同说明沿用前项，差异按各项说明。]',...texts].join('\n\n');
    // Don't add a decorative group heading that costs more than it saves.
    if(removed&&factored.length<original.length){parts.push(factored);sharedLines+=removed;groupedRecords+=group.length;}
    else parts.push(original);
  }
  const text=parts.join('\n\n'),beforeChars=entries.map(e=>e.text).join('\n\n').length;
  return {text,groups:groups.size,groupedRecords,sharedLines,beforeChars,afterChars:text.length,savedChars:beforeChars-text.length};
}
