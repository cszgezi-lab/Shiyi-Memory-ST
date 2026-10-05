import { ProviderClient } from './provider.js';
import { ShiyiError } from './errors.js';
import { clone, sha256, stableStringify } from './utils.js';
import {losslessStore} from './reliable-storage.js';

export const PRODUCT_HOST_ERROR_CODES = Object.freeze([
  'CHAT_IDENTITY_NOT_READY',
  'CHAT_REF_UNAVAILABLE',
  'CHAT_HANDLE_UNAVAILABLE',
  'HISTORY_UNAVAILABLE',
  'PERSISTENCE_UNAVAILABLE',
  'TRANSPORT_UNAVAILABLE',
  'MODEL_UNAVAILABLE',
  'PROVIDER_REQUEST_FAILED',
  'CANCELED',
  'SOURCE_INVALIDATED',
  'CHAT_CHANGED',
  'HOST_CONTRACT_INVALID',
]);

function productError(message, code, details = undefined) {
  return new ShiyiError(message, code, details);
}

function nonEmptyString(value) { return typeof value === 'string' && value.trim() ? value.trim() : ''; }

function safeIdentityFailure(error) {
  if (error?.code === 'CHAT_CHANGED') return error;
  // Host metadata exceptions may contain paths, account names, or provider
  // details.  Imported/unsaved chats commonly fail here because integrity is
  // not durable yet; all such failures have one user-facing explanation.
  return productError('当前聊天身份尚未就绪，请先让宿主保存聊天后重试。', 'CHAT_IDENTITY_NOT_READY',{causeError:error,stage:'prepare'});
}

function requireAdapter(adapter) {
  if (!adapter || typeof adapter.currentRef !== 'function') throw productError('当前聊天引用不可用。', 'CHAT_REF_UNAVAILABLE');
  if (typeof adapter.openHandle !== 'function') throw productError('当前聊天句柄不可用。', 'CHAT_HANDLE_UNAVAILABLE');
}

/** Strict identity boundary for the formal product shell. */
export async function captureProductHostSession(adapter, { accountId = null, branchId = null } = {}) {
  requireAdapter(adapter);
  let ref;
  try { ref = await adapter.currentRef(); } catch (error) { throw safeIdentityFailure(error); }
  if (!ref) throw productError('当前没有可绑定的聊天。', 'CHAT_REF_UNAVAILABLE');
  let handle;
  try { handle = await adapter.openHandle(clone(ref)); } catch (error) {
    if (error?.code === 'CHAT_REF_UNAVAILABLE') throw error;
    throw productError('当前聊天无法打开。', 'CHAT_HANDLE_UNAVAILABLE',{causeError:error,stage:'prepare'});
  }
  let rawIdentity;
  try {
    if (typeof handle?.stableId !== 'function') throw productError('当前聊天持久身份未提供。', 'CHAT_IDENTITY_NOT_READY');
    rawIdentity = await handle.stableId();
  } catch (error) { throw safeIdentityFailure(error); }
  // Do not coerce undefined, null, objects, or numbers into pseudo IDs.  A
  // stable ID is a host-owned non-empty string and nothing else.
  const stableId = nonEmptyString(rawIdentity);
  if (!stableId) throw productError('当前聊天持久身份未就绪，请先保存聊天。', 'CHAT_IDENTITY_NOT_READY');
  const scope = {};
  if (nonEmptyString(accountId)) scope.accountId = nonEmptyString(accountId);
  scope.chatId = stableId;
  if (nonEmptyString(branchId)) scope.branchId = nonEmptyString(branchId);
  return Object.freeze({
    adapter,
    ref: clone(ref),
    refKey: stableStringify(ref),
    handle,
    stableId,
    scope: Object.freeze(scope),
  });
}

// Naming alias used by the formal shell API; both names retain the strict
// captured-ref/non-empty-string identity boundary.
export const createProductHostSession = captureProductHostSession;

function historyApi(session) {
  const history = session?.handle?.history;
  if (!history || typeof history.tail !== 'function') throw productError('当前聊天历史读取不可用。', 'HISTORY_UNAVAILABLE');
  return history;
}

function historyReadError(error,historyStep){
  if(['CHAT_CHANGED','CANCELED','SOURCE_INVALIDATED'].includes(error?.code))return error;
  const reason=error?.name==='SyntaxError'?'history_decode_failed':historyStep==='before'?'history_before_failed':'history_tail_failed';
  return productError('当前聊天历史读取失败。','HISTORY_UNAVAILABLE',{causeError:error,stage:'prepare',reason,historyStep});
}

