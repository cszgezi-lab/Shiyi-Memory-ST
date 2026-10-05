import { ValidationError } from './errors.js';
import { bindOriginalSource } from './source-recall-evidence.js';
import { validationDetails, valueType } from './validation-diagnostics.js';
import { normalizeTerms, normalizeTags,enrichRetrievalMetadata } from './product-dictionary.js';
import { bindCharacterDetails,bindDialogueSources } from './event-consolidation.js';
import {sourceTimeline,reconcileSourceTimes} from './source-consistency.js';
import { normalizeFactValidity,bindKnowledgeEvidence } from './memory-evidence.js';
import {bindSummaryKnowledge,completeSummaryKnowledgeRefs} from './summary-knowledge-evidence.js';
import { completeInnerLife, SUMMARY_FACTUAL_RULE } from './character-journal.js';
import {
  asArray,
  asString,
  clone,
  estimateUnits,
  isPlainObject,
  makeId,
  normalizeText,
  sha256,
  stableStringify,
  uniqueStrings,
} from './utils.js';

export const DRAFT_CATEGORIES = Object.freeze([
  'events',
  'awarenessChanges',
  'entityFactChanges',
  'relationshipChanges',
  'personaChanges',
  'commitmentChanges',
  'performanceHints',
  'summaryView',
  'conflicts',
  'coverage',
]);

/**
 * The model-facing contract is deliberately data-only.  Keeping the field
 * names and enum values here (instead of sending only category names) makes a
 * request self describing and gives the host one canonical contract to audit.
 */
