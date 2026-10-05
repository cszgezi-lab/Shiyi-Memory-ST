import { DRAFT_CATEGORIES } from './contracts.js';

export const MEMORY_CATEGORIES=Object.freeze(DRAFT_CATEGORIES.filter(k=>k!=='coverage'));
export const batchOperationIds=b=>[...new Set([b.operationId,b.previousOperation,...(b.attempts??[])].filter(Boolean))];
export const savedBatchOperation=b=>b.replacement&&!b.savedOperationId?null:b.savedOperationId??(b.status==='saved'||b.status==='deleted'&&!b.error?b.operationId:b.previousOperation)??null;
export const sameBatchRange=(a,b)=>Number.isInteger(a.startIndex)&&Number.isInteger(a.endIndex)&&a.startIndex===b.startIndex&&a.endIndex===b.endIndex;

// Associate derived recall cards with their contributing batch, including a
// merged event whose surviving ID belongs to an earlier batch. Do not infer
// membership from a title or send unrelated/global knowledge to a batch retry.
export function batchVectorCards(batch,cards){
  const records=Object.values(batch.records??{}).flat(),ids=new Set(records.map(r=>r.id));
  const sources=new Set(records.flatMap(r=>r.sourceRefs??[]).map(r=>r.sourceId));
  return cards.filter(c=>ids.has(c.id)||(c.sourceRefs??[]).some(r=>sources.has(r.sourceId)));
}
export function batchVectorGroups(batches,cards){
  const ids=new Map(),sources=new Map(),groups=new Map();
  const add=(map,key,id)=>{if(!key)return;if(!map.has(key))map.set(key,new Set());map.get(key).add(id);};
  for(const b of batches){groups.set(b.id,[]);for(const r of Object.values(b.records??{}).flat()){add(ids,r.id,b.id);for(const ref of r.sourceRefs??[])add(sources,ref.sourceId,b.id);}}
  for(const c of cards){const linked=new Set(ids.get(c.id));for(const ref of c.sourceRefs??[])for(const id of sources.get(ref.sourceId)??[])linked.add(id);for(const id of linked)groups.get(id).push(c);}
  return groups;
}

// Display order is not a persistence/attempt ID. Deleting or retrying a batch
// must not consume a visible ordinal or change its durable identity.
export function numberedSummaryBatches(batches){
  const ordered=batches.map((b,index)=>({...b,_order:index})).sort((a,b)=>
    (Number.isInteger(a.startIndex)?a.startIndex:Infinity)-(Number.isInteger(b.startIndex)?b.startIndex:Infinity)||
    (a.endIndex??Infinity)-(b.endIndex??Infinity)||a._order-b._order);
  let current=0,recycled=0;
  return ordered.map(({_order,...b})=>({...b,displayNumber:b.status==='deleted'?++recycled:++current}));
}

