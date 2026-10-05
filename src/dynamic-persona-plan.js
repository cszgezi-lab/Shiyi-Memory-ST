// A manual range is not an automatic cadence. Persist all ranges before any
// provider call; later retries must not lose the unstarted tail of old chats.
export function personaManualPlan({startIndex,endIndex,batchSize,handoff=true},lastIndex){
  if(!Number.isSafeInteger(startIndex)||startIndex<0||!Number.isSafeInteger(endIndex)||endIndex<startIndex)throw new Error('请填写有效的起止楼层，结束楼不能早于起始楼');
  if(!Number.isSafeInteger(batchSize)||batchSize<1||batchSize>200)throw new Error('手动人设每批楼数需为1–200');
  if(typeof handoff!=='boolean')throw new Error('自动接续选项无效');
  if(!Number.isSafeInteger(lastIndex)||endIndex>lastIndex)throw new Error(`手动范围超出当前聊天，最新楼层为 #${lastIndex??'未读取'}`);
  const count=Math.ceil((endIndex-startIndex+1)/batchSize);
  if(count>5000)throw new Error('一次计划超过5000批，请分段补建');
  return {startIndex,endIndex,batchSize,handoff,items:Array.from({length:count},(_,i)=>({startIndex:startIndex+i*batchSize,endIndex:Math.min(endIndex,startIndex+(i+1)*batchSize-1),status:'pending'}))};
}
export const personaManualPending=plan=>plan?.items?.find(b=>b.status!=='saved');
export const personaManualUnfinished=plan=>plan&&['running','paused','failed'].includes(plan.status);
