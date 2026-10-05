// One user-initiated model call per click. The model only restates what the
// user asked for as standing rules; saving is a separate, explicit edit.
import {personaDevelopmentText} from './persona-development.js';

const unsafe=/\[\[SHIYI_PERSONA:|<%|%>|<\/?script\b|\{\{(?!\s*(?:user|char)\s*\}\})|@@/i;
export const MAX_PERSONA_DIRECTIVES=8;

export function personaDirectiveRequest(profile,instruction){
  const text=String(instruction??'').trim();
  if(!text)throw new Error('请先写下要模型记住什么');
  if(text.length>600||unsafe.test(text))throw new Error('请用普通句子写，不超过 600 字，不要包含脚本');
  const existing=(profile.userDirectives??[]).map(String);
  const attitudes=personaDevelopmentText(profile.composition?.development??[]);
  const system=`你把用户对一个角色的口头要求整理成「强调」条目，供角色扮演模型长期遵守。
只输出 JSON：{"directives":["……"]}。
规则：
1. 只写用户这次要求和已有强调里的内容，不补充用户没说的事实、经历、台词或新关系。
2. 每条一句，写清是谁、对谁、现在怎样。保留用户说出的条件和对象。不要把用户没说的情节补成固定句式。
3. 用户要求删除或改写旧条目时，按要求删除或替换；没提到的旧条目原样保留。
4. 用户要求去掉的旧内容从列表删除，或换成用户写出的当前说法。不要为被删内容再写一条说明。
5. 最多 ${MAX_PERSONA_DIRECTIVES} 条，每条不超过 120 字，用简体中文，不写解释。`;
  const user=JSON.stringify({name:profile.name,aliases:profile.aliases??[],existingDirectives:existing,currentAttitudes:attitudes||'',instruction:text});
  return {messages:[{role:'system',content:system},{role:'user',content:user}]};
}

export function parsePersonaDirectiveResponse(response){
  const reason=response?.choices?.[0]?.finish_reason;
  if(['length','max_tokens'].includes(reason))throw Object.assign(new Error('模型回答没写完，强调未保存'),{code:'MODEL_OUTPUT_TRUNCATED'});
  if(reason==='content_filter')throw Object.assign(new Error('接口拒绝了这次整理，强调未保存'),{code:'MODEL_OUTPUT_BLOCKED'});
  const raw=String(response?.choices?.[0]?.message?.content??'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  let body;try{body=JSON.parse(raw);}catch{throw Object.assign(new Error('模型回答不是完整 JSON，强调未保存'),{code:'PERSONA_RESPONSE_INVALID'});}
  if(!Array.isArray(body?.directives))throw Object.assign(new Error('模型回答缺少强调条目'),{code:'PERSONA_RESPONSE_INVALID'});
  const lines=[...new Set(body.directives.map(item=>String(item??'').trim()).filter(Boolean))];
  if(!lines.length)throw Object.assign(new Error('模型没有整理出任何强调'),{code:'PERSONA_RESPONSE_INVALID'});
  if(lines.length>MAX_PERSONA_DIRECTIVES||lines.some(line=>line.length>120||unsafe.test(line)))throw Object.assign(new Error('整理结果过长或含不安全内容，强调未保存'),{code:'PERSONA_RESPONSE_INVALID'});
  return lines;
}