export const SUMMARY_OUTPUT_CONTRACT = Object.freeze({
  analysisBoundaryRules:SUMMARY_FACTUAL_RULE,
  crossModuleQualityRules:'提交前对照本批原文：事件中明确谁听见/看见什么，awarenessChanges 是否遗漏；人物明确的学校、家人、任意新属性不能只存在于别人的知情摘要而不进入其档案。同一人物复用稳定姓名和已有属性含义，补充可兼容的信息，不重复复述整份档案。新信息若与既有学校/住址/数值矛盾且原文未确认更正，保留冲突，禁止按最后一楼覆盖。关系变化区分角色自述、当场反应和双方明确确认；感谢、害羞或旁人起哄不自动等于恋爱关系，不把一次表现概括为永久人设。有原文依据的简称写入 entities.aliases，主题和字段检索词写入 entities.indexWords 与 tags，不以空数组代替检查。首遇时间、相处时长以明确故事时间和经历为准，不因片段密集而夸大亲密程度。',
  schemaVersion: 1,
  sceneTimeRule: 'sourceMessages 的 sceneTime 是程序从连续楼层正文开头的日期和时刻提取的场景参照，不是现实日期，也不覆盖本楼讲述的往事或未来计划。事件发生、实际完成及逐楼时间应对照实际行动那一楼，不能混用最后一楼的日期；回忆、获知和预约分别保留自身含义。',
  kind: 'DraftBundle',
  categories: DRAFT_CATEGORIES,
  requiredCategories: DRAFT_CATEGORIES,
  categoryTypes: Object.freeze(Object.fromEntries(DRAFT_CATEGORIES.map(category=>[category,category==='coverage'?'object':'array of record objects']))),
  sourceRefRules: 'Every record sourceRefs is an array. Copy exact sourceMessages/bridgeMessages id strings as {sourceId:id}, plus fragmentId ONLY when supplied. Do not use floor numbers, record IDs or invent locators. Omit hash, contentHash, version and swipeId: the host binds them from the frozen input. Event links use eventRef/eventRefs, never sourceRefs.',
  coverageRules: Object.freeze({
    type: 'coverage is always an OBJECT, never an array or null, even when there are no events.',
    sourceRefs: 'Array of references for the input sourceMessages range, not bridgeMessages.',
    processed: 'Array of references actually processed, using the same {sourceId, fragmentId if present} format as record sources. Do not output floor numbers, booleans, counts or status objects keyed by floor.',
    bridgeRefs: 'Array of bridge references if used; these do not count as newly processed floors.',
    excluded: 'Array of intentionally excluded sources, each {sourceId, fragmentId if present, reason}. Empty [] if none.',
    unprocessed: 'Array of sources not processed, each {sourceId, fragmentId if present, reason}. Empty [] only if none. Each input source must have exactly one status; do not claim processing that did not occur.',
  }),
  requiredFields: Object.freeze(['scope(host-bound)', 'operationId(host-bound)', 'expectedRevision(host-bound)', 'schemaVersion', 'events', 'awarenessChanges', 'entityFactChanges', 'relationshipChanges', 'personaChanges', 'commitmentChanges', 'performanceHints', 'summaryView', 'conflicts', 'coverage']),
  fields: Object.freeze({
    events: Object.freeze(['id', 'title', 'description', 'recallSummary', 'participants', 'location', 'temporal', 'sourceRefs', 'subject', 'action', 'object', 'state', 'epistemicStatus', 'perspective', 'importance(optional,1-10)', 'mergeInto(optional)', 'keyDialogues(optional)', 'viewpoints(optional)']),
    awarenessChanges: Object.freeze(['id', 'eventRef|eventRefs', 'actorId|person|audience', 'knowledge|fact|content', 'description(optional)', 'status', 'via', 'learnedAt', 'sourceRefs']),
    entityFactChanges: Object.freeze(['id', 'entity|entityId', 'field|key', 'to|value|newValue', 'fieldLabel(optional)', 'temporal(optional)', 'validFrom(optional)', 'validUntil(optional)', 'epistemicStatus', 'sourceRefs']),
    relationshipChanges: Object.freeze(['id', 'from|subject', 'to|object', 'description', 'evidenceKind', 'eventRefs(optional)', 'temporal(optional)', 'epistemicStatus', 'sourceRefs']),
    personaChanges: Object.freeze(['id', 'subject|person|entity', 'description', 'aspect|field|key', 'object|objectRef', 'context', 'scope', 'expiresAt|validUntil|term|duration', 'epistemicStatus', 'sourceRefs','innerLife(optional)']),
    commitmentChanges: Object.freeze(['id', 'participants|subject', 'content|description', 'state', 'epistemicStatus', 'sourceRefs']),
    performanceHints: Object.freeze(['id', 'description', 'context(optional)', 'sourceRefs','innerLife(optional)']),
    summaryView: Object.freeze(['id', 'floorIndex', 'text', 'participants', 'location', 'temporal', 'eventRefs', 'sourceRefs']),
    conflicts: Object.freeze(['id', 'description', 'sourceRefs']),
    coverage: Object.freeze(['sourceRefs', 'bridgeRefs', 'processed', 'excluded', 'unprocessed']),
  }),
  personaValidityRule: '人设变化必须有具体对象、情境、范围与正文来源。有效期有明确依据时填写 expiresAt/validUntil/term/duration；没有明确期限就填 expiresAt:null，不猜日期，不自动判作永久人设。',
  dynamicProfileRule: '人物档案是动态的，不限于身份、学校、住址、爱好。正文新增的能力、等级、身体状态、技能或任意有意义的属性都可使用 entityFactChanges 的自定义 field 与 to 记录。对同一人物使用来源明确的稳定名称；同一属性优先复用 relevantRecords 中已有 field，不因换种说法就另造属性。field 使用清晰中文；已有技术字段名可附中文 fieldLabel。不要把整个人物所有属性硬塞进一个 to；界面会按人物自动归档。相同取值的重复佐证收拢 sourceRefs，真实变化保留不同取值、适用时间与各自来源。不能只凭后出的楼层认定旧事被覆盖，也不能把未来计划当现状。已有 DIY 区块仍遵守该区块定义，不复制成一份无来源的新档案。',
  supplementalNarrativeRule: 'relationshipChanges 的 evidenceKind 是程序分类，不能代替具体内容。必须另写中文 description，说明谁对谁、哪次互动中说了或做了什么、态度或边界如何变化；单方表达不能改成互相确认，可用 expression/response 分别保留。personaChanges、performanceHints、conflicts 同样写能独立理解的中文 description，不只给 aspect、枚举或一个标签；没有材料不捏造。关联事件仅填真实有关的精确 eventRef/eventRefs。时间按含义填写：事件发生用 temporal.occurredAt，知情用 learnedAt，人物属性开始/截止有效用 validFrom/validUntil。不得用获知时间填补旧事件发生时间，不把人物住址当成每次事件的发生地点。',
  floorSummaryRules: Object.freeze({
    cardinality: 'One independent row for EACH sourceMessages item, including user and non-story messages; do not combine floors. bridgeMessages are context only and must not get rows.',
    floorIndex: 'Copy sourceMessages[i].index (absolute host floor, not position in this batch).',
    text: '使用简体中文，完整记下本楼发生的事情与过程：参与者、触发原因、行动或对话、结果及新信息；保留正文明确的时间、地点、关键数值。不是标题或一句标签。有实质内容的长楼通常需要一段或数段；原文有多项独立事务、行动或决定时逐项交代，不能因为 events 已写经过，就把本楼缩成一句。长楼通常写至少两三句，短答和非剧情消息按实际信息量记录，不凑字。同一来源包含不同场景、时段或视角时，分别保留各段有依据的事实与相对先后，不把一段经历或知情套给另一段。不得替下一楼回应或合并楼层。',
    metadata: '每楼同时填写 participants（本楼实际参与人物，不含仅被提及者）、location、temporal 和 eventRefs（本楼涉及的 events 精确 id 数组，无事件则 []）。本楼明确出现的日期、时分、地点必须提取，不可只写在 text 却让字段为空。前文连续场景的明确时间/地点可在确认未转场、未跳时后沿用；回忆中的事件时间与当前叙述时间分开，不能用回忆日期覆盖本楼日期。同一楼含不同场景、时段或视角时，单组元数据只描述可确定的主场景，其他段在 text 中分开；无法给整楼一个共同发生时间时 temporal 不得冒充覆盖所有段落。无依据时用 null，不能用现实日期补空。eventRefs 只链接本楼有正文依据的事件，不能把整批事件都挂到每一楼。',
    awareness: '知情信息仍输出 awarenessChanges 并通过 eventRef/eventRefs 关联事件：明确谁亲历/听见/被告知什么、何时获知。主角自己的行动、收到的物品、直接听到的话有明确依据时应记录，不要因“不能全员知情”的保护规则而全部留空。出现在摘要里的名字不自动等于知情者；被蒙眼、离场、只被谈论的角色不能凭在场名单获知秘密。来源要定位实际获知的楼层，不引用整批来代表每个人早已知道。',
    sourceRefs: 'Exactly one object: {sourceId: sourceMessages[i].id}; also copy fragmentId when present. Never use the floor number as sourceId.',
    id: 'A unique string per summary row. Empty arrays are allowed in other categories but not in summaryView for a non-empty sourceMessages range.',
  }),
  narrativeRules: Object.freeze({
    language: '所有供用户阅读的标题、描述、摘要、人物变化及解释使用简体中文。JSON 字段名、枚举值、来源 ID 保持契约原样；人名、作品名及确需逐字保留的原话不强行翻译。不要用英文动作句夹杂中文人名。',
    eventBody: 'events 是能独立读懂的事件纪要，不是主谓宾标签。title 是短标题；description 是完整经过，仅按明确依据串起起因、谁在何处参与、各方具体做了或说了什么、如何转折、最后实际停在哪里。保留影响理解的约束、否认、承诺、取消、关键物品/数值、尚未解决之处。复杂事件通常需要约 150–450 个汉字，可按信息量增加；这是撰写参考而非硬性字数，简单事件不灌水，复杂事件不为了短而漏事。多模块不能替代这份纪要，也不要把一批全部压成一件事。',
    eventMetadata: 'participants 填参与该事件的人物姓名数组，不把仅被提及的人算在场，更不由参与者推断知情者；location 填原文地点，未知用 null。temporal 使用 assertedAt（本次表述时）、occurredAt（事情发生时）、plannedFor（原定）、actualAt（实际完成）区分各时间，值为有依据的日期或中文时期描述，未知为 null。回忆旧事和当前讲述分开，不能把中学时往事当成本轮刚发生。',
    brief: 'recallSummary 是独立的中文召回速览，通常 60–120 字，保留核心因果、人物、结论和必要条件/否认，不能只是标题。详细 description 必须同时写，二者不能互相替代。插件检索完整纪要，再在本轮预算内选择速览或展开经过。无需另一次模型调用。',
    facts: '时间不明就保留未知或明确的相对先后，不套现实日期，不补造年月日。只有已知锚点才能换算昨天/明天；保留原话时紧邻标注其原语境。说过不等于做到、表达不等于双方确认、回忆/传闻不等于亲历；正文明确情绪可记，不另做心理推断；角色自己的猜测只记为其自述。结果为取消、未接受或尚未完成时必须写清。',
    completeness: '同一次请求同时输出逐楼经过、跨楼事件纪要及其余人物/知情/关系等变化。按正文信息量而非偏好的题材决定详细程度；普通互动中出现的新细节也不能丢。对照本批每一楼检查首尾、人物、时间和结果是否遗漏，不按数组顺序猜来源，不输出思考过程。',
  }),
  retrievalMetadataRules: '每类记录可附 entities:[{name:"正式名称",aliases:["本条来源中明确同指的别称"],kind:"人物|地点|组织|物品|术语之一"}] 和 tags:["具体中文主题"]，不另建无来源的全局词典。自动随总结生成，名称与别称必须出现在该记录 sourceRefs 指向的文字内；不凭原作常识合并，不把“他/她/老师”等泛称当别名。tags 通常 2–5 个具体主题（例如借书归还、转校手续），不用“重要、普通、事件”等无区分度标签。标签只帮助检索，不决定知情或人物身份。summaryView 也可有 recallSummary 速览，但 text 仍保留逐楼完整经过。',
  consolidationRules: '同一件事跨楼延续或被再次谈起，只输出一条 events，串起起因、经过、转折、结果，合并 sourceRefs；同一天同地点也可能是不同事件，不能只因人物/标签/类型相同而合并。与 relevantRecords.events 中既有事件确为同一次经历时，增加 mergeInto:该事件的精确 id；description 记录本批有来源的经过，明确人物、发生时间和动作，单独阅读也能理解；recallSummary 概括本条，不挪用其他事件的内容。mergeInto 是合并建议，系统会先保存有来源的总结，再独立核对跨批合并；不要因目标不确定而省略本批事实。不得编造 mergeInto 或复用别件事的 identityKey。同批链接只能指向前面已输出的事件 id。不同日期的再次相似经历、不同学校/人物、回忆与当前讲述分别记录。观念改变仅保留原文明示的前后与原因，原因未知留空，不抹掉已发生的旧态度。summaryView 仍逐楼独立，不因事件合并而省略楼层。',
  characterDetailRules: 'events、relationshipChanges、personaChanges、performanceHints 可附 viewpoints:[{holder:"持有观念的人",target:"针对谁或什么",content:"具体观念或态度变化",context:"适用语境",basis:"原文明示/角色自述/推测"}] 和 keyDialogues:[{speaker:"说话人",to:"对谁说",text:"原文逐字台词",context:"何时何事下说出",meaning:"体现的观念、关系边界或改变",sourceRefs:[{sourceId:"实际说出这句台词的来源ID"}]}]。记录有辨识度的观念、价值取向、称呼转变、拒绝/接受和重要台词，不把每句闲聊都摘抄。没有原文明示则留空，不虚构内心；推测必须标注。引语必须逐字来自这句台词自己的 sourceRefs，不可把转述改成原话；关系跨多楼，不等于每句台词都出自关系的起止楼层。时间用本事件 temporal，知情者仍输出 awarenessChanges，不能把被谈论的人或全部在场者直接视为知道全部。演绎参考是有语境的行为倾向，不是要求每轮重说名台词或固定人设。',
  enums: Object.freeze({
    eventState: Object.freeze(['proposed', 'attempted', 'accepted', 'completed', 'declined', 'canceled']),
    epistemicStatus: Object.freeze(['observed', 'user_asserted', 'character_claim', 'inferred', 'unknown']),
    awarenessStatus: Object.freeze(['known', 'heard', 'suspected', 'mistaken', 'explicitly_unaware']),
    awarenessVia: Object.freeze(['witnessed', 'heard_in_scene', 'read', 'told', 'background', 'user_confirmed', 'special_ability', 'unknown']),
    relationEvidenceKind: Object.freeze(['expression', 'response', 'mutual_confirmation', 'boundary', 'shared_experience', 'habit', 'background']),
    perspective: Object.freeze(['first_person', 'second_person', 'third_person', 'omniscient', 'unknown']),
  }),
});

export function createSummaryOutputContract() {
  return clone(SUMMARY_OUTPUT_CONTRACT);
}

export const EVENT_STATES = Object.freeze([
  'proposed',
  'attempted',
  'accepted',
  'completed',
  'declined',
  'canceled',
]);

export const EPISTEMIC_STATUSES = Object.freeze([
  'observed',
  'user_asserted',
  'character_claim',
  'inferred',
  'unknown',
]);

export const AWARENESS_STATUSES = Object.freeze([
  'known',
  'heard',
  'suspected',
  'mistaken',
  'explicitly_unaware',
]);

export const AWARENESS_VIA = Object.freeze([
  'unknown',
  'witnessed',
  'heard_in_scene',
  'read',
  'told',
  'background',
  'user_confirmed',
  'special_ability',
]);

export const PERSPECTIVES = Object.freeze([
  'first_person',
  'second_person',
  'third_person',
  'omniscient',
  'unknown',
]);

