import { exportAndroidJson } from './product-android-export.js';

function triggerBrowserExport(blob, name, documentRef) {
  if (!documentRef?.createElement || !documentRef?.body) throw new Error('TT 下载桥和浏览器导出接口均不可用');
  const url = URL.createObjectURL(blob), anchor = documentRef.createElement('a');
  try {
    anchor.href = url; anchor.download = name; anchor.rel = 'noopener';
    documentRef.body.appendChild(anchor);
    anchor.click();
    // An anchor click only hands the payload to the host/browser download path.
    // It never proves that a file reached storage, so this result is reported as
    // "已派发" and can never be promoted to a save confirmation.
    return { mode: 'browser-fallback', status: 'dispatched', saved: false };
  } finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000); }
}

/** The TT Android bridge is an addJavascriptInterface method: when the Java
 * method throws, WebView surfaces the throwable itself. Recognize that shape so
 * a native Java failure can never be reported as a normal dispatchable error. */
function isHostExceptionError(error) {
  const name = String(error?.name ?? '');
  const text = `${String(error?.message ?? '')} ${String(error ?? '')}`;
  return /JavaException|Java exception was raised|Error invoking \w+|java\.lang\.|android\.(?:os|content|system)\.\w*(?:Exception|Error)/i.test(text)
    || /JavaException/i.test(name);
}
function messageOf(error) { return `${String(error?.name ?? '')} ${String(error?.message ?? '')} ${String(error ?? '')}`; }
function isCancelError(error) { return error?.name === 'AbortError' || /cancel(?:led|ed)?|取消/i.test(messageOf(error)); }
function isPermissionError(error) {
  return /NotAllowedError|SecurityException/i.test(String(error?.name ?? ''))
    || /permission|denied|not allowed|SecurityException|权限/i.test(messageOf(error));
}
/** Name the exact step that failed inside TT's Android export pipeline without
 * ever storing a path or host message. The official file-export.js resolves the
 * staging file before it talks to the MediaStore bridge, so its own thrown
 * texts identify the stage reliably. */
function saveStageOf(error) {
  const text = messageOf(error);
  // Java errors can also originate in staging-path validation. The wrapper
  // alone cannot tell us whether MediaStore was reached.
  if (/Export staging file not found|staging file/i.test(text)) return 'file_missing';
  if (/mkdir|app cache directory|staging directory|readable stream is required|unsupported binary chunk|blob payload is required/i.test(text)) return 'staging_failed';
  if (/did not return a saved path|Failed to create public Downloads entry|Failed to publish public Downloads entry|IS_PENDING|MediaStore/i.test(text)) return 'publish_failed';
  if (/Failed to copy export file|copyFileToContentUri|openOutputStream|Failed to open/i.test(text)) return 'write_failed';
  if (/Export source file is outside|Export filename must not contain/i.test(text)) return 'write_failed';
  return null;
}
/** Forward every attribution field the caller passed. Destructuring a fixed key
 * list here silently dropped exportAttempt / exportBytes / hostOperations, so
 * the thrown error lost exactly the diagnostics that identify the failing step. */
const exportFailure = (message, reason, details = {}) => {
  const { causeError, fallbackError, ...rest } = details;
  return Object.assign(new Error(message), {
    code: 'FILE_EXPORT_FAILED',
    details: { ...rest, reason, ...(causeError ? { causeError } : {}), ...(fallbackError ? { fallbackError } : {}) },
  });
};
/** TT's runtime returns camelCase (`savedPath`/`displayName`); a raw bridge
 * answer uses snake_case (`saved_path`/`display_name`). Accept both so a
 * successful save is never misread as unconfirmed. */
