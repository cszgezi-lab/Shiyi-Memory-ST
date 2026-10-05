import { clone, sha256, stableStringify } from './utils.js';
import { narrativeText } from './product-narrative.js';
import { ValidationError } from './errors.js';
import { valueType } from './validation-diagnostics.js';

const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const secret = /(?:api.?key|token|password|secret|authorization|密码|密钥)/i;
const idPattern = /^[a-z][a-z0-9_-]{0,63}$/;
export const moduleField = (id, field) => `custom:${id}:${field}`;
export function parseModuleField(value) {
  const match = /^custom:([a-z][a-z0-9_-]{0,63}):([a-z][a-z0-9_-]{0,63})$/.exec(String(value));
  return match ? { moduleId: match[1], fieldId: match[2] } : null;
}
export function validateModule(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('区块定义必须是对象');
  const allowed = ['id','name','description','subject','mode','fields','enabled','inject','archived'];
  if (Object.keys(input).some(k => !allowed.includes(k))) throw new Error('区块含不支持的字段；不执行代码');
  const text = (value, max, required = false) => {
    if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error('区块名称、说明或字段长度无效');
    return value.trim();
  };
  if (!idPattern.test(input.id) || forbidden.has(input.id)) throw new Error('区块 ID 无效');
  if (!['manual','summary','mvu'].includes(input.mode)) throw new Error('请选择手动、总结或 MVU 来源');
  if (!Array.isArray(input.fields) || !input.fields.length || input.fields.length > 16) throw new Error('每个区块需要 1–16 个字段');
  const seen = new Set();
  const fields = input.fields.map(f => {
    if (!f || Object.keys(f).some(k => !['id','label','type','path'].includes(k)) || !idPattern.test(f.id) || forbidden.has(f.id) || seen.has(f.id)) throw new Error('字段 ID 重复或无效');
    seen.add(f.id);
    if (!['text','number','boolean'].includes(f.type)) throw new Error('字段类型无效');
    const result = { id:f.id, label:text(f.label,80,true), type:f.type };
    if (input.mode === 'mvu') {
      if (!Array.isArray(f.path) || !f.path.length || f.path.length > 16 || f.path.some(k => typeof k !== 'string' || !k || k.length > 100 || forbidden.has(k) || secret.test(k))) throw new Error('MVU 字段需要有效的变量路径，不能读取密钥');
      result.path = [...f.path];
    }
    return result;
  });
  for (const k of ['enabled','inject','archived']) if (input[k] !== undefined && typeof input[k] !== 'boolean') throw new Error('区块开关必须为布尔值');
  return { id:input.id, name:text(input.name,80,true), description:text(input.description??'',1600), subject:text(input.subject??'',120), mode:input.mode, fields, enabled:input.enabled??true, inject:input.inject??false, archived:input.archived??false };
}
export function validateModules(list) {
  if (!Array.isArray(list) || list.length > 100) throw new Error('区块定义上限 100 个（包括已归档）');
  const result = list.map(validateModule);
  if (new Set(result.map(m => m.id)).size !== result.length) throw new Error('区块 ID 重复');
  return result;
}
export const moduleBinding = m => sha256({id:m.id,mode:m.mode,fields:m.fields.map(({id,type,path})=>({id,type,path}))});
export const activeModules = list => list.filter(m => m.enabled && !m.archived);
// This wording is part of persisted batch.rules. Keep the generated policy
// stable so a wording-only upgrade cannot invalidate an already-paid draft.
// Presentation guidance belongs to the transport contract, not this binding.
export function moduleRules(list) {
  const definitions = activeModules(list).filter(m => m.mode === 'summary').map(m => ({id:m.id,name:m.name,subject:m.subject,rule:m.description,fields:m.fields.map(f=>({field:moduleField(m.id,f.id),label:f.label,type:f.type}))}));
  return `自定义扩展区块：${JSON.stringify(definitions)}。在同一次总结中，有正文依据时将这些字段写入 entityFactChanges，field 必须使用上述完整标识，entity 使用正文人物，保留 sourceRefs；没有新信息不必生成。所有未列出的 custom: 字段（尤其 MVU/手动字段）禁止生成。不得猜测变量或把记录偏好当成已发生事实。`;
}
export function checkModuleBundle(bundle, definitions) {
  const allowed = new Map(activeModules(definitions).filter(m=>m.mode==='summary').flatMap(m=>m.fields.map(f=>[moduleField(m.id,f.id),f])));
  const issues=[];
  for (const [index,r] of (bundle.entityFactChanges??[]).entries()) {
    const key = r.field??r.key;
    if (!String(key).startsWith('custom:')) continue;
    const field = allowed.get(key);
    if (!field) {issues.push({path:`entityFactChanges[${index}].field`,reason:'unauthorized_module_field'});continue;}
    const value=Object.hasOwn(r,'to')?r.to:Object.hasOwn(r,'value')?r.value:r.newValue;
    try{checkValue(value,field.type);}catch{issues.push({path:`entityFactChanges[${index}].to`,reason:'type_mismatch',expectedType:field.type==='text'?'string':field.type,actualType:valueType(value)});}
  }
  // All row positions, never the untrusted names/values. Keep the entire draft
  // uncommitted: silently dropping a protected field would hide a failed task.
  if(issues.length)throw new ValidationError('扩展字段校验未通过，草稿保留，原记忆未改变',{validationIssueCount:issues.length,validationIssues:issues});
}
export function checkValue(value,type,{maxTextLength=12000}={}) {
  if (type === 'number' ? typeof value !== 'number'||!Number.isFinite(value) : type === 'boolean' ? typeof value !== 'boolean' : typeof value !== 'string'||value.length>maxTextLength) throw new Error('记录值与字段类型不匹配');
  return value;
}
export function customMemoryCards(cards, modules) {
  return cards.flatMap(card => {
    const tag = parseModuleField(card.field??card.key);
    if (!tag) return String(card.field??card.key??'').startsWith('custom:')?[]:[card];
    const m = modules.find(m=>m.id===tag.moduleId && !m.archived), f = m?.fields.find(f=>f.id===tag.fieldId);
    if (!m || !f || m.mode === 'mvu') return [];
    const value=Object.hasOwn(card,'to')?card.to:Object.hasOwn(card,'value')?card.value:card.newValue;
    const description = `${m.name} · ${card.entity??m.subject} · ${f.label}：${value===null?'已清空 / 未赋值':narrativeText(value)}`;
    return [{...card,customModuleId:m.id,fieldId:f.id,fieldKey:card.field??card.key,field:f.label,description,text:description,customInject:m.inject&&m.enabled}];
  });
}
export function messageFingerprint(message) {
  return sha256({id:message?.id??null,body:message?.mes??message?.text??'',swipe:message?.swipe_id??null,version:message?.version??null});
}
export function mvuContext(host) { return host.SillyTavern?.getContext?.()??host.getContext?.(); }
const leafValue = value => Array.isArray(value) && value.length===2 && typeof value[1]==='string' && ['string','number','boolean'].includes(typeof value[0]) ? value[0] : value;
export function variablePaths(data) {
  const out = []; let visited=0;
  function walk(value,path) {
    if (++visited>3000 || out.length>=200 || path.length>16) return;
    value=leafValue(value);
    if (['string','number','boolean'].includes(typeof value)) {out.push({path,type:typeof value==='string'?'text':typeof value});return;}
    if (!value||typeof value!=='object') return;
    for (const k of Object.keys(value)) if (!forbidden.has(k)&&!secret.test(k)) walk(value[k],[...path,k]);
  }
  walk(data,[]);return out;
}
export function valueAt(data,path) {
  let value=data;
  for (const key of path) {if (forbidden.has(key)||secret.test(key)||!value||typeof value!=='object'||!Object.hasOwn(value,key)) return undefined;value=value[key];}
  return leafValue(value);
}
/** Read-only, current-message scope only. No chat/global variable fallback. */
export async function readMvu(host,check=()=>{},{maxFloors=Infinity,totalMs=Infinity}={}) {
  check();const context=mvuContext(host),messages=context?.chat;
  if (!Array.isArray(messages)||!messages.length) return {status:'no_chat',paths:[]};
  let api=host.Mvu;
  if (!api?.getMvuData) return {status:'unavailable',paths:[]};
  const deadline=Date.now()+totalMs;
  // MVU exposes getMvuData only after its initialization. Do not wait on a
  // missing global in the send hook: a later MVU event/refresh retries it.
  for (let floor=messages.length-1;floor>=Math.max(0,messages.length-maxFloors);floor--) {
    if(Date.now()>=deadline)return {status:'pending',paths:[]};
    const fingerprint=messageFingerprint(messages[floor]);
    let timer;
    try {
      const raw=await Promise.race([Promise.resolve(api.getMvuData({type:'message',message_id:floor})),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('MVU 读取超时')),Math.max(1,Math.min(1200,deadline-Date.now())));})]);
      check();if (fingerprint!==messageFingerprint(mvuContext(host)?.chat?.[floor])) throw new Error('读取期间聊天来源已变化');
      if (raw?.stat_data && Object.keys(raw.stat_data).length) return {status:'ready',floor,fingerprint,data:clone(raw.stat_data),paths:variablePaths(raw.stat_data)};
    } catch {check();if(Date.now()>=deadline)return {status:'pending',paths:[]};throw new Error('MVU 读取未完成，请确认变量框架已初始化并重新读取');} finally {clearTimeout(timer);}
  }
  return {status:'empty',paths:[]};
}
export function mvuSnapshots(modules,read,previous) {
  if (read.status!=='ready') return [];
  return activeModules(modules).filter(m=>m.mode==='mvu').map(m=>{
    const values={},missing=[];
    for (const f of m.fields) {const value=valueAt(read.data,f.path);try{checkValue(value,f.type,{maxTextLength:Infinity});values[f.id]=value;}catch{missing.push(f.id);}}
    const row={moduleId:m.id,floor:read.floor,fingerprint:read.fingerprint,definition:moduleBinding(m),values,missing};
    const last=previous.filter(s=>s.moduleId===m.id&&s.definition===row.definition&&s.floor<row.floor).at(-1);
    row.changes=Object.fromEntries(Object.entries(values).filter(([k,v])=>last&&Object.hasOwn(last.values,k)&&stableStringify(v)!==stableStringify(last.values[k])).map(([k,v])=>[k,{from:last.values[k],to:v}]));
    return row;
  });
}
export function mvuCards(modules,rows) {
  return activeModules(modules).filter(m=>m.mode==='mvu').flatMap(m=>{
    const row=rows.filter(r=>r.moduleId===m.id&&r.definition===moduleBinding(m)).sort((a,b)=>a.floor-b.floor).at(-1);
    if(!row)return [];
    return m.fields.filter(f=>Object.hasOwn(row.values,f.id)).map(f=>{
      const description=`${m.name} · ${m.subject||'当前角色'} · ${f.label}：${String(row.values[f.id])}（MVU #${row.floor} 只读快照）`;
      return {id:`mvu-${m.id}-${f.id}`,customModuleId:m.id,customInject:m.inject,fieldId:f.id,fieldKey:moduleField(m.id,f.id),category:'entityFactChanges',entity:m.subject,field:f.label,to:row.values[f.id],description,text:description,readonly:true,sourceRefs:[{sourceId:`MVU:${row.floor}`,hash:row.fingerprint}],context:'变量不自动赋予角色知情权；只读，不改写 MVU',awareness:[]};
    });
  });
}
