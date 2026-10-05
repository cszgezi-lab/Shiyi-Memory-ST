import {
  DRAFT_CATEGORIES,
  SUMMARY_OUTPUT_CONTRACT,
  bindDraftBundle,
  coverageState,
  splitSummaryBatch,
  validateDraftBundle,
} from './contracts.js';
import { ScopeConflictError, ShiyiError, SummaryResponseError, ValidationError } from './errors.js';
import { abortError, clone, estimateUnits, estimateModelInputUnits, sha256, stableStringify, throwIfAborted } from './utils.js';
import { requireIndependentFloorSummaries } from './floor-summaries.js';
import { safeLogDetails } from './product-runtime-log.js';
import { diagnosticRequestId, errorDiagnostics, jsonFailure, contentType } from './diagnostics.js';
import { resolveEventMerges } from './event-consolidation.js';
import { tokenizeChinese } from './retrieval.js';
import { normalizeSummaryEnums, normalizePersonaValidity, normalizeRecordIdentifiers, repairableEnumTargets, createEnumRepairRequest, applyEnumCorrections, deferCommitmentStates, quarantineInvalidEnums } from './summary-enum-repair.js';
import {transientSummaryError,recoveryAttemptLimit,recoveryDelay,repairCategories,categoryRepairRequest,applyCategoryRepair,missingFloorRequest} from './summary-recovery.js';
import {summaryTransportOptions} from './summary-transport.js';
import { selectSummaryContext, summarySources } from './summary-context.js';
import { runSummaryStages, isolateDraftIds } from './summary-stages.js';
import { referenceRepairRequest, applyReferenceRepair } from './summary-reference-repair.js';
import { verificationRequest, verificationEnvelope, compactVerificationHints, applyVerificationProgress, verificationCounts, VERIFICATION_POLICY, VERIFICATION_MODULES } from './summary-verification.js';
import { planSummaryRequests } from './summary-planner.js';
import { moduleSummaryContract, moduleSummaryInstructions, expandModuleSummary, expandCompactSummary, normalizedModuleSourceRefs, moduleLinkNormalization, unwrapModuleSummaryResponse } from './summary-wire.js';
import { applySummaryPreset, summaryPresetFromRules, PRESET_TRANSPORT_GUARD } from './summary-presets.js';
import {parseSummaryJson} from './summary-json.js';
import {summaryKnowledgeSources,SUMMARY_KNOWLEDGE_EVIDENCE_RULE} from './summary-knowledge-evidence.js';
import {NARRATIVE_READING_RULE,narrativeCounters} from './narrative-reading.js';

function responseStatus(response) {
  return Number(response?.status ?? response?.statusCode ?? 200);
}

async function readRawBody(response) {
  if (response?.aborted || response?.bodyAborted || response?.truncated || response?.complete === false) {
    throw new SummaryResponseError('summary response body was interrupted or truncated', { status:responseStatus(response),stage:'read_body',reason:'body_interrupted' });
  }
  if (typeof response === 'string') return response;
  if (response?.body && typeof response.body !== 'string' && response.body[Symbol.asyncIterator]) {
    const chunks = [],decoder=new TextDecoder();let bytes=false;
    try {
      for await (const chunk of response.body){
        if(typeof chunk==='string'){if(bytes)chunks.push(decoder.decode());bytes=false;chunks.push(chunk);}
        else{bytes=true;chunks.push(decoder.decode(chunk,{stream:true}));}
      }
      if(bytes)chunks.push(decoder.decode());
    } catch (error) {
      throw new SummaryResponseError('summary response body stream was interrupted', { causeError:error,stage:'read_body',reason:'body_interrupted' });
    }
    return chunks.join('');
  }
  if (typeof response?.text === 'function') {
    try { return await response.text(); } catch (error) { throw new SummaryResponseError('summary response body could not be read', { causeError:error,stage:'read_body',reason:'body_interrupted' }); }
  }
  if (typeof response?.body === 'string') return response.body;
  if (response?.body !== undefined) return JSON.stringify(response.body);
  return JSON.stringify(response);
}

function stripJsonFence(text) {
  const value = String(text ?? '').trim();
  const fenced = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  return fenced ? fenced[1].trim() : value;
}

async function parseModelResponse(raw, { onMetadata = () => {}, onNormalize = () => {}, allowArray = false } = {}) {
  const parseJson=text=>{const parsed=parseSummaryJson(text);if(parsed.duplicateEmptyModules){try{onNormalize({duplicateEmptyModules:parsed.duplicateEmptyModules});}catch{/* diagnostics do not decide validity */}}return parsed.value;};
  const status = responseStatus(raw);
  if (status < 200 || status >= 300) {
    const body = await readRawBody(raw).catch(() => '');
    throw new SummaryResponseError(`summary model returned HTTP ${status}`, { status,bodyChars:body.length,stage:'request',reason:'http_error' });
  }
  let payload = raw;
  if (typeof raw === 'string' || raw?.text || raw?.body !== undefined || raw?.status !== undefined || raw?.statusCode !== undefined) {
    const text = stripJsonFence(await readRawBody(raw));
    try { payload=parseJson(text); } catch (error) { throw new SummaryResponseError('summary model returned invalid JSON', jsonFailure(error,text,{status,stage:'parse_envelope'})); }
  }
  // OpenAI-compatible chat response. A length stop is a truncated model
  // result even when the provider happened to return syntactically valid JSON.
  const finishReason = payload?.choices?.[0]?.finish_reason ?? payload?.choices?.[0]?.finishReason ?? payload?.finish_reason ?? payload?.finishReason;
  const content=payload?.choices?.[0]?.message?.content??payload?.output_text;
  const metadata=safeLogDetails({status,finishReason:finishReason??'unknown',truncated:['length','max_tokens','truncated','abort'].includes(String(finishReason).toLowerCase()),promptTokens:payload?.usage?.prompt_tokens,completionTokens:payload?.usage?.completion_tokens,totalTokens:payload?.usage?.total_tokens,reasoningTokens:payload?.usage?.completion_tokens_details?.reasoning_tokens,responseChars:typeof content==='string'?content.length:undefined});
  try{onMetadata(metadata);}catch{/* diagnostics are not part of model validation */}
  if (['length', 'max_tokens', 'truncated', 'abort'].includes(String(finishReason).toLowerCase())) {
    const error=new SummaryResponseError('summary model output was truncated', {...metadata,reason:'output_truncated',stage:'parse_content'});error.code='MODEL_OUTPUT_TRUNCATED';throw error;
  }
  if(finishReason==='content_filter'){const error=new SummaryResponseError('summary model output was filtered',{...metadata,reason:'output_blocked',stage:'parse_content'});error.code='MODEL_OUTPUT_BLOCKED';throw error;}
  if(payload?.choices&&typeof content!=='string')throw new SummaryResponseError('summary response has no textual content',{...metadata,reason:'empty_model_content',stage:'parse_content',contentType:contentType(content),choicesCount:payload.choices.length});
  if (payload?.choices?.[0]?.message?.content !== undefined) payload = payload.choices[0].message.content;
  else if (payload?.output_text !== undefined) payload = payload.output_text;
  if (typeof payload === 'string') {
    const text=stripJsonFence(payload);
    try { payload=parseJson(text); } catch (error) { throw new SummaryResponseError('summary model content is not valid JSON', jsonFailure(error,text,metadata)); }
  }
  if(!allowArray){
    const normalized=unwrapModuleSummaryResponse(payload);
    if(normalized!==payload){payload=normalized;try{onNormalize({unwrappedSummaryRoots:1});}catch{/* diagnostics do not authorize parsing */}}
  }
  // Other non-empty arrays are accepted only for the unambiguous one-category
  // repair compatibility path.  An empty top-level array is still an invalid
  // repair response: it cannot prove that an existing row was preserved.
  if (!payload || typeof payload !== 'object' || (Array.isArray(payload) && (!allowArray || payload.length === 0))) throw new SummaryResponseError('summary model response must be an object',{...metadata,stage:'parse_content',reason:'invalid_model_root',contentType:contentType(payload)});
  if (payload.draftBundle && typeof payload.draftBundle === 'object') return payload.draftBundle;
  return payload;
}

function modelEnvelope(request) {
  const preset=summaryPresetFromRules(request.extractionContext?.rules);
  const value = Object.fromEntries(Object.entries(request).filter(([key])=>key!=='instructions'&&key!=='readingConfig'));
  if (request.extractionContext?.coverage) {
    const coverage = {...request.extractionContext.coverage};
    // Hashes/revisions prove sources locally, but models only copy locators.
    // Keep the full request untouched for validators, recovery and function adapters.
    for (const key of ['sourceRefs','bridgeRefs']) if (Array.isArray(coverage[key])) {
      coverage[key] = coverage[key].map(({sourceId,fragmentId})=>({sourceId,...(fragmentId?{fragmentId}:{})}));
    }
    value.extractionContext = {...request.extractionContext, coverage};
  }
  if (request.kind==='ShiyiSummaryRequest' && !request.summaryStage && value.extractionContext?.outputContract) {
    value.extractionContext = { ...value.extractionContext, outputContract: applySummaryPreset(moduleSummaryContract(value.extractionContext.outputContract),preset) };
    value.extractionContext.outputContract.knowledgeEvidenceTransport=SUMMARY_KNOWLEDGE_EVIDENCE_RULE;
    value.extractionContext.outputContract.partialKnowledgeExample='部分获知示例（不是剧情）：人物只看到桌上已有成品菜，没看见烹饪。应有known“桌上已有成品菜”，access“只见成品，未见烹饪、配料和制作者”；若原文明说不知道制作者，可另有explicitly_unaware。不能只写不知道谁做菜，而遗漏此人确实看到的成品。把这个原则用于本批实际原文，不复制示例事实。';
    value.extractionContext.outputContract.knowledgeCueRules='段号p1不是宿主fragmentId，不填入sourceRefs或summaryView.fragmentId；它仅填在acquisitionEvidence的part字段。knowledgeCues只标出原文中可能含获知/明确未知/感知限制的段号，不是判断或完整清单。按原文顺序检查：谁获得了哪项具体信息、哪些内容仍未获知，后来是否出现新的告知或亲见。对只获得部分信息的人，保留已获得的具体部分及access中的限制，不能只写其不知情而抹掉实际获知。明确不知情到后来获知分别记录各自时间/来源，不覆盖历史；没提及者不推定状态。不要因关键词给所有在场者补知情，也不要为减少校对省略有效记录。';
    value.sourceMessages=summaryKnowledgeSources(value.sourceMessages,request.extractionContext?.rules?.narrativeExtraction);
    value.bridgeMessages=summaryKnowledgeSources(value.bridgeMessages,request.extractionContext?.rules?.narrativeExtraction);
    if(request.extractionContext?.rules?.narrativeExtraction||value.sourceMessages?.some(m=>m._reading))value.extractionContext.outputContract.readingRule=NARRATIVE_READING_RULE;
  }
  if(request.summaryStage&&(request.extractionContext?.rules?.narrativeExtraction||value.sourceMessages?.some(m=>/<\/?sy_(?:context|private)\b/i.test(m.text)))){
    value.sourceMessages=summaryKnowledgeSources(value.sourceMessages,request.extractionContext?.rules?.narrativeExtraction);
    value.bridgeMessages=summaryKnowledgeSources(value.bridgeMessages,request.extractionContext?.rules?.narrativeExtraction);
    value.readingRule=NARRATIVE_READING_RULE;
  }
  // Repair builders retain the frozen local policy, not an already-filtered
  // source. Budget measurement and provider I/O both use this one projection.
  // Main/staged requests and the independently projected review stay separate.
  if(['ShiyiFloorRepair','ShiyiCategoryRepair','ShiyiReferenceRepair','ShiyiSummaryEnumRepair'].includes(request.kind)){
    value.sourceMessages=summaryKnowledgeSources(value.sourceMessages,request.readingConfig);
    value.bridgeMessages=summaryKnowledgeSources(value.bridgeMessages,request.readingConfig);
    if(request.readingConfig||[...value.sourceMessages,...value.bridgeMessages].some(m=>m._reading))value.readingRule=NARRATIVE_READING_RULE;
  }
  if(request.kind==='ShiyiSummaryVerification'&&Object.hasOwn(value.recordingRules??{},'narrativeExtraction')){
    const {narrativeExtraction,...recordingRules}=value.recordingRules;
    value.recordingRules=recordingRules;
  }
  // Keep the frozen preset locally for checkpoint identity, but transmit its
  // system prompt and writing rules once, not the entire library a second time.
  if(preset||request.extractionContext?.rules?.narrativeExtraction)value.extractionContext={...value.extractionContext,rules:request.extractionContext.rules.recordingRules};
  return verificationEnvelope(value);
}

