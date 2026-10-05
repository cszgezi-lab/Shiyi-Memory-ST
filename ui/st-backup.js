import { ST_BACKUP_FORMAT } from '../src/st-backup.js';

export function downloadSTBrowserBackup(value, { host = globalThis, name = '拾忆-本机存档.json' } = {}) {
  if (value?.format !== ST_BACKUP_FORMAT) throw new Error('不是拾忆本机备份。');
  const document = host.document, urlAPI = globalThis.URL;
  const blob = new Blob([JSON.stringify(value)], { type: 'application/json;charset=utf-8' });
  const href = urlAPI.createObjectURL(blob), anchor = document.createElement('a');
  try {
    anchor.href = href; anchor.download = name; anchor.hidden = true;
    document.body.appendChild(anchor); anchor.click();
  } finally {
    anchor.remove(); (host.setTimeout ?? globalThis.setTimeout)(() => urlAPI.revokeObjectURL(href), 60000);
  }
  // Browser download APIs do not report durable save success. Import separately
  // asks the user to confirm that the recovery copy has reached their device.
  return { requested: true, filename: name };
}

export function mountSTBrowserBackup({ panel, host = globalThis, backup, download = (value, options) => downloadSTBrowserBackup(value, { host, ...options }),
  confirm = message => host.confirm(message) } = {}) {
  const settings = panel?.querySelector('[data-view="settings"]');
  if (!settings || !backup || settings.querySelector('[data-st-browser-backup]')) return null;
  const element = host.document.createElement('details');
  element.className = 'sy-card'; element.dataset.stBrowserBackup = '';
  element.innerHTML = `<summary>本机存档</summary><p class="sy-help">备份本浏览器当前账户的全部拾忆存档和设置，不含 API Key。换设备后仍需使用相同酒馆账户、角色头像、聊天文件名及聊天身份；不会自动合并改名或不同聊天。</p><div class="sy-actions"><button type="button" data-st-backup-export>导出本机存档</button><button type="button" data-st-backup-import>导入本机存档</button></div><input type="file" accept="application/json,.json" data-st-backup-file hidden><p class="sy-help" data-st-backup-status role="status">恢复将替换该账户现有拾忆存档。请关闭同站点其它酒馆窗口；原聊天、角色卡、世界书、酒馆设置和本机 Key 不变。</p>`;
  settings.appendChild(element);
  const file = element.querySelector('[data-st-backup-file]'), status = element.querySelector('[data-st-backup-status]');
  const exportButton = element.querySelector('[data-st-backup-export]'), importButton = element.querySelector('[data-st-backup-import]');
  let busy = false, disposed = false;
  const text = message => { status.textContent = message; };
  const run = async task => {
    if (busy || disposed) return;
    busy = true; exportButton.disabled = true; importButton.disabled = true;
    try { await task(); }
    catch (error) {
      const message = error?.code === 'CANCELED' ? '恢复已取消，原本机存档保留。' : error?.message ?? '本机存档操作未完成，请重试。';
      text(message); host.toastr?.error?.(message);
    } finally { busy = false; exportButton.disabled = false; importButton.disabled = false; }
  };
  const exportClick = () => void run(async () => {
    const value = await backup.exportBackup();
    await download(value, { name: '拾忆-本机存档.json' });
    text(`已请求下载 ${value.documents.length} 个存档文档；请确认文件已保存到设备。`);
  });
  const importClick = () => { if (!busy) { file.value = ''; file.click(); } };
  const change = () => void run(async () => {
    const selected = file.files?.[0]; if (!selected) return;
    let value;
    try { value = JSON.parse(await selected.text()); } catch { throw new Error('文件不是有效 JSON，未停止插件或修改存档。'); }
    const valid = await backup.validateBackup(value);
    text(`将恢复 ${valid.documents.length} 个文档，并替换当前账户的全部拾忆存档和设置；API Key 不变。`);
    const restored = await backup.restoreBackup(valid, { retainBackup: async previous => {
      await download(previous, { name: '拾忆-恢复前本机存档.json' });
      return confirm(`已请求下载恢复前备份（${previous.documents.length} 个文档）。请确认文件已保存，再继续替换为备份中的 ${valid.documents.length} 个文档。\n\n只替换本浏览器当前账户的拾忆存档和设置；不含 Key，不修改原聊天、角色卡、世界书或酒馆设置。不同账户或聊天身份不能自动合并。\n\n确认备份已保存并开始恢复？`) === true;
    } });
    const message = restored.restarted === false ? '本机存档已恢复；拾忆保持关闭，可在扩展管理重新启用。' : '本机存档已恢复，拾忆已重新启动。';
    text(message); host.toastr?.success?.(message);
  });
  exportButton.addEventListener('click', exportClick); importButton.addEventListener('click', importClick); file.addEventListener('change', change);
  return { element, dispose() { disposed = true; exportButton.removeEventListener('click', exportClick); importButton.removeEventListener('click', importClick); file.removeEventListener('change', change); element.remove(); } };
}