// Retry the whole snapshot, not an old cursor: TT may be saving JSONL while
// emitting a reply event. Never skip malformed rows or reopen a different chat.
async function recoverHistoryRead(session,read,check=()=>{}){
  for(let attempt=0;attempt<3;attempt++){
    await check();
    if(session.adapter?.currentRef&&stableStringify(await session.adapter.currentRef())!==session.refKey)throw productError('聊天已切换。','CHAT_CHANGED');
    try{return await read();}catch(error){
      if(error?.code!=='HISTORY_UNAVAILABLE')throw error;
      error.details={...error.details,historyReadAttempts:attempt+1};
      if(attempt===2)throw error;
      await new Promise(resolve=>setTimeout(resolve,attempt===0?250:750));
    }
  }
}

export async function readProductHistoryTail(session,{check=()=>{}}={}){
  return recoverHistoryRead(session,async()=>{
    try{return await historyApi(session).tail({limit:1});}catch(error){throw historyReadError(error,'tail');}
  },check);
}

export function normalizeHostMessage(message, index) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) throw productError('宿主返回了无效消息。', 'HOST_CONTRACT_INVALID');
  const text = String(message.text ?? message.mes ?? message.content ?? '');
  const explicit = nonEmptyString(message.id ?? message.messageId ?? message.uuid ?? message.sourceId);
  // v2.2.0 does not promise a per-message UUID.  An absolute index plus the
  // frozen body digest remains stable within this captured source revision.
  const digest = sha256(text);
  const id = explicit || `message:${index}:${digest.slice(0, 16)}`;
  if (message.complete === false || message.streaming === true || message.isStreaming === true) {
    throw productError('当前消息仍在生成，暂不能整理。', 'HISTORY_UNAVAILABLE');
  }
  const version = message.version ?? message.swipeId ?? message.swipe_id ?? 0;
  if (!((Number.isInteger(version) && version >= 0) || (typeof version === 'string' && version.trim()))) {
    throw productError('宿主消息版本不可用。', 'HOST_CONTRACT_INVALID');
  }
  return {
    id,
    // TT's saved JSONL uses `name` for a display name, not a role. Its
    // is_user/is_system flags identify the author; taking name first turned
    // every player turn into a custom role and broke current-turn recall.
    role: message.is_system===true?'system':message.is_user===true?'user':
      ['user','assistant','system'].includes(message.role)?message.role:message.is_user===false?'assistant':
      ['user','assistant','system'].includes(message.name)?message.name:'assistant',
    text,
    version,
    hash: digest,
    complete: true,
    index,
  };
}

function validBound(value, name) {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || value < 0) throw productError(`${name} 必须是非负整数。`, 'HOST_CONTRACT_INVALID');
  return value;
}

