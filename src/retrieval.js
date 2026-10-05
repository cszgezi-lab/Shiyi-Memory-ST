import { ShiyiError } from './errors.js';
import { sourceRecallExcerpt, sourceQuote, sourceEvidenceQuery } from './source-recall-evidence.js';
import { abortError, clone, estimateUnits, normalizeText, stableStringify, throwIfAborted } from './utils.js';

const CJK_RE = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/u;
const WORD_RE = /[\p{L}\p{N}_-]+/gu;

export function tokenizeChinese(value) {
  const text = normalizeText(value).toLocaleLowerCase();
  const tokens = [];
  const words = text.match(WORD_RE) ?? [];
  for (const word of words) {
    if ([...word].some((ch) => CJK_RE.test(ch))) {
      // Keep numbers/Latin identifiers atomic inside Chinese prose: floor 50
      // is not floor 500. CJK n-grams still handle unknown names without a
      // heavyweight segmenter or a model request.
      for(const part of word.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]+|[^\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]+/gu)??[]){
        if(!CJK_RE.test(part)){tokens.push(part);continue;}
        const chars = [...part];
        for (const ch of chars) tokens.push(ch);
        for (let i = 0; i < chars.length - 1; i += 1) tokens.push(chars.slice(i, i + 2).join(''));
        for (let i = 0; i < chars.length - 2; i += 1) tokens.push(chars.slice(i, i + 3).join(''));
      }
    } else {
      tokens.push(word);
    }
  }
  return tokens;
}

function textOf(record) {
  if (!record) return '';
  if (typeof record.searchText === 'string') return record.searchText;
  const values = [record.text, record.content, record.description, record.action, record.summary, record.event?.text, record.event?.content, record.event?.description, record.event?.action];
  return values.filter((value) => value !== undefined && value !== null).join(' ');
}

const localTextOf = record => typeof record?.localSearchText === 'string' ? record.localSearchText : textOf(record);

function entitiesOf(record) {
  const entities = record?.entities ?? record?.event?.entities ?? record?.entityRefs ?? [];
  return Array.isArray(entities) ? entities.map((entity) => typeof entity === 'string' ? entity : entity?.name ?? entity?.id).filter(Boolean).map((value) => normalizeText(value).toLocaleLowerCase()) : [];
}

function candidateId(record, index) {
  return record?.id ?? record?.event?.id ?? `candidate-${index}`;
}

/** Dependency-free local BM25 with CJK unigrams/bigrams/trigrams and exact entities. */
export class LocalBM25Index {
  constructor(records = [], { k1 = 1.2, b = 0.75 } = {}) {
    this.k1 = k1;
    this.b = b;
    this.documents = new Map();
    this.docFrequency = new Map();
    this.postings = new Map();
    this.entityPostings = new Map();
    this.totalLength = 0;
    this._nextIndex = 0;
    for (const record of records) this.add(record);
  }

  add(record) {
    const id = candidateId(record, this._nextIndex++);
    if (this.documents.has(id)) this.remove(id);
    const tokens = tokenizeChinese(localTextOf(record));
    const frequencies = new Map();
    for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    for (const token of frequencies.keys()) {
      this.docFrequency.set(token, (this.docFrequency.get(token) ?? 0) + 1);
      if (!this.postings.has(token)) this.postings.set(token, new Set());
      this.postings.get(token).add(id);
    }
    const document = { id, record: clone(record), tokens, frequencies, entities: entitiesOf(record), length: tokens.length };
    for (const entity of document.entities) {
      if (!this.entityPostings.has(entity)) this.entityPostings.set(entity, new Set());
      this.entityPostings.get(entity).add(id);
    }
    this.documents.set(id, document);
    this.totalLength += tokens.length;
    return id;
  }

  remove(id) {
    const document = this.documents.get(id);
    if (!document) return false;
    for (const token of document.frequencies.keys()) {
      const count = (this.docFrequency.get(token) ?? 1) - 1;
      if (count > 0) this.docFrequency.set(token, count); else this.docFrequency.delete(token);
      this.postings.get(token)?.delete(id);
      if (!this.postings.get(token)?.size) this.postings.delete(token);
    }
    for (const entity of document.entities) {
      this.entityPostings.get(entity)?.delete(id);
      if (!this.entityPostings.get(entity)?.size) this.entityPostings.delete(entity);
    }
    this.totalLength -= document.length;
    this.documents.delete(id);
    return true;
  }

  get(id) {
    const document = this.documents.get(id);
    return document ? clone(document.record) : null;
  }

  /** Metadata-only changes must refresh knowledge/time without re-tokenizing. */
  upsert(record) {
    const id = candidateId(record, this._nextIndex);
    const previous = this.documents.get(id);
    if (!previous || localTextOf(previous.record) !== localTextOf(record)) {
      this.add(record);
      return previous ? 'reindexed' : 'added';
    }
    for (const entity of previous.entities) {
      this.entityPostings.get(entity)?.delete(id);
      if (!this.entityPostings.get(entity)?.size) this.entityPostings.delete(entity);
    }
    previous.record = clone(record);
    previous.entities = entitiesOf(record);
    for (const entity of previous.entities) {
      if (!this.entityPostings.has(entity)) this.entityPostings.set(entity, new Set());
      this.entityPostings.get(entity).add(id);
    }
    return 'metadata';
  }

