import { normalizeTerms, normalizeTags } from './product-dictionary.js';
export const relationLabel = value => ({expression:'单方表达',response:'对方回应',mutual_confirmation:'双方确认',boundary:'相处边界',shared_experience:'共同经历',habit:'相处习惯',background:'背景关系'})[value] ?? value ?? '关系变化';
export const epistemicLabel = value => ({observed:'正文明确',user_asserted:'用户确认',character_claim:'角色自述',inferred:'推测而非事实',unknown:'未确认'})[value] ?? value;
export const scopeLabel = value => typeof value==='string'?({temporary:'临时表现',stable:'稳定表现',situational:'特定情境',permanent:'长期',unknown:'未确认'})[value]??value:value;
// Display aliases only, not a schema/field whitelist or a stored-key rewrite.
// Arbitrary DIY names remain intact and can still be edited by the user.
export const fieldLabel = value => ({identity:'身份',background:'背景',age:'年龄',occupation:'职业',profession:'职业',aliases:'别称',nickname:'昵称',address:'住址',residence:'居所',school:'学校',hobby:'兴趣爱好',hobbies:'兴趣爱好',interests:'兴趣爱好',level:'等级',strength:'力量',agility:'敏捷',skills:'技能',beverage_preference:'饮品偏好',action_habit:'动作习惯',energy_status:'能量状态',usage_limitation:'使用限制',skill_limitation:'技能限制',inspection_status:'检验状态',operating_mode:'运行模式'})[value] ?? value;
const objectLabels={name:'名称',date:'日期',period:'时期',time:'时间',location:'地点',value:'内容',description:'说明',kind:'类型',unknown:'未知',raw:'原文时间',assertedAt:'表述时间',occurredAt:'发生时间',plannedFor:'原定时间',actualAt:'实际时间',learnedAt:'获知时间',subject:'主体',from:'原先',to:'变为',before:'变化前',after:'变化后',content:'内容',text:'内容',reason:'原因',context:'情境',scope:'范围',target:'对象',speaker:'说话人',holder:'持有人',evidence:'依据',basis:'依据',expression:'表达',response:'回应',mutualConfirmation:'双方确认',publicScope:'公开范围',status:'状态',via:'获知方式',knowledge:'获知内容',expiresAt:'有效期',validUntil:'有效期',term:'期限',duration:'持续时间',instruction:'演绎建议',guidance:'演绎建议',hint:'演绎建议',summary:'摘要',evidenceKind:'关系依据',perspective:'叙述视角'};
const valueLabel=(key,value)=>key==='evidenceKind'?relationLabel(value):key==='epistemicStatus'?epistemicLabel(value):key==='via'?viaLabel(value):key==='status'?awarenessLabel(stateLabel(value)):key==='perspective'?({first_person:'第一人称',second_person:'第二人称',third_person:'第三人称',omniscient:'全知叙述',unknown:'未确认'})[value]??value:value;
export function narrativeText(value) {
  if(typeof value==='string')return value;
  if(value==null)return '';
  if(Array.isArray(value))return value.map(narrativeText).filter(Boolean).join('、');
  if(typeof value==='object')return Object.entries(value).map(([k,v])=>`${objectLabels[k]??fieldLabel(k)}：${narrativeText(typeof v==='string'?valueLabel(k,v):v)}`).join('；');
  if(typeof value==='boolean')return value?'是':'否';
  return String(value);
}
export function recordTitle(card) {
  if(typeof card.title==='string'&&card.title.trim())return card.title.trim().replace(/\b(expression|response|mutual_confirmation|boundary|shared_experience|habit|background)\b/g,relationLabel);
  if(Number.isInteger(card.floorIndex))return `第 ${card.floorIndex} 楼纪要`;
  const body=String(card.description??card.text??card.content??card.action??'记忆');
  const first=body.split(/[。！？\n]/)[0];return first.length<=48?first:`${first.slice(0,48)}…`;
}
export function sourceFloors(card) {
  const floors=Array.isArray(card.sourceFloors)?[...card.sourceFloors]:[];
  if(Number.isSafeInteger(card.floorIndex))floors.push(card.floorIndex);
  // Older TT host locators included the absolute floor; arbitrary IDs don't.
  for(const ref of card.sourceRefs??[]){const m=/^message:(\d+):[a-f\d]+$/i.exec(ref.sourceId??'');if(m)floors.push(Number(m[1]));}
  return [...new Set(floors.filter(n=>Number.isSafeInteger(n)&&n>=0))].sort((a,b)=>a-b);
}
export function sourceLabel(card) {
  const floors=sourceFloors({...card,sourceFloors:[...(card.sourceFloors??[])]}),ranges=[];
  for(let i=0;i<floors.length;i++){let end=floors[i],start=end;while(floors[i+1]===end+1)end=floors[++i];ranges.push(start===end?`${start}`:`${start}–${end}`);}
  if(ranges.length)return `来源：第 ${ranges.join('、')} 楼`;
  if(card.documentName)return `来源：${card.documentName}`;
  if((card.sourceRefs??[]).some(r=>String(r.sourceId).startsWith('user-note')))return '来源：用户手动记录';
  return '来源：已关联原文；旧记录未保存楼层号';
}
export function fullSearchText(card,body) {
  return [...new Set([card.title,body,card.recallSummary,card.innerLife?.text,card.innerLife?.stage,card.innerLife?.cause,narrativeText(card.participants),narrativeText(card.location),narrativeText(card.temporal),...(card.keyDialogues??[]).map(q=>[q.speaker,q.to,q.text,q.context,q.meaning].filter(Boolean).join(' ')),...(card.viewpoints??[]).map(v=>[v.holder,v.target,v.content,v.context].filter(Boolean).join(' ')),...normalizeTerms(card.entities).flatMap(t=>[t.name,...t.aliases,...t.indexWords]),...normalizeTags(card.tags)].filter(v=>typeof v==='string'&&v.trim()))].join('\n');
}
export const stateLabel=value=>({proposed:'提出',attempted:'尝试',accepted:'接受',completed:'完成',declined:'拒绝',canceled:'取消',resolved:'已解决',active:'有效',unknown:'待核对'})[value]??value;
export const awarenessLabel=value=>({known:'知道',heard:'听说',suspected:'怀疑',mistaken:'误以为',explicitly_unaware:'明确不知情'})[value]??value;
export const viaLabel=value=>({witnessed:'亲眼见证',heard_in_scene:'现场听见',read:'阅读获知',told:'被告知',background:'背景已知',user_confirmed:'用户确认',special_ability:'特殊能力获知',unknown:'渠道未注明'})[value]??value??'渠道未注明';

