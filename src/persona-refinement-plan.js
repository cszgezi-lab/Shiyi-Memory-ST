import {clone,sha256,makeId} from './utils.js';
import {personaManualPlan} from './dynamic-persona-plan.js';
import {personaRefinementRequest} from './persona-refinement.js';

export async function previewPersonaRefinement({profileId,startIndex,endIndex,batchSize}, {profiles,lastIndex,readRange,inputLimit}){
  const profile=profiles.find(p=>p.id===profileId&&!p.deleted);
  if(!profile)throw new Error('请选择已存在的人物档案');
  if(profile.locked)throw new Error('档案已锁定，请先解除锁定再精修');
  if(!profile.composition)throw new Error('这份档案尚无可定位片段，请先更新人设后再精修');
  const ranges=personaManualPlan({startIndex,endIndex,batchSize,handoff:false},lastIndex).items;
  if(ranges.length>100)throw new Error('一次精修最多100批，请缩小范围或增大每批楼数');
  const items=[];
  for(const [index,range]of ranges.entries()){
    const source=await readRange(range);
    if(!source.messages?.length||source.messages.some(m=>m.index<range.startIndex||m.index>range.endIndex))throw new Error('精修原文范围读取异常，未调用模型');
    const request=personaRefinementRequest(profile,source.messages,inputLimit);
    if(request.scope.omittedFloors)throw new Error(`#${range.startIndex}–${range.endIndex} 完整原文超预算，请减小每批楼数；预览未调用模型`);
    items.push({...range,index,sourceHash:sha256(source.messages),inputUnits:request.scope.inputUnits});
  }
  const plan={profileId,name:profile.name,profileHash:sha256(profile),through:profile.through,startIndex,endIndex,batchSize,items,plannedRequests:items.length,historicalOnly:endIndex<profile.through};
  return {...plan,previewHash:sha256(plan)};
}
export function startPersonaRefinement(preview){
  const id=makeId('persona-review-plan');
  const plan={...clone(preview),id,status:'running',createdAt:Date.now(),items:preview.items.map(item=>({...item,id:`${id}:${item.index}`,status:'pending'}))};
  const queue=plan.items.map(item=>({...item,profileId:plan.profileId,profileHash:plan.profileHash,manualPlanId:id,through:plan.through,attempts:0,retryAt:0}));
  return {plan,queue};
}
export function savePersonaRefinementCandidate(state,task,patch){
  const plan=state.manualPlan;
  if(!plan||plan.id!==task.manualPlanId||plan.status!=='running'||!plan.items.some(i=>i.id===task.id&&i.status==='pending'))throw new Error('精修计划已改变');
  const items=plan.items.map(item=>item.id===task.id?{...item,status:'saved',patch:clone(patch)}:item);
  const ready=items.every(item=>['saved','deleted'].includes(item.status));
  return {...state,queue:(state.queue??[]).filter(t=>t.id!==task.id),manualPlan:{...plan,items,status:ready?'ready':plan.status},status:ready?'ready':'waiting',message:ready?'精修候选已完成；请查看批次后应用，正式档案尚未改变':'本批精修候选已保存，继续下一批'};
}
export function personaRefinementMarkdown(state={}){
  const plan=state.manualPlan;if(!plan)return '# 人设精修\n\n尚未创建手动精修计划。';
  const plain=s=>String(s??'').replace(/[\r\n]+/g,' ').replace(/([\\`*_<>{}\[\]#|])/g,'\\$1');
  const status={pending:'等待处理',running:'处理中',failed:'失败，可重试',saved:'候选已保存',deleted:'已删除候选'};
  const planStatus={running:'处理中',paused:'已暂停',failed:'有失败批次',ready:'候选完成，待应用',applied:'已应用',discarded:'已放弃',withdrawn:'已撤回'};
  return [`# ${plain(plan.name)} · 人设精修`,`范围：#${plan.startIndex}–${plan.endIndex}；每批 ${plan.batchSize} 楼；状态：${planStatus[plan.status]??plain(plan.status)}`,plan.historicalOnly?'本计划为旧范围核对，不能覆盖已有更晚当前档案。':'候选未应用前，正式档案不变。',...plan.items.map(item=>{
    const queued=state.queue?.find(t=>t.id===item.id),phase=queued?.status??item.status;
    return [`## 第 ${item.index+1} 批 · #${item.startIndex}–${item.endIndex}`,`状态：${status[phase]??plain(phase)}`,queued?.attempts?`请求尝试：${queued.attempts}`:'',...(item.patch?.focus??[]).map(q=>`- #${q.floor} 核对依据：${plain(q.quote)}`),...(item.patch?.suggestions??[]).map(s=>`- 整理建议：${plain(s.reason)}（依据 #${s.evidence.floor}）`),...(item.patch?.updates??[]).map(s=>`- 局部修改：${plain(s.text)}（依据 #${s.evidence.floor}）`),...(item.patch?.derivedUpdates??[]).map(s=>`- 派生说明纠错 ${plain(s.ref??s.field)}：${plain(s.before)} → ${plain(s.after)}（${plain(s.reason)}；依据 #${s.evidence.floor}：${plain(s.evidence.quote)}）`)].filter(Boolean).join('\n\n');})].join('\n\n');
}
