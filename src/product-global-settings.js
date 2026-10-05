import { persistedProductSettings, validateProductEdit, validateStoredProductPatch as validateStoredSettings } from './product-settings.js';
import { API_SETTINGS_ADDRESS } from './product-api-settings.js';
import { clone, stableStringify } from './utils.js';
import {losslessStore,verifiedWrite} from './reliable-storage.js';

export const GLOBAL_SETTINGS_ADDRESS = Object.freeze({namespace:'shiyi-product-global',key:'settings-v1'});
export const DEFAULTS_MIGRATION_ID = '0.21.87-ready-defaults';
export const DEFAULTS_ARCHIVE_ADDRESS = Object.freeze({namespace:'shiyi-product-global',key:'settings-before-defaults-0.21.87'});
const connectionKeys=new Set(['provider','assistant','supplement','embedding','rerank','dynamicPersona','personaReview','knowledge'].flatMap(prefix=>['Endpoint','Model','EndpointMode','AuthMode'].map(suffix=>prefix+suffix)));
const connections=settings=>Object.fromEntries(Object.entries(settings).filter(([key])=>connectionKeys.has(key)));
// Loading old recipes must leave the editor reachable. Execute/compile them
// only for selected source requests or explicit preview; new saves stay strict.
// Share the same store serialization pattern as repository scope commits.
const storeQueues=new WeakMap();
function serial(store,task){
  const pending=(storeQueues.get(store)??Promise.resolve()).catch(()=>{}).then(task);
  storeQueues.set(store,pending);return pending;
}
/** Installation-wide configuration. Chat contents never enter this document. */
export function createGlobalSettings({getStore,onApply=()=>{}}) {
  let store,loading,loaded=false,saved={},queue=Promise.resolve();
  const value=()=>({...persistedProductSettings(),...clone(saved)});
  const read=async address=>store.tryGetJson ? store.tryGetJson(address) : store.getJson(address).then(value=>({found:value!=null,value}));
  async function archiveBeforeMigration(previous,address){
    const archived=await read(DEFAULTS_ARCHIVE_ADDRESS);
    if(!archived.found)await verifiedWrite(store,DEFAULTS_ARCHIVE_ADDRESS,{version:1,migration:DEFAULTS_MIGRATION_ID,source:address,document:clone(previous)});
    else if(archived.value?.version!==1||archived.value?.migration!==DEFAULTS_MIGRATION_ID||!archived.value.document)throw new Error('旧设置归档格式异常，未覆盖设置');
  }
  async function migrate(previous,address){
    const valid=validateStoredSettings(previous.settings);
    await archiveBeforeMigration(previous,address);
    // Another controller may have completed migration while archive I/O was
    // pending. Its completion marker and subsequent edits take precedence.
    const latest=await read(GLOBAL_SETTINGS_ADDRESS);
    if(latest.found&&latest.value?.version===1&&latest.value.defaultsMigration===DEFAULTS_MIGRATION_ID)return validateStoredSettings(latest.value.settings);
    const next={...persistedProductSettings(),...connections(valid)};
    await verifiedWrite(store,GLOBAL_SETTINGS_ADDRESS,{version:1,defaultsMigration:DEFAULTS_MIGRATION_ID,settings:next});
    return next;
  }
  async function load(){
    if(loaded)return value();
    if(loading)return loading;
    loading=(async()=>{
      store=losslessStore(await getStore());return serial(store,async()=>{
      const found=await read(GLOBAL_SETTINGS_ADDRESS);
      if(found.found){
        if(found.value?.version!==1)throw new Error('全局设置版本无效，未覆盖原数据');
        saved=found.value.defaultsMigration===DEFAULTS_MIGRATION_ID?validateStoredSettings(found.value.settings):await migrate(found.value,GLOBAL_SETTINGS_ADDRESS);
      } else {
        const old=await read(API_SETTINGS_ADDRESS);
        if(old.found){if(old.value?.version!==1)throw new Error('API 设置版本无效，未覆盖原数据');saved=await migrate(old.value,API_SETTINGS_ADDRESS);}
      }
      loaded=true;onApply(value());return value();
      });
    })().finally(()=>{loading=null;});return loading;
  }
  function save(patch,{adopt=false}={}){
    let valid=validateProductEdit(patch,saved);
    const pending=queue.catch(()=>{}).then(async()=>{
      await load();
      return serial(store,async()=>{
      const current=await read(GLOBAL_SETTINGS_ADDRESS);
      if(current.found&&current.value?.version===1&&current.value.defaultsMigration===DEFAULTS_MIGRATION_ID){
        saved=validateStoredSettings(current.value.settings);
        if(adopt){onApply(value());return value();}
      }
      valid=validateProductEdit(patch,saved);
      if(adopt)await archiveBeforeMigration({version:1,settings:valid},{namespace:'legacy-chat',key:'settings'});
      const next=adopt?{...persistedProductSettings(),...connections(valid),...saved}:{...saved,...valid};
      const document={version:1,defaultsMigration:DEFAULTS_MIGRATION_ID,settings:next};
      try{await verifiedWrite(store,GLOBAL_SETTINGS_ADDRESS,document);
      const check=await read(GLOBAL_SETTINGS_ADDRESS);
      if(!check.found||stableStringify(check.value)!==stableStringify(document))throw new Error('readback mismatch');}catch{throw new Error('全局设置保存或读回校验失败，请重试；未报告保存成功');}
      saved=clone(next);onApply(value());return value();
      });
    });queue=pending;return pending;
  }
  async function adoptLegacy(settings){
    await load();if((await read(GLOBAL_SETTINGS_ADDRESS)).found)return false;
    await save(settings??{},{adopt:true});return true;
  }
  return {load,save,adoptLegacy,get current(){return value();}};
}
