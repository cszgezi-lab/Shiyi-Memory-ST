import {clone,estimateModelInputUnits,sha256,yieldLocalWork} from './utils.js';
import {QUALITY_PROMPT,qualityGroups,qualityStatus,qualityEditableFields} from './product-memory-quality.js';
import {summaryRecord,selectSummaryContext} from './summary-context.js';
import {MEMORY_CATEGORIES} from './product-batches.js';
import {qualityEvidenceCatalog} from './product-quality-evidence.js';
import {knowledgeReviewWire} from './product-knowledge-review.js';
import {NARRATIVE_READING_RULE} from './narrative-reading.js';

export const qualityRows=records=>MEMORY_CATEGORIES.flatMap(category=>(records[category]??[]).map(r=>({...r,category})));
export function qualityTargets(records,saved={},recordIds=null,preparedStatus=null,automatic=false){
  const status=preparedStatus??qualityStatus(records,saved);
  const ids=new Set(status.pendingItems.map(i=>i.id));
  return qualityRows(records).filter(r=>(recordIds?recordIds.includes(r.id)&&(!automatic||ids.has(r.id)):ids.has(r.id))&&!r.manualQualityChecked);
}

/** Pure preflight: source loading is outside this loop, no model or storage
 * calls. A split replaces a pending candidate; only actual requests are counted. */
export async function planQuality({records,effectiveRecords=records,saved={},sources,settings,model,recordIds=null,preparedStatus=null,automatic=false,check=()=>{},yieldTask=yieldLocalWork}){
  const status=preparedStatus??qualityStatus(records,saved),targets=qualityTargets(records,saved,recordIds,status,automatic),rawById=new Map(targets.map(r=>[r.id,r]));
  // Read the accepted projection, but keep write guards tied to the original
  // records. A retry must not teach the model the superseded version again.
  const effectiveById=new Map(qualityRows(effectiveRecords).map(r=>[r.id,r]));
  const byId=new Map(targets.map(r=>[r.id,effectiveById.get(r.id)??r]));
  const ordered=qualityGroups(records).map(ids=>ids.filter(id=>byId.has(id))).filter(ids=>ids.length);
  const grouped=new Set(ordered.flat());
  const remaining=targets.filter(r=>!grouped.has(r.id)).map(r=>r.id);
  // Provenance guards writes. A visible, user-adjustable review count bounds
  // simultaneous judgments; it is not a hidden input-token or summary limit.
  // Freeze all groups in the preview, never grow them after dispatch.
  const orderedIds=[...ordered.flat(),...remaining],pending=[];
  const batchSize=Math.max(1,Math.min(100,Math.trunc(Number(settings.qualityBatchRecords)||6)));
  for(let i=0;i<orderedIds.length;i+=batchSize)pending.push(orderedIds.slice(i,i+batchSize));
  const sourceMap=new Map(sources.map(m=>[m.id,m])),jobs=[],blocked=[];
  const catalog=qualityEvidenceCatalog(sources,[...byId.values()],settings.narrativeExtraction);
  const limit=settings.inputBudgetUnits;
  while(pending.length){
    check();await yieldTask();check();
    const ids=pending.shift(),rows=ids.map(id=>byId.get(id));
    const refs=new Set(rows.flatMap(r=>r.sourceRefs??[]).map(r=>r.sourceId));
    const evidence=[...refs].map(id=>sourceMap.get(id)).filter(Boolean);
    if(evidence.length!==refs.size){blocked.push({ids,reason:'来源缺失，请查看原文后人工校对'});continue;}
    const related=selectSummaryContext(effectiveRecords,evidence,{budgetUnits:4000,maxRecords:24});
    const offered=catalog.filter(s=>refs.has(s.sourceId));
    const input={sources:evidence.map(({id,index})=>({id,index,text:offered.filter(s=>s.sourceId===id).map(s=>`【${s.segmentId}】\n${s.text}`).join('\n')})),records:rows.map(r=>({...summaryRecord(r),editableFields:qualityEditableFields(r.category)})),referenceRecords:qualityRows(related.records).filter(r=>!byId.has(r.id)).map(summaryRecord),issues:[...status.issues,...status.unresolved].filter(i=>i.recordIds.some(id=>ids.includes(id)))};
    if(recordIds&&!input.issues.length)input.issues=[{recordIds:ids,description:'用户主动选择校对这些条目；只作有原文依据的必要修正，不强求新增内容。'}];
    const knowledge=rows.every(r=>r.category==='awarenessChanges')?knowledgeReviewWire(rows,offered,evidence):null;
    const readingRule=settings.narrativeExtraction||offered.some(s=>/sy_(?:private|context)/i.test(s.text))?'\n'+NARRATIVE_READING_RULE:'';
    const payload=()=>({model,messages:[{role:'system',content:(knowledge?.prompt??QUALITY_PROMPT)+readingRule},{role:'user',content:JSON.stringify(knowledge?.input??input)}],stream:false,...(settings.outputBudgetUnits>0?{max_tokens:settings.outputBudgetUnits}:{})});
    let wire=payload(),inputUnits=estimateModelInputUnits(wire);
    while(!knowledge&&inputUnits>limit&&input.referenceRecords.length){input.referenceRecords.pop();wire=payload();inputUnits=estimateModelInputUnits(wire);}
    if(inputUnits>limit){
      if(ids.length>1){const middle=Math.ceil(ids.length/2);pending.unshift(ids.slice(0,middle),ids.slice(middle));}
      else blocked.push({ids,inputUnits,reason:`完整来源超过设置的输入预算 ${limit}；可人工校对或调整输入预算后重新预览`});
      continue;
    }
    jobs.push({ids,payload:wire,inputUnits,evidenceCatalog:offered,...(knowledge?{knowledgeReviewContext:knowledge.context}:{}),sourceIds:[...refs],anchors:Object.fromEntries(ids.map(id=>{const {category,...r}=rawById.get(id);return [id,sha256(r)];}))});
  }
  return {jobs,blocked,targetCount:targets.length,sourceCount:sources.length,inputLimit:limit};
}

// Retrying the same target set must not erase valid fields saved by a partial
// earlier answer merely because the new answer contains only remaining edits.
export function mergeQualityEntry(previous,next){
  if(!previous||Object.entries(previous.anchors??{}).some(([id,hash])=>Object.hasOwn(next.anchors??{},id)&&next.anchors[id]!==hash))return next;
  if(next.status==='failed')return previous.status==='reviewed'?{...clone(previous),retryError:next.error}:next;
  const updates=new Map((previous.updates??[]).map(u=>[u.id,clone(u)]));
  for(const u of next.updates??[]){const old=updates.get(u.id);updates.set(u.id,{...u,fields:{...old?.fields,...u.fields},evidence:[...(old?.evidence??[]),...(u.evidence??[])]});}
  return {...next,anchors:{...previous.anchors,...next.anchors},updates:[...updates.values()],additions:[...new Map([...(previous.additions??[]),...(next.additions??[])].map(a=>[a.record.id,a])).values()],outcomes:{...previous.outcomes,...next.outcomes}};
}
