import { ShiyiError } from './errors.js';
import { clone, sha256, stableStringify } from './utils.js';

export const ST_STORAGE_PREFIX = 'shiyi-st-v1-';
export const ST_DEVICE_NAMESPACE = 'shiyi-device-credentials';
export const ST_DATABASE_NAME = 'shiyi-memory-st-v1';
export const ST_DOCUMENTS_STORE = 'documents';
export const stAccountMutationLock = ownerAccountHash => `shiyi-st-account-${ownerAccountHash}`;
const idbConnections = new WeakMap();
const idbWriteQueues = new WeakMap();

const fail = (message, code = 'PERSISTENCE_UNAVAILABLE') => new ShiyiError(message, code);
function addressOf({ namespace, table = 'main', key } = {}) {
  if (typeof namespace !== 'string' || !namespace.startsWith('shiyi-') || typeof table !== 'string' || !table || typeof key !== 'string' || !key) {
    throw fail('拾忆专属存储地址无效。', 'STORE_ARGUMENT');
  }
  return { namespace, table, key };
}
function jsonCopy(value) {
  try {
    JSON.stringify(value, (_, item) => { if (typeof item === 'number' && !Number.isFinite(item)) throw Error(); return item; });
    const text = stableStringify(value);
    if (typeof text !== 'string') throw Error();
    return JSON.parse(text);
  } catch { throw fail('JSON 文档无法无损序列化。', 'STORE_ARGUMENT'); }
}
function base64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(binary);
}

/** Uses ST's authenticated, atomic /api/files API, never chat/card/settings APIs.
 * Values and addresses are wrapped and verified after every successful write.
 * Filenames disclose only hashes; storage is separate from TT's namespace. */
