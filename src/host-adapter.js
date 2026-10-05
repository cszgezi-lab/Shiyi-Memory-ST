import { ProbeWriteError, ShiyiError } from './errors.js';
import { clone, isPlainObject, makeId, stableStringify } from './utils.js';

export const CAPABILITY_STATUS = Object.freeze({
  STATIC_VISIBLE: 'static_visible',
  MOCK_PASSED: 'mock_passed',
  LIVE_TT_PASSED: 'live_tt_passed',
  TARGET_MOBILE_PENDING: 'target_mobile_pending',
});

const ENHANCED_ABI = Object.freeze({
  chatOpen: ['api', 'chat', 'open'],
  chatRef: ['api', 'chat', 'current', 'ref'],
  chatHandle: ['api', 'chat', 'current', 'handle'],
  stableId: ['api', 'chat', 'current', 'handle'],
  historyTail: ['api', 'chat', 'current', 'handle', 'history', 'tail'],
  historyBefore: ['api', 'chat', 'current', 'handle', 'history', 'before'],
  searchMessages: ['api', 'chat', 'current', 'handle', 'searchMessages'],
  chatStore: ['api', 'chat', 'current', 'handle', 'store'],
  chatMetadata: ['api', 'chat', 'current', 'handle', 'metadata'],
  extensionStore: ['api', 'extension', 'store'],
});

const LEGACY_ABI = Object.freeze({
  context: ['getContext'],
  eventSource: ['eventSource'],
  eventTypes: ['eventTypes'],
  setExtensionPrompt: ['setExtensionPrompt'],
  getTokenCountAsync: ['getTokenCountAsync'],
  saveMetadata: ['saveMetadata'],
  chat: ['chat'],
});

function rootOf(host) {
  if (!host) return globalThis;
  if (host.__TAURITAVERN__ || host.getContext || host.SillyTavern || host.api) return host;
  if (host.window && (host.window.__TAURITAVERN__ || host.window.getContext || host.window.SillyTavern)) return host.window;
  return host;
}

function getAt(root, path) {
  let current = root;
  for (const key of path) {
    if (current === null || current === undefined) return undefined;
    current = current[key];
  }
  return current;
}

function existsAt(root, path) {
  return getAt(root, path) !== undefined;
}

function statusFor(staticVisible, { mockPassed = false, liveTtPassed = false } = {}) {
  return {
    status: liveTtPassed
      ? CAPABILITY_STATUS.LIVE_TT_PASSED
      : mockPassed
        ? CAPABILITY_STATUS.MOCK_PASSED
        : staticVisible
          ? CAPABILITY_STATUS.STATIC_VISIBLE
          : CAPABILITY_STATUS.TARGET_MOBILE_PENDING,
    staticVisible,
    mockPassed,
    // Deliberately false unless a caller supplies explicit real-TT evidence.
    liveTtPassed,
    targetMobile: CAPABILITY_STATUS.TARGET_MOBILE_PENDING,
  };
}

function asStore(store) {
  if (!store || typeof store.setJson !== 'function' || (typeof store.getJson !== 'function' && typeof store.tryGetJson !== 'function')) return null;
  return store;
}

/** A deterministic in-memory stand-in for TT's public JSON store. */
export class InMemoryHostStore {
  constructor({ fail = {}, latencyMs = 0 } = {}) {
    this.values = new Map();
    this.fail = { ...fail };
    this.latencyMs = latencyMs;
    this.calls = [];
  }

  _key({ namespace, table = 'main', key }) {
    if (!namespace || !key) throw new ShiyiError('namespace and key are required', 'STORE_ARGUMENT');
    return `${namespace}\u0000${table}\u0000${key}`;
  }

  async _wait() {
    if (this.latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
  }

  _maybeFail(operation, args) {
    this.calls.push({ operation, args: clone(args) });
    const fault = this.fail[operation];
    if (!fault) return;
    if (typeof fault === 'function') throw fault(operation, args);
    throw new Error(typeof fault === 'string' ? fault : `synthetic store failure: ${operation}`);
  }

  async setJson(args) {
    await this._wait();
    this._maybeFail('setJson', args);
    this.values.set(this._key(args), clone(args.value));
  }

  async getJson(args) {
    await this._wait();
    this._maybeFail('getJson', args);
    return clone(this.values.get(this._key(args)));
  }

  async tryGetJson(args) {
    await this._wait();
    this._maybeFail('tryGetJson', args);
    const key = this._key(args);
    return this.values.has(key) ? { found: true, value: clone(this.values.get(key)) } : { found: false };
  }

  async updateJson(args) {
    const previous = await this.tryGetJson(args);
    const next = previous.found && isPlainObject(previous.value) && isPlainObject(args.value)
      ? { ...previous.value, ...clone(args.value) }
      : clone(args.value);
    return this.setJson({ ...args, value: next });
  }

  async deleteJson(args) {
    await this._wait();
    this._maybeFail('deleteJson', args);
    this.values.delete(this._key(args));
  }

  async listKeys({ namespace, table = 'main' }) {
    await this._wait();
    this._maybeFail('listKeys', { namespace, table });
    const prefix = `${namespace}\u0000${table}\u0000`;
    return [...this.values.keys()].filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length));
  }
}