function normalizeExportResult(result) {
  if (!result || typeof result !== 'object') return result;
  const savedPath = result.savedPath ?? result.saved_path;
  const displayName = result.displayName ?? result.display_name;
  const mimeType = result.mimeType ?? result.mime_type;
  return {
    ...result,
    ...(savedPath ? { savedPath } : {}),
    ...(displayName ? { displayName } : {}),
    ...(mimeType ? { mimeType } : {}),
    uri: result.uri ?? '',
  };
}
function confirmedExport(result) {
  const value = normalizeExportResult(result);
  if (!value || typeof value !== 'object') return false;
  if (value.mode === 'mobile-native' || value.mode === 'android-document-picker') return Boolean(String(value.savedPath ?? '').trim() || String(value.uri ?? '').trim());
  if (value.mode === 'ios-native-share') return value.completed === true;
  if (value.mode === 'browser') return true;
  // No mode: a raw bridge answer that reports a saved location is still a save.
  return Boolean(String(value.savedPath ?? '').trim() || String(value.uri ?? '').trim()) && Boolean(value.displayName ?? value.savedPath ?? value.uri);
}
function dispatchOnly(result) {
  if (result?.mode === 'ios-native-share') return result.completed === false ? 'canceled' : 'share-unconfirmed';
  return 'browser-fallback';
}
const saveLocationOf = result => normalizeExportResult(result)?.mode === 'android-document-picker' || result?.savedPath === ''&&Boolean(result?.uri) ? '你选择的保存位置' : '手机 Downloads';
/** TT on Android can save two ways: the direct public-Downloads bridge, or the
 * system file picker plus a copy into the chosen document.  A device where one
 * is broken can still export through the other, so a failed direct save gets one
 * explicit picker attempt instead of only a text fallback. */
async function withDocumentPickerFallback(blob, name, host, timeoutMs = 30000) {
  const bridge = host?.[BRIDGE_NAME];
  if (!bridge || typeof bridge.copyFileToContentUri !== 'function' || typeof bridge.requestCreateDocumentPicker !== 'function') return null;
  try { return { result: await exportAndroidJson(blob, name, host, timeoutMs) }; }
  catch (error) { return { error }; }
}

const BRIDGE_NAME = 'TauriTavernAndroidPublicDownloadBridge';
/** Record which TT host operation the export actually reached, so a native
 * failure can be attributed to a specific step without storing any path, host
 * text or payload.  The direct public-Downloads save and the document-picker
 * copy fail for different reasons; this tells them apart. */
const BRIDGE_OPERATIONS = ['saveFileToDownloads', 'requestCreateDocumentPicker', 'copyFileToContentUri'];
function trackHostOperations(bridge, onError) {
  const restore=[];
  if (!bridge || typeof bridge !== 'object') return ()=>{};
  for (const key of BRIDGE_OPERATIONS) {
    const original = bridge[key];
    if (typeof original !== 'function') continue;
    const tracked = function(...args) {
      try { return original.apply(bridge, args); }
      catch (error) { try { onError(key, error); } catch { /* attribution must not mask the host error */ } throw error; }
    };
    try{bridge[key]=tracked;if(bridge[key]===tracked)restore.push(()=>{if(bridge[key]===tracked)bridge[key]=original;});}catch{/* A read-only native bridge must still be callable. */}
  }
  return ()=>{for(const undo of restore)try{undo();}catch{/* Native ownership may change during export. */}};
}
/** Reject a promise if the host never answers, so a save that silently never
 * completes is reported instead of leaving the UI waiting forever. */
function withExportTimeout(promise, timeoutMs) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('宿主导出在限定时间内没有返回结果'), { code: 'TIMEOUT' })), timeoutMs); timer?.unref?.(); }),
  ]);
}