  search(query, { limit = 20, entityIds = [], filter = null } = {}) {
    const queryText = normalizeText(query);
    const queryTokens = tokenizeChinese(queryText);
    const uniqueQueryTokens = [...new Set(queryTokens)];
    const wantedEntities = new Set((Array.isArray(entityIds) ? entityIds : []).map((value) => normalizeText(value).toLocaleLowerCase()));
    const documentCount = this.documents.size || 1;
    const averageLength = this.totalLength / documentCount || 1;
    const candidates = [];
    const matching = new Set();
    for (const token of uniqueQueryTokens) for (const id of this.postings.get(token) ?? []) matching.add(id);
    for (const entity of wantedEntities) for (const id of this.entityPostings.get(entity) ?? []) matching.add(id);
    for (const id of matching) {
      const document = this.documents.get(id);
      if (typeof filter === 'function' && !filter(document.record)) continue;
      let score = 0;
      const termMatches = [];
      for (const token of uniqueQueryTokens) {
        const tf = document.frequencies.get(token) ?? 0;
        if (!tf) continue;
        const df = this.docFrequency.get(token) ?? 0;
        const idf = Math.log(1 + ((documentCount - df + 0.5) / (df + 0.5)));
        const denominator = tf + this.k1 * (1 - this.b + this.b * (document.length / averageLength));
        score += idf * ((tf * (this.k1 + 1)) / denominator);
        termMatches.push(token);
      }
      const exactEntities = [...wantedEntities].filter((entity) => document.entities.includes(entity));
      if (exactEntities.length) score += exactEntities.length * 3;
      if (score <= 0) continue;
      candidates.push({
        id: document.id,
        score,
        record: document.record,
        channels: [exactEntities.length ? 'entity_exact' : null, termMatches.length ? 'bm25_cjk' : null].filter(Boolean),
        termMatches,
        exactEntities,
      });
    }
    candidates.sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));
    // Only copy returned records, not the entire matching corpus.
    return candidates.slice(0, Math.max(0, limit)).map(candidate => ({ ...candidate, record: clone(candidate.record) }));
  }
}

const DEFAULT_VECTOR_TIMEOUT_MS = 4000;
const DEFAULT_RERANK_TIMEOUT_MS = 4000;
const monotonicNow = () => globalThis.performance?.now?.() ?? Date.now();

async function invokeWithDeadline(fn, args, {
  signal,
  timeoutMs,
  label,
} = {}) {
  throwIfAborted(signal);
  const controller = new AbortController();
  const relayAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) relayAbort();
  else signal?.addEventListener('abort', relayAbort, { once: true });
  let timer = null;
  let timedOut = false;
  let rejectTimeout;
  let rejectAbort;
  const deadline = new Promise((_, reject) => { rejectTimeout = reject; });
  const canceled = new Promise((_, reject) => { rejectAbort = reject; });
  const onExternalAbort = () => rejectAbort(abortError(signal?.reason ? String(signal.reason) : undefined));
  if (signal?.aborted) onExternalAbort();
  else signal?.addEventListener('abort', onExternalAbort, { once: true });
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timer = setTimeout(() => {
      timedOut = true;
      const error = new ShiyiError(`${label} timed out`, 'TIMEOUT', {reason:'timeout',stage:'request',timeoutMs});
      controller.abort(error);
      rejectTimeout(error);
    }, timeoutMs);
  }
  const operation = Promise.resolve().then(() => fn({ ...args, signal: controller.signal }));
  // An adapter is allowed to ignore abort.  Attach a rejection handler so a
  // late failure after the timeout cannot become an unhandled rejection or
  // mutate the next query's result.
  operation.catch(() => {});
  try {
    const races = [operation, canceled];
    if (timer) races.push(deadline);
    const result = await Promise.race(races);
    throwIfAborted(signal);
    return result;
  } catch (error) {
    if (signal?.aborted) throw abortError(signal.reason ? String(signal.reason) : undefined);
    if (timedOut || error?.code === 'TIMEOUT') {
      const timeoutError = new ShiyiError(`${label} timed out`, 'TIMEOUT', {reason:'timeout',stage:'request',timeoutMs});
      throw timeoutError;
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener('abort', relayAbort);
    signal?.removeEventListener('abort', onExternalAbort);
  }
}

function expectedVectorSpace(vectorAdapter, options) {
  return options.embeddingSpace ?? options.spaceId ?? vectorAdapter?.embeddingSpace ?? vectorAdapter?.spaceId ?? null;
}

function expectedVectorConfig(vectorAdapter, options) {
  return options.embeddingConfigFingerprint ?? options.configFingerprint ?? vectorAdapter?.embeddingConfigFingerprint ?? vectorAdapter?.configFingerprint ?? null;
}