/** Read one frozen, chat-bound range.  This function never reopens the live chat. */
export async function readProductHostRange(session,options={}){
  return recoverHistoryRead(session,()=>readProductHostRangeOnce(session,options),options.check);
}
async function readProductHostRangeOnce(session, { count = 8, startIndex = null, endIndex = null, maxMessages = 200 } = {}) {
  const history = historyApi(session);
  const max = Math.max(1, Math.min(2000, Number.isInteger(maxMessages) ? maxMessages : 200));
  const start = validBound(startIndex, 'startIndex');
  const end = validBound(endIndex, 'endIndex');
  let limit;
  if (start !== null || end !== null) {
    if (start === null || end === null || end < start) throw productError('明确范围必须同时提供有效起止位置。', 'HOST_CONTRACT_INVALID');
    if (end - start + 1 > max) throw productError('明确范围超过单批上限，请分批整理。', 'HOST_CONTRACT_INVALID');
    limit = end - start + 1;
  } else {
    if (!Number.isInteger(count) || count <= 0) throw productError('消息数量必须是正整数。', 'HOST_CONTRACT_INVALID');
    limit = Math.min(max, count);
  }
  let page;
  try { page = await history.tail({ limit }); } catch (error) { throw historyReadError(error,'tail'); }
  if (!page || !Array.isArray(page.messages)) throw productError('宿主历史页格式不可用。', 'HOST_CONTRACT_INVALID');
  const pageStart = Number.isInteger(page.startIndex) && page.startIndex >= 0 ? page.startIndex : Math.max(0, (page.totalCount ?? page.messages.length) - page.messages.length);
  const totalCount = Number.isInteger(page.totalCount) && page.totalCount >= pageStart + page.messages.length ? page.totalCount : pageStart + page.messages.length;
  if (end !== null && end >= totalCount) throw productError('结束楼层超出当前聊天。', 'HOST_CONTRACT_INVALID');
  const pages = [{ startIndex: pageStart, messages: page.messages }];

  // An explicit range can require one or more older pages.  Only the captured
  // handle is used, so a live chat switch cannot redirect the read.
  if (start !== null && pageStart > start && typeof history.before === 'function') {
    let cursor = Number.isInteger(page.startIndex) ? page : { ...page, startIndex: pageStart };
    let guard = 0;
    while (cursor.startIndex > start && guard < 64) {
      guard += 1;
      let older;
      try { older = await history.before(cursor, { limit: Math.min(max, Math.max(1, pageStart - start)) }); } catch (error) { throw historyReadError(error,'before'); }
      if (!older || !Array.isArray(older.messages) || !Number.isInteger(older.startIndex) || older.startIndex < 0 || older.startIndex >= cursor.startIndex) throw productError('宿主历史范围不连续。', 'HOST_CONTRACT_INVALID');
      if (older.startIndex + older.messages.length !== cursor.startIndex || (older.totalCount !== undefined && older.totalCount !== totalCount)) throw productError('宿主历史缺页或读取期间发生变化。', 'HOST_CONTRACT_INVALID');
      pages.push(older);
      cursor = older;
      if (older.messages.length === 0) break;
    }
  }
  const lower = start ?? Math.max(0, totalCount - limit);
  const upper = end ?? totalCount - 1;
  // Validate page continuity above, but only touch/hash bodies in the selected
  // range. Unrelated recent messages may even still be streaming.
  const selected = pages.reverse().flatMap(candidate => {
    const from = Math.max(lower, candidate.startIndex);
    const to = Math.min(upper + 1, candidate.startIndex + candidate.messages.length);
    return from >= to ? [] : candidate.messages.slice(from-candidate.startIndex, to-candidate.startIndex)
      .map((message, offset) => normalizeHostMessage(message, from + offset));
  });
  if (selected.length === 0) throw productError('所选聊天范围为空。', 'HISTORY_UNAVAILABLE');
  if (selected.length !== upper - lower + 1 || selected.some((m, i) => m.index !== lower + i)) throw productError('所选历史范围不完整，未进行总结。', 'HOST_CONTRACT_INVALID');
  return {
    messages: selected,
    startIndex: selected[0].index,
    endIndex: selected.at(-1).index,
    totalCount,
    requestedRange: { startIndex: lower, endIndex: upper },
    readStats: { historyPages: pages.length, fetchedMessages: pages.reduce((n,p)=>n+p.messages.length,0), normalizedMessages: selected.length },
    sourceRevision: sha256({ scope: session.scope, messages: selected.map(({ id, role, text, version, hash, index }) => ({ id, role, text, version, hash, index })) }),
  };
}

const stores = new WeakMap();
export function isMissingProductEntry(error) { return ['NOT_FOUND','ENOENT'].includes(error?.code) || /^(?:not found:|chat store entry not found:)/i.test(String(error?.message ?? error)); }
export function productStoreFromSession(session) {
  const store = session?.handle?.store ?? session?.store;
  if (!store || typeof store.setJson !== 'function' || (typeof store.tryGetJson !== 'function' && typeof store.getJson !== 'function')) {
    throw productError('宿主没有可验证的专属持久存储，已拒绝显示“已保存”。', 'PERSISTENCE_UNAVAILABLE');
  }
  if(stores.has(store))return stores.get(store);
  const wrapped={
    setJson: args=>store.setJson(args),
    async tryGetJson(args) {
      if (typeof store.tryGetJson === 'function') return store.tryGetJson(args);
      // TT 2.2 chat stores notify natively before a missing getJson rejects.
      // Catching that rejection is too late: query this namespace first.
      // No persistent key cache: another write/delete must be visible on reload.
      if (typeof store.listKeys === 'function') {
        const keys = await store.listKeys({ namespace: args.namespace, ...(args.table !== undefined ? { table: args.table } : {}) });
        if (!Array.isArray(keys) || keys.some(key => typeof key !== 'string')) {
          throw productError('宿主存储目录格式无效，未读取记忆。', 'HOST_CONTRACT_INVALID');
        }
        if (!keys.includes(args.key)) return { found: false };
        // A listed record that cannot be read is a real failure, not an empty
        // workspace (including deletion races, invalid JSON and permissions).
        return { found: true, value: await store.getJson(args) };
      }
      // Compatibility for older hosts with neither optional reads nor listing.
      try {
        const value = await store.getJson(args);
        return { found: value !== undefined, value };
      } catch (error) {
        if (isMissingProductEntry(error)) return { found: false };
        throw error;
      }
    },
    ...(store.getJson?{getJson:args=>store.getJson(args)}:{}),
    ...(store.deleteJson?{deleteJson:args=>store.deleteJson(args)}:{}),
  };
  const reliable=losslessStore(wrapped);stores.set(store,reliable);return reliable;
}