export const RELATION_EVIDENCE_KINDS = Object.freeze([
  'expression',
  'response',
  'mutual_confirmation',
  'boundary',
  'shared_experience',
  'habit',
  'background',
]);

export const LIFECYCLE_STATES = Object.freeze([
  'active',
  'resolved',
  'retracted',
  'superseded',
]);

const CATEGORY_DEFAULTS = Object.freeze({
  events: [],
  awarenessChanges: [],
  entityFactChanges: [],
  relationshipChanges: [],
  personaChanges: [],
  commitmentChanges: [],
  performanceHints: [],
  summaryView: [],
  conflicts: [],
  coverage: { sourceRefs: [], excluded: [], unprocessed: [] },
});

function requireScope(scope, errors = []) {
  if (!isPlainObject(scope)) {
    errors.push('scope must be an object');
    return {};
  }
  const result = {};
  for (const key of ['accountId', 'chatId', 'branchId']) {
    if (scope[key] !== undefined && (typeof scope[key] !== 'string' || !scope[key].trim())) {
      errors.push(`scope.${key} must be a non-empty string when provided`);
    } else if (scope[key] !== undefined) {
      result[key] = scope[key];
    }
  }
  if (!result.chatId && !result.branchId && !result.accountId) {
    errors.push('scope must identify at least an account, chat, or branch');
  }
  return result;
}

export function normalizeScope(scope) {
  const errors = [];
  const normalized = requireScope(scope, errors);
  if (errors.length) throw new ValidationError('invalid scope', errors);
  return normalized;
}

export function scopeKey(scope) {
  return stableStringify(normalizeScope(scope));
}

function normalizeSourceRef(ref) {
  if (typeof ref === 'string' && ref.trim()) return { sourceId: ref.trim() };
  if (!isPlainObject(ref)) return null;
  const sourceId = ref.sourceId ?? ref.messageId ?? ref.id ?? ref.uuid;
  if (typeof sourceId !== 'string' || !sourceId.trim()) return null;
  const result = { sourceId: sourceId.trim() };
  if (ref.version !== undefined && !((typeof ref.version === 'number' && Number.isInteger(ref.version) && ref.version >= 0) || (typeof ref.version === 'string' && ref.version.trim()))) return null;
  if (ref.swipeId !== undefined && !((typeof ref.swipeId === 'number' && Number.isInteger(ref.swipeId) && ref.swipeId >= 0) || (typeof ref.swipeId === 'string' && ref.swipeId.trim()))) return null;
  if (ref.fragmentId !== undefined && (typeof ref.fragmentId !== 'string' || !ref.fragmentId.trim())) return null;
  for (const key of ['hash', 'contentHash']) if (ref[key] !== undefined && (typeof ref[key] !== 'string' || !ref[key].trim())) return null;
  for (const key of ['version', 'swipeId', 'hash', 'contentHash', 'fragmentId', 'kind']) {
    if (ref[key] !== undefined) result[key] = ref[key];
  }
  return result;
}

export function normalizeSourceRefs(refs) {
  return (Array.isArray(refs) ? refs : []).map(normalizeSourceRef).filter(Boolean);
}

function normalizeMessage(message, index) {
  if (!isPlainObject(message)) throw new ValidationError(`source message ${index} must be an object`);
  if(message.index!==undefined){if(!Number.isInteger(message.index)||message.index<0)throw new ValidationError('source message index must be a non-negative integer');index=message.index;}
  const id = message.id ?? message.messageId ?? message.uuid ?? message.sourceId;
  if (typeof id !== 'string' || !id.trim()) {
    throw new ValidationError(`source message ${index} has no stable id`);
  }
  if (message.complete === false || message.streaming === true || message.isStreaming === true) {
    throw new ValidationError(`source message ${id} is not complete`, { sourceId: id });
  }
  const text = String(message.text ?? message.mes ?? message.content ?? '');
  // External hashes are useful evidence, but they are optional and can be
  // stale.  Always retain a digest of the frozen body so edits are detected
  // even when a host omits (or incorrectly reuses) its hash.
  const contentHash = sha256(text);
  const suppliedHash = typeof message.hash === 'string' && message.hash.trim() ? message.hash.trim() : null;
  const version = message.version ?? message.swipeId ?? 0;
  if (!((typeof version === 'number' && Number.isInteger(version) && version >= 0) || (typeof version === 'string' && version.trim()))) {
    throw new ValidationError(`source message ${id} has an invalid version/swipe`, { sourceId: id });
  }
  if (message.fragmentId !== undefined && (typeof message.fragmentId !== 'string' || !message.fragmentId.trim())) {
    throw new ValidationError(`source message ${id} has an invalid fragmentId`, { sourceId: id });
  }
  return {
    id: id.trim(),
    role: message.is_system===true?'system':message.is_user===true?'user':
      ['user','assistant','system'].includes(message.role)?message.role:message.is_user===false?'assistant':
      ['user','assistant','system'].includes(message.name)?message.name:'unknown',
    text,
    version,
    hash: suppliedHash ?? contentHash,
    contentHash,
    index,
    complete: true,
    fragmentId: message.fragmentId,
  };
}

/** Freeze the input range and revisions used by a summary job. */
export function createSummaryBatch({
  scope,
  operationId = makeId('summary'),
  expectedRevision = 0,
  messages = [],
  sourceMessages,
  focusSpec = null,
  configVersion = '1',
  rulesVersion = '1',
  bridgeMessages = [],
  requestedRange,
  inputBudget,
  outputBudget,
  outputReserveUnits,
  rules = null,
  recordingRules = null,
  focusVersion = null,
  trigger = 'automatic',
} = {}) {
  const frozenScope = normalizeScope(scope);
  if (typeof operationId !== 'string' || !operationId.trim()) throw new ValidationError('operationId must be a non-empty string');
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new ValidationError('expectedRevision must be a non-negative integer');
  const input = sourceMessages ?? messages;
  if (!Array.isArray(input) || input.length === 0) throw new ValidationError('summary batch requires at least one source message');
  const normalizedMessages = input.map((message,offset)=>normalizeMessage(message,(Number.isInteger(requestedRange?.startIndex)?requestedRange.startIndex:0)+offset));
  const normalizedBridgeMessages = Array.isArray(bridgeMessages) ? bridgeMessages.map(normalizeMessage) : [];
  const range = requestedRange ?? {
    startIndex: normalizedMessages[0].index,
    endIndex: normalizedMessages[normalizedMessages.length - 1].index,
  };
  return {
    schemaVersion: 1,
    kind: 'SummaryBatch',
    scope: frozenScope,
    operationId: operationId.trim(),
    expectedRevision,
    configVersion: String(configVersion),
    rulesVersion: String(rulesVersion),
    focusSpec: focusSpec ? clone(focusSpec) : null,
    focusVersion: focusVersion == null ? sha256(focusSpec ?? null).slice(0, 24) : String(focusVersion),
    trigger: String(trigger ?? 'automatic'),
    rules: clone(recordingRules ?? rules),
    sourceMessages: clone(normalizedMessages),
    bridgeMessages: clone(normalizedBridgeMessages),
    parentRange: { startIndex: range.startIndex, endIndex: range.endIndex },
    coverage: {
      sourceRefs: normalizedMessages.map((message) => ({ sourceId: message.id, version: message.version, hash: message.hash, contentHash: message.contentHash, fragmentId: message.fragmentId })),
      bridgeRefs: normalizedBridgeMessages.map((message) => ({ sourceId: message.id, version: message.version, hash: message.hash, contentHash: message.contentHash, fragmentId: message.fragmentId })),
      processed: [],
      unprocessed: [],
    },
    budgets: {
      inputUnits: Number.isFinite(inputBudget) ? inputBudget : null,
      outputUnits: Number.isFinite(outputBudget) ? outputBudget : null,
      outputReserveUnits: Number.isFinite(outputReserveUnits) ? outputReserveUnits : null,
    },
    // Scope (including branch), version, fragment and body all participate in
    // the frozen revision.  The caller-provided hash remains an auditable
    // source field, while contentHash protects against stale/missing hashes.
    sourceRevision: sha256({
      scope: frozenScope,
      parentRange: { startIndex: range.startIndex, endIndex: range.endIndex },
      sourceMessages: normalizedMessages.map((message) => ({ id: message.id, role: message.role, text: message.text, version: message.version, hash: message.hash, contentHash: message.contentHash, fragmentId: message.fragmentId })),
      bridgeMessages: normalizedBridgeMessages.map((message) => ({ id: message.id, role: message.role, text: message.text, version: message.version, hash: message.hash, contentHash: message.contentHash, fragmentId: message.fragmentId })),
    }),
  };
}