// A range is one logical batch. Immutable generations stay in the repository;
// only the effective generation changes. Never prefer an unfinished attempt.
export function consolidateSummaryBatches(rows,controls={}){
  const groups=new Map(),retire={};
  for(const row of rows){const key=!row.replacement&&!row.replacedBy&&Number.isInteger(row.startIndex)&&Number.isInteger(row.endIndex)?`${row.startIndex}:${row.endIndex}`:row.id;const group=groups.get(key)??[];group.push(row);groups.set(key,group);}
  const result=[];
  for(const group of groups.values()){
    if(group.length===1){result.push(group[0]);continue;}
    const completed=group.flatMap(b=>{
      const id=[b.operationId,savedBatchOperation(b)].find(id=>id&&(controls[id]==='active'||(!controls[id]&&b.status==='saved')));
      return id?[{...b,operationId:id,savedOperationId:id,status:'saved',error:null}]:[];
    });
    const winner=completed.sort((a,b)=>(a.updatedAt??a.createdAt??0)-(b.updatedAt??b.createdAt??0)).at(-1)??group.at(-1),attempts=[...new Set(group.flatMap(batchOperationIds))];
    for(const id of attempts)if(id!==winner.operationId&&completed.length&&controls[id]!=='deleted')retire[id]='deleted';
    result.push({...winner,id:group[0].id,number:group[0].number,savedOperationId:savedBatchOperation(winner),attempts:attempts.filter(id=>id!==winner.operationId)});
  }
  return {rows:result,retire,removed:rows.length-result.length};
}
export function pageSummaryBatches(batches,{query='',status='active',page=1,pageSize=10}={}) {
  const size=[10,20,50].includes(Number(pageSize))?Number(pageSize):10;
  const term=String(query).trim(),range=/^#?(\d+)\s*[-–~至]\s*#?(\d+)$/.exec(term),floor=/^#(\d+)$/.exec(term),number=/^第?\s*(\d+)\s*批$/.exec(term);
  const selected=numberedSummaryBatches(batches).reverse().filter(b=>{
    const pendingApplication=Boolean(b.replacementReady&&b.replacement&&!['saved','deleted'].includes(b.status));
    if(status==='active'&&b.status==='deleted')return false;
    if(status==='failed'&&(pendingApplication||!['failed','interrupted'].includes(b.status)))return false;
    if(status==='pending'&&!pendingApplication&&!['running','queued'].includes(b.status))return false;
    if(['saved','deleted'].includes(status)&&b.status!==status)return false;
    if(!term)return true;
    if(number)return b.displayNumber===Number(number[1]);
    if(floor)return Number.isInteger(b.startIndex)&&b.startIndex<=Number(floor[1])&&b.endIndex>=Number(floor[1]);
    if(range)return Number.isInteger(b.startIndex)&&b.startIndex<=Number(range[2])&&b.endIndex>=Number(range[1]);
    return `${b.displayNumber} ${b.focus??''} ${b.error??''}`.toLowerCase().includes(term.toLowerCase());
  });
  const pages=Math.max(1,Math.ceil(selected.length/size)),current=Math.min(pages,Math.max(1,Number.isInteger(Number(page))?Number(page):1));
  const deletedTotal=batches.filter(b=>b.status==='deleted').length;
  return {items:selected.slice((current-1)*size,current*size),page:current,pages,pageSize:size,total:selected.length,allTotal:batches.length,currentTotal:batches.length-deletedTotal,deletedTotal};
}
// The inactive UI range is deliberately absent from the submitted request.
export function summarySelection({mode='recent',count,startIndex,endIndex,batchSize,focus=''}={}){
  const integer=(value,label,min,max)=>{if(value==null||String(value).trim()===''||!Number.isInteger(Number(value))||Number(value)<min||Number(value)>max)throw new Error(`${label}需要填写 ${min}–${max} 的整数`);return Number(value);};
  const common={batchSize:integer(batchSize,'每批楼数',1,200),focus};
  if(mode==='recent')return {...common,count:integer(count,'最近楼数',1,100000)};
  if(mode!=='range')throw new Error('请选择总结范围');
  const start=integer(startIndex,'起始楼层',0,10000000),end=integer(endIndex,'结束楼层',0,10000000);
  if(end<start)throw new Error('结束楼层不能早于起始楼层');
  return {...common,startIndex:start,endIndex:end};
}
export function planSummaryRanges({count,startIndex,endIndex,lastIndex,batchSize}){
  if(!Number.isInteger(batchSize)||batchSize<1||batchSize>200)throw new Error('每批楼数应为 1–200');
  if((startIndex==null)!==(endIndex==null))throw new Error('请同时填写起止楼层');
  if(startIndex==null){if(!Number.isInteger(count)||count<1)throw new Error('总结楼数应为正整数');endIndex=lastIndex;startIndex=Math.max(0,lastIndex-count+1);}
  if(!Number.isInteger(startIndex)||!Number.isInteger(endIndex)||startIndex<0||endIndex<startIndex||endIndex>lastIndex)throw new Error('总结范围超出当前聊天');
  if(endIndex-startIndex+1>100000)throw new Error('一次任务最多 100000 楼，请拆成多个任务');
  const ranges=[];for(let start=startIndex;start<=endIndex;start+=batchSize)ranges.push({startIndex:start,endIndex:Math.min(endIndex,start+batchSize-1)});
  return ranges;
}
// Manual overwrite ends exactly at the requested cutoff. Preserve the prefix
// by regenerating whole source floors, and retire the old tail only together
// with the complete replacement. Automatic gap filling keeps independent tails.
export function summaryOverwritePlan(ranges,rows,batchSize,lastIndex,{truncateTail=true}={}){
  const requested={startIndex:ranges[0].startIndex,endIndex:ranges.at(-1).endIndex};
  const active=rows.filter(b=>b.status!=='deleted'&&savedBatchOperation(b)&&Number.isInteger(b.startIndex)&&Number.isInteger(b.endIndex));
  let start=requested.startIndex,end=requested.endIndex,changed=true;
  while(changed){changed=false;for(const b of active)if(b.startIndex<=end&&b.endIndex>=start){const s=Math.min(start,b.startIndex),e=truncateTail?end:Math.max(end,b.endIndex);if(s!==start||e!==end){start=s;end=e;changed=true;}}}
  const affected=active.filter(b=>(truncateTail||b.startIndex<=end)&&b.endIndex>=start);
  const through=Math.max(end,...affected.map(b=>b.endIndex));
  const discardedTail=truncateTail&&through>end?{startIndex:end+1,endIndex:through}:null;
  const parts=(s,e)=>s<=e?planSummaryRanges({startIndex:s,endIndex:e,batchSize,lastIndex}):[];
  const prefix=parts(start,requested.startIndex-1),suffix=parts(requested.endIndex+1,end);
  const actual=[...prefix,...ranges,...suffix];
  const grouped=Boolean(discardedTail)||affected.some(b=>!actual.some(r=>sameBatchRange(b,r)));
  return {requested,startIndex:start,endIndex:end,ranges:actual,prefix,suffix,grouped,affected,discardedTail,extraBatches:prefix.length+suffix.length,plannedBatches:actual.length,
    excludeOperations:[...new Set(active.filter(b=>b.endIndex>=start).flatMap(batchOperationIds))]};
}
export function batchRecords(history,operationId){
  const entries=(history??[]).filter(item=>item.operationId===operationId||item.operationId?.startsWith(`${operationId}/child-`));
  return Object.fromEntries(MEMORY_CATEGORIES.map(category=>[category,entries.flatMap(item=>item.categories?.[category]??[])]));
}
export function editedMemoryFields(category,record,text){
  if(typeof text!=='string'||!text.trim()||text.length>12000)throw new Error('记忆内容需要 1–12000 字');
  const body=text.trim();
  if(category==='entityFactChanges')return {to:body,value:body,newValue:body};
  if(category==='awarenessChanges')return {knowledge:body,fact:body,content:body};
  return {description:body,content:body,text:body,summary:body,recallSummary:null,...(body!==(record.description??record.content??record.text)?{entities:[]}:{} )};
}