function modelInvoker(model) {
  if (typeof model === 'function') return model;
  if (typeof model?.summarize === 'function') return model.summarize.bind(model);
  if (typeof model?.generate === 'function') return model.generate.bind(model);
  if (typeof model?.chatCompletions === 'function') {
    const invoke = (request, options) => model.chatCompletions(invoke.providerPayload(request), options);
    // Keep the exact wire shape in one place so the host can measure the
    // serialized payload before invoking an adapter.  The adapter receives no
    // second, independently estimated request.
    invoke.providerPayload = (request) => {
      const envelope=modelEnvelope(request);
      const payload={
      model: model.profile?.model,
      ...summaryTransportOptions(model.profile),
      ...(Number.isSafeInteger(request?.effectiveMaxTokens) && request.effectiveMaxTokens > 0
        ? { max_tokens: request.effectiveMaxTokens }
        : model.profile?.maxTokens > 0 ? { max_tokens: model.profile.maxTokens } : {}),
      messages: [
        { role: 'system', content: request.kind==='ShiyiSummaryRequest'&&!request.summaryStage ? (summaryPresetFromRules(request.extractionContext?.rules)?`${PRESET_TRANSPORT_GUARD}\n${summaryPresetFromRules(request.extractionContext.rules).instructions}`:moduleSummaryInstructions) : request.instructions },
        { role: 'user', content: JSON.stringify(envelope) },
      ],
      };
      const readings=[...(envelope.sourceMessages??[]),...(envelope.bridgeMessages??[])].map(m=>m._reading).filter(Boolean);
      Object.defineProperty(payload,'_outputContract',{value:envelope.extractionContext?.outputContract});
      if(readings.length)Object.defineProperty(payload,'_readingReport',{value:narrativeCounters(readings)});
      return payload;
    };
    return invoke;
  }
  throw new ValidationError('summary model adapter must be a function or expose summarize/generate/chatCompletions');
}

function ensureAllCategories(raw) {
  const missing = DRAFT_CATEGORIES.filter((category) => !(category in (raw ?? {})));
  if (missing.length) throw new SummaryResponseError('summary output is missing required categories', { reason:'missing_categories',stage:'validate',repairCategories:missing });
}

function focusFingerprint(focusSpec, focusVersion = null) {
  return String(focusVersion ?? sha256(focusSpec ?? null).slice(0, 24));
}

function focusGate(focusSpec) {
  if (!focusSpec) return { mode: 'inherit', confirmed: true, focus: null };
  const mode = String(focusSpec.mode ?? focusSpec.askMode ?? 'inherit').toLocaleLowerCase();
  if (!['inherit', 'ask_manual', 'ask_every'].includes(mode)) throw new ValidationError(`unsupported FocusSpec mode: ${mode}`);
  // `inherit` is a non-interactive mode.  The ask modes are explicitly
  // confirmed by the local UI; no model request is made to decide a focus.
  if (mode !== 'inherit' && focusSpec.confirmed !== true) return { mode, confirmed: false, focus: null };
  return {
    mode,
    confirmed: true,
    focus: focusSpec.focus ?? focusSpec.prompt ?? focusSpec.once ?? null,
  };
}

function serializableFocusSpec(focusSpec) {
  const result = clone(focusSpec ?? null);
  if (result && typeof result === 'object') {
    // Resolved focus and recording rules have their own canonical wire fields
    // below. FocusSpec carries only selection/confirmation metadata so marker
    // text is not serialized twice.
    delete result.focus;
    delete result.prompt;
    delete result.once;
    delete result.rules;
    delete result.focusRules;
  }
  return result;
}

function sourceRefsFor(child) {
  return child.sourceMessages.map((message) => ({ sourceId: message.id, version: message.version, hash: message.hash, contentHash: message.contentHash, fragmentId: message.fragmentId }));
}

function evidenceRefsFor(child) {
  return [...child.sourceMessages, ...child.bridgeMessages].map((message) => ({
    sourceId: message.id,
    version: message.version,
    hash: message.hash,
    contentHash: message.contentHash,
    fragmentId: message.fragmentId,
  }));
}

function makeInstructions(focus, rules) {
  return [
    '你是中文剧情记忆整理员。所有自然语言内容必须使用简体中文，不能以英文动作句代替中文总结；技术字段、枚举和来源标识保持契约原样。',
    '严格执行 outputContract.narrativeRules：完整事件纪要 description、召回速览 recallSummary 与逐楼经过 summaryView.text 分开写。标题不是纪要，多模块变化不代替事情的起因、过程和结果。输出前对照原文检查人物、时间、地点、条件/否认及结局，不续写，不用猜测填补缺失。',
    '执行 consolidationRules 与 characterDetailRules：先核对既有事件，用 mergeInto 合并同一次经历的新增经过；提取有依据的观念、态度变化与关键台词。不要重复建立同一事件，也不要把相似题材误当同一经历。',
    'Return one JSON DraftBundle for this complete source range.',
    'Return every required category with its exact categoryTypes from outputContract. The nine memory categories are arrays of record objects; use [] for categories with no changes. coverage is always an OBJECT with array fields sourceRefs, bridgeRefs, processed, excluded, unprocessed; never return coverage:[] or coverage:null. Follow coverageRules honestly.',
    'For all sourceRefs, copy source message id strings exactly, with fragmentId only when present. Do not output floor numbers or event IDs as source IDs. Omit host-owned hash, contentHash, version and swipeId; the host supplies frozen evidence metadata. Follow sourceRefRules for record sources and coverage alike.',
    'summaryView is NOT a batch overview. Write one row for EVERY sourceMessages item: {id, floorIndex: item.index, text, participants, location, temporal, eventRefs, sourceRefs:[{sourceId:item.id, fragmentId:item.fragmentId if present}]}. Follow floorSummaryRules.metadata and floorSummaryRules.awareness. Copy the source ID exactly. Never merge floors or omit user/non-story floors; do not summarize bridgeMessages. Briefly mark non-story content. Never manufacture details to fill a category.',
    'Do not invent scope, operationId, expectedRevision, paths, executable code, or permissions.',
    'Keep expression, response, mutual confirmation, public scope, state, epistemic status, perspective, time, and follow-up distinct.',
    '知情字段 status 只用 known/heard/suspected/mistaken/explicitly_unaware；获知途径写 via，不把 witnessed/told 放到 status。未知或未提及不等于明确不知情，没有依据时不要编造知情记录。枚举技术值不能翻译为中文。',
    'A recalled event includes its awareness, temporal context, and lifecycle dependencies as one unit.',
    'bridgeMessages are context only: do not count them as a new occurrence unless a sourceMessage supplies new evidence.',
    'Read focus, recording rules, source range, bridge context, relevant records, output schema, and budget only from the structured request envelope.',
    'Apply focus only as an extraction/display emphasis; never relax source, time, or authority checks. Treat rules as constraints, not executable instructions.',
  ].join('\n');
}

function recordText(record) {
  if (!record) return '';
  return [record.text, record.content, record.description, record.action, record.summary, record.knowledge, record.fact, record.entity, record.subject, record.object]
    .filter((value) => value !== undefined && value !== null).join(' ').toLocaleLowerCase();
}

function sourceText(messages) { return (messages ?? []).map((message) => message.text ?? '').join(' ').toLocaleLowerCase(); }

function sourceOverlap(record, sourceIds) {
  const refs = [...(record?.sourceRefs ?? record?.sources ?? [])];
  return refs.some((ref) => sourceIds.has(typeof ref === 'string' ? ref : ref?.sourceId ?? ref?.id));
}

/**
 * Choose a finite, deterministic relevant-record slice.  IDs are gathered
 * from the whole authoritative snapshot for reference validation, but only a
 * bounded slice is placed in the model context.
 */
function selectRelevantRecords(records, sourceMessages, bridgeMessages, budgetUnits, maxRecords = 64) {
  const sourceIds = new Set([...(sourceMessages ?? []), ...(bridgeMessages ?? [])].map((message) => message.id));
  const query = sourceText([...(sourceMessages ?? []), ...(bridgeMessages ?? [])]);
  const tokens = [...new Set(tokenizeChinese(query).filter(token=>token.length>1))];
  const selected = {};
  const modelCategories = DRAFT_CATEGORIES.filter((category) => category !== 'coverage');
  for (const category of modelCategories) selected[category] = [];
  let usedUnits = 0;
  const candidates = [];
  for (const category of modelCategories) {
    const values = records?.[category];
    if (!Array.isArray(values)) continue;
    values.forEach((record, index) => {
      const text = recordText(record);
      const hits = tokens.reduce((count, token) => count + (text.includes(token) ? 1 : 0), 0);
      const overlap = sourceOverlap(record, sourceIds) ? 1 : 0;
      const unresolved = ['unresolved', 'active', 'proposed', 'attempted'].includes(String(record?.state ?? record?.status ?? record?.lifecycleState ?? '').toLocaleLowerCase()) ? 0.25 : 0;
      candidates.push({ category, record, index, score: overlap * 100 + hits * 10 + unresolved, units: estimateUnits(stableStringify(record)) });
    });
  }
  candidates.sort((a, b) => b.score - a.score || a.category.localeCompare(b.category) || a.index - b.index);
  const limit = Number.isFinite(budgetUnits) ? Math.max(0, budgetUnits) : Infinity;
  for (const candidate of candidates) {
    if (Object.values(selected).reduce((sum, value) => sum + value.length, 0) >= maxRecords) break;
    if (usedUnits + candidate.units > limit) continue;
    selected[candidate.category].push(clone(candidate.record));
    usedUnits += candidate.units;
  }
  return { records: selected, usedUnits, candidateCount: candidates.length, omittedCount: Math.max(0, candidates.length - Object.values(selected).reduce((sum, value) => sum + value.length, 0)) };
}