function eventTypeObject(context, tauri) {
  return tauri?.api?.events ?? context?.eventTypes ?? context?.event_types ?? tauri?.eventTypes ?? {};
}

function capabilityReport(root, { mockPassed = [], liveTtPassed = [] } = {}) {
  const mockNames = new Set(mockPassed);
  const liveNames = new Set(liveTtPassed);
  const tauri = root.__TAURITAVERN__;
  // Static capability collection must not invoke getContext.  Apart from
  // keeping construction side-effect free, this avoids pinning a context
  // object from the wrong chat.  Runtime calls resolve the current context
  // lazily in HostAdapter._context().
  const context = null;
  const legacyRoot = root.SillyTavern ?? root;
  const enhanced = {};
  for (const [name, path] of Object.entries(ENHANCED_ABI)) {
    enhanced[name] = existsAt(tauri ?? {}, path);
    // ChatHandle methods live on the value returned by current.handle(); the
    // function itself is the publicly documented static anchor.
    if (!enhanced[name] && ['historyTail', 'historyBefore', 'searchMessages', 'chatStore', 'chatMetadata'].includes(name)) {
      enhanced[name] = typeof getAt(tauri ?? {}, ['api', 'chat', 'current', 'handle']) === 'function';
    }
  }
  const legacy = {};
  for (const [name, path] of Object.entries(LEGACY_ABI)) {
    legacy[name] = name === 'context'
      ? typeof root.getContext === 'function' || typeof root.SillyTavern?.getContext === 'function'
      : existsAt(context ?? legacyRoot, path);
  }
  const enhancedVisible = Object.values(enhanced).some(Boolean);
  const legacyVisible = Object.values(legacy).some(Boolean);
  const eventTypes = eventTypeObject(context, tauri);
  const eventNames = isPlainObject(eventTypes) ? Object.keys(eventTypes) : [];
  return {
    enhanced: Object.fromEntries(Object.entries(enhanced).map(([name, visible]) => [name, {
      ...statusFor(visible, { mockPassed: mockNames.has(name) && visible, liveTtPassed: liveNames.has(name) && visible }),
      evidence: visible ? `window.__TAURITAVERN__.${ENHANCED_ABI[name].join('.')}` : null,
    }])),
    legacy: Object.fromEntries(Object.entries(legacy).map(([name, visible]) => [name, {
      ...statusFor(visible, { mockPassed: mockNames.has(`legacy.${name}`) && visible, liveTtPassed: liveNames.has(`legacy.${name}`) && visible }),
      evidence: visible ? LEGACY_ABI[name].join('.') : null,
    }])),
    events: {
      // Event-name presence is intentionally a separate fact.  It does not
      // claim that listeners fire or that a prompt/save transaction works.
      names: eventNames,
      ...statusFor(eventNames.length > 0, { mockPassed: mockNames.has('events'), liveTtPassed: liveNames.has('events') }),
      endToEndPassed: false,
    },
    enhancedApiVisible: enhancedVisible,
    legacyApiVisible: legacyVisible,
    targetMobile: statusFor(false),
  };
}

/**
 * Adapter for the stable public TT surface with a legacy fallback.  It has no
 * production write side effects during construction or static probing.
 */
export class HostAdapter {
  constructor(host = globalThis, { liveEvidence = null } = {}) {
    this.root = rootOf(host);
    this.tauri = this.root.__TAURITAVERN__;
    this.context = null;
    this._liveEvidence = null;
    this.capabilities = capabilityReport(this.root);
    if (liveEvidence) this.recordLiveProof(liveEvidence);
  }

