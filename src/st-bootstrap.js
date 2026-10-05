import {STHostAdapter} from './st-host-adapter.js';
import {createSTWorldbookBridge} from './st-worldbook.js';
import {createSTProductFetch} from './st-network.js';
import {initProductShell} from '../ui/product-view.js';
import {ShiyiError} from './errors.js';
import {createSTBrowserBackup} from './st-backup.js';
import {mountSTBrowserBackup} from '../ui/st-backup.js';

const INSTANCE=Symbol.for('shiyi-memory.sillytavern.instance');
const STARTING=Symbol.for('shiyi-memory.sillytavern.starting');
const READY_LISTENER=Symbol.for('shiyi-memory.sillytavern.ready-listener');
const READY_TIMER=Symbol.for('shiyi-memory.sillytavern.ready-timer');
const EPOCH=Symbol.for('shiyi-memory.sillytavern.epoch');
export function assertSTHost(host,version){
  if(host?.__TAURITAVERN__)throw new ShiyiError('这是原版酒馆版，请在 TT 中使用拾忆 TT 版。','ST_WRONG_HOST');
  const context=host?.SillyTavern?.getContext?.()??host?.getContext?.();
  if(!context||typeof context.getRequestHeaders!=='function'||typeof context.eventSource?.on!=='function'||typeof context.setExtensionPrompt!=='function')
    throw new ShiyiError('原版酒馆接口尚未就绪，请刷新后重试。','ST_HOST_UNAVAILABLE');
  if(!/^1\.(?:17|18|19)\.\d+$/.test(String(version??'')))
    throw new ShiyiError('当前原版版支持 SillyTavern 1.17.x–1.19.x；其它版本尚未验证。','ST_VERSION_UNSUPPORTED');
  return context;
}

/** Public ST globals remain real. The facade only supplies this edition's
 * read-only source bridge; it never claims TauriTavern capabilities. */
export function createSTHostFacade(host,bridge){
  const overrides={...bridge,__SHIYI_EDITION__:'sillytavern'};
  return new Proxy(host,{get(target,key){
    if(Object.hasOwn(overrides,key))return overrides[key];
    const value=Reflect.get(target,key,target);
    return typeof value==='function'?value.bind(target):value;
  }});
}

