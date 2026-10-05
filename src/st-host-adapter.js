import { HostAdapter } from './host-adapter.js';
import { ShiyiError } from './errors.js';
import { clone, sha256, stableStringify } from './utils.js';
import { createSTStorage } from './st-storage.js';

const IDENTITY_ADDRESS = Object.freeze({ namespace: 'shiyi-st-identities', key: 'registry-v1' });
const error = (message, code) => new ShiyiError(message, code);
const nonempty = value => typeof value === 'string' && value.trim() ? value.trim() : '';
const validName = value => nonempty(value) && !/[\/\\\u0000-\u001f]/.test(value) && value !== '.' && value !== '..';
const locator = ({ accountId, kind, avatar, groupId, chatId }) => ({ accountId, kind, ...(kind === 'group' ? { groupId } : { avatar }), chatId });
const locatorKey = ref => sha256(locator(ref));
const refKey = ref => stableStringify(ref);
const generationId = (ref, generation = 0) => `st-chat-${sha256({ locator: locator(ref), integrity: ref.integrity, generation })}`;
function freezeDeep(value) {
  if (value && typeof value === 'object') { Object.freeze(value); for (const item of Object.values(value)) freezeDeep(item); }
  return value;
}
function messageIdentity(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.mes !== 'string') throw error('原版酒馆历史消息格式无效。', 'HISTORY_UNAVAILABLE');
  if (row.complete === false || row.streaming === true || row.isStreaming === true) throw error('当前消息仍在生成，请稍后重试。', 'HISTORY_UNAVAILABLE');
  const version = row.swipe_id ?? row.version ?? 0;
  if (!((Number.isInteger(version) && version >= 0) || nonempty(version))) throw error('原版酒馆消息版本无效。', 'HISTORY_UNAVAILABLE');
  return { text: row.mes, role: row.is_system === true ? 'system' : row.is_user === true ? 'user' : 'assistant', version };
}
const historyDigest = rows => sha256(rows.map(messageIdentity));

/** Original ST adapter: captured references, server-verified read-only history,
 * separate durable JSON, and native public events. No emulated TT global/API. */