function normalizedCategory(value, category) {
  if (category === 'coverage') {
    if (!isPlainObject(value)) return clone(CATEGORY_DEFAULTS.coverage);
    return {
      sourceRefs: normalizeSourceRefs(value.sourceRefs ?? value.processed ?? []),
      bridgeRefs: normalizeSourceRefs(value.bridgeRefs ?? []),
      processed: normalizeSourceRefs(value.processed ?? value.sourceRefs ?? []),
      excluded: Array.isArray(value.excluded) ? clone(value.excluded) : [],
      unprocessed: Array.isArray(value.unprocessed) ? clone(value.unprocessed) : [],
    };
  }
  return Array.isArray(value) ? clone(value) : [];
}

function validateRawCoverageShape(coverage, issues) {
  const errors = [];
  if (!isPlainObject(coverage)) {
    issues.push({path:'coverage',reason:'type_mismatch',expectedType:'object',actualType:valueType(coverage)});
    return ['coverage must be an object'];
  }
  const arrayFields = ['sourceRefs', 'bridgeRefs', 'processed', 'excluded', 'unprocessed'];
  for (const key of arrayFields) {
    if (coverage[key] !== undefined && !Array.isArray(coverage[key])) {
      errors.push(`coverage.${key} must be an array`);
      issues.push({path:`coverage.${key}`,reason:'type_mismatch',expectedType:'array',actualType:valueType(coverage[key])});
      continue;
    }
    const values = coverage[key] ?? [];
    for (let index = 0; index < values.length; index += 1) {
      const item = values[index];
      if (key === 'excluded' || key === 'unprocessed') {
        const validString = typeof item === 'string' && item.trim();
        const validObject = isPlainObject(item) && normalizeSourceRefs([item]).length === 1;
        if (!validString && !validObject) {
          errors.push(`coverage.${key}[${index}] must identify a source`);
          issues.push({path:`coverage.${key}[${index}]`,reason:'invalid_source_ref',actualType:valueType(item)});
        }
      } else if (!normalizeSourceRefs([item]).length) {
        errors.push(`coverage.${key}[${index}] must be a valid source reference`);
        issues.push({path:`coverage.${key}[${index}]`,reason:'invalid_source_ref',actualType:valueType(item)});
      }
    }
  }
  return errors;
}

function validateRawBundleShape(source) {
  const errors = [], issues = [];
  for (const category of DRAFT_CATEGORIES) {
    if (!(category in source)) continue;
    if (category === 'coverage') {
      errors.push(...validateRawCoverageShape(source.coverage,issues));
    } else if (!Array.isArray(source[category])) {
      errors.push(`${category} must be an array`);
      issues.push({path:category,reason:'type_mismatch',expectedType:'array',actualType:valueType(source[category])});
    } else {
      source[category].forEach((record,index)=>{
        const path=`${category}[${index}]`;
        if(!isPlainObject(record)){
          errors.push(`${path} must be an object`);
          issues.push({path,reason:'type_mismatch',expectedType:'object',actualType:valueType(record)});
          return;
        }
        for(const [name,expectedType] of [['title','string'],['description','string'],['recallSummary','string'],['entities','array'],['tags','array']]){
          if(record[name]==null)continue;
          if(valueType(record[name])!==expectedType){errors.push(`${path}.${name} must be a ${expectedType}`);issues.push({path:`${path}.${name}`,reason:'type_mismatch',expectedType,actualType:valueType(record[name])});}
        }
        const refs=record.sourceRefs??record.sources;
        // Check supplied refs before normalization can silently discard bad
        // entries. Omitted optional sources keep the existing later checks.
        if(refs===undefined)return;
        if(!Array.isArray(refs)){
          errors.push(`${path}.sourceRefs must be an array`);
          issues.push({path:`${path}.sourceRefs`,reason:'type_mismatch',expectedType:'array',actualType:valueType(refs)});
        }else refs.forEach((ref,refIndex)=>{
          if(normalizeSourceRefs([ref]).length)return;
          errors.push(`${path}.sourceRefs contains an invalid reference`);
          issues.push({path:`${path}.sourceRefs[${refIndex}]`,reason:'invalid_source_ref',actualType:valueType(ref)});
        });
      });
    }
  }
  if (errors.length) throw new ValidationError('DraftBundle contains malformed category types', { errors, validationIssueCount:issues.length, validationIssues:issues.slice(0,512) });
}

function sourceEvidenceKey(ref) {
  const normalized = normalizeSourceRefs([ref])[0];
  if (!normalized) return null;
  return stableStringify({
    sourceId: normalized.sourceId,
    version: normalized.version ?? null,
    swipeId: normalized.swipeId ?? null,
    fragmentId: normalized.fragmentId ?? null,
    contentHash: normalized.contentHash ?? normalized.hash ?? null,
  });
}

function evidenceFieldMatches(requested, candidate, field) {
  if (requested[field] === undefined) return true;
  return stableStringify(requested[field]) === stableStringify(candidate[field]);
}

function bindEvidenceRef(ref, candidates, field) {
  const matches = candidates.filter((candidate) => (
    evidenceFieldMatches(ref, candidate, 'version')
    && evidenceFieldMatches(ref, candidate, 'swipeId')
    && evidenceFieldMatches(ref, candidate, 'fragmentId')
    && evidenceFieldMatches(ref, candidate, 'contentHash')
    && evidenceFieldMatches(ref, candidate, 'hash')
  ));
  if (matches.length > 1) {
    throw new ValidationError(`${field} has ambiguous source evidence`, {
      sourceId: ref.sourceId,
      candidates: matches.map((candidate) => sourceEvidenceKey(candidate)),
      validationIssueCount:1,
      validationIssues:[{path:field,reason:'source_ambiguous',candidateCount:matches.length}],
    });
  }
  if (matches.length === 1) return clone(matches[0]);
  // A known source with supplied locator fields must bind to the exact frozen
  // evidence.  Keeping a mismatched fragment/hash merely because there is one
  // candidate would let later source-ID-only validation accept forged
  // evidence.  Unknown source IDs are retained so the normal allowed-source
  // validation can report them, but known mismatches fail here.
  if (candidates.length > 0) {
    throw new ValidationError(`${field} cannot resolve source evidence`, {
      sourceId: ref.sourceId,
      candidates: candidates.map((candidate) => sourceEvidenceKey(candidate)),
      validationIssueCount:1,
      validationIssues:[{path:field,reason:'source_mismatch',candidateCount:candidates.length,locatorFields:['version','swipeId','fragmentId','contentHash','hash'].filter(key=>ref[key]!==undefined)}],
    });
  }
  return null;
}

/**
 * Bind model business fields to host-owned execution metadata.  Model values
 * for scope/operationId/expectedRevision are deliberately ignored.
 */