export async function initST({host=globalThis,importModule=url=>import(url),fetchImpl=host.fetch?.bind(host)}={}){
  if(host[INSTANCE])return host[INSTANCE];
  const epoch=host[EPOCH]??0;
  if(host[STARTING]?.epoch===epoch)return host[STARTING].task;
  const abort=new AbortController();
  const check=()=>{if(abort.signal.aborted||(host[EPOCH]??0)!==epoch)throw new ShiyiError('拾忆启动已取消。','CANCELED');};
  const task=(async()=>{
    check();
    if(host?.__TAURITAVERN__)throw new ShiyiError('这是原版酒馆版，请在 TT 中使用拾忆 TT 版。','ST_WRONG_HOST');
    const context=host.SillyTavern?.getContext?.()??host.getContext?.();
    if(typeof fetchImpl!=='function'||!context?.getRequestHeaders)throw new ShiyiError('酒馆请求接口尚未就绪。','ST_HOST_UNAVAILABLE');
    const response=await fetchImpl('/version',{credentials:'same-origin',cache:'no-store',signal:abort.signal});check();
    if(!response.ok)throw new ShiyiError('无法核实酒馆版本，请刷新后重试。','ST_HOST_UNAVAILABLE');
    const {pkgVersion}=await response.json();check();assertSTHost(host,pkgVersion);
    if(host.document?.getElementById('shiyi-floating-layer'))throw new ShiyiError('已有拾忆窗口，请只启用一个拾忆版本。','ST_DUPLICATE_EDITION');
    const [worldInfoModule,userModule]=await Promise.all([importModule('/scripts/world-info.js'),importModule('/scripts/user.js')]);
    check();
    const accountResponse=await fetchImpl('/api/users/me',{headers:context.getRequestHeaders(),credentials:'same-origin',cache:'no-store',signal:abort.signal});check();
    if(!accountResponse.ok)throw new ShiyiError('无法确认当前酒馆账户，请重新登录后重试。','ST_ACCOUNT_UNAVAILABLE');
    const account=await accountResponse.json();
    check();
    if(typeof account.handle!=='string'||!account.handle||userModule.getCurrentUserHandle?.()!==account.handle)
      throw new ShiyiError('酒馆账户已变化，请刷新后重试。','ST_ACCOUNT_CHANGED');
    const getContext=()=>host.SillyTavern?.getContext?.()??host.getContext?.();
    const getAccountId=()=>userModule.getCurrentUserHandle();
    const bridge=createSTWorldbookBridge({context:getContext,worldInfoModule,fetchImpl});
    const facade=createSTHostFacade(host,bridge);
    const adapter=new STHostAdapter(facade,{fetchImpl,getAccountId,nativeHost:host,deviceStorage:host.localStorage,locks:host.navigator?.locks});
    await adapter.ready();check();
    const renameOff=adapter.attachRenameListener?.({onError:cause=>host.toastr?.error?.(cause.message??'拾忆未能跟随聊天更名；原存档保留。')});
    let shell;
    try{shell=initProductShell({host:facade,documentRef:host.document,controllerOptions:{adapter,fetchImpl:createSTProductFetch(facade,fetchImpl)}});}
    catch(error){renameOff?.();await adapter.dispose?.();throw error;}
    if(!shell){renameOff?.();await adapter.dispose?.();throw new ShiyiError('拾忆窗口未能挂载，请刷新页面。','ST_MOUNT_FAILED');}
    const originalDestroy=shell.destroy.bind(shell);
    shell.edition=Object.freeze({name:'sillytavern',hostVersion:pkgVersion,account:account.handle});
    shell.adapter=adapter;
    let backupUI;
    shell.destroy=async()=>{try{backupUI?.dispose();renameOff?.();await originalDestroy();}finally{await adapter.dispose?.();if(host[INSTANCE]===shell)delete host[INSTANCE];}};
    host[INSTANCE]=shell;
    shell.browserBackup=createSTBrowserBackup({indexedDB:host.indexedDB,getAccountId,locks:host.navigator?.locks,
      beforeRestore:()=>shell.destroy(),afterRestore:()=>((host[EPOCH]??0)===epoch?initST({host,importModule,fetchImpl}):false)});
    backupUI=mountSTBrowserBackup({panel:shell.panel,host,backup:shell.browserBackup});
    return shell;
  })();
  const starting={task,abort,epoch};host[STARTING]=starting;
  try{return await task;}finally{if(host[STARTING]===starting)delete host[STARTING];}
}

/** The awaited ST loader must finish before APP_READY. Register, then defer
 * initialization so no model lifetime blocks the host's ready event. */
export function activateST(host=globalThis){
  if(host?.__TAURITAVERN__){host.toastr?.error?.('这是原版酒馆版，请使用拾忆 TT 版。');return;}
  if(host[READY_LISTENER]||host[INSTANCE])return;
  const context=host.SillyTavern?.getContext?.()??host.getContext?.();
  if(!context?.eventSource?.on)return;
  const type=context.eventTypes?.APP_READY??'app_ready';
  const epoch=host[EPOCH]??0;
  const listener=()=>{deactivateReadyListener(host);host[READY_TIMER]=host.setTimeout(()=>{delete host[READY_TIMER];if((host[EPOCH]??0)!==epoch)return;void initST({host}).catch(error=>{if(error?.code!=='CANCELED'&&error?.name!=='AbortError')host.toastr?.error?.(error.message??'拾忆启动失败');});},0);};
  host[READY_LISTENER]={source:context.eventSource,type,listener};context.eventSource.on(type,listener);
}
function deactivateReadyListener(host){const saved=host[READY_LISTENER];if(saved){(saved.source.removeListener??saved.source.off)?.call(saved.source,saved.type,saved.listener);delete host[READY_LISTENER];}}
export async function disableST(host=globalThis){host[EPOCH]=(host[EPOCH]??0)+1;deactivateReadyListener(host);if(host[READY_TIMER]!=null){host.clearTimeout(host[READY_TIMER]);delete host[READY_TIMER];}host[STARTING]?.abort.abort();await host[INSTANCE]?.destroy();}