function vectorDimension(vectorAdapter, options) {
  return options.embeddingDimension ?? options.dimension ?? vectorAdapter?.embeddingDimension ?? vectorAdapter?.dimension ?? null;
}

function validateVectorMetadata(result, vectorAdapter, options) {
  const expectedSpace = expectedVectorSpace(vectorAdapter, options);
  const expectedConfig = expectedVectorConfig(vectorAdapter, options);
  const expectedDimension = vectorDimension(vectorAdapter, options);
  const adapterSpace = vectorAdapter?.embeddingSpace ?? vectorAdapter?.spaceId ?? vectorAdapter?.spaceFingerprint;
  const adapterConfig = vectorAdapter?.embeddingConfigFingerprint ?? vectorAdapter?.configFingerprint;
  const adapterDimension = vectorAdapter?.embeddingDimension ?? vectorAdapter?.dimension;
  const actualSpace = result?.embeddingSpace ?? result?.spaceId ?? result?.metadata?.embeddingSpace ?? result?.metadata?.spaceId ?? adapterSpace;
  const actualConfig = result?.embeddingConfigFingerprint ?? result?.configFingerprint ?? result?.metadata?.embeddingConfigFingerprint ?? result?.metadata?.configFingerprint ?? adapterConfig;
  const actualDimension = result?.dimension ?? result?.metadata?.dimension ?? adapterDimension;
  if (expectedSpace && !actualSpace) return 'embedding space metadata is missing';
  if (expectedConfig && !actualConfig) return 'embedding config metadata is missing';
  if (expectedDimension && !actualDimension && !(Array.isArray(result?.vector))) return 'embedding dimension metadata is missing';
  if (expectedSpace && actualSpace && String(expectedSpace) !== String(actualSpace)) return 'embedding space fingerprint mismatch';
  if (expectedConfig && actualConfig && String(expectedConfig) !== String(actualConfig)) return 'embedding config fingerprint mismatch';
  if (expectedDimension && actualDimension && Number(expectedDimension) !== Number(actualDimension)) return 'embedding dimension mismatch';
  if (result?.vector && expectedDimension && Array.isArray(result.vector) && result.vector.length !== Number(expectedDimension)) return 'embedding dimension mismatch';
  return null;
}

async function invokeReranker(reranker, query, candidates, options, signal) {
  if (!reranker) return { candidates, status: 'disabled', attempted: false };
  if (candidates.length === 0) return { candidates, status: 'skipped', attempted: false, reason: 'no_candidates' };
  const fn = typeof reranker === 'function' ? reranker : reranker.rerank;
  if (typeof fn !== 'function') return { candidates, status: 'disabled', attempted: false, reason: 'no_rerank_function' };
  const maxCandidates = Math.max(1, Math.min(options.maxCandidates ?? candidates.length, candidates.length));
  const selected = candidates.slice(0, maxCandidates).map(candidate => {
    const people = [...(options.sourcePersonNames ?? []), ...(candidate.record.participants ?? []), ...(candidate.record.entities ?? []).filter(e => e.kind === '人物').flatMap(e => [e.name, ...(e.aliases ?? [])])];
    const queryTokens = tokenizeChinese(sourceEvidenceQuery(query, people));
    const excerpt = sourceRecallExcerpt(candidate.record, queryTokens);
    return { id: candidate.id, score: candidate.score, text: [textOf(candidate.record), excerpt ? sourceQuote(candidate.record, excerpt) : ''].filter(Boolean).join('\n') };
  });
  try {
    const raw = await invokeWithDeadline(fn, { query, candidates: selected }, {
      signal,
      timeoutMs: options.timeoutMs ?? options.deadlineMs ?? DEFAULT_RERANK_TIMEOUT_MS,
      label: 'rerank',
    });
    const items = Array.isArray(raw) ? raw : raw?.items;
    if (!Array.isArray(items) || items.length === 0) return { candidates, status: 'fallback', attempted: true, reason: 'invalid_response' };
    const ids = new Set(selected.map((candidate) => String(candidate.id)));
    const seen = new Set();
    const ranks = [];
    for (const item of items) {
      // A reranker may only reorder IDs already supplied by the caller. Index
      // output is rejected because filtering can make an index point at a
      // different fact after the model responds.
      const id = item?.id ?? item?.candidateId;
      const score = Number(item?.score);
      if (id === undefined || !ids.has(String(id)) || seen.has(String(id)) || !Number.isFinite(score) || score < -1e6 || score > 1e6) {
        return { candidates, status: 'fallback', attempted: true, reason: 'unknown_duplicate_or_invalid_score' };
      }
      seen.add(String(id));
      ranks.push({ id: String(id), score });
    }
    if (ranks.length !== selected.length) return { candidates, status: 'fallback', attempted: true, reason: 'truncated_response' };
    const rankById = new Map(ranks.map((rank) => [rank.id, rank.score]));
    const reordered = [...candidates].sort((a, b) => {
      const as = rankById.has(String(a.id)) ? rankById.get(String(a.id)) : Number.NEGATIVE_INFINITY;
      const bs = rankById.has(String(b.id)) ? rankById.get(String(b.id)) : Number.NEGATIVE_INFINITY;
      return bs - as || b.score - a.score;
    });
    return { candidates: reordered, status: 'passed', attempted: true, scores: ranks };
  } catch (error) {
    return { candidates, status: 'fallback', attempted: true, reason: error?.code === 'TIMEOUT' ? 'timeout' : error?.code==='RECALL_LANE_COOLDOWN'?'cooldown':error.message };
  }
}