export function recallExplanation(trace={}){
  const matched=(trace.dictionary?.matched??[]).map(t=>`${t.matched.join('、')} → ${t.name}`);
  const tags=(trace.tags?.lanes??[]).map(l=>l.tag);
  const status=s=>({passed:'完成',disabled:'未启用',fallback:'未完成，已降级',skipped:'已跳过'})[s]??'未使用';
  return [`字典匹配：${matched.join('；')||'没有命中词条'}`,`标签辅助：${tags.join('、')||'本轮没有触发相关标签'}`,`关键词候选：${trace.local?.count??0} 条；语义检索：${status(trace.vector?.status)}；重排：${status(trace.rerank?.status)}`,...(trace.characters?.mode==='full'?[`人物档案全量：${trace.characters.people.join('、')||'未匹配人物'}；${trace.characters.records} 项，不受历史记忆条数或篇幅限制。`]:[]),...(trace.knowledgeContext?[`知情关联背景：补入 ${trace.knowledgeContext.eventIds.length} 件明确关联事件；${trace.knowledgeContext.units} 估算单位（随人物知情带入，不占历史候选名额）；未关联事件的知情 ${trace.knowledgeContext.unresolvedRecordIds.length} 条，可能是独立命题或属性知情，不自动猜测关联。`]:[]),`本轮注入：${trace.packing?.selected??0} 项，补充相关经过 ${trace.packing?.excerpts??0} 条，省去重复记录 ${trace.packing?.duplicates??0} 条。`,`耗时：关键词 ${Math.round(trace.timings?.localMs??0)} ms · 向量 ${Math.round(trace.timings?.vectorMs??0)} ms · 重排 ${Math.round(trace.timings?.rerankMs??0)} ms`,...(trace.packing?.decisions??[]).map(d=>`${({selected:'已选',duplicate:'已去重',budget:'篇幅不足',limit:'数量上限'})[d.status]??'候选'} · ${d.title}：${d.reason}${d.detailOmitted?'；相关经过未能放入':''}`),'相关人物档案完整带入；历史事件按需检索。没有把全部字典和标签发送给聊天模型。'].join('\n');
}