  _context() {
    const owner = typeof this.root.getContext === 'function'
      ? this.root
      : typeof this.root.SillyTavern?.getContext === 'function'
        ? this.root.SillyTavern
        : null;
    if (!owner) return null;
    try {
      // Do not cache this object: TT replaces the active context on chat
      // switches, and an async read must never use a stale legacy context.
      return owner.getContext();
    } catch {
      return null;
    }
  }

  _chatApi() { return this.tauri?.api?.chat; }

  async ready() {
    const ready = this.tauri?.ready ?? this.root.__TAURITAVERN_MAIN_READY__;
    if (typeof ready === 'function') return ready();
    if (ready && typeof ready.then === 'function') return ready;
    return undefined;
  }

  async currentRef() {
    await this.ready();
    const fn = this._chatApi()?.current?.ref;
    if (typeof fn === 'function') {
      try { return await fn(); }
      catch(error) {
        // TT 2.2 throws these exact errors on its home/empty-chat screen.
        // Confirm the empty context as well: a real identity failure in an
        // opened chat must remain an error, not silently turn into "no chat".
        const context=this._context(),id=context?.chatId;
        const empty=context&&Array.isArray(context.chat)&&(id==null||(typeof id==='string'&&!id.trim()));
        if(empty&&['Failed to resolve active character id','SillyTavern context chatId is empty for character chat','SillyTavern context chatId is empty for group chat'].includes(error?.message))return null;
        throw new ShiyiError('无法读取 TT 当前聊天标识','CHAT_REF_UNAVAILABLE',{reason:'chat_ref_unavailable',stage:'prepare',causeError:error});
      }
    }
    const context = this._context();
    const chatId = typeof context?.getCurrentChatId === 'function' ? context.getCurrentChatId() : context?.chatId ?? context?.chat_id;
    return chatId ? { kind: 'legacy', chatId: String(chatId) } : null;
  }

  async currentHandle() {
    await this.ready();
    const fn = this._chatApi()?.current?.handle;
    if (typeof fn === 'function') return fn();
    return null;
  }

  /** Open a handle from a captured ref so an async read is chat-bound. */
  async openHandle(ref) {
    await this.ready();
    const api = this._chatApi();
    if (typeof api?.open === 'function') return api.open(ref);
    const current = await this.currentRef();
    if (stableStringify(current) === stableStringify(ref)) return this.currentHandle();
    throw new ShiyiError('chat.open is unavailable for a captured ref', 'CAPABILITY_UNAVAILABLE');
  }

  /** Prefer the enhanced tokenizer and use TT/ST's public context counter as a verified fallback. */
  async countTokens(text, options = {}) {
    await this.ready();
    const tokenizer = this.tauri?.api?.tokenizer ?? this.tauri?.api?.text?.tokenizer;
    const fn = tokenizer?.count ?? tokenizer?.countTokens;
    const context = this._context();
    const legacy = context?.getTokenCountAsync;
    if (typeof fn !== 'function' && typeof legacy !== 'function') {
      throw new ShiyiError('host tokenizer is unavailable', 'CAPABILITY_UNAVAILABLE');
    }
    const result = typeof fn === 'function'
      ? await fn.call(tokenizer, text, options)
      : await legacy.call(context, text, options?.padding);
    if (!Number.isInteger(result) || result < 0) throw new ShiyiError('host tokenizer returned an invalid count', 'HOST_CONTRACT_INVALID');
    return result;
  }

  /** Subscribe through an enhanced API or the public SillyTavern context event bus. */
  subscribe(eventName, listener) {
    const events = this.tauri?.api?.events;
    if (typeof events?.subscribe === 'function') {
      const subscription = events.subscribe(eventName, listener);
      if (typeof subscription === 'function') return subscription;
      if (subscription && typeof subscription.unsubscribe === 'function') return () => subscription.unsubscribe();
      if (typeof events.unsubscribe === 'function') return () => events.unsubscribe(eventName, listener);
      throw new ShiyiError('enhanced event cancellation is unavailable', 'HOST_CONTRACT_INVALID');
    }

    const context = this._context();
    const source = context?.eventSource;
    const types = context?.eventTypes ?? context?.event_types ?? {};
    const resolvedName = typeof types?.[eventName] === 'string' ? types[eventName] : eventName;
    const remove = source?.removeListener ?? source?.off;
    if (typeof source?.on !== 'function') throw new ShiyiError('event subscription is unavailable', 'EVENT_CAPABILITY_UNAVAILABLE');
    // Refuse before registering when there is no exact cancellation path.
    if (typeof remove !== 'function') throw new ShiyiError('event cancellation is unavailable', 'EVENT_CANCEL_UNAVAILABLE');
    source.on(resolvedName, listener);
    return () => remove.call(source, resolvedName, listener);
  }