function contextIds(records) {
  const ids = new Set();
  for (const category of Object.keys(records ?? {})) {
    if (!Array.isArray(records[category])) continue;
    for (const record of records[category]) if (record?.id) ids.add(record.id);
  }
  for (const [from, to] of Object.entries(records?.idAliases ?? {})) { ids.add(from); ids.add(to); }
  return ids;
}

function defineModelAlias(target, key, value) {
  Object.defineProperty(target, key, {
    value,
    enumerable: false,
    configurable: false,
    writable: false,
  });
}

// A failed large request should not be replayed with the same optional
// history. Keep source-overlapping records first, shed unrelated history,
// and update the diagnostic budget without touching frozen source evidence.
function compactRecoveryContext(request, targetUnits, providerPayload) {
  const measure = () => estimateModelInputUnits(typeof providerPayload === 'function' ? providerPayload(request) : request);
  const beforeUnits = measure();
  const records = request?.relevantRecords;
  if (!records || typeof records !== 'object') return { changed: false, beforeUnits, afterUnits: beforeUnits, removed: 0 };
  const sourceIds = new Set((request.sourceMessages ?? []).map(message => message?.id).filter(Boolean));
  const entries = Object.entries(records).filter(([, rows]) => Array.isArray(rows) && rows.length);
  const candidates = entries.flatMap(([category, rows]) => rows.map((record, index) => ({
    category,
    record,
    index,
    overlap: sourceOverlap(record, sourceIds) ? 1 : 0,
    units: estimateUnits(stableStringify(record)),
  })));
  candidates.sort((a, b) => a.overlap - b.overlap || b.units - a.units || b.index - a.index);
  let removed = 0;
  while (measure() > targetUnits && candidates.length) {
    const item = candidates.shift();
    const rows = records[item.category];
    const index = rows.indexOf(item.record);
    if (index < 0) continue;
    rows.splice(index, 1);
    removed += 1;
    if (item.category === 'events') {
      records.awarenessChanges = (records.awarenessChanges ?? []).filter(awareness => awareness.eventRef !== item.record.id && !(awareness.eventRefs ?? []).includes(item.record.id));
    }
  }
  const afterUnits = measure();
  if (!removed) return { changed: false, beforeUnits, afterUnits, removed: 0 };
  const remaining = Object.values(records).flatMap(rows => Array.isArray(rows) ? rows : []);
  const budget = request.extractionContext?.budget;
  if (budget) {
    const relevantUnits = estimateUnits(JSON.stringify(records));
    budget.sections.relevantRecords = relevantUnits;
    budget.usedInputUnits = (budget.sections.source ?? 0) + (budget.sections.bridge ?? 0) + (budget.sections.focusRules ?? 0) + relevantUnits;
    budget.totalReservedUnits = budget.usedInputUnits + (budget.sections.outputSchema ?? 0) + (budget.outputReserveUnits ?? 0);
    budget.relevantRecordCount = remaining.length;
    budget.omittedRelevantRecords = (budget.relevantCandidateCount ?? 0) - remaining.length;
    budget.contextTruncated = true;
    budget.strategy = 'recovery_context_shed';
  }
  const coverage = request.extractionContext?.coverage;
  if (coverage) {
    coverage.relevantRecordIds = remaining.map(record => record?.id).filter(Boolean);
    coverage.relevantRecordCount = remaining.length;
    coverage.omittedRelevantRecords = budget?.omittedRelevantRecords ?? 0;
  }
  return { changed: true, beforeUnits, afterUnits, removed };
}

/** P1 one-request-per-segment orchestration with atomic bundle commits. */
export class SummaryEngine {
  constructor({ model, supplementModel=null, staged=false, verified=false, isolateIds=false, packRequests=false, repository, maxInputUnits = 12000, maxSourceUnits = null, requestSafetyUnits = null, outputReserveUnits = null, maxRelevantRecords = 64, requireFloorSummaries = false, stageCrossBatchMerges = false, recoveryEnabled=false, now = () => Date.now() } = {}) {
    this.model = modelInvoker(model);
    this.supplementModel = supplementModel ? modelInvoker(supplementModel) : this.model;
    this.verified = verified;
    this.staged = staged && !verified;
    this.packRequests = packRequests;
    this.isolateIds = isolateIds || staged;
    if (!repository || typeof repository.commitBundle !== 'function') throw new ValidationError('SummaryEngine requires a MemoryRepository');
    this.repository = repository;
    // maxInputUnits bounds all model-visible prompt text. A caller
    // that also needs small body chunks for continuation can opt into the
    // separate maxSourceUnits split quota without weakening that ceiling.
    this.maxInputUnits = maxInputUnits;
    // Optional explicit adapter limit for compatibility. The product uses the
    // user's input budget directly; it no longer supplies a hidden lower cap.
    this.requestSafetyUnits = Number.isFinite(requestSafetyUnits) && requestSafetyUnits > 0
      ? Math.min(Number(requestSafetyUnits), Number(maxInputUnits) || Number(requestSafetyUnits))
      : null;
    this.requireFloorSummaries=requireFloorSummaries;
    this.stageCrossBatchMerges=stageCrossBatchMerges;
    // Paid first-pass caching is intrinsic to verified mode, independent of
    // the legacy optional automatic-repair setting. invoke still forbids any
    // third automatic call when verified is true.
    this.recoveryEnabled=recoveryEnabled||verified;
    this.maxSourceUnits = Number.isFinite(maxSourceUnits) && maxSourceUnits > 0 ? maxSourceUnits : null;
    this.outputReserveUnits = Number.isFinite(outputReserveUnits) ? Math.max(0, outputReserveUnits) : null;
    this.maxRelevantRecords = Math.max(1, Number(maxRelevantRecords) || 64);
    this.now = now;
    this.requestLog = [];
  }

  async _existingContext(scope, { sourceMessages = [], bridgeMessages = [], budgetUnits = Infinity, relevantRecords = null, authoritativeRecords = null } = {}) {
    if (typeof this.repository.listRecords !== 'function') return { records: {}, authoritativeRecords: {}, ids: new Set(), selection: { usedUnits: 0, candidateCount: 0, omittedCount: 0 } };
    authoritativeRecords ??= await this.repository.listRecords(scope);
    const ids = contextIds(authoritativeRecords);
    const selection = selectSummaryContext(relevantRecords ?? authoritativeRecords, [...sourceMessages,...bridgeMessages], {budgetUnits:Math.min(budgetUnits,6000),maxRecords:this.maxRelevantRecords});
    return { records: selection.records, authoritativeRecords, ids, selection };
  }

