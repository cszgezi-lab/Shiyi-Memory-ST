import { LocalBM25Index } from './retrieval.js';
import { abortError, stableStringify, throwIfAborted, yieldLocalWork } from './utils.js';

const now = () => globalThis.performance?.now?.() ?? Date.now();
const yieldToHost = yieldLocalWork;

/** One instance per application, never shared across users or chats.
 * Callers supply an immutable snapshot revision and reject in-flight results
 * when that revision changes. Indexes are disposable projections, not facts.
 */
export class RecallIndexCache {
  constructor() { this.generation = 0; this.clear(); }
  clear() {
    this.generation++;
    this.index = null;
    this.key = null;
    this.scope = null;
    this.signatures = new Map();
    this.pending = null;
  }

  async prepare(records, { scopeKey, revision, k1 = 1.2, b = 0.75, signal } = {}) {
    throwIfAborted(signal);
    if (typeof scopeKey !== 'string' || !scopeKey || revision === undefined) throw new Error('recall cache requires scope and snapshot revision');
    const scope = stableStringify({ scopeKey, k1, b });
    const key = stableStringify({ scope, revision });
    if (this.key === key && this.index) return { index: this.index, stats: { status: 'reused', size: this.index.documents.size, added: 0, reindexed: 0, metadata: 0, removed: 0 } };
    if (this.pending?.key === key && !this.pending.signal?.aborted) return this.pending.promise;
    const generation = ++this.generation;
    const reuse = this.scope === scope && this.index;
    const index = reuse || new LocalBM25Index([], { k1, b });
    const signatures = reuse ? this.signatures : new Map();
    // While preparing, no caller can obtain a partially-updated index.
    this.index = null; this.key = null;
    const check = () => {
      throwIfAborted(signal);
      if (generation !== this.generation) throw abortError('recall snapshot changed');
    };
    const promise = Promise.resolve().then(async () => {
      const stats = { status: reuse ? 'updated' : 'built', added: 0, reindexed: 0, metadata: 0, removed: 0 };
      const seen = new Set();
      let yieldAt = now();
      for (const record of records) {
        check();
        const id = record?.id;
        if (typeof id !== 'string' || !id || seen.has(id)) throw new Error('recall snapshot contains missing or duplicate IDs');
        seen.add(id);
        const signature = stableStringify(record);
        if (signature !== signatures.get(id)) {
          stats[index.upsert(record)]++;
          signatures.set(id, signature);
        }
        if (now() - yieldAt >= 8) { await yieldToHost(); check(); yieldAt = now(); }
      }
      for (const id of signatures.keys()) {
        if (!seen.has(id)) { index.remove(id); signatures.delete(id); stats.removed++; }
        if (now() - yieldAt >= 8) { await yieldToHost(); check(); yieldAt = now(); }
      }
      check();
      this.index = index; this.key = key; this.scope = scope; this.signatures = signatures;
      return { index, stats: { ...stats, size: index.documents.size } };
    });
    this.pending = { key, promise, signal };
    try { return await promise; }
    finally { if (this.pending?.promise === promise) this.pending = null; }
  }
}