  async stableId() {
    const handle = await this.currentHandle();
    if (typeof handle?.stableId !== 'function') throw new ShiyiError('chat stableId is unavailable', 'CAPABILITY_UNAVAILABLE');
    const value = String(await handle.stableId()).trim();
    if (!value) throw new ShiyiError('chat stableId is empty', 'CHAT_IDENTITY_MISSING');
    return value;
  }

  async historyTail(options = {}) {
    const handle = await this.currentHandle();
    if (typeof handle?.history?.tail !== 'function') throw new ShiyiError('history.tail is unavailable', 'CAPABILITY_UNAVAILABLE');
    return handle.history.tail(options);
  }

  async historyBefore(page, options = {}) {
    const handle = await this.currentHandle();
    if (typeof handle?.history?.before !== 'function') throw new ShiyiError('history.before is unavailable', 'CAPABILITY_UNAVAILABLE');
    return handle.history.before(page, options);
  }

  async searchMessages(query) {
    const handle = await this.currentHandle();
    if (typeof handle?.searchMessages !== 'function') throw new ShiyiError('searchMessages is unavailable', 'CAPABILITY_UNAVAILABLE');
    return handle.searchMessages(query);
  }

  async getStore({ scope = 'chat' } = {}) {
    const handle = scope === 'chat' ? await this.currentHandle() : null;
    const candidate = handle?.store ?? this.tauri?.api?.extension?.store;
    const store = asStore(candidate);
    if (!store) throw new ShiyiError('TT extension/chat store is unavailable', 'CAPABILITY_UNAVAILABLE');
    return store;
  }

  async getMetadata() {
    const handle = await this.currentHandle();
    if (typeof handle?.metadata?.get === 'function') return handle.metadata.get();
    return clone(this._context()?.chatMetadata ?? null);
  }

  async setExtensionMetadata(namespace, value) {
    if (!namespace || typeof namespace !== 'string') throw new ShiyiError('metadata namespace is required', 'STORE_ARGUMENT');
    const handle = await this.currentHandle();
    if (typeof handle?.metadata?.setExtension === 'function') return handle.metadata.setExtension({ namespace, value });
    const context = this._context();
    if (typeof context?.updateChatMetadata === 'function') {
      const metadata = context.chatMetadata ?? (context.chatMetadata = {});
      metadata.extensions ??= {};
      metadata.extensions[namespace] = clone(value);
      if (typeof context.saveMetadata === 'function') await context.saveMetadata();
      return;
    }
    throw new ShiyiError('metadata write is unavailable', 'CAPABILITY_UNAVAILABLE');
  }

  async saveMetadata() {
    const context = this._context();
    if (typeof context?.saveMetadata === 'function') return context.saveMetadata();
    throw new ShiyiError('saveMetadata is unavailable', 'CAPABILITY_UNAVAILABLE');
  }

  async setExtensionPrompt(...args) {
    const context = this._context();
    if (typeof context?.setExtensionPrompt === 'function') return context.setExtensionPrompt(...args);
    throw new ShiyiError('setExtensionPrompt is unavailable', 'CAPABILITY_UNAVAILABLE');
  }

  async getTokenCountAsync(...args) {
    const context = this._context();
    if (typeof context?.getTokenCountAsync === 'function') return context.getTokenCountAsync(...args);
    throw new ShiyiError('getTokenCountAsync is unavailable', 'CAPABILITY_UNAVAILABLE');
  }