  async _prepareRequest(child, batch, { relevantRecords = null, authoritativeRecords = null } = {}) {
    const focusForChild = focusGate(child.focusSpec);
    const wireFocusSpec = serializableFocusSpec(child.focusSpec);
    const effectiveRules = child.rules ?? child.focusSpec?.rules ?? child.focusSpec?.focusRules ?? null;
    const writingPreset=summaryPresetFromRules(effectiveRules);
    const outputContract = clone(SUMMARY_OUTPUT_CONTRACT);
    const sourceUnits = estimateUnits(JSON.stringify(summarySources(child.sourceMessages)));
    const bridgeUnits = estimateUnits(JSON.stringify(summarySources(child.bridgeMessages ?? [])));
    const focusRules = { focusSpec: wireFocusSpec, focus: focusForChild.focus, rules: effectiveRules, configVersion: child.configVersion, rulesVersion: child.rulesVersion };
    const focusRulesUnits = estimateUnits(JSON.stringify(writingPreset?{...focusRules,rules:effectiveRules.recordingRules}:focusRules));
    const schemaUnits = writingPreset?estimateUnits(JSON.stringify(applySummaryPreset(moduleSummaryContract(outputContract),writingPreset))+writingPreset.instructions):estimateUnits(JSON.stringify(outputContract));
    const outputReserveUnits = Number.isFinite(child.budgets?.outputReserveUnits)
      ? Math.max(0, child.budgets.outputReserveUnits)
      : this.outputReserveUnits ?? Math.max(1, Math.ceil((Number(this.maxInputUnits) || 12000) * 0.2));
    // maxInputUnits is the complete model-visible input ceiling.
    // Output reserve is separately reported because it is not part of the
    // serialized input payload measured immediately before adapter I/O.
    const explicitInputBudget = Number.isFinite(child.budgets?.inputUnits) && child.budgets.inputUnits >= 0;
    const declaredLimit = explicitInputBudget ? Number(child.budgets.inputUnits) : (Number(this.maxInputUnits) || 12000);
    const configuredLimit = Math.min(declaredLimit, this.requestSafetyUnits ?? declaredLimit);
    const contentQuota = Math.max(0, configuredLimit - sourceUnits - bridgeUnits - focusRulesUnits - schemaUnits - 1500);
    const context = relevantRecords
      ? await this._existingContext(child.scope, { sourceMessages: child.sourceMessages, bridgeMessages: child.bridgeMessages, budgetUnits: contentQuota, relevantRecords, authoritativeRecords })
      : await this._existingContext(child.scope, { sourceMessages: child.sourceMessages, bridgeMessages: child.bridgeMessages, budgetUnits: contentQuota, authoritativeRecords });
    const committedRevision = typeof this.repository.getCommittedRevision === 'function' ? await this.repository.getCommittedRevision(child.scope) : child.expectedRevision;
    const budget = {
      limitUnits: configuredLimit,
      declaredLimitUnits: declaredLimit,
      measurement: 'conservative_estimate_of_serialized_sections',
      strategy: context.selection.omittedCount > 0 ? 'bounded_partial_context' : 'bounded_context',
      status: sourceUnits + bridgeUnits + focusRulesUnits > configuredLimit ? 'fixed_sections_exceed_content_quota' : 'within_content_quota',
      overflowUnits: Math.max(0, sourceUnits + bridgeUnits + focusRulesUnits - configuredLimit),
      outputReserveUnits,
      sections: {
        source: sourceUnits,
        bridge: bridgeUnits,
        focusRules: focusRulesUnits,
        relevantRecords: context.selection.usedUnits,
        outputSchema: schemaUnits,
        outputReserve: outputReserveUnits,
      },
      usedInputUnits: sourceUnits + bridgeUnits + focusRulesUnits + context.selection.usedUnits,
      totalReservedUnits: sourceUnits + bridgeUnits + focusRulesUnits + context.selection.usedUnits + schemaUnits + outputReserveUnits,
        relevantRecordCount: Object.values(context.records).reduce((sum, values) => sum + (Array.isArray(values) ? values.length : 0), 0),
      relevantCandidateCount: context.selection.candidateCount,
      omittedRelevantRecords: context.selection.omittedCount,
      contextTruncated: context.selection.omittedCount > 0,
      outputBudgetUnits: Number.isFinite(child.budgets?.outputUnits) ? Math.max(0, child.budgets.outputUnits) : 0,
    };
    const extractionContext = {
      kind: 'ExtractionContext',
      schemaVersion: 1,
      scope: clone(child.scope),
      committedRevision,
      sourceRevision: child.sourceRevision,
      configVersion: String(child.configVersion),
      rulesVersion: String(child.rulesVersion),
      focusVersion: focusFingerprint(child.focusSpec, child.focusVersion),
      focusSpec: clone(wireFocusSpec),
      focus: clone(focusForChild),
      rules: clone(effectiveRules),
      // Source bodies and selected records live once at request level.
      // Non-enumerable compatibility aliases are attached below for
      // function adapters without duplicating provider JSON.
      coverage: {
        sourceRefs: sourceRefsFor(child),
        // Only context floors belong here. evidenceRefsFor also contains the
        // selected new floors and is reserved for local binding/validation.
        bridgeRefs: sourceRefsFor({sourceMessages:child.bridgeMessages??[]}),
        relevantRecordIds: Object.values(context.records).flatMap((values) => (Array.isArray(values) ? values.map((record) => record?.id).filter(Boolean) : [])),
        relevantRecordCount: context.selection.candidateCount,
        omittedRelevantRecords: context.selection.omittedCount,
      },
      outputContract,
      budget,
    };
    const request = {
      kind: 'ShiyiSummaryRequest',
      instructions: writingPreset?`${PRESET_TRANSPORT_GUARD}\n${writingPreset.instructions}\n写作规则采用 rules.summaryPreset.rules；适配器输出结构仍须遵守本次 outputContract。`:makeInstructions(focusForChild, effectiveRules),
      scope: clone(child.scope),
      operationId: child.operationId,
      parentOperationId: batch.operationId,
      expectedRevision: child.expectedRevision,
      parentRange: clone(child.parentRange),
      childRange: clone(child.childRange),
      sourceMessages: this.staged || this.packRequests ? summarySources(child.sourceMessages) : clone(child.sourceMessages),
      bridgeMessages: this.staged || this.packRequests ? summarySources(child.bridgeMessages ?? []) : clone(child.bridgeMessages ?? []),
      relevantRecords: clone(context.records),
      extractionContext,
    };
    // These aliases keep the existing local adapter contract ergonomic;
    // they are deliberately non-enumerable and therefore absent from the
    // serialized provider payload.  Each body/schema/context section is
    // transmitted exactly once.
    defineModelAlias(request, 'outputContract', extractionContext.outputContract);
    defineModelAlias(request, 'outputCategories', [...DRAFT_CATEGORIES]);
    defineModelAlias(request, 'focusSpec', extractionContext.focusSpec);
    defineModelAlias(request, 'focus', extractionContext.focus);
    defineModelAlias(request, 'rules', extractionContext.rules);
    defineModelAlias(request, 'budget', extractionContext.budget);
    defineModelAlias(extractionContext, 'sourceMessages', request.sourceMessages);
    defineModelAlias(extractionContext, 'bridgeMessages', request.bridgeMessages);
    defineModelAlias(extractionContext, 'relevantRecords', request.relevantRecords);
    // For a provider adapter this is the exact payload that will be sent,
    // including system/user messages and response format.  Measure that
    // decoded message content at the last responsible moment and reject a
    // declared budget overflow before any adapter call.  The local
    // estimate is explicitly a bounded planning unit, not provider token
    // accounting or a claim about tokenizer behavior.
    // Optional previous memories must fit after the complete prompt,
    // not consume the room reserved for schema and source evidence.
    const wireUnits=()=>estimateModelInputUnits(typeof this.model.providerPayload==='function'?this.model.providerPayload(request):request);
    while(wireUnits()>configuredLimit){
      const entries=Object.entries(request.relevantRecords).filter(([,rows])=>Array.isArray(rows)&&rows.length);
      if(!entries.length)break;
      // Keep source-overlapping evidence ahead of merely optional history.
      const ids=new Set(child.sourceMessages.map(m=>m.id));
      const candidates=entries.flatMap(([category,rows])=>rows.map((record,index)=>({category,record,index,score:sourceOverlap(record,ids)?1:0})));
      candidates.sort((a,b)=>a.score-b.score||b.index-a.index);
      const removed=candidates[0];request.relevantRecords[removed.category].splice(removed.index,1);
      if(removed.category==='events')request.relevantRecords.awarenessChanges=(request.relevantRecords.awarenessChanges??[]).filter(a=>a.eventRef!==removed.record.id&&!(a.eventRefs??[]).includes(removed.record.id));
      const remaining=Object.values(request.relevantRecords).flatMap(rows=>Array.isArray(rows)?rows:[]);
      extractionContext.coverage.relevantRecordIds=remaining.map(r=>r.id);
      budget.relevantRecordCount=remaining.length;budget.omittedRelevantRecords=context.selection.candidateCount-remaining.length;
      extractionContext.coverage.omittedRelevantRecords=budget.omittedRelevantRecords;
      budget.contextTruncated=true;budget.strategy='bounded_partial_context';
      budget.sections.relevantRecords=estimateUnits(JSON.stringify(request.relevantRecords));
      budget.usedInputUnits=sourceUnits+bridgeUnits+focusRulesUnits+budget.sections.relevantRecords;
      budget.totalReservedUnits=budget.usedInputUnits+schemaUnits+outputReserveUnits;
    }
    if (typeof this.model.providerPayload === 'function') {
      budget.measurement = 'model_visible_prompt_estimate_units';
      const providerPayload = this.model.providerPayload(request);
      const providerPayloadUnits = estimateModelInputUnits(providerPayload);
      // Keep the diagnostic local-only. It must not become an enumerable
      // field in the measured/final provider payload.
      defineModelAlias(budget, 'providerPayloadUnits', providerPayloadUnits);
      if (providerPayloadUnits > configuredLimit) {
        const error = new ValidationError('serialized provider request exceeds input budget', {
          code: 'INPUT_BUDGET_EXCEEDED',
          reason:'input_budget_exceeded',stage:'prepare',inputLimit:configuredLimit,inputUnits:providerPayloadUnits,
          limitUnits: configuredLimit,
          providerPayloadUnits,
          outputReserveUnits,
          sections: budget.sections,
        });
        error.code = 'INPUT_BUDGET_EXCEEDED';
        throw error;
      }
    } else {
      budget.measurement = 'serialized_model_request_estimate_units';
      const serializedRequestUnits = estimateUnits(JSON.stringify(request));
      defineModelAlias(budget, 'serializedRequestUnits', serializedRequestUnits);
      if (serializedRequestUnits > configuredLimit) {
        const error = new ValidationError('serialized model request exceeds input budget', {
          code: 'INPUT_BUDGET_EXCEEDED',
          reason:'input_budget_exceeded',stage:'prepare',inputLimit:configuredLimit,inputUnits:serializedRequestUnits,
          limitUnits: configuredLimit,
          serializedRequestUnits,
          outputReserveUnits,
          sections: budget.sections,
        });
        error.code = 'INPUT_BUDGET_EXCEEDED';
        throw error;
      }
    }
    return { request, context, configuredLimit };
  }