function recordEventIds(event, records) {
  const ids = new Set([event?.id].filter(Boolean));
  for (const [from, to] of Object.entries(records?.idAliases ?? {})) if (to === event?.id) ids.add(from);
  return ids;
}

function referencesEvent(record, ids) {
  if (!record) return false;
  const refs = [record.eventRef, record.eventId, record.sourceEventId, ...(record.eventRefs ?? []), ...(record.eventIds ?? [])].filter(Boolean);
  return refs.some((ref) => ids.has(ref));
}

function mergeLifecycleDependencies(event, committed) {
  const merged = new Map();
  const add = (value, authoritative = false) => {
    if (!Array.isArray(value)) return;
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      const key = item.id ? `id:${item.id}` : `digest:${stableStringify(item)}`;
      // A committed change is the authoritative current projection for the
      // same dependency ID; embedded event payloads remain useful only when
      // no later record addresses that dependency.
      if (authoritative || !merged.has(key)) merged.set(key, clone(item));
    }
  };
  add(event?.followUps);
  add(event?.lifecycleDependencies);
  add(committed, true);
  return [...merged.values()];
}

function hydrateCandidate(candidate, records) {
  const events = Array.isArray(records?.events) ? records.events : [];
  const aliases = records?.idAliases ?? {};
  const candidateId = String(candidate?.id ?? candidate?.record?.id ?? '');
  const aliasedId = aliases[candidateId] ?? candidateId;
  let event = events.find((record) => String(record?.id) === String(aliasedId) || String(record?.id) === candidateId);
  if (!event && candidate?.record) {
    const identity = candidate.record.identityKey ?? candidate.record.eventIdentity;
    if (identity) event = events.find((record) => record.identityKey === identity || record.eventIdentity === identity);
  }
  if (!event) return { candidate, status: 'missing_authoritative_record', reason: 'record_id_not_in_committed_snapshot' };
  if (event.lifecycleState === 'retracted' || event.lifecycle === 'retracted' || event.retracted === true) {
    return { candidate, status: 'retracted', reason: 'event_retracted_in_current_view' };
  }
  const eventIds = recordEventIds(event, records);
  const awareness = (records.awarenessChanges ?? []).filter((record) => referencesEvent(record, eventIds));
  const commitments = (records.commitmentChanges ?? []).filter((record) => referencesEvent(record, eventIds));
  const lifecycleDependencies = mergeLifecycleDependencies(event, commitments);
  const pendingFollowUps = lifecycleDependencies.filter((record) => !['completed', 'resolved', 'retracted', 'superseded', 'declined', 'canceled'].includes(String(record.state ?? record.status ?? record.lifecycleState ?? '').toLocaleLowerCase()));
  const indexed = clone(candidate.record ?? {});
  const hydrated = {
    ...clone(candidate),
    record: {
      ...indexed,
      ...clone(event),
      awareness,
      awarenessChanges: awareness,
      temporal: clone(event.temporal ?? event.storyTime ?? event.time ?? { kind: 'unknown' }),
      followUps: lifecycleDependencies,
      lifecycleDependencies,
      pendingFollowUps,
      metadataRevision: records?.committedRevision ?? null,
      metadataSource: 'committed-snapshot',
    },
  };
  return { candidate: hydrated, status: 'hydrated' };
}

async function hydrateCandidates(candidates, repository, scope, trace) {
  if (!repository) return candidates;
  if (!scope) {
    trace.metadata = { status: 'fallback', reason: 'scope_required_for_authoritative_metadata' };
    trace.fallbacks.push({ channel: 'metadata', reason: 'scope_required_for_authoritative_metadata' });
    return [];
  }
  let snapshot;
  try {
    snapshot = typeof repository.readScope === 'function'
      ? await repository.readScope(scope)
      : { records: await repository.listRecords(scope), committedRevision: null };
  } catch (error) {
    trace.fallbacks.push({ channel: 'metadata', reason: error?.message ?? 'committed snapshot unavailable' });
    trace.metadata = { status: 'fallback', reason: error?.message ?? 'committed snapshot unavailable' };
    return [];
  }
  const records = snapshot?.records ?? snapshot ?? {};
  const hydrated = [];
  const omissions = [];
  for (const candidate of candidates) {
    const result = hydrateCandidate(candidate, records);
    if (result.status === 'hydrated') hydrated.push(result.candidate);
    else omissions.push({ id: candidate?.id, reason: result.reason });
  }
  trace.metadata = { status: 'passed', committedRevision: snapshot?.committedRevision ?? records?.committedRevision ?? null, hydrated: hydrated.length, omitted: omissions };
  trace.omittedMetadata = omissions;
  return hydrated;
}