export class SillyTavernHostAdapter extends HostAdapter {
  constructor(host = globalThis, { getAccountId, accountId, fetchImpl = globalThis.fetch, nativeHost = host, deviceStorage = globalThis.localStorage, indexedDB = host.indexedDB ?? globalThis.indexedDB, storageBackend = 'indexeddb', locks = globalThis.navigator?.locks } = {}) {
    super(host);
    if (this.root.__TAURITAVERN__) throw error('原版酒馆版本不能用于 TT。', 'HOST_CONTRACT_INVALID');
    this.fetchImpl = fetchImpl;
    this.nativeHost = nativeHost;
    this.getAccountId = getAccountId ?? (() => accountId);
    this.deviceStorage = deviceStorage;
    this.indexedDB = indexedDB;
    this.storageBackend = storageBackend;
    this.locks = locks;
    this.extensionStores = new Map();
    this.identityQueues = new Map();
    this.renameUnsubscribe = null;
    this.lastIdentifiedRef = null;
  }
  async ready() { return undefined; }
  async _account() {
    const id = nonempty(await this.getAccountId());
    if (!id) throw error('原版酒馆账号身份尚未就绪。', 'CHAT_IDENTITY_NOT_READY');
    return id;
  }
  _liveRef(accountId) {
    const context = this._context();
    if (!context || !Array.isArray(context.chat)) throw error('原版酒馆当前聊天不可用。', 'CHAT_REF_UNAVAILABLE');
    const rawChatId = typeof context.getCurrentChatId === 'function' ? context.getCurrentChatId() : context.chatId;
    const chatId = rawChatId == null ? '' : String(rawChatId);
    if (!chatId) return null;
    if (!validName(chatId)) throw error('原版酒馆聊天文件名不可用。', 'CHAT_REF_UNAVAILABLE');
    const integrity = nonempty(context.chatMetadata?.integrity);
    if (!integrity) throw error('请先让酒馆保存当前聊天，再开始整理。', 'CHAT_IDENTITY_NOT_READY');
    if (context.groupId != null && String(context.groupId) !== '') {
      const groupId = String(context.groupId);
      const group = context.groups?.find(item => String(item.id) === groupId);
      if (!group || String(group.chat_id) !== chatId) throw error('群聊身份尚未稳定。', 'CHAT_IDENTITY_NOT_READY');
      return { host: 'sillytavern', accountId, kind: 'group', groupId, chatId, integrity };
    }
    const avatar = context.characters?.[context.characterId]?.avatar;
    if (!validName(avatar)) throw error('角色头像身份不可用。', 'CHAT_IDENTITY_NOT_READY');
    return { host: 'sillytavern', accountId, kind: 'character', avatar, chatId, integrity };
  }
  async currentRef() { return freezeDeep(this._liveRef(await this._account())); }
  async _assertCurrent(ref) {
    if (refKey(await this.currentRef()) !== refKey(ref)) throw error('聊天或账号已切换。', 'CHAT_CHANGED');
  }
  async _assertAccount(accountId) { if (await this._account() !== accountId) throw error('账号已切换。', 'CHAT_CHANGED'); }
  _liveDigest() {
    const context = this._context();
    if (context?.streamingProcessor && context.streamingProcessor.isFinished === false) throw error('当前回复尚未完成，暂不能整理。', 'HISTORY_UNAVAILABLE');
    if (!Array.isArray(context?.chat)) throw error('原版酒馆当前历史不可用。', 'HISTORY_UNAVAILABLE');
    return historyDigest(context.chat);
  }
  _headers() {
    const fn = this._context()?.getRequestHeaders;
    if (typeof fn !== 'function') throw error('原版酒馆认证请求头不可用。', 'HOST_CONTRACT_INVALID');
    return fn();
  }
  async _readPersisted(ref, { current = true, missing = false } = {}) {
    if (current) await this._assertCurrent(ref); else await this._assertAccount(ref.accountId);
    const path = ref.kind === 'group' ? '/api/chats/group/get' : '/api/chats/get';
    const body = ref.kind === 'group' ? { id: ref.chatId } : { avatar_url: ref.avatar, file_name: ref.chatId };
    let response, rows;
    try {
      response = await this.fetchImpl(path, { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { ...this._headers(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) throw error('原版酒馆历史读取失败。', 'HISTORY_UNAVAILABLE');
      rows = await response.json();
    } catch (cause) {
      if (cause?.code) throw cause;
      throw error('原版酒馆历史请求或 JSON 读取失败。', 'HISTORY_UNAVAILABLE');
    }
    if (current) await this._assertCurrent(ref); else await this._assertAccount(ref.accountId);
    if (missing && ((Array.isArray(rows) && rows.length === 0) || (rows && !Array.isArray(rows) && Object.keys(rows).length === 0))) return null;
    if (!Array.isArray(rows) || !rows[0]?.chat_metadata || typeof rows[0].chat_metadata !== 'object') throw error('持久聊天头尚未就绪，请先保存聊天。', 'CHAT_IDENTITY_NOT_READY');
    const metadata = rows[0].chat_metadata;
    if (!nonempty(metadata.integrity) || (ref.integrity && metadata.integrity !== ref.integrity)) throw error('当前聊天身份与保存的聊天不一致。', 'CHAT_IDENTITY_NOT_READY');
    const messages = rows.slice(1), digest = historyDigest(messages);
    if (current) {
      if (digest !== this._liveDigest()) throw error('酒馆正在保存或重新生成回复，请稍后重试。', 'HISTORY_UNAVAILABLE');
      await this._assertCurrent(ref);
    }
    return freezeDeep({ messages: clone(messages), metadata: clone(metadata), digest });
  }
  _extensionStore(accountId, { guard } = {}) {
    const create = () => createSTStorage({
      scope: { accountId, edition: 'sillytavern', scope: 'extension' }, fetchImpl: this.fetchImpl,
      getRequestHeaders: () => this._headers(), deviceStorage: this.deviceStorage, indexedDB: this.indexedDB, backend: this.storageBackend, locks: this.locks,
      guard: async () => { await this._assertAccount(accountId); await guard?.(); },
    });
    // A legacy receipt has its own lifetime guard, including queued IDB writes.
    if (guard) return create();
    if (!this.extensionStores.has(accountId)) this.extensionStores.set(accountId, create());
    return this.extensionStores.get(accountId);
  }
  async _registry(accountId) {
    const found = await this._extensionStore(accountId).tryGetJson(IDENTITY_ADDRESS);
    if (!found.found) return { version: 1, records: {} };
    if (found.value?.version !== 1 || !found.value.records || typeof found.value.records !== 'object' || Array.isArray(found.value.records)) throw error('拾忆聊天身份记录损坏，未新建空记忆。', 'PERSISTENCE_UNAVAILABLE');
    return found.value;
  }
  _record(registry, ref) {
    const record = registry.records[locatorKey(ref)];
    if (!record) return null;
    if (!Number.isSafeInteger(record.generation) || record.generation < 0 || typeof record.integrity !== 'string' || !/^st-chat-[a-f0-9]{64}$/.test(record.stableId) || typeof record.retired !== 'boolean') throw error('拾忆聊天身份记录格式无效。', 'PERSISTENCE_UNAVAILABLE');
    return record;
  }
  _resolve(registry, ref) {
    const record = this._record(registry, ref);
    if (record && !record.retired && record.integrity === ref.integrity) return { stableId: record.stableId, generation: record.generation };
    const generation = record ? record.generation + 1 : 0;
    return { stableId: generationId(ref, generation), generation };
  }
  async _assertNoPendingRename(registry, ref) {
    const target = this._record(registry, ref), previousRef = this.lastIdentifiedRef;
    if ((target && !target.retired && target.integrity === ref.integrity) || !previousRef || previousRef.accountId !== ref.accountId || previousRef.kind !== ref.kind || previousRef.chatId === ref.chatId || previousRef.integrity !== ref.integrity || (ref.kind === 'group' ? previousRef.groupId !== ref.groupId : previousRef.avatar !== ref.avatar)) return;
    const previous = this._record(registry, previousRef);
    if (!previous || previous.retired || previous.integrity !== previousRef.integrity) return;
    // ST reloads and emits CHAT_CHANGED before its awaited CHAT_RENAMED. A
    // follower may otherwise establish an empty new-name identity in that
    // gap. A copied/branched source still exists and remains independent.
    // Refuse this capture immediately; only the later verified rename event
    // may transfer the identity. Never wait inside the host's awaited emitter
    // or infer an alias merely from identical integrity values.
    const oldSource = await this._readPersisted({ ...previousRef, integrity: '' }, { current: false, missing: true });
    await this._assertCurrent(ref);
    if (!oldSource) throw error('聊天正在完成重命名，请等待身份转移后重试。', 'CHAT_IDENTITY_NOT_READY');
  }
  _serialIdentity(accountId, task) {
    const current = (this.identityQueues.get(accountId) ?? Promise.resolve()).catch(() => {}).then(() => this.locks?.request
      ? this.locks.request(`shiyi-st-identity-${sha256(accountId)}`, { mode: 'exclusive' }, task)
      : task());
    this.identityQueues.set(accountId, current);
    return current.finally(() => { if (this.identityQueues.get(accountId) === current) this.identityQueues.delete(accountId); });
  }
  async _ensureIdentity(ref, stableId) {
    return this._serialIdentity(ref.accountId, async () => {
      await this._assertCurrent(ref);
      const registry = await this._registry(ref.accountId), resolved = this._resolve(registry, ref);
      if (resolved.stableId !== stableId) throw error('聊天持久身份发生变化，已拒绝旧会话保存。', 'SOURCE_INVALIDATED');
      const record = this._record(registry, ref);
      if (!record || record.retired || record.integrity !== ref.integrity) {
        registry.records[locatorKey(ref)] = { integrity: ref.integrity, stableId, generation: resolved.generation, retired: false };
        await this._extensionStore(ref.accountId).setJson({ ...IDENTITY_ADDRESS, value: registry });
      }
      await this._assertCurrent(ref);
    });
  }
  async openHandle(rawRef) {
    const ref = freezeDeep(clone(rawRef));
    if (ref?.host !== 'sillytavern' || !['character', 'group'].includes(ref.kind)) throw error('捕获的原版酒馆聊天引用无效。', 'CHAT_REF_UNAVAILABLE');
    await this._assertCurrent(ref);
    let stableId = null, initialSnapshot = null;
    const snapshots = new Map();
    const identify = async () => {
      await this._assertCurrent(ref);
      if (!stableId) {
        initialSnapshot = await this._readPersisted(ref);
        const registry = await this._registry(ref.accountId);
        await this._assertNoPendingRename(registry, ref);
        stableId = this._resolve(registry, ref).stableId;
        await this._assertCurrent(ref);
        this.lastIdentifiedRef = ref;
      }
      return stableId;
    };
    const rawStore = async () => createSTStorage({ scope: { accountId: ref.accountId, edition: 'sillytavern', chatId: await identify() }, fetchImpl: this.fetchImpl, getRequestHeaders: () => this._headers(), deviceStorage: this.deviceStorage, indexedDB: this.indexedDB, backend: this.storageBackend, locks: this.locks, guard: () => this._assertCurrent(ref) });
    let storePromise;
    const store = {
      tryGetJson: async args => (await (storePromise ??= rawStore())).tryGetJson(args),
      getJson: async args => (await (storePromise ??= rawStore())).getJson(args),
      setJson: async args => { await this._ensureIdentity(ref, await identify()); return (await (storePromise ??= rawStore())).setJson(args); },
      deleteJson: async args => { await this._ensureIdentity(ref, await identify()); return (await (storePromise ??= rawStore())).deleteJson(args); },
    };
    const page = (snapshot, startIndex, endIndex) => freezeDeep({ startIndex, totalCount: snapshot.messages.length, messages: clone(snapshot.messages.slice(startIndex, endIndex)), snapshotId: snapshot.digest, refKey: refKey(ref) });
    const limitOf = value => Number.isInteger(value) && value > 0 ? Math.min(value, 2000) : 200;
    const history = {
      tail: async ({ limit = 200 } = {}) => {
        await identify();
        await this._assertCurrent(ref);
        let snapshot = initialSnapshot;
        initialSnapshot = null;
        if (!snapshot || snapshot.digest !== this._liveDigest()) snapshot = await this._readPersisted(ref);
        snapshots.clear(); snapshots.set(snapshot.digest, snapshot);
        return page(snapshot, Math.max(0, snapshot.messages.length - limitOf(limit)), snapshot.messages.length);
      },
      before: async (cursor, { limit = 200 } = {}) => {
        await this._assertCurrent(ref);
        const snapshot = snapshots.get(cursor?.snapshotId);
        if (!snapshot || cursor.refKey !== refKey(ref) || !Number.isInteger(cursor.startIndex) || cursor.startIndex <= 0 || cursor.startIndex > snapshot.messages.length || cursor.totalCount !== snapshot.messages.length) throw error('历史分页游标已失效。', 'SOURCE_INVALIDATED');
        if (snapshot.digest !== this._liveDigest()) throw error('读取分页期间聊天内容已变化。', 'SOURCE_INVALIDATED');
        return page(snapshot, Math.max(0, cursor.startIndex - limitOf(limit)), cursor.startIndex);
      },
    };
    return Object.freeze({ ref, stableId: identify, history: Object.freeze(history), store: Object.freeze(store), metadata: Object.freeze({ get: async () => clone((await this._readPersisted(ref)).metadata) }) });
  }
  async currentHandle() { const ref = await this.currentRef(); return ref ? this.openHandle(ref) : null; }
  async getStore({ scope = 'chat' } = {}) { return scope === 'extension' ? this._extensionStore(await this._account()) : (await this.currentHandle())?.store; }
  async getMetadata() { return (await this.currentHandle())?.metadata.get() ?? null; }
  async setExtensionMetadata() { throw error('原版酒馆适配不修改原聊天元数据。', 'HOST_CONTRACT_INVALID'); }
  async saveMetadata() { throw error('原版酒馆适配不写原聊天。', 'HOST_CONTRACT_INVALID'); }
  async _renamedFilename(name, accountId) {
    if (typeof name !== 'string' || !name.endsWith('.jsonl')) throw error('聊天重命名事件文件名无效。', 'HOST_CONTRACT_INVALID');
    await this._assertAccount(accountId);
    let response, data;
    try {
      response = await this.fetchImpl('/api/files/sanitize-filename', { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { ...this._headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ fileName: name }) });
      if (!response.ok) throw Error();
      data = await response.json();
    } catch { throw error('无法核实重命名后的实际文件名。', 'SOURCE_INVALIDATED'); }
    await this._assertAccount(accountId);
    // Native ST 1.19 returns { fileName }, although its server local variable
    // is called sanitizedFilename. Validate the public response contract.
    if (typeof data?.fileName !== 'string' || !data.fileName.endsWith('.jsonl')) throw error('重命名后的实际文件名无效。', 'SOURCE_INVALIDATED');
    return data.fileName.slice(0, -6);
  }

  /** ST1.19 public CHAT_RENAMED fires after persisted move/reload. Atomically
   * transfer only an established identity; a duplicate/branch is never merged. */
  async handleChatRenamed(payload, { guard = async () => {} } = {}) {
    await guard();
    const accountId = await this._account();
    await guard();
    // ST emits original request names, even when the rename endpoint returned a
    // different sanitized basename. Ask its pure filename helper, not a guess
    // from whatever chat happens to be selected after reload.
    const oldChatId = await this._renamedFilename(payload?.oldFileName, accountId);
    await guard();
    const newChatId = await this._renamedFilename(payload?.newFileName, accountId);
    await guard();
    const groupId = payload?.groupId == null ? '' : String(payload.groupId);
    const avatar = payload?.avatarId;
    if (!validName(oldChatId) || !validName(newChatId) || oldChatId === newChatId || (!groupId && !validName(avatar))) throw error('聊天重命名事件无效。', 'HOST_CONTRACT_INVALID');
    const base = { host: 'sillytavern', accountId, kind: groupId ? 'group' : 'character', ...(groupId ? { groupId } : { avatar }) };
    return this._serialIdentity(accountId, async () => {
      await guard();
      const oldRef = { ...base, chatId: oldChatId }, newRef = { ...base, chatId: newChatId };
      const registry = await this._registry(accountId), previous = this._record(registry, oldRef);
      await guard();
      if (!previous || previous.retired) return { changed: false, reason: 'no_established_identity' };
      const saved = await this._readPersisted(newRef, { current: false });
      await guard();
      if (saved.metadata.integrity !== previous.integrity) throw error('重命名后的聊天身份不一致，未合并记忆。', 'SOURCE_INVALIDATED');
      if (await this._readPersisted(oldRef, { current: false, missing: true })) throw error('旧聊天仍存在，已拒绝把复制聊天合并。', 'SOURCE_INVALIDATED');
      await guard();
      const target = this._record(registry, newRef);
      if (target && !target.retired && target.stableId !== previous.stableId) throw error('重命名目标已有独立记忆，未覆盖。', 'SOURCE_INVALIDATED');
      registry.records[locatorKey(oldRef)] = { ...previous, retired: true };
      registry.records[locatorKey(newRef)] = { ...previous, retired: false };
      await this._extensionStore(accountId, { guard }).setJson({ ...IDENTITY_ADDRESS, value: registry });
      return { changed: true, stableId: previous.stableId, oldChatId, newChatId };
    });
  }
  _legacyRenameRequest(input, init = {}) {
    let url;
    try { url = new URL(typeof input === 'string' || input instanceof URL ? input : input?.url, this.nativeHost.location.href); }
    catch { return null; }
    if (url.origin !== this.nativeHost.location.origin || url.pathname !== '/api/chats/rename' || url.search || url.hash || String(init.method ?? input?.method ?? 'GET').toUpperCase() !== 'POST' || typeof init.body !== 'string') return null;
    let body;
    try { body = JSON.parse(init.body); } catch { return null; }
    if (!body || Array.isArray(body) || typeof body.original_file !== 'string' || typeof body.renamed_file !== 'string' || !body.original_file.endsWith('.jsonl') || !body.renamed_file.endsWith('.jsonl') || typeof body.is_group !== 'boolean') return null;
    if (!body.is_group) return { payload: { avatarId: body.avatar_url, oldFileName: body.original_file, newFileName: body.renamed_file } };
    const context = this._context(), groupId = context?.groupId == null ? '' : String(context.groupId);
    const chatId = context?.getCurrentChatId?.() ?? context?.chatId;
    const group = context?.groups?.find(item => String(item.id) === groupId);
    // ST1.17's request omits the group ID. Only the selected, exact old chat
    // proves which group is being renamed; another group's rename is refused.
    if (!groupId || !group || group.chat_id !== chatId || `${chatId}.jsonl` !== body.original_file)
      return { failure: error('当前酒馆缺少群聊更名通知，无法确认非当前群聊的更名归属；拾忆保留旧存档，未合并记忆。', 'CHAT_IDENTITY_NOT_READY') };
    return { payload: { groupId, oldFileName: body.original_file, newFileName: body.renamed_file } };
  }
  _attachLegacyRenameObserver({ onRenamed, onError }) {
    const nativeHost = this.nativeHost, originalFetch = nativeHost.fetch;
    if (typeof originalFetch !== 'function') throw error('原版酒馆更名观察接口不可用。', 'HOST_CONTRACT_INVALID');
    let active = true;
    const adapter = this;
    const wrapper = async function (...args) {
      const request = active ? adapter._legacyRenameRequest(...args) : null;
      // Capture the native account before dispatch, without delaying dispatch.
      let accountTask;
      if (request) {
        try { accountTask = Promise.resolve(adapter.getAccountId()).then(nonempty, () => ''); }
        catch { accountTask = Promise.resolve(''); }
      }
      const response = await Reflect.apply(originalFetch, nativeHost, args);
      if (!request || !active || !response.ok) return response;
      try {
        const receipt = await response.clone().json();
        if (receipt?.ok !== true) return response;
        const accountId = await accountTask;
        const guard = async () => {
          if (!active) throw error('拾忆更名观察已停止。', 'CANCELED');
          await adapter._assertAccount(accountId);
          if (!active) throw error('拾忆更名观察已停止。', 'CANCELED');
        };
        await guard();
        if (request.failure) throw request.failure;
        const result = await adapter.handleChatRenamed(request.payload, { guard });
        await guard();
        if (result.changed) {
          if (onRenamed) await onRenamed(result);
          else {
            // Usually native reload follows this returned response and emits
            // CHAT_CHANGED itself. Do not refresh its still-selected old name.
            const context = adapter._context(), name = context?.eventTypes?.CHAT_CHANGED;
            if (name && (context.getCurrentChatId?.() ?? context.chatId) === result.newChatId)
              await context.eventSource.emit(name, result.newChatId);
          }
        }
      } catch (cause) {
        if (active && cause?.code !== 'CANCELED' && cause?.name !== 'AbortError') {
          try { await onError(cause); } catch { /* notification must not change native fetch */ }
        }
      }
      return response;
    };
    nativeHost.fetch = wrapper;
    return () => {
      active = false;
      // Keep any wrapper a later extension placed around ours. Its calls into
      // this detached wrapper simply forward, with no receipt observation.
      if (nativeHost.fetch === wrapper) nativeHost.fetch = originalFetch;
    };
  }
  attachRenameListener({ onRenamed = null, onError = () => {} } = {}) {
    if (this.renameUnsubscribe) return this.renameUnsubscribe;
    const nativeRenameType = this._context()?.eventTypes?.CHAT_RENAMED;
    const legacy = typeof nativeRenameType !== 'string' || !nativeRenameType;
    const unsubscribe = legacy ? this._attachLegacyRenameObserver({ onRenamed, onError }) : this.subscribe('CHAT_RENAMED', async payload => {
      try {
        const result = await this.handleChatRenamed(payload);
        if (result.changed) {
          if (onRenamed) await onRenamed(result);
          else {
            const context = this._context(), name = context?.eventTypes?.CHAT_CHANGED;
            if (name && typeof context.eventSource?.emit === 'function') await context.eventSource.emit(name, context.getCurrentChatId?.() ?? context.chatId);
          }
        }
      } catch (cause) { onError(cause); }
    });
    this.renameUnsubscribe = () => { unsubscribe(); this.renameUnsubscribe = null; };
    return this.renameUnsubscribe;
  }
  dispose() { this.renameUnsubscribe?.(); }
}

export const STAdapter = SillyTavernHostAdapter;
export const STHostAdapter = SillyTavernHostAdapter;