  async process(batch, { signal, relevantRecords = null, onProgress = null, onSourcePlan = null, onDiagnostic = () => {}, correctionAuthorizations = [] } = {}) {
    const emit=(phase,details={},level='info')=>{try{onDiagnostic({phase,level,details:safeLogDetails(details)});}catch{/* log failure must not affect a commit */}};
    const focus = focusGate(batch?.focusSpec);
    if (!focus.confirmed) {
      return {
        kind: 'SummaryJob',
        operationId: batch?.operationId,
        status: 'awaiting_focus',
        reason: 'focus_confirmation_required',
        focusSpec: clone(batch?.focusSpec),
        requests: 0,
        receipts: [],
        startedAt: this.now(),
      };
    }
    const checkpoint = typeof this.repository.getCheckpoint === 'function' ? await this.repository.getCheckpoint(batch.operationId, batch.scope) : null;
    const frozenPlan = this.packRequests ? await this.repository.readPrivateTask?.(batch.scope, batch.operationId) : null;
    const authoritativeRecords = this.packRequests && this.repository.listRecords ? await this.repository.listRecords(batch.scope) : null;
    const children = this.packRequests ? await planSummaryRequests(batch, {
      maxSourceUnits: this.maxSourceUnits ?? this.maxInputUnits,
      frozen: frozenPlan?.requestPlan,
      checkpointPlan: checkpoint?.splitPlan,
      signal,
      prepare: child => this._prepareRequest(child, batch, { relevantRecords, authoritativeRecords }),
    }) : splitSummaryBatch(batch, { maxInputUnits: this.maxSourceUnits ?? this.maxInputUnits });
    const splitPlan = children.map((child) => ({
      childIndex: child.childRange.childIndex,
      operationId: child.operationId,
      expectedRevision: child.expectedRevision,
      sourceRefs: sourceRefsFor(child),
      childRange: child.childRange,
    }));
    const splitPlanFingerprint = sha256(splitPlan);
    const checkpointBinding = {
      scopeKey: stableStringify(batch.scope),
      sourceRevision: batch.sourceRevision,
      configVersion: String(batch.configVersion),
      rulesVersion: String(batch.rulesVersion),
      focusVersion: focusFingerprint(batch.focusSpec, batch.focusVersion),
      splitPlanFingerprint,
    };
    if (checkpoint && checkpointBinding.scopeKey !== checkpoint.scopeKey) {
      throw new ScopeConflictError('summary checkpoint scope differs from requested scope', { expected: checkpointBinding.scopeKey, actual: checkpoint.scopeKey });
    }
    if (checkpoint) {
      const mismatches = Object.entries(checkpointBinding).filter(([key, expected]) => checkpoint[key] !== undefined && checkpoint[key] !== expected).map(([key, expected]) => ({ key, expected, actual: checkpoint[key] }));
      if (mismatches.length) throw new ScopeConflictError('summary checkpoint binding does not match frozen batch', { mismatches });
    }
    if (this.packRequests && !frozenPlan?.requestPlan) {
      try { await this.repository.savePrivateTask?.(batch.scope, batch.operationId, {requestPlan:{version:1,sourceRevision:batch.sourceRevision,splitPlan}}); }
      catch (error) { emit('checkpoint_warning',{...errorDiagnostics(error),storageArtifact:'batch-recovery'},'warning'); }
    }
    const completed = new Set(checkpoint?.completedChildIndexes ?? []);
    if ([...completed].some((index) => !Number.isInteger(index) || index < 0 || index >= children.length)) {
      throw new ScopeConflictError('summary checkpoint contains an invalid child index', { completedChildIndexes: [...completed], totalChildren: children.length });
    }
    if (checkpoint && completed.size && Array.isArray(checkpoint.receipts) && typeof this.repository.getOperationReceipt === 'function') {
      for (const childIndex of completed) {
        const plan = splitPlan[childIndex];
        const receipt = checkpoint.receipts.find((item) => item?.operationId === plan.operationId);
        const persisted = this.repository.recoverOperationReceipt?await this.repository.recoverOperationReceipt(batch.scope,plan.operationId):await this.repository.getOperationReceipt(plan.operationId);
        if (!receipt || !persisted || persisted.scopeKey !== checkpointBinding.scopeKey || persisted.bundleHash !== receipt.bundleHash || persisted.committedRevision !== plan.expectedRevision + 1) {
          throw new ScopeConflictError('summary checkpoint completed child lacks a matching committed receipt', { childIndex, operationId: plan.operationId });
        }
      }
    } else if (checkpoint && completed.size && checkpoint.schemaVersion >= 2 && typeof this.repository.getOperationReceipt === 'function') {
      throw new ScopeConflictError('summary checkpoint completed children have no commit credentials');
    }
    const state = {
      kind: 'SummaryJob',
      operationId: batch.operationId,
      status: completed.size === children.length ? 'done' : 'running',
      parentRange: clone(batch.parentRange),
      totalChildren: children.length,
      completedChildren: [...completed].sort((a, b) => a - b),
      failedChildren: [],
      requests: 0,
      receipts: clone(checkpoint?.receipts ?? []),
      startedAt: this.now(),
    };
    // The host validates these exact immutable boundaries before API I/O and
    // again before commit. It must not independently rerun a different splitter.
    throwIfAborted(signal);
    if(onSourcePlan)await onSourcePlan({operationId:batch.operationId,sourceRevision:batch.sourceRevision,scope:clone(batch.scope),range:clone(batch.parentRange),children:children.map(child=>({operationId:child.operationId,sourceRevision:child.sourceRevision,expectedRevision:child.expectedRevision}))});
    if(this.verified&&children.length>1)throw new ShiyiError('本批超过输入预算；双次复核模式不会暗中拆批，请调整本批范围或输入预算','INPUT_BUDGET_EXCEEDED');
    emit('plan',{plannedRequests:(children.length-completed.size)*(this.staged||this.verified?2:1),totalChildren:children.length,completedChildren:completed.size,sourceCount:batch.sourceMessages.length});
    if (completed.size === children.length) return state;
    let recoveryCalls=0, verifyBeforeRequest=null, childCalls=0;
    const invoke=async(request,baseDetails,{extra=false}={})=>{
      if(extra&&++recoveryCalls>2)throw new ShiyiError('本次自动恢复预算已用完，已返回结果保留','RECOVERY_LIMIT');
      let compacted=false;
      for(;;){
        if(verifyBeforeRequest)await verifyBeforeRequest();
        throwIfAborted(signal);
        if(this.verified&&childCalls>=2)throw new ShiyiError('本批两次请求已用完；已返回内容保留，可单独重试未完成复核','RECOVERY_LIMIT');
        const purpose=({ShiyiSummaryVerification:'summary_verification',ShiyiCategoryRepair:'category_repair',ShiyiFloorRepair:'floor_repair',ShiyiSummaryEnumRepair:'enum_repair',ShiyiReferenceRepair:'reference_repair'})[request.kind]??(request.summaryStage==='narrative'?'summary_narrative':request.summaryStage==='details'?'summary_details':'summary');
        const model=request.summaryRole==='supplement'?this.supplementModel:this.model;
        Object.assign(baseDetails,{requestId:diagnosticRequestId(),purpose,requestNumber:state.requests+1});
        let providerPayload=typeof model.providerPayload==='function'?model.providerPayload(request):null;
        let units=estimateModelInputUnits(providerPayload??request);
        const requestLimit=this.requestSafetyUnits??this.maxInputUnits;
        if(units>requestLimit&&request.kind==='ShiyiSummaryVerification'){
          compactVerificationHints(request);
          providerPayload=model.providerPayload?.(request)??null;units=estimateModelInputUnits(providerPayload??request);
        }
        // Per-clause highlights expand the lossless source envelope. They are
        // advisory and duplicate sourceChecks: remove this markup before
        // spending the budget on less useful repetition, never source text.
        if(units>requestLimit&&request.kind==='ShiyiSummaryVerification'&&request.sourceGaps?.length){
          request.sourceGaps=[];
          providerPayload=model.providerPayload?.(request)??null;units=estimateModelInputUnits(providerPayload??request);
        }
        // Repeated attention excerpts are optional. Shed only those excerpts
        // to fit; never drop original text, records, or source proof fields.
        while(units>requestLimit&&request.kind==='ShiyiSummaryVerification'&&request.sourceChecks?.length){
          request.sourceChecks.pop();
          providerPayload=model.providerPayload?.(request)??null;units=estimateModelInputUnits(providerPayload??request);
        }
        if(units>requestLimit&&request.summaryStage){
          compactRecoveryContext(request,requestLimit,model.providerPayload);
          providerPayload=model.providerPayload?.(request)??null;units=estimateModelInputUnits(providerPayload??request);
        }
        if(units>requestLimit)throw new ShiyiError('本次模型输入超过设置的输入预算；已返回结果保留，尚未发送该请求','INPUT_BUDGET_EXCEEDED',{...baseDetails,reason:'input_budget_exceeded',stage:'prepare',inputLimit:requestLimit,inputUnits:units});
        const wireContract=providerPayload?._outputContract??request.extractionContext?.outputContract;
        if(providerPayload?._readingReport)emit('reading',providerPayload._readingReport,providerPayload._readingReport.readingFallbacks?'warning':'info');
        emit('request',{...baseDetails,summaryStage:request.summaryStage,modelRole:request.summaryRole??'summary',sourceInputUnits:estimateUnits(JSON.stringify(request.sourceMessages??[])),historyInputUnits:estimateUnits(JSON.stringify(request.relevantRecords??{})),schemaInputUnits:estimateUnits(JSON.stringify(wireContract??request.outputContract??{})),bridgeInputUnits:estimateUnits(JSON.stringify(request.bridgeMessages??[])),inputUnits:units,maxTokens:providerPayload?.max_tokens??0,recoveryCalls});
        const started=this.now();state.requests++;childCalls++;
        try{
          try{return await model(request,{signal,requestId:baseDetails.requestId,purpose});}
          finally{emit('wait_complete',{...baseDetails,modelMs:Math.max(0,Math.round(this.now()-started))});}
        }
        catch(error){
          error.details={...error.details,elapsedMs:error.details?.requestElapsedMs??Math.max(0,Math.round(this.now()-started)),requestId:baseDetails.requestId,purpose};
          emit('response',{...baseDetails,...errorDiagnostics(error)},'error');
          if(this.verified||!this.recoveryEnabled||!transientSummaryError(error)||recoveryCalls>=recoveryAttemptLimit(error))throw error;
          // Long rate limits require user action later, not ignoring Retry-After
          // or holding a mobile task open indefinitely.
          if((error.details?.retryAfterMs??0)>5000)throw error;
          if(!compacted&&['ShiyiSummaryRequest','ShiyiSummaryStage'].includes(request.kind)){
            const declaredLimit=Number(request.extractionContext?.budget?.declaredLimitUnits)||Number(this.maxInputUnits)||12000;
            const configuredLimit=Math.min(declaredLimit,this.requestSafetyUnits??declaredLimit);
            const targetUnits=Math.min(configuredLimit,Math.floor(units*0.85));
            const shed=compactRecoveryContext(request,targetUnits,requestPayload=>typeof model.providerPayload==='function'?model.providerPayload(requestPayload):requestPayload);
            const configuredOutput=Number(providerPayload?.max_tokens)||Number(request.extractionContext?.budget?.outputBudgetUnits)||0;
            // A timeout does not prove the output ceiling caused the failure.
            // Keep the user's configured ceiling, including on retries.
            const reducedOutput=configuredOutput;
            compacted=true;
            emit('recovery_compact',{...baseDetails,beforeInputUnits:shed.beforeUnits,afterInputUnits:shed.afterUnits,removedRelevantRecords:shed.removed,recoveryInputTarget:targetUnits,requestedMaxTokens:configuredOutput,effectiveMaxTokens:reducedOutput||configuredOutput},'warning');
          }
          recoveryCalls++;const retryDelayMs=Math.max(recoveryCalls*400,error.details?.retryAfterMs??0,error.details?.retryDelayMs??0);
          emit('retry_wait',{...baseDetails,retryDelayMs,recoveryCalls,code:error.code,status:error.details?.status},'warning');
          const timing=await recoveryDelay(retryDelayMs,signal);
          emit('wait_complete',{...baseDetails,retryDelayMs,actualWaitMs:Math.round(timing.elapsedMs),timerLagMs:Math.round(timing.timerLagMs)});
        }
      }
    };
    for (const child of children) {
      const childIndex = child.childRange.childIndex;
      if (completed.has(childIndex)) continue;
      verifyBeforeRequest=this.isolateIds&&typeof this.repository.verifySourceRevision==='function'?async()=>{
        const actual=await this.repository.verifySourceRevision({scope:clone(child.scope),bundle:child});
        if(actual!==child.sourceRevision)throw new ShiyiError('聊天或正文已变化，后续阶段未调用','SOURCE_INVALIDATED');
      }:null;
      // Recovery budget is per source child. A failed early batch must not
      // consume the retry/repair allowance of every later batch in a 1–300
      // run.
      recoveryCalls=0;childCalls=0;
      let phase='request';
      const started=this.now();
      const baseDetails={childIndex,startIndex:child.sourceMessages[0]?.index,endIndex:child.sourceMessages.at(-1)?.index,sourceCount:child.sourceMessages.length};
      try {
        throwIfAborted(signal);
        if(this.recoveryEnabled&&this.repository.recoverOperationReceipt){
          const receipt=await this.repository.recoverOperationReceipt(batch.scope,child.operationId);
          if(receipt){
            if(receipt.sourceRevision!==child.sourceRevision||receipt.committedRevision!==child.expectedRevision+1)throw new ScopeConflictError('saved child no longer matches frozen task');
            state.receipts.push(receipt);completed.add(childIndex);state.completedChildren=[...completed];emit('resume_commit',baseDetails,'success');continue;
          }
        }
        const { request, context, configuredLimit } = await this._prepareRequest(child, batch, { relevantRecords });
        this.requestLog.push({ operationId: child.operationId, parentOperationId: batch.operationId, childIndex, sourceIds: child.sourceMessages.map((message) => message.id) });
        baseDetails.inputLimit=configuredLimit;
        const resultBinding=sha256({sourceRevision:child.sourceRevision,scope:child.scope,rules:child.rules,focus:child.focusSpec,configVersion:child.configVersion});
        const prior=this.recoveryEnabled?await this.repository.readPrivateTask?.(child.scope,child.operationId):null;
        if(prior?.binding&&prior.binding!==resultBinding)throw new ScopeConflictError('saved response source or rules changed');
        const keepResponse=async raw=>{
          throwIfAborted(signal);
          if(!this.recoveryEnabled||!this.repository.savePrivateTask)return;
          const previousPhase=phase;phase='response_saved';
          const patch={binding:resultBinding,raw,retryModel:false};
          this.repository.retainPrivateResponse?.(child.scope,child.operationId,patch);
          // Recovery storage is an optimization. A host may reject the
          // private task catalog while the actual chat-store commit is still
          // healthy. Never turn a valid model response into a failed summary
          // solely because this optional cache could not be acknowledged.
          try {
            await this.repository.savePrivateTask(child.scope,child.operationId,patch);
            emit('response_saved',baseDetails,'success');
          } catch (error) {
            emit('checkpoint_warning',{...baseDetails,...errorDiagnostics(error),storageArtifact:'response-cache'},'warning');
          }
          phase=previousPhase;
        };
        let raw,cachedForeignSource=false;
        if(prior?.raw!==undefined&&!prior.retryModel&&!this.verified&&!this.staged){
          // Explicit resume must not replay an irreparably foreign source
          // forever. Inspect only contract locators, never story/DIY values.
          // Do not guess a replacement ID: one new request for this failed
          // child is allowed on this user-triggered run. Valid paid responses
          // still resume locally after persistence/commit failures.
          try{
            const cached=unwrapModuleSummaryResponse(await parseModelResponse(prior.raw));
            const allowed=new Set([...child.sourceMessages,...child.bridgeMessages].map(m=>m.id));
            cachedForeignSource=DRAFT_CATEGORIES.some(k=>Array.isArray(cached?.[k])&&cached[k].some(row=>{
              if(typeof row?.sourceId==='string'&&!allowed.has(row.sourceId))return true;
              const refs=Array.isArray(row?.sourceRefs)?row.sourceRefs.flatMap(r=>r&&Object.keys(r).length===1&&Array.isArray(r.sourceRefs)?r.sourceRefs:[r]):[];
              return refs.some(r=>typeof r?.sourceId==='string'&&!allowed.has(r.sourceId));
            }));
            // A known floor with a wrong fragment, or a missing single-floor
            // locator, also cannot become valid by replaying the same answer.
            const expanded=expandModuleSummary(expandCompactSummary(cached,child.sourceMessages),child.sourceMessages);
            bindDraftBundle(expanded,{scope:child.scope,operationId:child.operationId,expectedRevision:child.expectedRevision,sourceRefs:evidenceRefsFor(child)});
          }catch(error){if(error?.details?.validationIssues?.some(i=>['source_mismatch','unknown_source','missing_source','source_ambiguous'].includes(i.reason)))cachedForeignSource=true;/* Other parse/shape recovery remains authoritative. */}
          if(cachedForeignSource)emit('resume_rejected_source',baseDetails,'warning');
        }
        if(prior?.raw!==undefined&&!prior.retryModel&&!cachedForeignSource){raw=prior.raw;emit('resume_response',baseDetails,'success');}
        else{
          if(this.staged){
            const checkCoverage=output=>{
              const bound=bindDraftBundle(output,{scope:child.scope,operationId:child.operationId,expectedRevision:child.expectedRevision,sourceRefs:evidenceRefsFor(child)});
              const coverage=coverageState(bound.coverage,sourceRefsFor(child));
              if(!coverage.complete){const error=new ValidationError('阶段未完整处理所选楼层',{coverage});error.code='COVERAGE_INCOMPLETE';throw error;}
            };
            raw=await runSummaryStages({request,cached:prior?.stages,invoke:(r,options)=>{phase='request';if(!options?.extra)recoveryCalls=0;return invoke(r,baseDetails,options);},parse:(r,stage)=>{phase='response';return parseModelResponse(r,{onMetadata:metadata=>emit('response',{...baseDetails,...metadata,summaryStage:stage})});},validateNarrative:checkCoverage,validateDetails:checkCoverage,
              save:async stages=>{
                const patch={binding:resultBinding,stages,retryModel:true};
                this.repository.retainPrivateResponse?.(child.scope,child.operationId,patch);
                try{await this.repository.savePrivateTask?.(child.scope,child.operationId,patch);}
                catch(error){emit('checkpoint_warning',{...baseDetails,...errorDiagnostics(error),storageArtifact:'response-cache'},'warning');}
              },emit:(phase,details,level)=>emit(phase,{...baseDetails,...details},level)});
          }else raw=await invoke(request,baseDetails);
          if(this.recoveryEnabled){
            if(typeof raw?.text==='function'||raw?.body!==undefined)raw={status:responseStatus(raw),body:await readRawBody(raw)};
            await keepResponse(raw);
          }
        }
        throwIfAborted(signal);
        phase='response';
        let parsed = await parseModelResponse(raw,{onMetadata:metadata=>emit('response',{...baseDetails,...metadata,elapsedMs:this.now()-started}),onNormalize:details=>emit('normalize',{...baseDetails,...details},details.duplicateEmptyModules?'warning':'success')});
        if(this.verified&&parsed?.format==='shiyi-module-records-v1'){
          parsed={...parsed};for(const key of VERIFICATION_MODULES)if(!Object.hasOwn(parsed,key))parsed[key]=[];
        }
        phase='validate';
        const expanded=expandModuleSummary(expandCompactSummary(parsed,child.sourceMessages),child.sourceMessages);
        if(expanded!==parsed){
          const links=moduleLinkNormalization(parsed,expanded,child.sourceMessages);
          emit('normalize',{...baseDetails,...links,normalizedSourceRefs:normalizedModuleSourceRefs(parsed,expanded),compactFloors:expanded.summaryView.length,compactChanges:Object.keys(expanded).filter(k=>!['events','summaryView'].includes(k)&&Array.isArray(expanded[k])).reduce((n,k)=>n+expanded[k].length,0)},links.resolvedSourceTextHints||links.wholeFloorEventAnnotations?'warning':'success');
        }
        const normalizeDraftMetadata=(draft,purpose)=>{
          const {output:identified,normalizedIdentifiers}=normalizeRecordIdentifiers(draft);
          const {output:enumOutput,...enumCounts}=normalizeSummaryEnums(identified);
          const {output:value,...personaCounts}=normalizePersonaValidity(enumOutput);
          const counts={...(normalizedIdentifiers?{normalizedIdentifiers}:{}),...enumCounts,...personaCounts};
          if(Object.values(counts).some(n=>n>0))emit('normalize',{...baseDetails,...counts,...(purpose?{purpose}:{})},counts.misplacedEvidenceKinds||counts.unknownEvidenceTypes||counts.unknownKnowledgeMetadata||counts.unknownPersonaContexts||counts.restrictedPersonaScopes||counts.unknownEventPerspectives?'warning':'success');
          return value;
        };
        let output=normalizeDraftMetadata(expanded);
        if(this.verified)for(const key of DRAFT_CATEGORIES){
          // The narrative pass intentionally has no responsibility for the
          // seven detail modules; they remain uncommitted until verification.
          if(!['events','summaryView','coverage'].includes(key)&&!Object.hasOwn(output,key))output[key]=[];
        }
        ensureAllCategories(output);
        if(this.verified){
          const binding=sha256({policy:VERIFICATION_POLICY,output});
          if(prior?.verifiedDraft?.binding===binding){output=clone(prior.verifiedDraft.output);emit('stage_resume',{...baseDetails,purpose:'summary_verification'},'success');}
          else{
            const progress=prior?.reviewProgress?.binding===binding?prior.reviewProgress:null;
            if(progress){output=clone(progress.output);emit('stage_resume',{...baseDetails,purpose:'summary_verification'},'info');}
            phase='verification_request';emit('stage_start',{...baseDetails,purpose:'summary_verification'});
            // Give review concrete local failures before spending the second
            // request. Missing metadata is never silently invented by binding.
            const preflight=bindDraftBundle(output,{scope:child.scope,operationId:child.operationId,expectedRevision:child.expectedRevision,sourceRefs:evidenceRefsFor(child)});
            const checked=validateDraftBundle(preflight,{allowedSourceIds:new Set([...child.sourceMessages,...child.bridgeMessages].map(m=>m.id)),knownRecordIds:context.ids,expectedSourceRefs:sourceRefsFor(child),existingFacts:context.authoritativeRecords?.entityFactChanges??[],enforceCorrectionAuthority:true,trustedCorrectionIds:correctionAuthorizations,newSourceIds:child.sourceMessages.map(m=>m.id)});
            const validationIssues=(checked.validationIssues??[]).map(issue=>{
              const match=/^(\w+)\[(\d+)\]/.exec(issue.path??'');
              return {...issue,...(match?{id:output[match[1]]?.[Number(match[2])]?.id}:{})};
            });
            const readingConfig=request.extractionContext?.rules?.narrativeExtraction;
            const projectReview=readingConfig||request.sourceMessages.some(m=>/<\/?sy_(?:context|private)\b/i.test(m.text));
            const reviewRequest=projectReview?{...request,sourceMessages:summaryKnowledgeSources(request.sourceMessages,readingConfig),bridgeMessages:summaryKnowledgeSources(request.bridgeMessages,readingConfig)}:request;
            const review=verificationRequest(reviewRequest,output,{validationIssues,pending:progress?.pending??[]});
            if(projectReview)review.instructions+='\n'+NARRATIVE_READING_RULE;
            const apply=async response=>{
              const changes=await parseModelResponse(response,{onMetadata:metadata=>emit('response',{...baseDetails,...metadata,purpose:'summary_verification'})});
              const result=applyVerificationProgress(output,changes,review);
              const value=normalizeDraftMetadata(result.output,'summary_verification');
              return {changes,value,pending:result.pending,accepted:result.accepted,noteCoverage:result.noteCoverage};
            };
            let reviewed;
            if(!progress&&!prior?.verificationRetry&&prior?.verificationRaw?.binding===binding){
              try{reviewed=await apply(prior.verificationRaw.raw);emit('stage_resume',{...baseDetails,purpose:'summary_verification'},'success');}
              catch(error){throwIfAborted(signal);emit('validate',{...baseDetails,...errorDiagnostics(error),purpose:'summary_verification'},'warning');}
            }
            if(!reviewed){
              let response=await invoke(review,baseDetails);
              phase='verification_response';
              if(typeof response?.text==='function'||response?.body!==undefined)response={status:responseStatus(response),body:await readRawBody(response)};
              const responsePatch={binding:resultBinding,verificationRetry:false,verificationRaw:{binding,raw:response}};
              this.repository.retainPrivateResponse?.(child.scope,child.operationId,responsePatch);
              try{await this.repository.savePrivateTask?.(child.scope,child.operationId,responsePatch);}
              catch(error){emit('checkpoint_warning',{...baseDetails,...errorDiagnostics(error),storageArtifact:'response-cache'},'warning');}
              reviewed=await apply(response);
            }
            output=reviewed.value;
            emit('review_notes',{...baseDetails,...reviewed.noteCoverage,purpose:'summary_verification'},'info');
            // Keep individually source-checked deltas across a failed sibling
            // or later contract error. This checkpoint is private: it never
            // becomes a partial publication or an embedding candidate.
            const recoveryPatch={binding:resultBinding,reviewProgress:{binding,output,pending:reviewed.pending}};
            this.repository.retainPrivateResponse?.(child.scope,child.operationId,recoveryPatch);
            try{await this.repository.savePrivateTask?.(child.scope,child.operationId,recoveryPatch);}
            catch(error){emit('checkpoint_warning',{...baseDetails,...errorDiagnostics(error),storageArtifact:'response-cache'},'warning');}
            if(reviewed.pending.length){
              const accepted=verificationCounts({checks:[],...reviewed.accepted});
              emit('partial_repair',{...baseDetails,purpose:'summary_verification',accepted,rejected:reviewed.pending.length},'warning');
              throw new ValidationError('部分复核项待修复；已核对的改动已缓存，尚未发布到记忆',{reason:'quality_validation',stage:'validate',accepted,rejected:reviewed.pending.length,verificationIssues:reviewed.pending.flatMap(p=>p.issues.map(issue=>({...issue,path:issue.path.replace(/^(updates|additions)\[0\]/,`${p.kind}[${p.index}]`)})))});
            }
            // Preserve the successfully returned second pass across commit or
            // process failures. The original main response is kept separately.
            const patch={binding:resultBinding,verifiedDraft:{binding,output}};
            this.repository.retainPrivateResponse?.(child.scope,child.operationId,patch);
            try{await this.repository.savePrivateTask?.(child.scope,child.operationId,patch);}
            catch(error){emit('checkpoint_warning',{...baseDetails,...errorDiagnostics(error),storageArtifact:'response-cache'},'warning');}
            emit('stage_complete',{...baseDetails,purpose:'summary_verification',accepted:verificationCounts(reviewed.changes)},'success');
          }
        }
        phase='validate';
        const sourceRefs = sourceRefsFor(child);
        const bindOutput = value => bindDraftBundle(this.isolateIds ? isolateDraftIds(value,child.scope,child.operationId,request.relevantRecords.events) : value, {
          scope: child.scope,
          operationId: child.operationId,
          expectedRevision: child.expectedRevision,
          parentRange: child.parentRange,
          childRange: child.childRange,
          sourceRefs: evidenceRefsFor(child),
          sourceFloorIndices: [...child.sourceMessages,...child.bridgeMessages].map(m=>({sourceId:m.id,fragmentId:m.fragmentId,index:m.index})),
          sourceTexts: [...child.sourceMessages,...child.bridgeMessages].map(m=>({sourceId:m.id,fragmentId:m.fragmentId,text:m.text})),
          readingConfig:child.rules?.narrativeExtraction,
          requireKnowledgeEvidence:typeof this.model.providerPayload==='function'&&!this.staged&&!this.verified,
          sourceRevision: child.sourceRevision,
          configVersion: child.configVersion,
          rulesVersion: child.rulesVersion,
          focusVersion: focusFingerprint(child.focusSpec, child.focusVersion),
          correctionAuthorizations,
        });
        let bundle=bindOutput(output);
        const detailRows=DRAFT_CATEGORIES.flatMap(k=>Array.isArray(bundle[k])?bundle[k]:[]);
        const timeCorrections=detailRows.flatMap(r=>(r.timeCorrections??[]).map(c=>({recordId:r.id,path:c.path,sourceId:c.sourceId,method:c.method})));
        if(timeCorrections.length)emit('validate',{...baseDetails,sourceTimeCorrections:timeCorrections.length},'info');
        emit('character_details',{...baseDetails,journalCount:detailRows.filter(r=>r.innerLife?.text).length,stageObservations:detailRows.filter(r=>r.innerLife?.origin==='stage_observation').length,rejectedDialogues:detailRows.reduce((n,r)=>n+(r.detailWarnings?.rejectedDialogues??0),0)},detailRows.some(r=>r.detailWarnings?.rejectedDialogues)?'warning':'info');
        resolveEventMerges(bundle,request.relevantRecords,{deferUnresolved:true,stageCrossBatch:this.stageCrossBatchMerges,onDeferred:({eventIndex,reason})=>emit('merge_deferred',{...baseDetails,validationIssueCount:1,validationIssues:[{path:`events[${eventIndex}].mergeInto`,reason}]},'info')});
        if(this.requireFloorSummaries){
          phase='floors';
          let details;
          try{details=requireIndependentFloorSummaries(bundle,child.sourceMessages);}
          catch(error){
            if(this.verified||!this.recoveryEnabled||error.details?.invalidRows||error.details?.duplicateCount||error.details?.emptyFloors?.length||!error.details?.missingFloors?.length)throw error;
            const missing=child.sourceMessages.filter(m=>error.details.missingFloors.includes(m.index));
            emit('partial_repair',{...baseDetails,...safeLogDetails(error.details),purpose:'floor_repair',repairFields:missing.length},'warning');
            let fixed;
            const repairRaw=await invoke(missingFloorRequest(request,bundle,missing),baseDetails,{extra:true});
            try{fixed=await parseModelResponse(repairRaw,{onMetadata:metadata=>emit('repair_response',{...baseDetails,...metadata})});}
            catch(repairError){
              if(signal?.aborted)throw repairError;
              emit('repair_failed',{...baseDetails,...errorDiagnostics(repairError)},'error');
              error.details.repairAttempted=true;throw error;
            }
            if(!Array.isArray(fixed?.summaryView)||Object.keys(fixed).length!==1)throw error;
            fixed.summaryView=bindOutput({summaryView:fixed.summaryView}).summaryView;
            requireIndependentFloorSummaries(fixed,missing);
            // Floor rows are not cross-record link targets. Assign stable IDs
            // for the verified missing source instead of colliding with an ID
            // such as "floor-1" already used in the complete part.
            for(const row of fixed.summaryView)row.id=`repair-floor-${sha256([child.operationId,row.sourceRefs]).slice(0,24)}`;
            bundle.summaryView.push(...fixed.summaryView);
            details=requireIndependentFloorSummaries(bundle,child.sourceMessages);
            await keepResponse(bundle);
          }
          emit('floors',{...baseDetails,...details},'success');
        }
        phase='validate';emit('validate',baseDetails);
        // The host freezes what was submitted; the model still has to report
        // which of those refs it processed.  Overwriting processed here would
        // make an explicit unprocessed gap look complete.
        bundle.coverage.sourceRefs = clone(sourceRefs);
        const validationOptions = {
          expectedBinding: { scope: child.scope, operationId: child.operationId, expectedRevision: child.expectedRevision },
          allowedSourceIds: new Set([...child.sourceMessages, ...child.bridgeMessages].map((message) => message.id)),
          knownRecordIds: context.ids ?? new Set(),
          existingFacts: context.authoritativeRecords?.entityFactChanges ?? [],
          expectedSourceRefs: sourceRefs,
          enforceCorrectionAuthority: true,
          trustedCorrectionIds: correctionAuthorizations,
          newSourceIds: child.sourceMessages.map((message) => message.id),
        };
        let validation = validateDraftBundle(bundle,validationOptions);
        // U199: one residual bad enum must not discard the whole paid batch.
        // After every model-informed repair path, fields whose vocabulary has
        // an explicit 'unknown' member fall back to it with a pending review
        // marker; structural damage still fails at the final validation.
        const tryQuarantineEnums=async()=>{
          if(validation.valid)return;
          const quarantined=quarantineInvalidEnums(bundle,validation);
          if(!quarantined.paths.length)return;
          bundle=quarantined.output;
          validation=validateDraftBundle(bundle,validationOptions);
          await keepResponse(bundle);
          emit('records_deferred',{...baseDetails,deferredRecords:quarantined.paths.length,enumQuarantined:quarantined.paths.length},'warning');
        };
        const deferred=deferCommitmentStates(bundle,validation);
        if(deferred.paths.length){
          bundle=deferred.output;validation=validateDraftBundle(bundle,validationOptions);
          await keepResponse(bundle);
        }
        const deferredCommitments=(bundle.commitmentChanges??[]).filter(r=>r.state==='unknown').length;
        const deferredKnowledge=(bundle.awarenessChanges??[]).filter(r=>r.knowledgeReview?.status==='pending').length;
        const deferredCount=deferredCommitments+deferredKnowledge;
        if(deferredCount)emit('records_deferred',{...baseDetails,deferredRecords:deferredCount,deferredCommitments,deferredKnowledge},'warning');
        if(!validation.valid&&this.recoveryEnabled&&!this.verified){
          const repairRequest=referenceRepairRequest(request,bundle,validation);
          if(repairRequest){
            emit('partial_repair',{...baseDetails,purpose:'reference_repair',...safeLogDetails(validation)},'warning');
            const fixed=await parseModelResponse(await invoke(repairRequest,baseDetails,{extra:true}),{onMetadata:metadata=>emit('repair_response',{...baseDetails,...metadata})});
            const repaired=applyReferenceRepair(bundle,repairRequest,fixed);
            if(repaired){const checked=validateDraftBundle(repaired,validationOptions);if(checked.valid){bundle=repaired;validation=checked;await keepResponse(bundle);emit('repair_complete',{...baseDetails,purpose:'reference_repair'},'success');}}
          }
        }
        const repairTargets=repairableEnumTargets(bundle,validation);
        if(!validation.valid&&repairTargets.length&&!this.verified){
          // A single bounded field-only correction. Normal summaries retain one
          // model call. Source, scope, chronology and coverage rules stay intact.
          const repairRequest=createEnumRepairRequest(bundle,repairTargets,request);
          if(this.staged)repairRequest.summaryRole='supplement';
          const repairUnits=estimateModelInputUnits(this.model.providerPayload?.(repairRequest)??repairRequest);
          if(repairUnits<=configuredLimit){
            phase='repair_request';
            const repairStarted=this.now();
            emit('repair_request',{...baseDetails,...safeLogDetails(validation),repairFields:repairTargets.length,inputLimit:configuredLimit,inputUnits:repairUnits,maxTokens:this.model.providerPayload?.(repairRequest)?.max_tokens??0},'warning');
            throwIfAborted(signal);
            if(this.recoveryEnabled&&recoveryCalls>=2)throw new ShiyiError('本次自动恢复预算已用完','RECOVERY_LIMIT');
            this.requestLog.push({operationId:child.operationId,parentOperationId:batch.operationId,childIndex,kind:'enum_repair',sourceIds:repairRequest.sourceMessages.map(m=>m.id)});
            const repairRaw=await invoke(repairRequest,baseDetails,{extra:this.recoveryEnabled});
            throwIfAborted(signal);
            phase='repair_response';
            const correction=await parseModelResponse(repairRaw,{onMetadata:metadata=>emit('repair_response',{...baseDetails,...metadata,elapsedMs:this.now()-repairStarted})});
            const corrected=applyEnumCorrections(bundle,repairTargets,correction,{onRejected:repairRejection=>emit('repair_failed',{...baseDetails,repairRejection},'warning')});
            if(corrected){
              const checked=validateDraftBundle(corrected,validationOptions);
              if(checked.valid){bundle=corrected;validation=checked;await keepResponse(bundle);emit('repair_complete',{...baseDetails,repairFields:repairTargets.length,elapsedMs:this.now()-repairStarted},'success');}
            }
            phase='validate';
            if(!validation.valid)emit('repair_failed',{...baseDetails,...safeLogDetails(validation),repairFields:repairTargets.length},'error');
            await tryQuarantineEnums();
            if(!validation.valid)throw new ValidationError('enum correction did not pass validation',{...validation,repairAttempted:true});
          }else emit('repair_skipped',{...baseDetails,inputLimit:configuredLimit,inputUnits:repairUnits,code:'INPUT_BUDGET_EXCEEDED'},'warning');
        }
        if(!validation.valid&&this.recoveryEnabled&&!this.verified){
          const categories=repairCategories(validation);
          if(categories.length){
            phase='repair_request';
            const repairDetails={...safeLogDetails(validation),repairCategories:categories,repairCategoriesCount:categories.length,purpose:'category_repair'};
            emit('partial_repair',{...baseDetails,...repairDetails},'warning');
            try{
              const repairRaw=await invoke(categoryRepairRequest(request,bundle,categories,validation),baseDetails,{extra:true});
              phase='repair_response';
              const fixed=await parseModelResponse(repairRaw,{allowArray:categories.length===1,onMetadata:metadata=>emit('repair_response',{...baseDetails,...metadata})});
              // A number of OpenAI-compatible providers ignore the requested
              // object shape for a one-category repair and return the array
              // itself. It is unambiguous in this branch, so wrap it before
              // applying the normal evidence/row-preservation checks.
              const repairObject=Array.isArray(fixed)?{[categories[0]]:fixed}:fixed;
              const repaired=applyCategoryRepair(bundle,categories,repairObject);
              if(!repaired)throw new ValidationError('category repair changed shape or dropped records',{...validation,stage:'repair',reason:'invalid_repair_shape'});
              const normalized=bindOutput(normalizeDraftMetadata(repaired,'category_repair'));
              const checked=validateDraftBundle(normalized,validationOptions);
              if(!checked.valid)throw new ValidationError('category repair failed validation',{...checked,stage:'validate',repairAttempted:true});
              bundle=normalized;validation=checked;await keepResponse(bundle);emit('repair_complete',{...baseDetails,...repairDetails},'success');
              phase='validate';
            }catch(error){
              error.details={...repairDetails,...error.details,requestId:baseDetails.requestId,purpose:'category_repair',repairAttempted:true};
              emit('repair_failed',{...baseDetails,...errorDiagnostics(error)},'error');throw error;
            }
          }
        }
        await tryQuarantineEnums();
        if (!validation.valid) throw new ValidationError('summary DraftBundle failed validation', validation);
        const coverage = coverageState(bundle.coverage, sourceRefs);
        if (!coverage.complete) {
          const incomplete = new ValidationError('summary coverage is incomplete; unprocessed source range must be resumed', { coverage });
          incomplete.code = 'COVERAGE_INCOMPLETE';
          throw incomplete;
        }
        throwIfAborted(signal);
        phase='commit';emit('commit',baseDetails);
        const receipt = await this.repository.commitBundle(bundle, { scope: child.scope, expectedRevision: child.expectedRevision, sourceRevision: child.sourceRevision });
        state.receipts.push(receipt);
        completed.add(childIndex);
        state.completedChildren = [...completed].sort((a, b) => a - b);
        if (typeof this.repository.saveCheckpoint === 'function') await this.repository.saveCheckpoint(batch.operationId, {
          status: 'running',
          scope: clone(batch.scope),
          sourceRevision: batch.sourceRevision,
          configVersion: String(batch.configVersion),
          rulesVersion: String(batch.rulesVersion),
          focusVersion: checkpointBinding.focusVersion,
          splitPlanFingerprint,
          splitPlan: clone(splitPlan),
          parentRange: clone(batch.parentRange),
          completedChildIndexes: state.completedChildren,
          failedChildIndexes: state.failedChildren,
          totalChildren: children.length,
          receipts: clone(state.receipts),
        }).catch(error=>emit('checkpoint_warning',{...baseDetails,...errorDiagnostics(error),storageArtifact:'checkpoint'},'warning'));
        if (typeof onProgress === 'function') await onProgress(clone(state));
      } catch (error) {
        if(this.verified&&!signal?.aborted&&error?.name!=='AbortError'&&error?.code!=='CANCELED'&&!['commit','request','verification_request'].includes(phase)){
          // Invalid second-pass output is not a successful resume checkpoint.
          // Keep the paid main response; an explicit retry calls only review.
          await this.repository.savePrivateTask?.(child.scope,child.operationId,{verifiedDraft:null,verificationRetry:phase!=='verification_response'}).catch(e=>emit('checkpoint_warning',{...errorDiagnostics(e),storageArtifact:'checkpoint'},'warning'));
        }
        if(this.recoveryEnabled&&!signal?.aborted&&phase==='response'&&['MODEL_OUTPUT_TRUNCATED','SUMMARY_RESPONSE_ERROR','SUMMARY_RESPONSE_INVALID','MODEL_OUTPUT_BLOCKED'].includes(error?.code)){
          // An incomplete/blocked response cannot be repaired as a complete JSON
          // draft. A manual retry may use a newly selected model/output budget.
          await this.repository.savePrivateTask?.(child.scope,child.operationId,{retryModel:true}).catch(error=>emit('checkpoint_warning',{...baseDetails,...errorDiagnostics(error),storageArtifact:'checkpoint'},'warning'));
        }
        emit(error.details?.stage==='validate'?'validate':phase,{...baseDetails,...errorDiagnostics(error),code:signal?.aborted?'CANCELED':error?.code,elapsedMs:this.now()-started},signal?.aborted?'warning':'error');
        if (error?.name === 'AbortError' || error?.code === 'CANCELED' || signal?.aborted) {
          state.status = 'canceled';
          state.canceledChild = childIndex;
          if (typeof this.repository.saveCheckpoint === 'function') await this.repository.saveCheckpoint(batch.operationId, {
            status: 'canceled', scope: clone(batch.scope), sourceRevision: batch.sourceRevision, configVersion: String(batch.configVersion), rulesVersion: String(batch.rulesVersion), focusVersion: checkpointBinding.focusVersion, splitPlanFingerprint, splitPlan: clone(splitPlan), completedChildIndexes: [...completed].sort((a, b) => a - b), failedChildIndexes: state.failedChildren, totalChildren: children.length, receipts: clone(state.receipts),
          }).catch(e=>emit('checkpoint_warning',{...errorDiagnostics(e),storageArtifact:'checkpoint'},'warning'));
          throw (error?.name === 'AbortError' ? error : abortError());
        }
        if (error?.code === 'COVERAGE_INCOMPLETE') {
          state.status = 'partial';
          state.partialChild = childIndex;
          state.unprocessedChildren = [...new Set([...(state.unprocessedChildren ?? []), childIndex])];
          if (typeof this.repository.saveCheckpoint === 'function') await this.repository.saveCheckpoint(batch.operationId, {
            status: 'partial', scope: clone(batch.scope), sourceRevision: batch.sourceRevision, configVersion: String(batch.configVersion), rulesVersion: String(batch.rulesVersion), focusVersion: checkpointBinding.focusVersion, splitPlanFingerprint, splitPlan: clone(splitPlan), parentRange: clone(batch.parentRange), completedChildIndexes: [...completed].sort((a, b) => a - b), failedChildIndexes: state.failedChildren, partialChildIndexes: state.unprocessedChildren, totalChildren: children.length, receipts: clone(state.receipts), coverage: clone(error.details?.coverage ?? null),
          }).catch(e=>emit('checkpoint_warning',{...errorDiagnostics(e),storageArtifact:'checkpoint'},'warning'));
          throw error;
        }
        state.status = 'failed';
        state.failedChildren.push(childIndex);
        if (typeof this.repository.saveCheckpoint === 'function') await this.repository.saveCheckpoint(batch.operationId, {
          status: 'failed', scope: clone(batch.scope), sourceRevision: batch.sourceRevision, configVersion: String(batch.configVersion), rulesVersion: String(batch.rulesVersion), focusVersion: checkpointBinding.focusVersion, splitPlanFingerprint, splitPlan: clone(splitPlan), completedChildIndexes: [...completed].sort((a, b) => a - b), failedChildIndexes: state.failedChildren, totalChildren: children.length, receipts: clone(state.receipts), error: { code: error.code, message: error.message },
          }).catch(e=>emit('checkpoint_warning',{...errorDiagnostics(e),storageArtifact:'checkpoint'},'warning'));
        throw error;
      }
    }
    state.status = 'done';
    state.completedAt = this.now();
    if (typeof this.repository.saveCheckpoint === 'function') await this.repository.saveCheckpoint(batch.operationId, {
      status: 'done', scope: clone(batch.scope), sourceRevision: batch.sourceRevision, configVersion: String(batch.configVersion), rulesVersion: String(batch.rulesVersion), focusVersion: checkpointBinding.focusVersion, splitPlanFingerprint, splitPlan: clone(splitPlan), parentRange: clone(batch.parentRange), completedChildIndexes: state.completedChildren, failedChildIndexes: [], totalChildren: children.length, receipts: clone(state.receipts),
          }).catch(e=>emit('checkpoint_warning',{...errorDiagnostics(e),storageArtifact:'checkpoint'},'warning'));
    if(this.recoveryEnabled)for(const child of children)await this.repository.clearPrivateTask?.(batch.scope,child.operationId).catch(error=>emit('checkpoint_warning',{...errorDiagnostics(error),storageArtifact:'checkpoint'},'warning'));
    return state;
  }

  async run(batch, options = {}) { return this.process(batch, options); }
  async summarize(batch, options = {}) { return this.process(batch, options); }
}

export { parseModelResponse, modelInvoker };