const compareCandidates = (a, b) => b.score - a.score || (b.localScore ?? 0) - (a.localScore ?? 0) || String(a.id).localeCompare(String(b.id));

function reserveCategoryPool(candidates, lanes, categories, capacity) {
  const reserved = [];
  for (const lane of [...lanes, ...categories]) {
    const hit = candidates.find(c => (lane.tag ? c.record?.tags?.includes(lane.tag) : c.record?.category === lane.category) && !reserved.some(r => r.id === c.id));
    if (hit && reserved.length < Math.floor(capacity / 2)) reserved.push(hit);
  }
  const ids = new Set(reserved.map(c => c.id));
  const baseline = candidates.filter(c => !ids.has(c.id)).slice(0, capacity - reserved.length);
  const pool = [...baseline, ...reserved].sort(compareCandidates), pooled = new Set(pool.map(c => c.id));
  return { candidates: [...pool, ...candidates.filter(c => !pooled.has(c.id))], reserved };
}

/**
 * Local retrieval is always the baseline. Optional vector and rerank adapters
 * can add ordering information but never become a source of facts.
 */
export async function retrieveMemories({
  index,
  query,
  limit = 20,
  entityIds = [],
  tagLanes = [],
  categoryLanes = [],
  focus = null,
  filter,
  vectorAdapter = null,
  reranker = null,
  rerankOptions = {},
  vectorOptions = {},
  vectorTimeoutMs,
  totalTimeoutMs,
  repository = null,
  scope = null,
  signal,
} = {}) {
  if (!index || typeof index.search !== 'function') throw new ShiyiError('a local BM25 index is required', 'RETRIEVAL_INDEX_REQUIRED');
  throwIfAborted(signal);
  const startedAt = monotonicNow();
  const keywordFilter=r=>r.keywordEnabled!==false&&(!filter||filter(r));
  const local = index.search(query, { limit: Math.max(limit, rerankOptions.maxCandidates ?? limit), entityIds, filter:keywordFilter });
  const lanes=tagLanes.slice(0,4).filter(l=>typeof l.tag==='string'&&l.tag.length>=2&&Number.isSafeInteger(l.limit)&&l.limit>0).map(l=>({...l,limit:Math.min(l.limit,20)}));
  const tagged=lanes.map(lane=>({...lane,candidates:index.search(query,{limit:lane.limit,entityIds,filter:r=>keywordFilter(r)&&Array.isArray(r.tags)&&r.tags.includes(lane.tag)})}));
  const categories=categoryLanes.slice(0,12).filter(l=>typeof l.category==='string'&&Number.isSafeInteger(l.limit)&&l.limit>0).map(l=>({...l,limit:Math.min(l.limit,20)}));
  const classified=categories.map(lane=>({...lane,candidates:index.search(query,{limit:lane.limit,entityIds,filter:r=>keywordFilter(r)&&r.category===lane.category})}));
  const capacity = Math.max(1, Math.min(rerankOptions.maxCandidates ?? limit, limit));
  const maxFocusCapacity = Math.floor(capacity / 2);
  const distinctFocus = maxFocusCapacity > 0 && typeof focus?.query === 'string' && focus.query.trim() && normalizeText(focus.query) !== normalizeText(query);
  // A long auxiliary scene must not decide all candidates for a short current
  // question. Reuse the same index and filters; reserve at most half of the
  // existing pool, leaving the other half available for contextual references.
  // Corpus frequency keeps ubiquitous pronouns from reserving unrelated rows.
  const specificTerm = term => [...term].length >= 2 && (index.docFrequency?.get(term) ?? Infinity) <= Math.max(2, (index.documents?.size ?? 0) / 5);
  const focusSpecific = candidate => candidate.exactEntities?.length || (candidate.termMatches ?? []).some(specificTerm);
  const focusLocal = distinctFocus ? index.search(focus.query, { limit: Math.max(limit, rerankOptions.maxCandidates ?? limit), entityIds: focus.entityIds ?? [], filter: keywordFilter }).filter(focusSpecific) : [];
  // A rare two-character reference can still be a pronoun. One short match
  // may keep one candidate, but cannot claim half the pool on rarity alone.
  const matchedPositions = new Set(), focusText = normalizeText(focus?.query).toLocaleLowerCase();
  for (const term of new Set(focusLocal.flatMap(c => c.termMatches ?? []).filter(specificTerm))) {
    const at = focusText.indexOf(term);
    if (at >= 0) for (let i = at; i < at + term.length; i++) matchedPositions.add(i);
  }
  const focusCapacity = focusLocal.some(c => c.exactEntities?.length) || matchedPositions.size >= 4 ? maxFocusCapacity : Math.min(1, maxFocusCapacity);
  const focusCategories = focusLocal.length ? categories.map(lane => ({...lane, candidates: index.search(focus.query, {limit: lane.limit, entityIds: focus.entityIds ?? [], filter: r => keywordFilter(r) && r.category === lane.category}).filter(focusSpecific)})) : [];
  const focusById = new Map(focusLocal.map(c => [String(c.id), c]));
  for (const lane of focusCategories) for (const candidate of lane.candidates) if (!focusById.has(String(candidate.id))) focusById.set(String(candidate.id), candidate);
  const focusRanks = new Map(focusLocal.map((c, i) => [String(c.id), i + 1]));
  const rankConstant = Number.isFinite(vectorOptions.rankConstant) ? Math.max(1, Number(vectorOptions.rankConstant)) : 60;
  const focused = reserveCategoryPool([...focusById.values()].map(candidate => {
    const rank = focusRanks.get(String(candidate.id));
    const categoryRank = focusCategories.reduce((best, lane) => {const i = lane.candidates.findIndex(c => c.id === candidate.id); return i < 0 ? best : Math.min(best, i + 1);}, Infinity);
    return {...candidate, localScore: candidate.score, score: (rank ? 1 / (rankConstant + rank) : 0) + (Number.isFinite(categoryRank) ? .25 / (rankConstant + categoryRank) : 0)};
  }).sort(compareCandidates), [], focusCategories, focusCapacity).candidates.slice(0, focusCapacity);
  const onlineStartedAt = monotonicNow();
  const finiteTimeout = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;
  const vectorDeadline = finiteTimeout(vectorTimeoutMs ?? vectorOptions.timeoutMs ?? vectorOptions.deadlineMs ?? vectorAdapter?.timeoutMs, DEFAULT_VECTOR_TIMEOUT_MS);
  const rerankDeadline = finiteTimeout(rerankOptions.timeoutMs ?? rerankOptions.deadlineMs, DEFAULT_RERANK_TIMEOUT_MS);
  // No mandatory three-second quality cutoff. An explicit total protection
  // is optional; otherwise retain the configured allowance of both stages.
  const explicitTotal = Number.isFinite(totalTimeoutMs) && totalTimeoutMs > 0;
  const onlineBudget = explicitTotal ? totalTimeoutMs : (vectorAdapter ? vectorDeadline : 0) + (reranker ? rerankDeadline : 0);
  const remaining = () => explicitTotal ? Math.max(0, onlineBudget - (monotonicNow() - onlineStartedAt)) : Infinity;
  const stageTimeout = (requested, fallback) => Math.min(Number.isFinite(requested) && requested > 0 ? requested : fallback, remaining());
  const byId = new Map(local.map((candidate) => [String(candidate.id), candidate]));
  for(const lane of tagged)for(const item of lane.candidates){const candidate=byId.get(String(item.id))??item;candidate.channels=[...new Set([...candidate.channels,'tag_local'])];byId.set(String(item.id),candidate);}
  for(const lane of classified)for(const item of lane.candidates){const candidate=byId.get(String(item.id))??item;candidate.channels=[...new Set([...candidate.channels,'category_local'])];byId.set(String(item.id),candidate);}
  for (const item of focused) {
    const candidate = byId.get(String(item.id)) ?? {...item, score: item.localScore};
    candidate.channels = [...new Set([...candidate.channels, 'focus_local'])];
    byId.set(String(item.id), candidate);
  }
  const trace = {
    query: String(query ?? ''),
    local: { status: 'passed', count: local.length, channel: 'bm25_cjk+entity_exact' },
    tags: {status:lanes.length?'active':'not_triggered',lanes:tagged.map(l=>({tag:l.tag,limit:l.limit,local:l.candidates.length}))},
    categories: {status:categories.length?'active':'disabled',lanes:classified.map(l=>({category:l.category,limit:l.limit,local:l.candidates.length}))},
    focus: {status: distinctFocus ? focused.length ? 'active' : 'no_specific_match' : 'not_needed', count: focusLocal.length, reserved: focused.length, capacity: focusCapacity, ids: focused.map(c => c.id)},
    vector: { status: vectorAdapter ? 'pending' : 'disabled' },
    rerank: { status: reranker ? 'pending' : 'disabled', calls: 0 },
    fusion: { algorithm: 'weighted_rrf', rankConstant: 60, weights: { local: 1, vector: 1 } },
    fallbacks: [],
    timings: { localMs: onlineStartedAt - startedAt, vectorMs: 0, rerankMs: 0 },
    deadline: { totalTimeoutMs: explicitTotal ? onlineBudget : 0, nominalAllowanceMs: onlineBudget, scope: explicitTotal ? 'online_stages_shared' : 'per_api', mode: explicitTotal ? 'explicit_total' : 'per_api_allowance' },
  };
  const localRanks = new Map(local.map((candidate, index) => [String(candidate.id), index + 1]));
  const vectorRanks = new Map();
  if (vectorAdapter) {
    const stageStarted = monotonicNow();
    try {
      const search = typeof vectorAdapter === 'function' ? vectorAdapter : vectorAdapter.search;
      if (typeof search !== 'function') throw new Error('vector adapter has no search function');
      const timeoutMs = stageTimeout(vectorTimeoutMs ?? vectorOptions.timeoutMs ?? vectorOptions.deadlineMs ?? vectorAdapter.timeoutMs, DEFAULT_VECTOR_TIMEOUT_MS);
      if (timeoutMs <= 0) throw new Error('shared deadline exceeded');
      const vectorResults = await invokeWithDeadline(search.bind(vectorAdapter), { query, limit, candidates: [...byId.keys()], tagLanes:lanes,categoryLanes:categories,filter }, {
        signal,
        timeoutMs,
        label: 'vector search',
      });
      if (!Array.isArray(vectorResults)) throw new Error('vector adapter returned a non-array');
      // Stage the entire optional channel first.  An invalid tail must not
      // leave a valid head's vector-only candidate or score in the fused
      // result, so no shared candidate map is touched until every item has
      // passed metadata, ID, score, and duplicate checks.
      const stagedById = new Map(byId);
      const stagedRanks = new Map();
      const seenIds = new Set();
      for (let rank = 0; rank < vectorResults.length; rank += 1) {
        const result = vectorResults[rank];
        if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('vector adapter returned an invalid result');
        const metadataError = validateVectorMetadata(result, vectorAdapter, vectorOptions);
        if (metadataError) throw new Error(metadataError);
        const id = String(result?.id ?? result?.candidateId ?? '');
        if (!id) throw new Error('vector result is missing a candidate ID');
        if (seenIds.has(id)) throw new Error(`vector result contains duplicate candidate ID ${id}`);
        seenIds.add(id);
        const score = Number(result?.score);
        if (!Number.isFinite(score)) throw new Error(`vector result has an invalid score for ${id}`);
        let candidate = stagedById.get(id);
        if (!candidate && id) {
          const record = typeof index.get === 'function' ? index.get(id) : null;
          if (record && (typeof filter !== 'function' || filter(record))) {
            candidate = { id, score: 0, record, channels: [], termMatches: [], exactEntities: [] };
            stagedById.set(id, candidate);
          }
        }
        if (candidate) {
          const next = clone(candidate);
          stagedRanks.set(id, rank + 1);
          next.vectorScore = score;
          next.channels = [...new Set([...(next.channels ?? []), 'vector_optional'])];
          stagedById.set(id, next);
        }
      }
      byId.clear();
      for (const [id, candidate] of stagedById) byId.set(id, candidate);
      vectorRanks.clear();
      for (const [id, rank] of stagedRanks) vectorRanks.set(id, rank);
      trace.vector = { status: 'passed', count: vectorResults.length };
      if (vectorResults.coverage) {
        trace.vector.coverage = { indexed: vectorResults.coverage.indexed, total: vectorResults.coverage.total };
        if (vectorResults.coverage.indexed < vectorResults.coverage.total) trace.fallbacks.push({ channel: 'vector', reason: 'partial_index' });
      }
    } catch (error) {
      throwIfAborted(signal);
      const reason=error?.code==='RECALL_LANE_COOLDOWN'?'cooldown':error.message;
      trace.vector = { status: 'fallback', reason };
      trace.fallbacks.push({ channel: 'vector', reason });
    } finally {
      trace.timings.vectorMs = monotonicNow() - stageStarted;
    }
  }
  const localWeight = Number.isFinite(vectorOptions.localWeight) ? Math.max(0, Number(vectorOptions.localWeight)) : 1;
  const vectorWeight = Number.isFinite(vectorOptions.vectorWeight) ? Math.max(0, Number(vectorOptions.vectorWeight)) : 1;
  trace.fusion = { algorithm: 'weighted_rrf', rankConstant, weights: { local: localWeight, vector: vectorWeight } };
  let candidates = [...byId.values()].map((candidate) => {
    const id = String(candidate.id);
    const localRank = localRanks.get(id);
    const vectorRank = vectorRanks.get(id);
    candidate.localScore = candidate.score;
    const tagRank=tagged.reduce((best,lane)=>{const n=lane.candidates.findIndex(c=>String(c.id)===id);return n<0?best:Math.min(best,n+1);},Infinity);
    const categoryRank=classified.reduce((best,lane)=>{const n=lane.candidates.findIndex(c=>String(c.id)===id);return n<0?best:Math.min(best,n+1);},Infinity);
    candidate.fusionScore = (localRank ? localWeight / (rankConstant + localRank) : 0) + (vectorRank ? vectorWeight / (rankConstant + vectorRank) : 0) + (Number.isFinite(tagRank)?0.5*localWeight/(rankConstant+tagRank):0) + (Number.isFinite(categoryRank)?0.25*localWeight/(rankConstant+categoryRank):0);
    candidate.score = candidate.fusionScore;
    return candidate;
  }).sort(compareCandidates);
  if(lanes.length||categories.length){
    // Reserve room in the rerank pool without demoting an already top-ranked
    // exact/tag hit to its tail (especially when reranking is disabled).
    const reservation = reserveCategoryPool(candidates, lanes, categories, capacity), reserved = reservation.reserved;
    candidates = reservation.candidates;
    trace.tags.reserved=reserved.length;
    trace.categories.reserved=reserved.filter(c=>categories.some(l=>c.record?.category===l.category)).length;
  }
  if (focused.length) {
    const ids = new Set(focused.map(c => String(c.id)));
    const protectedRows = candidates.filter(c => ids.has(String(c.id)));
    const rest = candidates.filter(c => !ids.has(String(c.id)));
    const pool = [...protectedRows, ...rest.slice(0, capacity - protectedRows.length)].sort(compareCandidates);
    const pooled = new Set(pool.map(c => c.id));
    candidates = [...pool, ...candidates.filter(c => !pooled.has(c.id))];
  }
  throwIfAborted(signal);
  if (reranker && remaining() <= 0) {
    trace.rerank = { status: 'skipped', calls: 0, reason: 'shared_deadline' };
    trace.fallbacks.push({ channel: 'rerank', reason: 'shared_deadline' });
  } else if (reranker) {
    const stageStarted = monotonicNow();
    trace.rerank.calls = 1;
    const reranked = await invokeReranker(reranker, query, candidates, { ...rerankOptions, timeoutMs: stageTimeout(rerankOptions.timeoutMs ?? rerankOptions.deadlineMs, DEFAULT_RERANK_TIMEOUT_MS) }, signal);
    candidates = reranked.candidates;
    trace.rerank = { status: reranked.status, calls: 1, reason: reranked.reason, scores: reranked.scores };
    if (reranked.status === 'fallback') trace.fallbacks.push({ channel: 'rerank', reason: reranked.reason });
    trace.timings.rerankMs = monotonicNow() - stageStarted;
  }
  throwIfAborted(signal);
  let returned = candidates.slice(0, limit);
  if (repository) returned = await hydrateCandidates(returned, repository, scope, trace);
  trace.timings.totalMs = monotonicNow() - startedAt;
  trace.deadline.elapsedMs = monotonicNow() - onlineStartedAt;
  trace.degraded = trace.fallbacks.length > 0;
  return { candidates: returned, trace };
}