export function bindDraftBundle(modelOutput, {
  scope,
  operationId,
  expectedRevision,
  parentRange = null,
  childRange = null,
  sourceRefs = [],
  sourceFloorIndices = [],
  sourceTexts = [],
  readingConfig = '',
  requireKnowledgeEvidence = false,
  sourceRevision = null,
  configVersion = '1',
  rulesVersion = '1',
  focusVersion = null,
  correctionAuthorizations = [],
} = {}) {
  const boundScope = normalizeScope(scope);
  if (typeof operationId !== 'string' || !operationId.trim()) throw new ValidationError('bound operationId is required');
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new ValidationError('bound expectedRevision is invalid');
  const source = isPlainObject(modelOutput) ? modelOutput : {};
  validateRawBundleShape(source);
  const boundEvidenceRefs = normalizeSourceRefs(sourceRefs);
  const timeline=sourceTimeline(sourceTexts,sourceFloorIndices);
  const evidenceBySource = new Map();
  for (const ref of boundEvidenceRefs) {
    const list = evidenceBySource.get(ref.sourceId) ?? [];
    list.push(ref);
    evidenceBySource.set(ref.sourceId, list);
  }
  const bindEvidence = (record, category, recordIndex) => {
    let next = category === 'entityFactChanges' ? normalizeFactValidity(clone(record)) : clone(record);
    const raw = normalizeSourceRefs(record?.sourceRefs ?? record?.sources ?? []);
    next.sourceRefs = raw.map((ref, index) => {
      const candidates = evidenceBySource.get(ref.sourceId) ?? [];
      const matched = bindEvidenceRef(ref, candidates, `${category}[${recordIndex}].sourceRefs[${index}]`);
      // Unknown refs are retained for the later allowed-source validation;
      // known-but-ambiguous refs fail above rather than being last-write-wins.
      return matched ?? clone(ref);
    });
    delete next.sources;
    if(category==='awarenessChanges')next=completeSummaryKnowledgeRefs(next,sourceTexts,boundEvidenceRefs,{readingConfig});
    if(['events','relationshipChanges','personaChanges','performanceHints'].includes(category))next=bindDialogueSources(next,{sources:sourceTexts,sourceRefs:boundEvidenceRefs,sourceFloorIndices});
    next=reconcileSourceTimes(next,category,timeline);
    // Display floors are host-derived metadata, never supplied by the model.
    delete next.sourceFloors;
    const floors=sourceFloorIndices.filter(m=>Number.isSafeInteger(m.index)&&m.index>=0&&next.sourceRefs.some(ref=>ref.sourceId===m.sourceId&&ref.fragmentId===m.fragmentId)).map(m=>m.index);
    if(floors.length)next.sourceFloors=[...new Set(floors)].sort((a,b)=>a-b);
    const evidence=sourceTexts.filter(m=>next.sourceRefs.some(r=>r.sourceId===m.sourceId&&r.fragmentId===m.fragmentId)).map(m=>m.text).join('\n');
    const canonical=[...(Array.isArray(next.participants)?next.participants:[]),next.person].filter(n=>typeof n==='string').map(name=>({name,kind:'人物',aliases:[]}));
    for(const name of [next.subject,next.entity])if(typeof name==='string')canonical.push({name,kind:'术语',aliases:[]});
    if(typeof next.location==='string')canonical.push({name:next.location,kind:'地点',aliases:[]});
    const terms=new Map();
    for(const term of normalizeTerms([...(Array.isArray(next.entities)?next.entities:[]),...canonical]))if(evidence.includes(term.name)){
      const key=term.name.toLocaleLowerCase(),previous=terms.get(key);terms.set(key,{...(previous??term),aliases:[...new Set([...(previous?.aliases??[]),...term.aliases.filter(a=>evidence.includes(a))])]});
    }
    next.entities=[...terms.values()];
    if(next.tags!==undefined)next.tags=normalizeTags(next.tags);
    delete next.journalOnly;
    if(next.innerLife!==undefined&&!['personaChanges','performanceHints'].includes(category))delete next.innerLife;
    const knowledge=category==='awarenessChanges'&&requireKnowledgeEvidence&&next.acquisitionEvidence===undefined?{...next,acquisitionEvidence:null}:next;
    const checked=category==='awarenessChanges'?bindSummaryKnowledge(knowledge,sourceTexts.filter(m=>next.sourceRefs.some(r=>r.sourceId===m.sourceId&&r.fragmentId===m.fragmentId)),bindKnowledgeEvidence,{readingConfig}):next;
    return bindOriginalSource(bindCharacterDetails(completeInnerLife(enrichRetrievalMetadata(checked,evidence),evidence,category),evidence),category,sourceTexts);
  };
  const bindCategory = category => normalizedCategory(source[category],category).map((record,index)=>bindEvidence(record,category,index));
  const bundle = {
    schemaVersion: 1,
    kind: 'DraftBundle',
    scope: clone(boundScope),
    operationId: operationId.trim(),
    expectedRevision,
    configVersion: String(configVersion),
    rulesVersion: String(rulesVersion),
    focusVersion: focusVersion == null ? null : String(focusVersion),
    sourceRevision: sourceRevision ? String(sourceRevision) : null,
    parentRange: parentRange ? clone(parentRange) : null,
    childRange: childRange ? clone(childRange) : null,
    events: bindCategory('events'),
    awarenessChanges: bindCategory('awarenessChanges'),
    entityFactChanges: bindCategory('entityFactChanges'),
    relationshipChanges: bindCategory('relationshipChanges'),
    personaChanges: bindCategory('personaChanges'),
    commitmentChanges: bindCategory('commitmentChanges'),
    performanceHints: bindCategory('performanceHints'),
    summaryView: bindCategory('summaryView'),
    conflicts: bindCategory('conflicts'),
    coverage: normalizedCategory(source.coverage, 'coverage'),
    binding: {
      sourceRefs: boundEvidenceRefs,
      boundBy: 'shiyi-core',
      // Only the host may populate this allow-list.  Model fields such as
      // explicitCorrection/correctionOf/changeKind are retained for audit,
      // but do not grant authority by themselves.
      correctionAuthorizations: [...new Set((Array.isArray(correctionAuthorizations) ? correctionAuthorizations : []).filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim()))],
    },
  };
  // Preserve diagnostics without allowing the model to smuggle executable or
  // persistence instructions into the bundle.
  if (Array.isArray(source.trace)) bundle.trace = clone(source.trace);
  return bundle;
}

export function createDraftBundle(input = {}) {
  const { modelOutput, ...binding } = input;
  return bindDraftBundle(modelOutput ?? input.data ?? input, binding);
}

function recordId(record, field = 'id') {
  return typeof record?.[field] === 'string' && record[field].trim() ? record[field].trim() : null;
}

function sourceIdsOf(record) {
  return normalizeSourceRefs(record?.sourceRefs ?? record?.sources ?? []).map((ref) => ref.sourceId);
}

function validEnum(value, allowed, field, errors, { optional = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (!optional) errors.push(`${field} is required`);
    return;
  }
  if (!allowed.includes(value)) errors.push(`${field} must be one of ${allowed.join(', ')}`);
}

function validateSourceRefs(record, field, allowedSourceIds, errors) {
  const rawRefs = record?.sourceRefs ?? record?.sources;
  if (!Array.isArray(rawRefs)) errors.push(`${field}.sourceRefs must be an array`);
  const refs = normalizeSourceRefs(rawRefs ?? []);
  if (Array.isArray(rawRefs) && refs.length !== rawRefs.length) errors.push(`${field}.sourceRefs contains an invalid reference`);
  if (refs.length === 0) errors.push(`${field}.sourceRefs must contain a stable source reference`);
  if (allowedSourceIds) {
    for (const ref of refs) if (!allowedSourceIds.has(ref.sourceId)) errors.push(`${field} references unknown source ${ref.sourceId}`);
  }
  return refs;
}

function validateEvents(events, allowedSourceIds, errors, invalidIds, newSourceIds = null) {
  const ids = new Set();
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const field = `events[${index}]`;
    const errorsBefore = errors.length;
    const id = recordId(event);
    if (!id) { errors.push(`${field}.id must be a non-empty string`); continue; }
    if (ids.has(id)) errors.push(`${field}.id is duplicated: ${id}`);
    ids.add(id);
    const refs = validateSourceRefs(event, field, allowedSourceIds, errors);
    if (newSourceIds && refs.length && !refs.some((ref) => newSourceIds.has(ref.sourceId))) {
      errors.push(`${field} is supported only by bridge/context sources; a new source reference is required`);
    }
    validEnum(event.state ?? event.status, EVENT_STATES, `${field}.state`, errors, { optional: false });
    validEnum(event.epistemicStatus, EPISTEMIC_STATUSES, `${field}.epistemicStatus`, errors, { optional: false });
    validEnum(event.perspective, PERSPECTIVES, `${field}.perspective`, errors, { optional: false });
    if (!event.action && !event.description && !event.content) errors.push(`${field} needs an action or description`);
    if (event.invalid === true || event.valid === false || errors.length > errorsBefore) invalidIds.add(id);
  }
  return ids;
}

function checkEventRef(record, field, eventIds, knownRecordIds, invalidEventIds, errors) {
  const refs = [];
  for (const key of ['eventRef', 'eventId', 'sourceEventId']) {
    if (record?.[key] !== undefined) refs.push({ key, value: record[key] });
  }
  for (const key of ['eventRefs', 'eventIds']) {
    if (Array.isArray(record?.[key])) refs.push(...record[key].map((value) => ({ key, value })));
  }
  for (const ref of refs) {
    if (typeof ref.value !== 'string' || (!eventIds.has(ref.value) && !knownRecordIds?.has(ref.value))) {
      errors.push(`${field}.${ref.key} references unknown event ${String(ref.value)}`);
    } else if (eventIds.has(ref.value) && invalidEventIds.has(ref.value)) {
      errors.push(`${field}.${ref.key} depends on invalid event ${ref.value}`);
    }
  }
  return refs;
}

function validateAwareness(records, eventIds, knownRecordIds, invalidEventIds, allowedSourceIds, errors, factIds = new Set()) {
  const ids = new Set();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const field = `awarenessChanges[${index}]`;
    const id = recordId(record);
    if (!id) errors.push(`${field}.id must be a non-empty string`); else if (ids.has(id)) errors.push(`${field}.id is duplicated`); else ids.add(id);
    checkEventRef(record, field, eventIds, knownRecordIds, invalidEventIds, errors);
    if (record.recordRef !== undefined && (typeof record.recordRef !== 'string' || !factIds.has(record.recordRef) && !knownRecordIds.has(record.recordRef))) errors.push(`${field}.recordRef references unknown fact`);
    validateSourceRefs(record, field, allowedSourceIds, errors);
    if (!record.actorId && !record.person && !record.personId && !record.audience) errors.push(`${field} needs an actor/person/audience`);
    if (!record.knowledge && !record.fact && !record.content) errors.push(`${field} needs a knowledge payload`);
    validEnum(record.status ?? record.knowledgeStatus, AWARENESS_STATUSES, `${field}.status`, errors, { optional: false });
    validEnum(record.via, AWARENESS_VIA, `${field}.via`, errors, { optional: false });
    if (!('learnedAt' in record)) errors.push(`${field}.learnedAt is required (null/unknown is allowed)`);
    validEnum(record.epistemicStatus, EPISTEMIC_STATUSES, `${field}.epistemicStatus`, errors);
    validEnum(record.perspective, PERSPECTIVES, `${field}.perspective`, errors);
  }
  return ids;
}