  /**
   * Run a read-only capability probe. Only an explicitly selected synthetic or
   * sandbox namespace permits a write/readback check.
   */
  async probe({ mode = 'static', namespace = null, key = 'probe', writeReadback = true } = {}) {
    const normalizedMode = String(mode).toLowerCase();
    const report = { capabilities: clone(this.capabilities) };
    report.mode = normalizedMode;
    report.generatedAt = new Date().toISOString();
    report.probeId = makeId('probe');
    report.warnings = [];
    const writable = ['synthetic', 'sandbox'].includes(normalizedMode)
      && typeof namespace === 'string'
      && namespace.trim()
      && namespace !== 'shiyi-memory';
    if (normalizedMode === 'live' || normalizedMode === 'real-tt') {
      report.warnings.push('live TT was not executed by static adapter; no live_tt_passed is inferred');
    }
    if (writeReadback && !writable) {
      report.writeReadback = { attempted: false, status: 'not_authorized', reason: 'explicit synthetic/sandbox namespace is required' };
      return report;
    }
    if (!writeReadback) {
      report.writeReadback = { attempted: false, status: 'disabled' };
      return report;
    }
    const store = await this.getStore({ scope: 'extension' });
    const value = { probeId: report.probeId, mode: normalizedMode, synthetic: true };
    await store.setJson({ namespace: namespace.trim(), key, value });
    const result = typeof store.tryGetJson === 'function'
      ? await store.tryGetJson({ namespace: namespace.trim(), key })
      : { found: true, value: await store.getJson({ namespace: namespace.trim(), key }) };
    const passed = result?.found === true && stableStringify(result.value) === stableStringify(value);
    let cleanup = 'unavailable';
    if (typeof store.deleteJson === 'function') {
      try { await store.deleteJson({ namespace: namespace.trim(), key }); cleanup = 'passed'; }
      catch (error) { cleanup = 'failed'; report.warnings.push(`probe cleanup failed: ${error.message}`); }
    }
    report.writeReadback = { attempted: true, status: passed ? 'passed' : 'failed', namespace: namespace.trim(), key, cleanup };
    report.capabilities = capabilityReport(this.root, { mockPassed: passed ? ['extensionStore'] : [] });
    this.capabilities = report.capabilities;
    return report;
  }

  /** Explicit operator evidence is required before any live status is shown. */
  recordLiveProof(evidence) {
    if (!isPlainObject(evidence) || evidence.verified !== true || !['real-tt', 'target-mobile'].includes(evidence.source)
      || !Array.isArray(evidence.capabilities) || evidence.capabilities.length === 0) {
      throw new ShiyiError('live status requires explicit verified real-tt or target-mobile evidence', 'LIVE_PROOF_REQUIRED');
    }
    this._liveEvidence = clone(evidence);
    this.capabilities = capabilityReport(this.root, { liveTtPassed: evidence.source === 'real-tt' ? evidence.capabilities : [] });
    if (evidence.source === 'target-mobile') this.capabilities.targetMobile = statusFor(true, { liveTtPassed: true });
    return this.getCapabilities();
  }

  getCapabilities() {
    return { ...clone(this.capabilities), liveEvidence: clone(this._liveEvidence) };
  }
}

export function createMockHost({ messages = [], store = new InMemoryHostStore(), context = {} } = {}) {
  const eventTypes = {
    MESSAGE_SENT: 'message_sent',
    MESSAGE_RECEIVED: 'message_received',
    MESSAGE_EDITED: 'message_edited',
  };
  const handle = {
    async stableId() { return 'synthetic-chat-integrity'; },
    history: {
      async tail({ limit = 100 } = {}) {
        const startIndex = Math.max(0, messages.length - limit);
        return { messages: clone(messages.slice(startIndex)), startIndex, hasMoreBefore: startIndex > 0 };
      },
      async before(page, { limit = 100 } = {}) {
        const end = page.startIndex;
        const start = Math.max(0, end - limit);
        return { messages: clone(messages.slice(start, end)), startIndex: start, hasMoreBefore: start > 0 };
      },
    },
    async searchMessages({ query, limit = 20 } = {}) {
      const q = String(query ?? '').toLocaleLowerCase();
      return messages.map((message, index) => ({ message, index, score: String(message.mes ?? message.text ?? '').toLocaleLowerCase().includes(q) ? 1 : 0 }))
        .filter((hit) => hit.score > 0).slice(0, limit).map(({ message, index, score }) => ({
          index,
          score,
          role: message.role,
          text: message.mes ?? message.text ?? '',
          snippet: message.mes ?? message.text ?? '',
        }));
    },
    store,
    metadata: {
      async get() { return clone(context.chatMetadata ?? {}); },
      async setExtension({ namespace, value }) {
        context.chatMetadata ??= {};
        context.chatMetadata.extensions ??= {};
        context.chatMetadata.extensions[namespace] = clone(value);
      },
    },
  };
  return {
    __TAURITAVERN__: {
      api: {
        chat: {
          open: () => handle,
          current: { ref: () => ({ kind: 'character', characterId: 'synthetic', fileName: 'synthetic.jsonl' }), handle: () => handle },
        },
        extension: { store },
      },
    },
    getContext: () => ({ ...context, eventTypes, event_types: eventTypes, chat: messages, saveMetadata: async () => {} }),
  };
}

export async function runHostProbe(host, options = {}) {
  return new HostAdapter(host).probe(options);
}