function awarenessOf(unit) {
  return clone(unit?.awareness ?? unit?.awarenessChanges ?? unit?.metadata?.awareness ?? unit?.event?.awareness ?? unit?.event?.awarenessChanges ?? []);
}

function temporalOf(unit) {
  return clone(unit?.temporal ?? unit?.storyTime ?? unit?.metadata?.temporal ?? unit?.event?.temporal ?? unit?.event?.storyTime ?? unit?.event?.time ?? null);
}

function followUpsOf(unit) {
  return clone(unit?.followUps ?? unit?.lifecycleDependencies ?? unit?.metadata?.followUps ?? unit?.event?.followUps ?? unit?.event?.lifecycleDependencies ?? []);
}

/** Normalize a candidate into the indivisible event/awareness/time/follow-up unit. */
export function toMemoryUnit(candidate) {
  const record = candidate?.record ?? candidate;
  const event = record?.event ?? record;
  const awareness = awarenessOf(record);
  const temporal = temporalOf(record);
  const followUps = followUpsOf(record);
  const unit = {
    id: candidate?.id ?? record?.id ?? event?.id,
    event: clone(event),
    awareness,
    temporal,
    followUps,
    sourceRefs: clone(record?.sourceRefs ?? event?.sourceRefs ?? []),
    score: candidate?.score,
  };
  unit.units = {
    event: estimateUnits(unit.event),
    awareness: estimateUnits(awareness),
    temporal: estimateUnits(temporal),
    followUps: estimateUnits(followUps),
  };
  unit.cost = unit.units.event + unit.units.awareness + unit.units.temporal + unit.units.followUps;
  return unit;
}