function validateEntityFacts(records, eventIds, knownRecordIds, invalidEventIds, allowedSourceIds, errors, existingFacts = [], { enforceCorrectionAuthority = false, trustedCorrectionIds = new Set() } = {}) {
  const ids = new Set();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const field = `entityFactChanges[${index}]`;
    const id = recordId(record);
    if (!id) errors.push(`${field}.id must be a non-empty string`); else if (ids.has(id)) errors.push(`${field}.id is duplicated`); else ids.add(id);
    checkEventRef(record, field, eventIds, knownRecordIds, invalidEventIds, errors);
    validateSourceRefs(record, field, allowedSourceIds, errors);
    if (!record.entity && !record.entityId) errors.push(`${field} needs an entity`);
    if (!record.field && !record.key) errors.push(`${field} needs a field/key`);
    validEnum(record.epistemicStatus, EPISTEMIC_STATUSES, `${field}.epistemicStatus`, errors, { optional: false });
    const entity = record.entity ?? record.entityId;
    const key = record.field ?? record.key;
    const value = record.to ?? record.value ?? record.newValue;
    if (!('to' in record) && !('value' in record) && !('newValue' in record)) errors.push(`${field} needs a new value (null is allowed)`);
    const hardFact = existingFacts.find((fact) => (fact.entity ?? fact.entityId) === entity && (fact.field ?? fact.key) === key && fact.confirmed === true);
    if (hardFact && stableStringify(hardFact.value ?? hardFact.to) !== stableStringify(value)) {
      const modelMarker = record.explicitCorrection === true || record.correctionOf || record.changeKind === 'correct' || record.changeKind === 'revise';
      const hostAuthorized = trustedCorrectionIds.has(id) || trustedCorrectionIds.has(record.correctionOf);
      if (!modelMarker || (enforceCorrectionAuthority && !hostAuthorized)) {
        errors.push(`${field} conflicts with confirmed fact ${entity}.${key}; host-authorized correction evidence is required`);
      }
    }
  }
  return ids;
}

function validateRelationships(records, eventIds, knownRecordIds, invalidEventIds, allowedSourceIds, errors) {
  const ids = new Set();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const field = `relationshipChanges[${index}]`;
    const id = recordId(record);
    if (!id) errors.push(`${field}.id must be a non-empty string`); else if (ids.has(id)) errors.push(`${field}.id is duplicated`); else ids.add(id);
    checkEventRef(record, field, eventIds, knownRecordIds, invalidEventIds, errors);
    validateSourceRefs(record, field, allowedSourceIds, errors);
    if (!(record.from ?? record.subject) || !(record.to ?? record.object)) errors.push(`${field} needs directional participants`);
    const evidenceKind = record.evidenceKind ?? (RELATION_EVIDENCE_KINDS.includes(record.kind) ? record.kind : undefined);
    validEnum(evidenceKind, RELATION_EVIDENCE_KINDS, `${field}.evidenceKind`, errors, { optional: false });
    // A response or mutual confirmation is never synthesized from an
    // expression.  If supplied, it must retain its own evidence payload.
    for (const key of ['expression', 'response', 'mutualConfirmation', 'publicScope']) {
      if (record[key] !== undefined && typeof record[key] !== 'object' && typeof record[key] !== 'string' && typeof record[key] !== 'boolean') {
        errors.push(`${field}.${key} has an invalid shape`);
      }
    }
    validEnum(record.epistemicStatus, EPISTEMIC_STATUSES, `${field}.epistemicStatus`, errors, { optional: false });
  }
  return ids;
}

function validatePersona(records, eventIds, knownRecordIds, invalidEventIds, allowedSourceIds, errors) {
  const ids = new Set();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const field = `personaChanges[${index}]`;
    const id = recordId(record);
    if (!id) errors.push(`${field}.id must be a non-empty string`); else if (ids.has(id)) errors.push(`${field}.id is duplicated`); else ids.add(id);
    checkEventRef(record, field, eventIds, knownRecordIds, invalidEventIds, errors);
    validateSourceRefs(record, field, allowedSourceIds, errors);
    if (!(record.subject ?? record.person ?? record.entity)) errors.push(`${field} needs a subject`);
    if (!(record.aspect ?? record.field ?? record.key)) errors.push(`${field} needs an aspect`);
    // Object/context/time/scope make a local change non-global by default.
    if (!record.object && !record.objectRef) errors.push(`${field}.object is required to bound a persona change`);
    if (!record.context) errors.push(`${field}.context is required to bound a persona change`);
    if (!record.scope) errors.push(`${field}.scope is required to bound a persona change`);
    if (!('expiresAt' in record) && !('validUntil' in record) && !('term' in record) && !('duration' in record)) errors.push(`${field}.expiresAt/term is required to bound a persona change`);
    validEnum(record.epistemicStatus, EPISTEMIC_STATUSES, `${field}.epistemicStatus`, errors, { optional: false });
  }
  return ids;
}

function validateCommitments(records, eventIds, knownRecordIds, invalidEventIds, allowedSourceIds, errors) {
  const ids = new Set();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const field = `commitmentChanges[${index}]`;
    const id = recordId(record);
    if (!id) errors.push(`${field}.id must be a non-empty string`); else if (ids.has(id)) errors.push(`${field}.id is duplicated`); else ids.add(id);
    checkEventRef(record, field, eventIds, knownRecordIds, invalidEventIds, errors);
    validateSourceRefs(record, field, allowedSourceIds, errors);
    validEnum(record.state ?? record.status, [...EVENT_STATES,'unknown'], `${field}.state`, errors, { optional: false });
    if (!record.participants && !record.subject) errors.push(`${field} needs participants`);
    if (!record.content && !record.description) errors.push(`${field} needs commitment content`);
    validEnum(record.epistemicStatus, EPISTEMIC_STATUSES, `${field}.epistemicStatus`, errors, { optional: false });
  }
  return ids;
}

function validateGenericRecords(category, records, eventIds, knownRecordIds, invalidEventIds, allowedSourceIds, errors, { sourceRequired = false } = {}) {
  const ids = new Set();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const field = `${category}[${index}]`;
    const id = recordId(record);
    if (!id) errors.push(`${field}.id must be a non-empty string`); else if (ids.has(id)) errors.push(`${field}.id is duplicated`); else ids.add(id);
    checkEventRef(record, field, eventIds, knownRecordIds, invalidEventIds, errors);
    if (sourceRequired) validateSourceRefs(record, field, allowedSourceIds, errors);
  }
  return ids;
}

function isolateDependencies(bundle, invalidEventIds) {
  const isolated = [];
  if (invalidEventIds.size) isolated.push(...[...invalidEventIds].map((id) => ({ kind: 'event', id, reason: 'invalid_event' })));
  for (const category of ['awarenessChanges', 'relationshipChanges', 'personaChanges', 'commitmentChanges']) {
    for (const record of bundle[category] ?? []) {
      const refs = [record.eventRef, record.eventId, ...(record.eventRefs ?? []), ...(record.eventIds ?? [])].filter(Boolean);
      if (refs.some((ref) => invalidEventIds.has(ref))) isolated.push({ kind: category, id: record.id, reason: 'depends_on_invalid_event' });
    }
  }
  return isolated;
}

function coverageRefKey(ref) {
  const normalized = normalizeSourceRefs([ref])[0];
  if (!normalized) return null;
  return stableStringify({
    sourceId: normalized.sourceId,
    version: normalized.version ?? null,
    swipeId: normalized.swipeId ?? null,
    fragmentId: normalized.fragmentId ?? null,
    // A fragment/version can still be edited in place.  Keep the body hash
    // in the evidence key so coverage and binding cannot silently attach the
    // result for one edit to another.
    contentHash: normalized.contentHash ?? normalized.hash ?? null,
  });
}

function coverageSourceId(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (isPlainObject(value)) {
    const ref = normalizeSourceRefs([value])[0];
    return ref?.sourceId ?? null;
  }
  return null;
}

/**
 * Validate and classify model-reported coverage without treating the frozen
 * submitted range as proof that the model actually processed it.
 */
