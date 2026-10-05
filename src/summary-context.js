import { clone, estimateUnits, stableStringify } from './utils.js';
import { tokenizeChinese } from './retrieval.js';
import { sourceTimeline } from './source-consistency.js';
import {markMemoryStates} from './memory-current-state.js';
import {explicitSubjectNames} from './product-person-profiles.js';
import {foldName} from './name-fold.js';

// Storage proofs stay in the repository. Model context needs exact identifiers,
// meaningful fields and source locators, not repeated hashes and old revisions.
export function summaryRecord(record) {
  const result = clone(record);
  // Keep knowledge scope, not repeated full source proof, in future summary
  // context. Original citations remain in storage and the quality UI.
  if(result.acquisitionEvidence?.method==='summary-source-parts-v1')result.acquisitionEvidence={access:result.acquisitionEvidence.access};
  for (const key of ['history','qualityEvidence','originalSource','timeCorrections','localSearchText','sourceFloors','hash','contentHash','bundleHash','operationId','scopeKey','committedRevision','expectedRevision','createdAt','updatedAt']) delete result[key];
  if (Array.isArray(result.sourceRefs)) result.sourceRefs = result.sourceRefs.map(ref => typeof ref === 'string' ? {sourceId:ref} : {sourceId:ref.sourceId, ...(ref.fragmentId ? {fragmentId:ref.fragmentId} : {})});
  return result;
}

export function summarySources(messages = []) {
  const timeline=sourceTimeline(messages.map(m=>({...m,sourceId:m.id})),messages.map(m=>({...m,sourceId:m.id})));
  return messages.map(({id,index,text,fragmentId,role,name,isUser}) => {
    const scene=timeline.find(s=>s.sourceId===id&&s.fragmentId===fragmentId);
    return {id,index,text,...(fragmentId ? {fragmentId} : {}),role,name,isUser,...(scene?{sceneTime:scene.stamp}:{})};
  });
}

export function selectSummaryContext(records, messages, {budgetUnits=6000, maxRecords=48, categories=null}={}) {
  const query = messages.map(m=>m.text??'').join('\n').toLocaleLowerCase();
  const tokens = [...new Set(tokenizeChinese(query).filter(t=>t.length>1))];
  const sourceIds = new Set(messages.map(m=>m.id));
  const selected = {}, candidates=[];
  const historical=new Set(markMemoryStates(['relationshipChanges','commitmentChanges'].flatMap(category=>(records?.[category]??[]).map(r=>({...r,category})))).filter(r=>r.stateHistorical).map(r=>r.id));
  for (const [category, rows] of Object.entries(records??{})) {
    if (!Array.isArray(rows) || ['history','summaryView','conflicts','coverage'].includes(category) || categories && !categories.includes(category)) continue;
    selected[category]=[];
    for (const original of rows) {
      if(historical.has(original.id))continue;
      const record=summaryRecord(original);
      const text=stableStringify(record).toLocaleLowerCase();
      const overlap=(record.sourceRefs??[]).some(r=>sourceIds.has(r.sourceId));
      const hits=tokens.reduce((sum,t)=>sum+(text.includes(t)?1:0),0);
      // Never fill a large user budget with unrelated old rows.
      if (!overlap && !hits) continue;
      candidates.push({category,record,score:(overlap?1000:0)+hits,units:estimateUnits(JSON.stringify(record))});
    }
  }
  candidates.sort((a,b)=>b.score-a.score || String(a.record.id).localeCompare(String(b.record.id)));
  // High-scoring long events must not evict every same-participant current
  // relationship/promise ID. Reserve at most a third of the EXISTING budget,
  // one per directional pair/category, then use normal relevance ordering.
  const folded=foldName(query),reserved=[],groups=new Set();let reservedUnits=0;
  for(const item of candidates){
    if(!['relationshipChanges','commitmentChanges'].includes(item.category))continue;
    const r=item.record,names=explicitSubjectNames(item.category==='commitmentChanges'?r.participants??r.subject:[r.from??r.subject,r.to??r.object]);
    if(names.length<2||!names.every(n=>foldName(n)&&folded.includes(foldName(n))))continue;
    const pair=names.map(foldName),group=JSON.stringify([item.category,item.category==='commitmentChanges'?pair.sort():pair]);
    if(groups.has(group)||reserved.length>=Math.min(12,maxRecords)||reservedUnits+item.units>budgetUnits/3)continue;
    groups.add(group);reserved.push(item);reservedUnits+=item.units;
  }
  const prioritized=new Set(reserved);let usedUnits=0,count=0;
  for (const item of [...reserved,...candidates.filter(c=>!prioritized.has(c))]) {
    if (count>=maxRecords) break;
    if (usedUnits+item.units>budgetUnits) continue;
    selected[item.category].push(item.record);usedUnits+=item.units;count++;
  }
  return {records:selected,usedUnits,candidateCount:candidates.length,omittedCount:candidates.length-count};
}
