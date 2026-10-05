// TT 2.2 exports no picker option on downloadBlobWithRuntime. Use its documented
// native protocol directly, without assigning to a Java @JavascriptInterface.
// The cache root and fs write headers match TT's file-export.js; no dependencies.
const BRIDGE = 'TauriTavernAndroidPublicDownloadBridge';
const RECEIVER = '__TAURITAVERN_PUBLIC_DOWNLOAD_PICKER__';
const active = new WeakMap();
const CHUNK = 4 * 1024 * 1024;
let sequence = 0;

const failure = (reason, stage, message, causeError, operation) => Object.assign(new Error(message), {
  code: reason === 'canceled' ? 'CANCELED' : 'FILE_EXPORT_FAILED',
  details: { reason, stage, exportAttempt: 'picker_failed', ...(causeError ? { causeError } : {}),
    ...(operation ? { hostOperations: [{ operation, errorType: causeError?.name ?? 'Error' }] } : {}) },
});
function pickerError(error) {
  const canceled = error?.name === 'AbortError' || /cancel(?:led|ed)|取消/i.test(String(error?.message ?? error));
  return failure(canceled ? 'canceled' : 'export_picker_open_failed', 'export_picker_open',
    canceled ? '已取消文件导出' : 'TT 未能打开系统“选择保存位置”窗口；未调用原生 Downloads 直存，文件没有保存。可使用“查看／复制文本”。',
    error, 'requestCreateDocumentPicker');
}
const busyError = () => failure('export_picker_busy', 'export_picker_open',
  '另一个文件选择器尚未结束，未开启第二次导出。请先返回并关闭系统保存窗口；仍提示占用时刷新 TT 后重试，日志文本仍可复制。');

function pickDocument(host, bridge, name, type, timeoutMs, state) {
  // TT 2.2's callback has no request ID. Never steal a foreign receiver: it may
  // have an in-flight host export. Do not reuse a timed-out slot before its late
  // result is drained, or an old selection could receive a different backup.
  const previous = host[RECEIVER];
  if (previous != null) throw busyError();
  return new Promise((resolve, reject) => {
    let done = false, timer;
    const restore = () => {
      if (host[RECEIVER] === receiver) {
        if (previous === undefined) delete host[RECEIVER]; else host[RECEIVER] = previous;
      }
    };
    const receiver = { onNativeResult(payload) {
      clearTimeout(timer); restore();
      if (done) { if (state.waitingLateResult && active.get(host) === state) active.delete(host); return; }
      done = true;
      if (payload?.error) { reject(pickerError(new Error(String(payload.error)))); return; }
      const uri = typeof payload?.content_uri === 'string' ? payload.content_uri.trim() : '';
      if (!/^content:\/\/[^\s]+$/i.test(uri)) {
        reject(failure('export_picker_invalid', 'export_picker_open', '系统没有返回有效的保存位置；未写入文件，可重试或复制文本。')); return;
      }
      resolve(uri);
    } };
    try {
      host[RECEIVER] = receiver;
      if (host[RECEIVER] !== receiver) throw new Error('picker receiver unavailable');
      timer = setTimeout(() => {
        done = true; state.waitingLateResult = true;
        reject(failure('export_picker_timeout', 'export_picker_open',
          '系统保存窗口没有按时返回结果，未写入文件。请返回并关闭该窗口后重试；窗口始终未出现时刷新 TT，日志文本仍可复制。'));
      }, timeoutMs);
      timer?.unref?.();
      bridge.requestCreateDocumentPicker(name, type);
    } catch (error) {
      clearTimeout(timer); done = true; restore(); reject(pickerError(error));
    }
  });
}