/** Use TT's export runtime so Android saves through the native Downloads bridge.
 * Resolution contract: the promise only resolves when the host itself confirmed
 * a save (`saved:true`); every other outcome resolves as `status:'dispatched'`
 * (the payload was handed to a host path that cannot confirm storage) or rejects
 * with a classified FILE_EXPORT_FAILED / CANCELED error.
 *
 * preferBrowser:
 *  - true / 'browser': plain anchor.click() Web download. Works in desktop
 *    browsers but often silently does nothing in Tauri WebView on Android.
 *  - false / 'direct' (legacy default): the public-Downloads bridge first,
 *    then the system document picker as a fallback. file_missing on many
 *    Android devices.
 *  - 'picker' (UI default): explicit Android document picker, with NO implicit
 *    direct/browser fallback when the picker is unavailable or fails.
 *    The user gets a real system file picker and the chosen URI is confirmed
 *    by the host, so a "saved" result actually means a file reached storage.
 */
export async function exportProductJson(data, name, {
  host = globalThis, documentRef = globalThis.document,
  loadExporter = () => import('/scripts/file-export.js'),
  timeoutMs = 30000,
  preferBrowser = false,
} = {}) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  if (preferBrowser === 'picker' && (host?.[BRIDGE_NAME] || /android/i.test(host?.navigator?.userAgent ?? ''))) {
    return exportAndroidJson(blob, name, host, timeoutMs);
  }
  // Honour an explicit "browser" preference for callers that want the anchor
  // download path; otherwise enter the bridge path (which can also reach the
  // picker, depending on preferBrowser).
  if (preferBrowser === true || preferBrowser === 'browser') {
    try { return await triggerBrowserExport(blob, name, documentRef); }
    catch { /* fall through to the bridge path */ }
  }
  if (host?.__TAURITAVERN__?.api) {
    let downloadBlobWithRuntime;
    try{({downloadBlobWithRuntime}=await loadExporter());if(typeof downloadBlobWithRuntime!=='function')throw new Error('missing exporter');}
    catch(error){
      try{return {...await triggerBrowserExport(blob,name,documentRef),nativeAttempt:'unavailable',reason:'export_module_unavailable',stage:'export_load'};}
      catch(fallbackError){throw exportFailure('当前 TT 文件导出接口不可用；日志可使用“查看／复制文本”导出','export_module_unavailable',{stage:'exporter_load',causeError:error,fallbackError});}
    }
    const bridge = host[BRIDGE_NAME];
    const observed = [];
    const restoreTracking=trackHostOperations(bridge, (operation, error) => {
      try { if (observed.length < 8) observed.push({ operation, reason: saveStageOf(error) ?? 'unclassified', errorType: error?.name }); }
      catch { /* diagnostics only */ }
    });
    const exportDiagnostics = extra => ({ ...extra, exportBytes: blob.size, ...(observed.length ? { hostOperations: observed } : {}) });
    try{
    const useDirect = preferBrowser === false || preferBrowser === 'direct';
    let attempt;
    let pickerFallback;
    try{
      if (useDirect) {
        attempt = await withExportTimeout(downloadBlobWithRuntime(blob, name), timeoutMs);
      } else {
        // Android's explicit picker route returned above. Other hosts retain
        // their platform export runtime (e.g. iOS native sharing).
        pickerFallback = await withDocumentPickerFallback(blob, name, host, timeoutMs);
        if(isCancelError(pickerFallback?.error))throw pickerFallback.error;
        if (pickerFallback?.result) attempt = pickerFallback.result;
        else attempt = await withExportTimeout(downloadBlobWithRuntime(blob, name), timeoutMs);
      }
    }
    catch(error){
      const saveStage=saveStageOf(error);
      if(isCancelError(error))throw Object.assign(new Error('已取消文件导出'),{code:'CANCELED',details:exportDiagnostics({reason:'canceled',...(saveStage?{saveStage}:{}),causeError:error})});
      if(isPermissionError(error))throw exportFailure('系统拒绝文件保存权限；日志可使用“查看／复制文本”','export_permission_denied',{stage:'export_save_publish',saveStage,exportAttempt:useDirect?'direct':'picker',...exportDiagnostics({causeError:error})});
      // Direct failed and the picker fallback did not run yet: try the picker
      // once before giving up.  Picker already attempted and also failed falls
      // through to the failure reporting below.
      let fallback;
      if (useDirect) fallback = await withDocumentPickerFallback(blob, name, host, timeoutMs);
      else fallback = pickerFallback;
      if (fallback) {
        if (!fallback.error && confirmedExport(fallback.result)) return {...normalizeExportResult(fallback.result),status:'saved',saved:true,exportAttempt:'picker',saveLocation:'你选择的保存位置',directFailure:true};
        if (isCancelError(fallback.error)) throw Object.assign(new Error('已取消文件导出'),{code:'CANCELED',details:exportDiagnostics({reason:'canceled',exportAttempt:'picker',causeError:fallback.error})});
        if (fallback.error?.code === 'FILE_EXPORT_FAILED') {
          fallback.error.details.hostOperations = [...observed, ...(fallback.error.details.hostOperations ?? []).filter(row => !observed.some(prior => prior.operation === row.operation))].slice(0, 8);
          throw fallback.error;
        }
      }
      const hostError = fallback?.error ?? error;
      const failedStage = saveStageOf(hostError) ?? saveStage;
      const exportAttempt = fallback ? 'picker_failed' : (useDirect ? 'direct' : 'picker_failed');
      const details = exportDiagnostics({stage:failedStage?'export_save_publish':'export_native_save',saveStage:failedStage,exportAttempt,causeError:hostError});
      if (isHostExceptionError(error)) {
        throw exportFailure(fallback ? '宿主的原生下载接口抛出 Java 异常，备用保存通道也没能确认文件已保存；请改用“查看／复制文本”导出' : '宿主的原生下载接口抛出 Java 异常，本次没有确认文件已保存；请改用“查看／复制文本”导出','export_host_exception',{...details,saveStage:saveStage??failedStage,causeError:error});
      }
      if (isHostExceptionError(hostError)) throw exportFailure('宿主的原生下载接口抛出 Java 异常，备用保存通道也没能确认文件已保存；请改用“查看／复制文本”导出','export_host_exception',details);
      if (failedStage==='staging_failed') throw exportFailure('宿主在写入导出暂存文件时失败，文件没有保存；请改用“查看／复制文本”导出','export_stage_write_failed',{...details,stage:'export_save_copy'});
      if (failedStage==='file_missing') throw exportFailure('宿主找不到本次导出的暂存文件，文件没有保存；请改用“查看／复制文本”导出','export_stage_file_missing',{...details,stage:'export_save_verify'});
      if (fallback) throw exportFailure('宿主直存和系统文件选择器都没能保存文件；请改用“查看／复制文本”导出','export_native_failed',details);
      try{return {...triggerBrowserExport(blob,name,documentRef),nativeAttempt:'failed',reason:'export_native_failed',stage:'export_save_publish',...(failedStage?{saveStage:failedStage}:{}),exportAttempt,status:'dispatched',saved:false,dispatch:'browser-fallback'};}
      catch(fallbackError){throw exportFailure('宿主保存文件失败；本次没有确认文件已保存，可复制文本导出','export_native_failed',{...details,fallbackError});}
    }
    if(confirmedExport(attempt))return {...normalizeExportResult(attempt),status:'saved',saved:true,exportAttempt:useDirect?'direct':'picker',saveLocation:saveLocationOf(attempt),...exportDiagnostics({})};
    return {...normalizeExportResult(attempt),status:'dispatched',saved:false,exportAttempt:useDirect?'direct':'picker',reason:'export_dispatched_unconfirmed',dispatch:dispatchOnly(attempt),...exportDiagnostics({})};
    }finally{restoreTracking();}
  }
  return {...triggerBrowserExport(blob,name,documentRef),reason:'export_dispatched_unconfirmed',stage:'export_dispatch',exportAttempt:'browser',dispatch:'browser-fallback'};
}