export function coverageState(coverage, expectedSourceRefs = []) {
  const value = isPlainObject(coverage) ? coverage : {};
  const submitted = normalizeSourceRefs(value.sourceRefs ?? []);
  const processed = normalizeSourceRefs(value.processed ?? []);
  const excluded = Array.isArray(value.excluded) ? value.excluded.map((item) => ({ item: clone(item), sourceId: coverageSourceId(item) })).filter((item) => item.sourceId) : [];
  const unprocessed = Array.isArray(value.unprocessed) ? value.unprocessed.map((item) => ({ item: clone(item), sourceId: coverageSourceId(item) })).filter((item) => item.sourceId) : [];
  const expected = normalizeSourceRefs(expectedSourceRefs);
  const expectedById = new Map();
  for (const ref of expected) {
    const key = ref.sourceId;
    if (!expectedById.has(key)) expectedById.set(key, []);
    expectedById.get(key).push(ref);
  }
  const usedExpected = new Set();
  const matchedStatus = { processed: [], excluded: [], unprocessed: [] };
  const overlaps = [];
  const matchExpected = (ref) => {
    const options = expectedById.get(ref?.sourceId) ?? [];
    const hasLocator = ['version', 'swipeId', 'fragmentId', 'contentHash', 'hash'].some((key) => ref?.[key] !== undefined);
    if (!hasLocator && options.length > 1) return null;
    const matches = options.filter((candidate) => {
      const key = coverageRefKey(candidate);
      if (usedExpected.has(key)) return false;
      if (ref?.fragmentId !== undefined && ref.fragmentId !== candidate.fragmentId) return false;
      if (ref?.version !== undefined && ref.version !== candidate.version) return false;
      if (ref?.swipeId !== undefined && ref.swipeId !== candidate.swipeId) return false;
      if (ref?.contentHash !== undefined && ref.contentHash !== candidate.contentHash) return false;
      if (ref?.hash !== undefined && ref.hash !== candidate.hash) return false;
      return true;
    });
    // A source-only status is ambiguous when multiple frozen fragments/edits
    // share its message ID.  Treat it as an overlap, not as the first match.
    return matches.length === 1 ? matches[0] : null;
  };
  const assign = (kind, values) => {
    for (const entry of values) {
      const ref = typeof entry === 'string' ? { sourceId: entry } : normalizeSourceRefs([entry])[0];
      if (!ref) continue;
      const candidate = matchExpected(ref);
      const key = candidate ? coverageRefKey(candidate) : `source:${ref.sourceId}`;
      const prior = [...matchedStatus.processed, ...matchedStatus.excluded, ...matchedStatus.unprocessed].find((item) => item.key === key);
      if (prior && prior.kind !== kind) overlaps.push(key);
      if (!candidate && (expectedById.get(ref.sourceId)?.length ?? 0) > 0) overlaps.push(`ambiguous:${ref.sourceId}`);
      if (candidate) usedExpected.add(coverageRefKey(candidate));
      matchedStatus[kind].push({ key, kind, sourceId: ref.sourceId, ref: clone(ref) });
    }
  };
  assign('processed', processed);
  assign('excluded', excluded.map((entry) => entry.item));
  assign('unprocessed', unprocessed.map((entry) => entry.item));
  const missing = expected.filter((ref) => !usedExpected.has(coverageRefKey(ref))).map((ref) => clone(ref));
  return {
    submitted,
    processed,
    excluded,
    unprocessed,
    missing,
    overlaps,
    complete: expected.length > 0 && missing.length === 0 && overlaps.length === 0 && unprocessed.length === 0,
    partial: expected.length > 0 && (missing.length > 0 || unprocessed.length > 0 || overlaps.length > 0),
    expected,
    expectedById,
  };
}

function validateCoverage(value, sourceSet, errors, expectedSourceRefs = []) {
  if (!isPlainObject(value)) return;
  const arrays = ['sourceRefs', 'bridgeRefs', 'processed', 'excluded', 'unprocessed'];
  for (const key of arrays) if (!Array.isArray(value[key])) errors.push(`coverage.${key} must be an array`);
  const sourceRefs = Array.isArray(value.sourceRefs) ? value.sourceRefs : [];
  const processed = Array.isArray(value.processed) ? value.processed : [];
  const excluded = Array.isArray(value.excluded) ? value.excluded : [];
  const unprocessed = Array.isArray(value.unprocessed) ? value.unprocessed : [];
  const seen = new Map();
  const mark = (kind, item) => {
    const sourceId = coverageSourceId(item);
    if (!sourceId) { errors.push(`coverage.${kind} contains an invalid source reference`); return; }
    if (sourceSet && !sourceSet.has(sourceId)) errors.push(`coverage.${kind} references unknown source ${sourceId}`);
    const list = seen.get(sourceId) ?? [];
    list.push(kind);
    seen.set(sourceId, list);
    if ((kind === 'excluded' || kind === 'unprocessed') && isPlainObject(item) && !(typeof item.reason === 'string' && item.reason.trim())) {
      errors.push(`coverage.${kind} entry for ${sourceId} requires a reason`);
    }
  };
  for (const ref of sourceRefs) mark('sourceRefs', ref);
  for (const ref of processed) mark('processed', ref);
  for (const ref of excluded) mark('excluded', ref);
  for (const ref of unprocessed) mark('unprocessed', ref);
  for (const [sourceId, kinds] of seen) {
    const statuses = kinds.filter((kind) => ['processed', 'excluded', 'unprocessed'].includes(kind));
    if (new Set(statuses).size > 1) errors.push(`coverage source ${sourceId} appears in multiple status sets`);
  }
  if (expectedSourceRefs?.length) {
    const expected = normalizeSourceRefs(expectedSourceRefs);
    const expectedIds = new Set(expected.map((ref) => ref.sourceId));
    for (const ref of sourceRefs) if (!expectedIds.has(ref.sourceId)) errors.push(`coverage.sourceRefs references source outside frozen range ${ref.sourceId}`);
    const statuses = [...processed, ...excluded, ...unprocessed];
    for (const ref of expected) {
      const matches = statuses.filter((item) => {
        const candidate = normalizeSourceRefs([item])[0];
        if (!candidate || candidate.sourceId !== ref.sourceId) return false;
        if (ref.fragmentId !== undefined && candidate.fragmentId !== ref.fragmentId) return false;
        if (ref.version !== undefined && candidate.version !== undefined && candidate.version !== ref.version) return false;
        return true;
      });
      if (!matches.length) errors.push(`coverage is missing status for frozen source ${ref.sourceId}${ref.fragmentId ? ` fragment ${ref.fragmentId}` : ''}`);
    }
  }
}

function temporaryEventId(id) {
  return typeof id === 'string' && /^(?:tmp|temp|temporary)(?:[-_]|$)/iu.test(id);
}

/**
 * Return a deterministic identity used to avoid counting one event twice.
 * A source/message ID is evidence, not an event identity: the semantic
 * fingerprint is included so two events from one message remain distinct.
 */
export function eventIdentity(event) {
  if (!isPlainObject(event)) return null;
  if (typeof event.identityKey === 'string' && event.identityKey.trim()) return `identity:${event.identityKey.trim()}`;
  if (typeof event.eventIdentity === 'string' && event.eventIdentity.trim()) return `identity:${event.eventIdentity.trim()}`;
  if (typeof event.sourceEventId === 'string' && event.sourceEventId.trim()) return `source-event:${event.sourceEventId.trim()}`;
  // A host/model supplied occurrence identifier is stronger evidence than a
  // text fingerprint.  In particular, two independently sourced occurrences
  // can have identical descriptions.  Stable IDs are therefore identities for
  // durable records; only operation-local temporary IDs fall through.
  for (const key of ['occurrenceId', 'occurrenceKey', 'canonicalId', 'sameOccurrenceId']) {
    if (typeof event[key] === 'string' && event[key].trim()) return `occurrence:${event[key].trim()}`;
  }
  if (typeof event.id === 'string' && event.id.trim() && !temporaryEventId(event.id)) return `id:${event.id.trim()}`;
  // Temporary records may be deduplicated only with an explicit same-event
  // link.  Semantic similarity by itself is intentionally not identity.
  for (const key of ['sameEventAs', 'sameAs', 'duplicateOf', 'repeatsEvent', 'sameOccurrenceAs']) {
    if (typeof event[key] === 'string' && event[key].trim()) return `linked:${event[key].trim()}`;
  }
  // `sourceEventId` above is the preferred link, but allow an explicit
  // source-evidence link object without treating source/message ID as event
  // identity.  Unknown dates and matching prose are not equality evidence.
  return null;
}

/** Keep the first occurrence and report repeated mentions rather than events. */
export function dedupeEvents(events = []) {
  const seen = new Map();
  const unique = [];
  const duplicates = [];
  const idMap = new Map();
  for (const event of events) {
    const identity = eventIdentity(event);
    if (!identity || !seen.has(identity)) {
      if (identity) seen.set(identity, event.id);
      unique.push(event);
    } else {
      duplicates.push({ duplicateId: event.id, keptId: seen.get(identity), identity });
      if (event?.id && seen.get(identity)) idMap.set(event.id, seen.get(identity));
    }
  }
  return { events: unique, duplicates, idMap };
}

/**
 * Validate the complete bundle before any write.  `valid:false` is returned
 * instead of throwing so callers can display isolated dependency diagnostics;
 * `assertValidDraftBundle` is provided for transactional callers.
 */