async function writeAndCopy(host, bridge, blob, name, uri, state, timeoutMs) {
  const pathApi = host.__TAURI__.path, invoke = host.__TAURI__.core.invoke;
  let directory, filePath, timer, expired = false, stage = 'export_prepare';
  const check = () => { if (expired) throw new Error('export expired'); };
  const work = (async () => {
    try {
      const cache = await pathApi.appCacheDir(); check();
      if (typeof cache !== 'string' || !/^\//.test(cache)) throw new Error('invalid Android cache root');
      const root = await pathApi.join(cache, 'tauritavern-export-staging'); check();
      const leaf = `shiyi-export-${Date.now().toString(36)}-${(++sequence).toString(36)}`;
      const target = await pathApi.join(root, leaf); check();
      // Recursive cleanup can only touch this operation's new child directory.
      if (target !== `${root.replace(/\/+$/, '')}/${leaf}` || /(?:^|\/)\.\.?(?:\/|$)/.test(target)) throw new Error('invalid staging path');
      directory = target;
      await invoke('plugin:fs|mkdir', { path: directory, options: { recursive: true } }); check();
      filePath = await pathApi.join(directory, name); check();
      if (filePath !== `${directory}/${name}`) throw new Error('invalid staged filename');
      for (let offset = 0; offset < Math.max(blob.size, 1); offset += CHUNK) {
        const bytes = new Uint8Array(await blob.slice(offset, offset + CHUNK).arrayBuffer()); check();
        await invoke('plugin:fs|write_file', bytes, {
          headers: { path: encodeURIComponent(filePath), options: JSON.stringify({ append: offset > 0, create: true }) },
        }); check();
      }
      stage = 'export_save_copy';
      const copied = bridge.copyFileToContentUri(filePath, uri);
      // TT returns the destination URI only after its synchronous channel copy
      // finishes. A blank, mismatched or promise-like answer is not a receipt.
      if (typeof copied !== 'string' || copied.trim() !== uri) throw new Error('copy receipt missing');
      return { mode: 'android-document-picker', savedPath: '', uri, displayName: name,
        status: 'saved', saved: true, exportAttempt: 'picker', saveLocation: '你选择的保存位置' };
    } catch (error) {
      const denied = /NotAllowedError|SecurityException|permission|denied|权限/i.test(`${error?.name ?? ''} ${error?.message ?? ''}`);
      throw failure(denied ? 'export_permission_denied' : stage === 'export_prepare' ? 'export_stage_write_failed' : 'export_picker_copy_failed', stage,
        stage === 'export_prepare' ? '已选择保存位置，但 TT 写入导出暂存文件失败；目标可能为空文件，未确认保存，可复制文本。'
          : '已选择保存位置，但 TT 未能确认文件写入完成；目标可能为空或不完整文件，可复制文本。',
        error, stage === 'export_save_copy' ? 'copyFileToContentUri' : undefined);
    } finally {
      // If a disk operation times out, let it finish before cleaning its own
      // directory, but never copy the payload afterwards or report late success.
      if (directory) try { await invoke('plugin:fs|remove', { path: directory, options: { recursive: true } }); } catch { /* cache only */ }
      if (active.get(host) === state) active.delete(host);
    }
  })();
  try {
    return await Promise.race([work, new Promise((_, reject) => {
      timer = setTimeout(() => { expired = true; state.waitingWrite = true;
        reject(failure('export_native_failed', stage, 'TT 写入导出文件超时，未确认保存；等待本次写入结束后可重试，日志文本仍可复制。'));
      }, timeoutMs); timer?.unref?.();
    })]);
  } finally { clearTimeout(timer); }
}

export async function exportAndroidJson(blob, name, host, timeoutMs = 30000) {
  const bridge = host?.[BRIDGE], pathApi = host?.__TAURI__?.path;
  if (!bridge || typeof bridge.requestCreateDocumentPicker !== 'function' || typeof bridge.copyFileToContentUri !== 'function'
      || typeof pathApi?.appCacheDir !== 'function' || typeof pathApi?.join !== 'function' || typeof host?.__TAURI__?.core?.invoke !== 'function') {
    throw failure('export_picker_unavailable', 'export_picker_open', '当前 TT 未提供完整的系统保存接口；未回退到出错的 Downloads 直存。请使用“查看／复制文本”。');
  }
  if (active.has(host)) throw busyError();
  const state = {}; active.set(host, state);
  const fileName = String(name || '拾忆-导出.json').replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '_').replace(/[. ]+$/, '').trim() || '拾忆-导出.json';
  try {
    const uri = await pickDocument(host, bridge, fileName, blob.type || 'application/json', timeoutMs, state);
    return { ...await writeAndCopy(host, bridge, blob, fileName, uri, state, timeoutMs), exportBytes: blob.size };
  } catch (error) {
    if (error?.details) error.details.exportBytes = blob.size;
    throw error;
  } finally { if (!state.waitingLateResult && !state.waitingWrite && active.get(host) === state) active.delete(host); }
}