export class STFileStore {
  constructor({ scope, fetchImpl = globalThis.fetch, getRequestHeaders = () => ({}), guard = async () => {}, locks = globalThis.navigator?.locks } = {}) {
    if (!scope?.accountId || typeof fetchImpl !== 'function') throw fail('原版酒馆存储身份或网络尚未就绪。');
    this.scope = jsonCopy(scope);
    this.scopeHash = sha256(this.scope);
    this.fetchImpl = fetchImpl;
    this.getRequestHeaders = getRequestHeaders;
    this.guard = guard;
    this.locks = locks;
    this.pending = new Map();
  }
  _location(args) {
    const address = addressOf(args);
    if (address.namespace === ST_DEVICE_NAMESPACE) throw fail('本机 Key 不允许保存到服务器文件。', 'STORE_ARGUMENT');
    const addressHash = sha256(address);
    const name = `${ST_STORAGE_PREFIX}${this.scopeHash}-${addressHash}.json`;
    return { address, addressHash, name, path: `user/files/${name}` };
  }
  async _request(path, options = {}) {
    await this.guard();
    let response;
    try {
      response = await this.fetchImpl(path, {
        credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        ...options, headers: { ...this.getRequestHeaders(), ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw fail('存储操作已取消。', 'CANCELED');
      throw fail('拾忆服务器文件请求失败。');
    }
    await this.guard();
    return response;
  }
  async tryGetJson(args) {
    const location = this._location(args);
    const response = await this._request(`/${location.path}`, { signal: args?.signal });
    if (response.status === 404) return { found: false };
    if (!response.ok) throw fail('拾忆服务器文件读取失败。');
    let document;
    try { document = await response.json(); } catch { throw fail('拾忆存储 JSON 已损坏，未按空存档处理。'); }
    await this.guard();
    if (document?.format !== 'shiyi-st-json-v1' || document.scopeHash !== this.scopeHash || document.addressHash !== location.addressHash || !Object.hasOwn(document, 'value') || document.digest !== sha256(document.value)) {
      throw fail('拾忆存储身份或完整性校验失败。');
    }
    return { found: true, value: clone(document.value) };
  }
  async getJson(args) {
    const entry = await this.tryGetJson(args);
    if (!entry.found) throw fail('chat store entry not found:', 'NOT_FOUND');
    return entry.value;
  }
  _serial(location, task) {
    const prior = this.pending.get(location.path) ?? Promise.resolve();
    const current = prior.catch(() => {}).then(() => this.locks?.request
      ? this.locks.request(`shiyi-st-file-${this.scopeHash}-${location.addressHash}`, { mode: 'exclusive' }, task)
      : task());
    this.pending.set(location.path, current);
    return current.finally(() => { if (this.pending.get(location.path) === current) this.pending.delete(location.path); });
  }
  async setJson(args) {
    const location = this._location(args), value = jsonCopy(args.value);
    const document = { format: 'shiyi-st-json-v1', scopeHash: this.scopeHash, addressHash: location.addressHash, digest: sha256(value), value };
    return this._serial(location, async () => {
      const response = await this._request('/api/files/upload', { method: 'POST', signal: args?.signal, body: JSON.stringify({ name: location.name, data: base64Utf8(stableStringify(document)) }) });
      if (!response.ok) throw fail('拾忆存储写入失败，不能确认已保存。');
      let receipt;
      try { receipt = await response.json(); } catch { throw fail('拾忆存储回执不可用。'); }
      // Official clientRelativePath may include the root separator. Never GET
      // arbitrary returned paths or follow a redirect to another origin.
      if (typeof receipt?.path !== 'string' || receipt.path.replace(/^\//, '') !== location.path) throw fail('拾忆存储回执路径不匹配。');
      const readback = await this.tryGetJson(args);
      if (!readback.found || stableStringify(readback.value) !== stableStringify(value)) throw fail('拾忆存储写后读回不一致，不能确认已保存。');
    });
  }
  async deleteJson(args) {
    const location = this._location(args);
    return this._serial(location, async () => {
      const response = await this._request('/api/files/delete', { method: 'POST', signal: args?.signal, body: JSON.stringify({ path: location.path }) });
      if (!response.ok && response.status !== 404) throw fail('拾忆存储删除失败。');
      if ((await this.tryGetJson(args)).found) throw fail('拾忆存储删除未持久生效。');
    });
  }
}

/** Explicit plugin Keys stay on this browser/device, outside server files and
 * every exportable workspace. ST accountStorage writes settings and is avoided. */
export class STDeviceStore {
  constructor({ scope, deviceStorage = globalThis.localStorage, guard = async () => {} } = {}) {
    if (!scope?.accountId) throw fail('本机 Key 存储身份尚未就绪。');
    this.scopeHash = sha256({ accountId: scope.accountId, edition: 'sillytavern' });
    this.storage = deviceStorage;
    this.guard = guard;
  }
  _key(args) {
    const address = addressOf(args);
    if (address.namespace !== ST_DEVICE_NAMESPACE) throw fail('本机 Key 存储只接收凭据地址。', 'STORE_ARGUMENT');
    return `${ST_STORAGE_PREFIX}device-${this.scopeHash}-${sha256(address)}`;
  }
  async tryGetJson(args) {
    const key = this._key(args);
    await this.guard();
    let raw;
    try { raw = this.storage.getItem(key); } catch { throw fail('本机 Key 存储读取失败。'); }
    await this.guard();
    if (raw === null) return { found: false };
    let document;
    try { document = JSON.parse(raw); } catch { throw fail('本机 Key 存储已损坏。'); }
    if (document?.format !== 'shiyi-st-device-v1' || document.digest !== sha256(document.value)) throw fail('本机 Key 完整性校验失败。');
    return { found: true, value: clone(document.value) };
  }
  async getJson(args) { const entry = await this.tryGetJson(args); if (!entry.found) throw fail('chat store entry not found:', 'NOT_FOUND'); return entry.value; }
  async setJson(args) {
    const key = this._key(args), value = jsonCopy(args.value);
    await this.guard();
    try { this.storage.setItem(key, stableStringify({ format: 'shiyi-st-device-v1', digest: sha256(value), value })); } catch { throw fail('本机 Key 存储写入失败。'); }
    const result = await this.tryGetJson(args);
    if (!result.found || stableStringify(result.value) !== stableStringify(value)) throw fail('本机 Key 写后读回不一致。');
  }
  async deleteJson(args) {
    const key = this._key(args);
    await this.guard();
    try { this.storage.removeItem(key); } catch { throw fail('本机 Key 删除失败。'); }
    if ((await this.tryGetJson(args)).found) throw fail('本机 Key 删除未生效。');
  }
}

/** Original ST has no independent server KV endpoint. Browser IndexedDB keeps
 * plugin documents away from host settings/chats and Data Maid's loose files.
 * A complete IDB transaction and separate readback are required before saved. */
export class STIndexedDBStore {
  constructor({ scope, indexedDB = globalThis.indexedDB, guard = async () => {}, locks = globalThis.navigator?.locks } = {}) {
    if (!scope?.accountId || !indexedDB || typeof indexedDB.open !== 'function') throw fail('当前浏览器没有可用的拾忆独立存储。');
    this.scopeHash = sha256(jsonCopy(scope));
    this.ownerAccountHash = sha256(scope.accountId);
    this.indexedDB = indexedDB;
    this.guard = guard;
    this.locks = locks;
    if (!idbWriteQueues.has(indexedDB)) idbWriteQueues.set(indexedDB, new Map());
    this.pending = idbWriteQueues.get(indexedDB);
  }
  _location(args) {
    const address = addressOf(args);
    if (address.namespace === ST_DEVICE_NAMESPACE) throw fail('本机 Key 仅使用独立凭据存储。', 'STORE_ARGUMENT');
    const addressHash = sha256(address);
    return { key: `${this.scopeHash}:${addressHash}`, addressHash };
  }
  async _ready() {
    if (!idbConnections.has(this.indexedDB)) {
      const driver = this.indexedDB;
      const pending = new Promise((resolve, reject) => {
        let rejected = false, request;
        const rejectOpen = () => { rejected = true; reject(fail('拾忆独立数据库打开失败，未覆盖已有存档。')); };
        try { request = driver.open(ST_DATABASE_NAME, 1); } catch { rejectOpen(); return; }
        request.onupgradeneeded = () => {
          // Schema version 1 only creates this edition's absent store. Updates
          // never delete a database, clear records, or replace saved settings.
          const db = request.result;
          if (!db.objectStoreNames.contains(ST_DOCUMENTS_STORE)) db.createObjectStore(ST_DOCUMENTS_STORE, { keyPath: 'key' });
        };
        request.onerror = rejectOpen;
        request.onblocked = rejectOpen;
        request.onsuccess = () => {
          const db = request.result;
          if (rejected || !db.objectStoreNames.contains(ST_DOCUMENTS_STORE)) { db.close(); if (!rejected) rejectOpen(); return; }
          db.onversionchange = () => { db.close(); idbConnections.delete(driver); };
          resolve(db);
        };
      });
      idbConnections.set(driver, pending);
      void pending.catch(() => { if (idbConnections.get(driver) === pending) idbConnections.delete(driver); });
    }
    return idbConnections.get(this.indexedDB);
  }
  async _transaction(mode, operate) {
    await this.guard();
    const db = await this._ready();
    await this.guard();
    const result = await new Promise((resolve, reject) => {
      let transaction, request, value;
      try { transaction = db.transaction(ST_DOCUMENTS_STORE, mode); request = operate(transaction.objectStore(ST_DOCUMENTS_STORE)); }
      catch { try { transaction?.abort(); } catch { /* already inactive */ } reject(fail('拾忆独立存储事务未能开始。')); return; }
      request.onsuccess = () => { value = request.result; };
      // Do not resolve an IDBRequest before its enclosing write commits.
      transaction.oncomplete = () => resolve(value);
      transaction.onabort = () => reject(fail('拾忆独立存储事务未提交，不能确认已保存。'));
      transaction.onerror = () => { /* onabort reports the final failed transaction */ };
    });
    await this.guard();
    return result;
  }
  async tryGetJson(args) {
    const location = this._location(args), document = await this._transaction('readonly', store => store.get(location.key));
    if (document === undefined) return { found: false };
    if (document?.format !== 'shiyi-st-idb-v1' || document.ownerAccountHash !== this.ownerAccountHash || document.scopeHash !== this.scopeHash || document.addressHash !== location.addressHash || !Object.hasOwn(document, 'value') || document.digest !== sha256(document.value)) throw fail('拾忆独立存档身份或完整性校验失败，未按空存档处理。');
    return { found: true, value: clone(document.value) };
  }
  async getJson(args) { const entry = await this.tryGetJson(args); if (!entry.found) throw fail('chat store entry not found:', 'NOT_FOUND'); return entry.value; }
  _serial(location, task) {
    const current = (this.pending.get(location.key) ?? Promise.resolve()).catch(() => {}).then(() => this.locks?.request
      ? this.locks.request(stAccountMutationLock(this.ownerAccountHash), { mode: 'exclusive' }, task)
      : task());
    this.pending.set(location.key, current);
    return current.finally(() => { if (this.pending.get(location.key) === current) this.pending.delete(location.key); });
  }
  async setJson(args) {
    const location = this._location(args), value = jsonCopy(args.value);
    const document = { key: location.key, format: 'shiyi-st-idb-v1', ownerAccountHash: this.ownerAccountHash, scopeHash: this.scopeHash, addressHash: location.addressHash, digest: sha256(value), value };
    return this._serial(location, async () => {
      await this._transaction('readwrite', store => store.put(document));
      const result = await this.tryGetJson(args);
      if (!result.found || stableStringify(result.value) !== stableStringify(value)) throw fail('拾忆独立存档写后读回不一致。');
    });
  }
  async deleteJson(args) {
    const location = this._location(args);
    return this._serial(location, async () => {
      await this._transaction('readwrite', store => store.delete(location.key));
      if ((await this.tryGetJson(args)).found) throw fail('拾忆独立存档删除未生效。');
    });
  }
}

export function createSTStorage(options = {}) {
  // The files backend is retained only as an explicit experimental choice. It
  // is not safe from ST's unreferenced-file cleanup and is never the default.
  const documents = options.backend === 'files' ? new STFileStore(options) : new STIndexedDBStore(options);
  const device = new STDeviceStore(options);
  const backend = args => args?.namespace === ST_DEVICE_NAMESPACE ? device : documents;
  return Object.freeze({
    setJson: args => backend(args).setJson(args), getJson: args => backend(args).getJson(args),
    tryGetJson: args => backend(args).tryGetJson(args), deleteJson: args => backend(args).deleteJson(args),
  });
}