export function validateDraftBundle(bundle, {
  expectedBinding,
  allowedSourceIds,
  knownRecordIds = new Set(),
  existingFacts = [],
  expectedSourceRefs = [],
  enforceCorrectionAuthority = false,
  trustedCorrectionIds = [],
  newSourceIds = null,
} = {}) {
  const errors = [];
  const value = isPlainObject(bundle) ? bundle : {};
  const actualScope = value.scope;
  if (!isPlainObject(actualScope)) errors.push('scope is required');
  else if (expectedBinding?.scope && stableStringify(actualScope) !== stableStringify(expectedBinding.scope)) errors.push('scope does not match program binding');
  if (typeof value.operationId !== 'string' || !value.operationId.trim()) errors.push('operationId is required');
  else if (expectedBinding?.operationId && value.operationId !== expectedBinding.operationId) errors.push('operationId does not match program binding');
  if (!Number.isInteger(value.expectedRevision) || value.expectedRevision < 0) errors.push('expectedRevision must be a non-negative integer');
  else if (expectedBinding?.expectedRevision !== undefined && value.expectedRevision !== expectedBinding.expectedRevision) errors.push('expectedRevision does not match program binding');
  for (const category of DRAFT_CATEGORIES) {
    if (!(category in value)) errors.push(`missing required category ${category}`);
  }
  for (const category of ['events', 'awarenessChanges', 'entityFactChanges', 'relationshipChanges', 'personaChanges', 'commitmentChanges', 'performanceHints', 'summaryView', 'conflicts']) {
    if (!Array.isArray(value[category])) errors.push(`${category} must be an array`);
  }
  if (!isPlainObject(value.coverage)) errors.push('coverage must be an object');
  const sourceSet = allowedSourceIds ? new Set(allowedSourceIds) : null;
  const knownSet = knownRecordIds instanceof Set ? knownRecordIds : new Set(knownRecordIds ?? []);
  const invalidEventIds = new Set();
  const eventIds = validateEvents(value.events ?? [], sourceSet, errors, invalidEventIds, newSourceIds ? new Set(newSourceIds) : null);
  validateAwareness(value.awarenessChanges ?? [], eventIds, knownSet, invalidEventIds, sourceSet, errors, new Set((value.entityFactChanges ?? []).map(r => r.id)));
  const trustedCorrections = trustedCorrectionIds instanceof Set ? trustedCorrectionIds : new Set(trustedCorrectionIds ?? []);
  validateEntityFacts(value.entityFactChanges ?? [], eventIds, knownSet, invalidEventIds, sourceSet, errors, existingFacts, { enforceCorrectionAuthority, trustedCorrectionIds: trustedCorrections });
  validateRelationships(value.relationshipChanges ?? [], eventIds, knownSet, invalidEventIds, sourceSet, errors);
  validatePersona(value.personaChanges ?? [], eventIds, knownSet, invalidEventIds, sourceSet, errors);
  validateCommitments(value.commitmentChanges ?? [], eventIds, knownSet, invalidEventIds, sourceSet, errors);
  validateGenericRecords('performanceHints', value.performanceHints ?? [], eventIds, knownSet, invalidEventIds, sourceSet, errors);
  validateGenericRecords('summaryView', value.summaryView ?? [], eventIds, knownSet, invalidEventIds, sourceSet, errors);
  validateGenericRecords('conflicts', value.conflicts ?? [], eventIds, knownSet, invalidEventIds, sourceSet, errors);
  validateCoverage(value.coverage, sourceSet, errors, expectedSourceRefs);
  const isolated = isolateDependencies(value, invalidEventIds);
  const deduped = dedupeEvents(value.events ?? []);
  return {
    valid: errors.length === 0,
    errors,
    ...validationDetails(errors),
    isolated,
    duplicateMentions: deduped.duplicates,
    normalized: clone(value),
  };
}

export function assertValidDraftBundle(bundle, options = {}) {
  const result = validateDraftBundle(bundle, options);
  if (!result.valid) throw new ValidationError('DraftBundle validation failed', result);
  return result.normalized;
}

export function validateSummaryBatch(batch) {
  const errors = [];
  try { normalizeScope(batch?.scope); } catch (error) { errors.push(error.message); }
  if (typeof batch?.operationId !== 'string' || !batch.operationId) errors.push('operationId is required');
  if (!Number.isInteger(batch?.expectedRevision) || batch.expectedRevision < 0) errors.push('expectedRevision is invalid');
  if (!Array.isArray(batch?.sourceMessages) || batch.sourceMessages.length === 0) errors.push('sourceMessages is required');
  if (Array.isArray(batch?.sourceMessages)) {
    for (const message of batch.sourceMessages) if (message.complete === false) errors.push(`source ${message.id ?? '?'} is incomplete`);
  }
  return { valid: errors.length === 0, errors };
}

export function splitSummaryBatch(batch, { maxInputUnits = 12000, groups = null } = {}) {
  const check = validateSummaryBatch(batch);
  if (!check.valid) throw new ValidationError('invalid SummaryBatch', check.errors);
  const messages = batch.sourceMessages;
  const limit = Math.max(1, Number(maxInputUnits) || 12000);
  const children = [];
  let current = [];
  let currentUnits = 0;
  const flush = () => {
    if (!current.length) return;
    const first = current[0];
    const last = current[current.length - 1];
    const childIndex = children.length;
    children.push({
      ...clone(batch),
      operationId: `${batch.operationId}/child-${childIndex + 1}`,
      expectedRevision: batch.expectedRevision + childIndex,
      parentOperationId: batch.operationId,
      parentRange: clone(batch.parentRange),
      childRange: { startIndex: first.index, endIndex: last.index, childIndex, totalChildren: null },
      sourceMessages: clone(current),
      coverage: {
        ...clone(batch.coverage),
        sourceRefs: current.map((message) => ({ sourceId: message.id, version: message.version, hash: message.hash, contentHash: message.contentHash, fragmentId: message.fragmentId })),
        processed: [],
      },
    });
    current = [];
    currentUnits = 0;
  };
  if (groups) {
    for (const group of groups) { current = group; flush(); }
  } else for (const message of messages) {
    const units = estimateUnits(message.text);
    if (current.length && currentUnits + units > limit) flush();
    if (units <= limit) {
      current.push(message);
      currentUnits += units;
      continue;
    }
    // A single long message is split only at text boundaries.  Each fragment
    // carries the same source version and an explicit fragment id.
    const characters = [...message.text];
    let offset = 0;
    let fragmentIndex = 0;
    while (offset < characters.length) {
      // Boundaries preserve original code points. Binary search avoids repeatedly
      // normalizing an ever-growing prefix for each individual character.
      let low=offset+1,high=characters.length,best=offset+1;
      while(low<=high){const end=Math.floor((low+high)/2);if(estimateUnits(characters.slice(offset,end).join(''))<=limit){best=end;low=end+1;}else high=end-1;}
      const piece=characters.slice(offset,best).join('');offset=best;
      if (current.length) flush();
      current.push({ ...clone(message), text: piece, fragmentId: `${message.id}#${fragmentIndex}` });
      currentUnits = estimateUnits(piece);
      flush();
      fragmentIndex += 1;
    }
  }
  flush();
  for (const child of children) {
    child.childRange.totalChildren = children.length;
    child.sourceRevision = sha256({
      scope: child.scope,
      parentRange: child.parentRange,
      sourceMessages: child.sourceMessages.map((message) => ({ id: message.id, role: message.role, text: message.text, version: message.version, hash: message.hash, contentHash: message.contentHash, fragmentId: message.fragmentId })),
      bridgeMessages: (child.bridgeMessages ?? []).map((message) => ({ id: message.id, role: message.role, text: message.text, version: message.version, hash: message.hash, contentHash: message.contentHash, fragmentId: message.fragmentId })),
    });
  }
  for (let index = 1; index < children.length; index += 1) {
    const previous = children[index - 1].sourceMessages.at(-1);
    children[index].bridgeMessages = [
      ...clone(batch.bridgeMessages ?? []),
      { ...clone(previous), contextOnly: true },
    ];
    children[index].sourceRevision = sha256({
      scope: children[index].scope,
      parentRange: children[index].parentRange,
      sourceMessages: children[index].sourceMessages.map((message) => ({ id: message.id, role: message.role, text: message.text, version: message.version, hash: message.hash, contentHash: message.contentHash, fragmentId: message.fragmentId })),
      bridgeMessages: children[index].bridgeMessages.map((message) => ({ id: message.id, role: message.role, text: message.text, version: message.version, hash: message.hash, contentHash: message.contentHash, fragmentId: message.fragmentId })),
    });
  }
  if (children.length === 1) {
    children[0].operationId = batch.operationId;
    children[0].expectedRevision = batch.expectedRevision;
    children[0].childRange = { ...children[0].childRange, childIndex: 0, totalChildren: 1 };
  }
  return children;
}

export function requiredCategoryKeys() {
  return [...DRAFT_CATEGORIES];
}
