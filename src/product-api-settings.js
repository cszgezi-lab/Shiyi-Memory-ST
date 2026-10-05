import { defaultProductSettings, splitProductSettings, validateProductPatch } from './product-settings.js';
import { clone, stableStringify } from './utils.js';

export const API_SETTINGS_ADDRESS = Object.freeze({namespace:'shiyi-product-api',key:'connections-v1'});

/** Only uses TT's global extension store; never opens a chat or reads its body. */
export function createApiSettings({getStore,onApply=()=>{}}) {
  const defaults=splitProductSettings(defaultProductSettings()).api;
  let store,loaded=false,loading=null,saved={},queue=Promise.resolve();
  const value=()=>({...clone(defaults),...clone(saved)});
  const read=()=>store.tryGetJson ? store.tryGetJson(API_SETTINGS_ADDRESS) : store.getJson(API_SETTINGS_ADDRESS).then(value=>({found:value!==undefined&&value!==null,value}));
  async function load() {
    if(loaded)return value();
    if(loading)return loading;
    loading=(async()=>{
      store=await getStore();
      const found=await read();
      if(found.found){
        if(found.value?.version!==1||!found.value.settings||typeof found.value.settings!=='object')throw new Error('API 配置格式异常，未覆盖原数据');
        const {api,chat}=splitProductSettings(validateProductPatch(found.value.settings));
        if(Object.keys(chat).length)throw new Error('API 配置中含有非连接字段，未覆盖原数据');
        saved=api;
      }
      loaded=true;onApply(value());return value();
    })().finally(()=>{loading=null;});
    return loading;
  }
  function save(patch,{onlyIfEmpty=false}={}) {
    const {api,chat}=splitProductSettings(validateProductPatch(patch));
    if(Object.keys(chat).length)throw new Error('此处仅保存 API 配置');
    const pending=queue.catch(()=>{}).then(async()=>{
      await load();
      if(onlyIfEmpty&&Object.keys(saved).length)return value();
      const next={...saved,...api},document={version:1,settings:next};
      try {
        await store.setJson({...API_SETTINGS_ADDRESS,value:document});
        const check=await read();
        if(!check.found||stableStringify(check.value)!==stableStringify(document))throw new Error('readback mismatch');
      } catch { throw new Error('API 配置保存或读回校验失败，请重试；没有报告保存成功'); }
      saved=clone(next);onApply(value());return value();
    });
    queue=pending;return pending;
  }
  async function adoptLegacy(settings) {
    await load();
    if(Object.keys(saved).length)return false;
    const api=splitProductSettings(settings??{}).api;
    if(!Object.entries(api).some(([key,v])=>stableStringify(v)!==stableStringify(defaults[key])))return false;
    await save(api,{onlyIfEmpty:true});return true;
  }
  return {load,save,adoptLegacy,get current(){return value();}};
}