/**
 * Pack complete units only. If time, knowledge scope, or a follow-up cannot
 * fit, the event is omitted as a whole; no naked event is emitted.
 */
export function packMemoryUnits(candidates = [], { budgetUnits = Infinity, maxItems = Infinity } = {}) {
  let remaining = Number.isFinite(budgetUnits) ? Math.max(0, budgetUnits) : Infinity;
  const packed = [];
  const omitted = [];
  for (const candidate of candidates) {
    if (packed.length >= maxItems) { omitted.push({ id: candidate?.id, reason: 'max_items' }); continue; }
    const unit = toMemoryUnit(candidate);
    if (unit.cost > remaining) {
      omitted.push({ id: unit.id, reason: 'indivisible_budget_unit', required: unit.cost, remaining });
      continue;
    }
    packed.push(unit);
    if (remaining !== Infinity) remaining -= unit.cost;
  }
  return { units: packed, omitted, usedUnits: Number.isFinite(budgetUnits) ? budgetUnits - remaining : null, remainingUnits: remaining };
}

export async function retrieveAndPack(options = {}) {
  const retrieved = await retrieveMemories(options);
  const packed = packMemoryUnits(retrieved.candidates, options);
  return { ...packed, candidates: retrieved.candidates, trace: retrieved.trace };
}
