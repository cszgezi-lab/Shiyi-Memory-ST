import { ShiyiError } from './errors.js';
import { sha256, sha256Async, stableStringify } from './utils.js';
import { ST_DATABASE_NAME, ST_DOCUMENTS_STORE, stAccountMutationLock } from './st-storage.js';
import { API_KINDS } from './product-model-list.js';

export const ST_BACKUP_FORMAT = 'ShiyiSTBrowserBackup';
const HASH = /^[a-f0-9]{64}$/;
const DOCUMENT_FIELDS = ['key', 'format', 'scopeHash', 'addressHash', 'ownerAccountHash', 'digest', 'value'];
const CREDENTIAL_ADDRESSES = new Set(API_KINDS.map(kind => sha256({ namespace: 'shiyi-device-credentials', table: 'main', key: `${kind}-v1` })));
const fail = (message, code = 'ST_BACKUP_INVALID', details) => new ShiyiError(message, code, details);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));

function jsonValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!Array.isArray(value) && !object(value)) throw fail('备份包含不能无损恢复的 JSON 值。');
  for (const item of Array.isArray(value) ? value : Object.values(value)) jsonValue(item);
}
async function envelope(value) {
  if (!value || typeof value !== 'object') return;
  if (['shiyi-lossless-json', 'shiyi-vector-document'].includes(value.kind)) {
    if (value.version !== 1 || typeof value.payload !== 'string' || !HASH.test(value.checksum) ||
      await sha256Async(value.payload) !== value.checksum) throw fail('备份中的数值或向量存档校验失败。');
    let parsed;
    try { parsed = JSON.parse(value.payload); } catch { throw fail('备份中的存档信封不是有效 JSON。'); }
    jsonValue(parsed);
    return;
  }
  for (const item of Array.isArray(value) ? value : Object.values(value)) await envelope(item);
}
async function validateDocument(value, ownerHash) {
  if (!object(value) || Object.keys(value).length !== DOCUMENT_FIELDS.length ||
    DOCUMENT_FIELDS.some(field => !Object.hasOwn(value, field)) || value.format !== 'shiyi-st-idb-v1' ||
    !HASH.test(value.scopeHash) || !HASH.test(value.addressHash) || !HASH.test(value.digest) ||
    value.ownerAccountHash !== ownerHash || value.key !== `${value.scopeHash}:${value.addressHash}` || CREDENTIAL_ADDRESSES.has(value.addressHash))
    throw fail('备份文档的账户、地址或格式校验失败。');
  jsonValue(value.value);
  if (await sha256Async(value.value) !== value.digest) throw fail('备份文档内容已损坏，未恢复。');
  await envelope(value.value);
}

export async function validateSTBrowserBackup(value, ownerHash) {
  if (!HASH.test(ownerHash) || !object(value) || value.format !== ST_BACKUP_FORMAT || value.version !== 1 ||
    value.edition !== 'sillytavern' || value.editionVersion !== '0.1.0' || value.ownerHash !== ownerHash ||
    !Array.isArray(value.documents) || !HASH.test(value.digest))
    throw fail('这不是当前酒馆账户可用的拾忆本机备份，或备份版本不受支持。');
  const keys = new Set();
  for (const document of value.documents) {
    await validateDocument(document, ownerHash);
    if (keys.has(document.key)) throw fail('备份包含重复存档地址。');
    keys.add(document.key);
  }
  if (await sha256Async({ ownerHash, documents: value.documents }) !== value.digest)
    throw fail('完整备份的校验值不一致，未恢复。');
  return JSON.parse(stableStringify(value));
}

function openDatabase(driver) {
  return new Promise((resolve, reject) => {
    let request, rejected = false;
    const rejectOpen = () => { rejected = true; reject(fail('拾忆本机数据库无法打开，原存档保留。', 'ST_BACKUP_STORAGE_FAILED')); };
    try { request = driver.open(ST_DATABASE_NAME, 1); } catch { rejectOpen(); return; }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(ST_DOCUMENTS_STORE))
        request.result.createObjectStore(ST_DOCUMENTS_STORE, { keyPath: 'key' });
    };
    request.onerror = rejectOpen;
    request.onblocked = rejectOpen;
    request.onsuccess = () => {
      const db = request.result;
      if (rejected || !db.objectStoreNames.contains(ST_DOCUMENTS_STORE)) { db.close(); if (!rejected) rejectOpen(); return; }
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}
function readDocuments(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ST_DOCUMENTS_STORE, 'readonly'), request = tx.objectStore(ST_DOCUMENTS_STORE).getAll();
    let rows;
    request.onsuccess = () => { rows = request.result; };
    tx.oncomplete = () => resolve(rows);
    tx.onabort = () => reject(fail('拾忆本机存档读取未完成。', 'ST_BACKUP_STORAGE_FAILED'));
    tx.onerror = () => {};
  });
}

/** Entire current-account IDB documents only. Credentials remain in the
 * separate device store; no host chats, cards, worldbooks or settings are read. */