export function safeProductError(error, fallback = 'PROVIDER_REQUEST_FAILED') {
  const mapping = new Map([
    ['CANCELED', 'CANCELED'], ['TIMEOUT', 'PROVIDER_REQUEST_FAILED'], ['PROVIDER_HTTP_ERROR', 'PROVIDER_REQUEST_FAILED'],
    ['SUMMARY_RESPONSE_ERROR', 'PROVIDER_REQUEST_FAILED'], ['PROVIDER_PROFILE_INVALID', 'TRANSPORT_UNAVAILABLE'],
    ['PROVIDER_FETCH_UNAVAILABLE', 'TRANSPORT_UNAVAILABLE'], ['PERSISTENCE_ERROR', 'PERSISTENCE_UNAVAILABLE'],
    ['REVISION_CONFLICT', 'SOURCE_INVALIDATED'], ['SCOPE_CONFLICT', 'CHAT_CHANGED'], ['VALIDATION_ERROR', 'HOST_CONTRACT_INVALID'],
  ]);
  const code = mapping.get(error?.code) ?? (PRODUCT_HOST_ERROR_CODES.includes(error?.code) ? error.code : fallback);
  return PRODUCT_HOST_ERROR_CODES.includes(code) ? code : 'PROVIDER_REQUEST_FAILED';
}

/** Session-only transport.  `apiKey` is never copied into persisted settings. */
export function createProductTransport(profile = {}, { sessionApiKey = '', fetchImpl = globalThis.fetch } = {}) {
  const endpoint = nonEmptyString(profile.providerEndpoint ?? profile.endpoint ?? profile.url);
  const model = nonEmptyString(profile.providerModel ?? profile.model);
  if (!endpoint || !model) return { status: 'unavailable', errorCode: 'TRANSPORT_UNAVAILABLE', reason: 'provider_endpoint_or_model_missing' };
  let client;
  try {
    client = new ProviderClient({
      endpoint,
      endpointMode: profile.providerEndpointMode ?? profile.endpointMode ?? 'base',
      model,
      authMode: profile.providerAuthMode ?? profile.authMode ?? 'bearer',
      // This value lives only in the returned session object.
      apiKey: typeof sessionApiKey === 'string' ? sessionApiKey : '',
      timeoutMs: profile.deadlineMs ?? profile.timeoutMs,
    }, { fetchImpl, recordRequests: false,modelRole:'summary' });
  } catch (error) {
    return { status: 'unavailable', errorCode: 'TRANSPORT_UNAVAILABLE', reason: 'provider_profile_invalid' };
  }
  const publicProfile = {
      summaryRequestMode:profile.summaryRequestMode,
      summaryStreaming:profile.summaryStreaming===true,
      maxTokens: Number.isSafeInteger(profile.outputBudgetUnits) && profile.outputBudgetUnits>0 ? profile.outputBudgetUnits : 0,
    endpointMode: client.profile.endpointMode,
    url: client.profile.url,
    model: client.profile.model,
    authMode: client.profile.authMode,
    timeoutMs: client.profile.timeoutMs,
  };
  const clearTransportLog = () => {
    // ProviderClient keeps a local diagnostic requestLog for the core tests.
    // The formal shell must not retain chat bodies or session credentials in
    // a product-visible transport object, even transiently after a request.
    if (Array.isArray(client.requestLog)) client.requestLog.length = 0;
  };
  return {
    status: 'ready',
    sessionOnly: true,
    profile: publicProfile,
    model: {
      profile: publicProfile,
      async chatCompletions(payload, options = {}) {
        // The profile value is the user-facing ceiling. A recovery request may
        // provide a smaller effective max_tokens after a timeout/502; do not
        // overwrite that adaptive value on the way to the provider.
        const body={...payload};
        if (profile.outputBudgetUnits>0 && body.max_tokens===undefined) body.max_tokens=profile.outputBudgetUnits;
        try { return await client.chatCompletions(body, options); } finally { clearTransportLog(); }
      },
    },
    async testConnection({ payload = null, signal } = {}) {
      try {
        return await client.testConnection({ task: 'chat', payload: payload ?? { model, messages: [{ role: 'user', content: '[SHIYI_SYNTHETIC_CONNECTION_CHECK]' }], stream: false }, signal });
      } finally { clearTransportLog(); }
    },
  };
}

export function describeProductSession(session) {
  return session ? { status: 'ready', identityReady: true, scopeKind: 'chat-bound', hasStore: Boolean(session.handle?.store) } : { status: 'unbound', identityReady: false, scopeKind: null, hasStore: false };
}
