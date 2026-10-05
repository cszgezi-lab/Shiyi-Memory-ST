import { API_KINDS } from './product-model-list.js';
import { isMissingProductEntry } from './product-host-adapters.js';
import { stableStringify } from './utils.js';
import {verifiedWrite} from './reliable-storage.js';

export const credentialAddress = kind => {
  if (!API_KINDS.includes(kind)) throw new Error('未知模型用途');
  return { namespace:'shiyi-device-credentials',key:`${kind}-v1` };
};
export function credentialOrigin(endpoint) {
  try {const url=new URL(endpoint);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.origin:'';} catch{return '';}
}
/** User-requested device persistence, separate from all exportable documents.
 * TT extension storage is not advertised as an OS keychain or encrypted vault.
 * Only keys explicitly entered for this plugin are ever read or changed. */
export function createCredentialStore({getStore}) {
  let store;const pending=new Map();
  const ready=async()=>store??=await getStore();
  async function read(kind) {
    try {
      const s=await ready(),address=credentialAddress(kind);
      const entry=s.tryGetJson?await s.tryGetJson(address):{found:true,value:await s.getJson(address)};
      if(!entry?.found||entry.value==null)return {value:'',origin:''};
      const v=entry.value;
      if(v.version!==1||typeof v.value!=='string'||typeof v.origin!=='string'||v.value.length>16384||/[\r\n]/.test(v.value)||(v.value?(!v.origin||credentialOrigin(v.origin)!==v.origin):v.origin!==''))throw new Error('invalid');
      return {value:v.value,origin:v.origin};
    }catch(error){if(isMissingProductEntry(error))return {value:'',origin:''};throw new Error('本机 Key 读取失败，已有记忆不受影响；请重试或重新填写 Key');}
  }
  function save(kind,value,origin) {
    credentialAddress(kind);
    if(typeof value!=='string'||value.length>16384||/[\r\n]/.test(value))throw new Error('Key 格式无效');
    if(value&&!credentialOrigin(origin))throw new Error('请先填写有效 API 地址，再保存 Key');
    const document={version:1,value,origin:value?credentialOrigin(origin):''};
    const task=(pending.get(kind)??Promise.resolve()).catch(()=>{}).then(async()=>{
      try {const s=await ready();await verifiedWrite(s,credentialAddress(kind),document);const check=await read(kind);if(stableStringify(check)!==stableStringify({value:document.value,origin:document.origin}))throw new Error('mismatch');}
      catch{throw new Error('本机 Key 保存或读回失败，不能确认已保存；当前输入仍保留，请重试');}
      return {value:document.value,origin:document.origin};
    });pending.set(kind,task);return task.finally(()=>{if(pending.get(kind)===task)pending.delete(kind);});
  }
  return {read,save};
}