export function createSTBrowserBackup({ indexedDB = globalThis.indexedDB, getAccountId,
  locks = globalThis.navigator?.locks, beforeRestore, afterRestore, now = () => new Date().toISOString() } = {}) {
  if (!indexedDB || typeof indexedDB.open !== 'function' || typeof getAccountId !== 'function')
    throw fail('当前账户的本机备份接口尚未就绪。', 'ST_BACKUP_UNAVAILABLE');
  const owner = () => {
    const account = getAccountId();
    if (typeof account !== 'string' || !account.trim()) throw fail('酒馆账户尚未就绪。', 'ST_ACCOUNT_UNAVAILABLE');
    return sha256(account);
  };
  const check = expected => { if (owner() !== expected) throw fail('账户已切换，未恢复其它账户存档。', 'ST_ACCOUNT_CHANGED'); };
  async function snapshot(db, ownerHash) {
    const rows = await readDocuments(db); check(ownerHash);
    if (rows.some(row => !HASH.test(row?.ownerAccountHash)))
      throw fail('数据库包含无法确认账户归属的旧记录，未生成不完整备份。');
    const documents = rows.filter(row => row.ownerAccountHash === ownerHash).sort((a, b) => a.key.localeCompare(b.key));
    for (const document of documents) await validateDocument(document, ownerHash);
    check(ownerHash);
    const digest = await sha256Async({ ownerHash, documents }); check(ownerHash);
    return { format: ST_BACKUP_FORMAT, version: 1, edition: 'sillytavern', editionVersion: '0.1.0',
      ownerHash, createdAt: now(), documents, digest };
  }
  const accountLock = (ownerHash, task) => typeof locks?.request === 'function'
    ? locks.request(stAccountMutationLock(ownerHash), { mode: 'exclusive' }, task) : task();
  async function exportBackup() {
    const ownerHash = owner();
    const db = await openDatabase(indexedDB);
    try { return await snapshot(db, ownerHash); } finally { db.close(); }
  }
  async function validateBackup(value) {
    const ownerHash = owner(), valid = await validateSTBrowserBackup(value, ownerHash);
    check(ownerHash); return valid;
  }
  async function restoreBackup(value, { retainBackup } = {}) {
    // Capture a private validated copy before any lifecycle or database change.
    const ownerHash = owner(), valid = await validateSTBrowserBackup(value, ownerHash); check(ownerHash);
    if (typeof beforeRestore !== 'function' || typeof afterRestore !== 'function' || typeof retainBackup !== 'function')
      throw fail('恢复需要先停止插件并保存恢复前备份。', 'ST_BACKUP_UNAVAILABLE');
    let stopped = false, committed = false, operationError, receipt;
    try {
      stopped = true; await beforeRestore(); check(ownerHash);
      receipt = await accountLock(ownerHash, async () => {
        check(ownerHash);
        const db = await openDatabase(indexedDB);
        try {
          const previous = await snapshot(db, ownerHash);
          if (await retainBackup(previous) !== true) throw fail('未确认保留恢复前备份，恢复已取消。', 'CANCELED');
          check(ownerHash);
          await new Promise((resolve, reject) => {
            let tx, transactionFailure;
            try {
              tx = db.transaction(ST_DOCUMENTS_STORE, 'readwrite');
              const store = tx.objectStore(ST_DOCUMENTS_STORE), request = store.getAll();
              request.onsuccess = () => {
                try {
                  check(ownerHash);
                  const foreignKeys = new Set(request.result.filter(row => row.ownerAccountHash !== ownerHash).map(row => row.key));
                  if (valid.documents.some(row => foreignKeys.has(row.key)))
                    throw fail('导入地址与其它账户存档冲突，原存档保留。', 'ST_BACKUP_SCOPE_COLLISION');
                  for (const row of request.result) if (row.ownerAccountHash === ownerHash) store.delete(row.key);
                  for (const row of valid.documents) store.put(row);
                } catch (error) { transactionFailure = error; tx.abort(); }
              };
              tx.oncomplete = () => { committed = true; resolve(); };
              tx.onabort = () => reject(transactionFailure ?? fail('恢复事务未提交，原本机存档保留。', 'ST_BACKUP_RESTORE_FAILED', { committed: false }));
              tx.onerror = () => {};
            } catch { try { tx?.abort(); } catch {} reject(fail('恢复事务无法开始，原本机存档保留。', 'ST_BACKUP_RESTORE_FAILED', { committed: false })); }
          });
          check(ownerHash);
          return { restored: true, documents: valid.documents.length, previousDocuments: previous.documents.length };
        } finally { db.close(); }
      });
    } catch (error) { operationError = error; }
    if (stopped) {
      try { const restarted = await afterRestore(); if (receipt) receipt.restarted = restarted !== false; }
      catch {
        throw fail(committed ? '存档已恢复，但拾忆重新启动失败；请刷新页面。' : '恢复未完成，拾忆重新启动失败；原存档保留，请刷新页面。',
          'ST_BACKUP_RESTART_FAILED', { committed, restoreCode: operationError?.code });
      }
    }
    if (operationError) throw operationError;
    return receipt;
  }
  return Object.freeze({ exportBackup, validateBackup, restoreBackup });
}
