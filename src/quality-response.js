import {isPlainObject} from './utils.js';

const fields=['updates','additions','issues','reviews'];
const type=v=>v===undefined?'missing':v===null?'null':Array.isArray(v)?'array':typeof v;
/** Structural diagnostics only: never export arbitrary keys, text or IDs. */
export function qualityResponseShape(value){
  return [{field:'root',type:type(value),...(Array.isArray(value)?{count:value.length}:{})},
    ...fields.map(field=>({field,type:type(value?.[field]),...(Array.isArray(value?.[field])?{count:value[field].length}:{})}))];
}
export function qualityResponseError(reason,output,details={}){
  return Object.assign(new Error(`记忆校对未通过：${reason}；原记忆保留`),{code:'QUALITY_RESPONSE_INVALID',details:{stage:'validate',reason:'quality_validation',qualityReason:reason,qualityShape:qualityResponseShape(output),...details}});
}

/** Compatibility is syntax only; never infer missing corrections or proof. */
export function normalizeQualityResponse(value){
  const original=value;let normalizedFields=0;
  for(let i=0;i<2&&isPlainObject(value)&&Object.keys(value).length===1;i++){
    const key=Object.keys(value)[0];
    if(!['result','data','review'].includes(key)||!isPlainObject(value[key]))break;
    value=value[key];normalizedFields++;
  }
  if(Array.isArray(value)&&value.length&&value.every(r=>isPlainObject(r)&&typeof r.id==='string'&&isPlainObject(r.fields)&&(Array.isArray(r.evidence)||Array.isArray(r.fields.acquisitionEvidence?.segmentIds)))){value={updates:value};normalizedFields++;}
  if(!isPlainObject(value)||!['updates','additions','issues'].some(k=>Array.isArray(value[k])))throw qualityResponseError('返回格式或条数不正确',original);
  const output={...value};
  for(const k of ['updates','additions','issues']){
    if(output[k]===undefined||output[k]===null){output[k]=[];normalizedFields++;}
    if(!Array.isArray(output[k]))throw qualityResponseError('返回格式或条数不正确',original);
  }
  if(output.updates.length+output.additions.length>200||output.issues.length>100)throw qualityResponseError('返回格式或条数不正确',original);
  return {output,normalizedFields};
}
