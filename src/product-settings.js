import { clone, isPlainObject } from './utils.js';
import { readSummaryPresets } from './summary-presets.js';
import {getNarrativeConfig} from './narrative-extraction.js';

/**
 * Settings shared by the product shell and future assistant panels.
 *
 * The registry is intentionally data-only: a setting is not considered
 * implemented merely because it is present here.  `consumers` names the
 * executable code that reads the value, while `status` distinguishes a
 * disabled/awaiting adapter from a live local consumer.
 */
export const PRODUCT_SETTINGS_VERSION = 1;

const DEFINITIONS = [
  {key:'personaReviewEnabled',label:'启用按角色辅助精修（额外调用，默认关闭）',defaultValue:false,type:'boolean',consumers:['PersonaRefinement']},
  {key:'personaReviewEndpoint',label:'人设精修 API 地址',defaultValue:'',type:'string',maxLength:2048,consumers:['PersonaRefinement']},
  {key:'personaReviewModel',label:'人设精修模型',defaultValue:'',type:'string',maxLength:240,consumers:['PersonaRefinement']},
  {key:'personaReviewEndpointMode',label:'人设精修地址模式',defaultValue:'base',type:'enum',values:['base','exact'],consumers:['PersonaRefinement']},
  {key:'personaReviewAuthMode',label:'人设精修认证方式',defaultValue:'bearer',type:'enum',values:['none','bearer','api-key'],consumers:['PersonaRefinement']},
  {key:'personaReviewInputUnits',label:'精修输入上限（估算）',defaultValue:16000,type:'integer',min:2000,max:32000,consumers:['PersonaRefinement']},
  {key:'personaReviewOutputTokens',label:'精修输出上限（Token）',defaultValue:3072,type:'integer',min:512,max:8192,consumers:['PersonaRefinement']},
  {key:'personaReviewDeadlineMs',label:'精修超时（毫秒）',defaultValue:90000,type:'integer',min:1000,max:180000,consumers:['PersonaRefinement']},
  {key:'personaReviewCooldownFloors',label:'同一人物精修间隔楼数',defaultValue:30,type:'integer',min:10,max:1000,consumers:['PersonaRefinement']},
  {key:'knowledgeFollowAssistant',label:'资料分析沿用配置助手连接',defaultValue:true,type:'boolean',consumers:['ProductApplication.analyzeDocuments']},
  {key:'knowledgeEndpoint',label:'资料分析 API 地址',defaultValue:'',type:'string',maxLength:2048,consumers:['ProductApplication.analyzeDocuments']},
  {key:'knowledgeModel',label:'资料分析模型',defaultValue:'',type:'string',maxLength:240,consumers:['ProductApplication.analyzeDocuments']},
  {key:'knowledgeEndpointMode',label:'资料分析地址模式',defaultValue:'base',type:'enum',values:['base','exact'],consumers:['ProductApplication.analyzeDocuments']},
  {key:'knowledgeAuthMode',label:'资料分析认证方式',defaultValue:'bearer',type:'enum',values:['none','bearer','api-key'],consumers:['ProductApplication.analyzeDocuments']},
  {key:'knowledgeOutputTokens',label:'资料分析回复上限（Token）',defaultValue:4096,type:'integer',min:0,max:131072,consumers:['ProductApplication.analyzeDocuments']},
  {key:'narrativeExtraction',label:'正文提取规则',defaultValue:'',type:'string',maxLength:16384,consumers:['SummaryEngine','DynamicPersonaController','planQuality']},
  {key:'dynamicPersonaEnabled',label:'启用动态人设',defaultValue:true,type:'boolean',consumers:['DynamicPersonaController']},
  {key:'dynamicPersonaFactReviewEnabled',label:'重要变化后核查（每批最多额外 1 次）',defaultValue:false,type:'boolean',consumers:['DynamicPersonaController']},
  {key:'dynamicPersonaEvery',label:'人设每多少楼更新',defaultValue:20,type:'integer',min:1,max:200,consumers:['DynamicPersonaController']},
  {key:'dynamicPersonaKeepRecent',label:'保留最近楼数（推荐 2）',defaultValue:2,type:'integer',min:0,max:1000,consumers:['DynamicPersonaController']},
  {key:'dynamicPersonaInputUnits',label:'人设输入预算（估算）',defaultValue:200000,type:'integer',min:1000,max:1000000,consumers:['DynamicPersonaController']},
  {key:'dynamicPersonaOutputTokens',label:'人设回复上限（Token，0 为不设上限）',defaultValue:0,type:'integer',min:0,max:131072,consumers:['DynamicPersonaController']},
  {key:'dynamicPersonaJsonMode',label:'人设强制 JSON 输出（接口需支持 response_format）',defaultValue:false,type:'boolean',consumers:['DynamicPersonaController']},
  {key:'dynamicPersonaDeadlineMs',label:'人设请求超时（毫秒）',defaultValue:180000,type:'integer',min:1000,max:600000,consumers:['DynamicPersonaController']},
  {key:'dynamicPersonaEndpoint',label:'动态人设 API 地址',defaultValue:'',type:'string',maxLength:2048,consumers:['DynamicPersonaController']},
  {key:'dynamicPersonaModel',label:'动态人设模型',defaultValue:'',type:'string',maxLength:240,consumers:['DynamicPersonaController']},
  {key:'dynamicPersonaEndpointMode',label:'动态人设地址模式',defaultValue:'base',type:'enum',values:['base','exact'],consumers:['DynamicPersonaController']},
  {key:'dynamicPersonaAuthMode',label:'动态人设认证方式',defaultValue:'bearer',type:'enum',values:['none','bearer','api-key'],consumers:['DynamicPersonaController']},
  {key:'dynamicPersonaPrompt',label:'动态人设预设',defaultValue:'',type:'string',maxLength:60000,consumers:['DynamicPersonaController']},
  {key:'dynamicPersonaMvuMode',label:'人物演绎主次',defaultValue:'narrative',type:'enum',values:['narrative','strict'],consumers:['DynamicPersonaController']},
  {key:'summaryPresets',label:'总结预设库',defaultValue:'',type:'string',maxLength:600000,consumers:['SummaryEngine','ProductShellController.createBatch']},
  { key:'summaryStaged', label:'分工总结', defaultValue:false, type:'boolean', consumers:['SummaryEngine'] },
  { key:'summaryReviewEnabled', label:'主总结＋原文复核（两次）', defaultValue:false, type:'boolean', consumers:['SummaryEngine'] },
  { key:'supplementFollowSummary', label:'辅助整理沿用总结模型', defaultValue:true, type:'boolean', consumers:['ProductApplication.supplement'] },
  { key:'supplementEndpoint', label:'辅助整理 API 地址', defaultValue:'', type:'string', maxLength:2048, consumers:['ProductApplication.supplement'] },
  { key:'supplementModel', label:'辅助整理模型', defaultValue:'', type:'string', maxLength:240, consumers:['ProductApplication.supplement'] },
  { key:'supplementEndpointMode', label:'辅助整理地址模式', defaultValue:'base', type:'enum', values:['base','exact'], consumers:['ProductApplication.supplement'] },
  { key:'supplementAuthMode', label:'辅助整理认证方式', defaultValue:'bearer', type:'enum', values:['none','bearer','api-key'], consumers:['ProductApplication.supplement'] },
  { key: 'autoQualityEnabled', label: '总结后校对缺项与矛盾', defaultValue: false, type: 'boolean', consumers: ['ProductApplication.processQuality'] },
  { key: 'qualityBatchRecords', label: '每次校对条数', defaultValue: 6, type: 'integer', min: 1, max: 100, consumers: ['ProductApplication.processQuality','planQuality'] },
  { key: 'messageCount', label: '最近消息数', defaultValue: 10, type: 'integer', min: 1, max: 200, consumers: ['ProductShellController.readRange'] },
  { key: 'autoMergeEnabled', label: '总结后自动核对合并', defaultValue: false, type: 'boolean', consumers: ['ProductApplication.processMergeQueue'] },
  { key: 'inputBudgetUnits', label: '总结输入预算', defaultValue: 120000, type: 'integer', min: 256, max: 1000000, consumers: ['ProductShellController.createBatch', 'SummaryEngine'] },
  { key: 'outputBudgetUnits', label: '总结回复上限（Token）', defaultValue: 40960, type: 'integer', min: 0, max: 131072, consumers: ['ProductShellController.createBatch', 'SummaryEngine'] },
  { key: 'deadlineMs', label: '请求截止时间', defaultValue: 120000, type: 'integer', min: 100, max: 600000, consumers: ['ProductShellController.transport', 'ProviderClient'] },
  { key: 'summaryDeadlineMs', label: '后台总结与复核超时', defaultValue: 300000, type: 'integer', min: 1000, max: 600000, consumers: ['ProductShellController.transport', 'ProductApplication.summary', 'ProductApplication.supplement'] },
  { key:'summaryStreaming', label:'总结流式接收', defaultValue:false, type:'boolean', consumers:['SummaryEngine','ProviderClient'] },
  { key:'summaryRequestMode', label:'总结请求方式', defaultValue:'chat-stream', type:'enum', values:['chat-stream','chat-buffered','legacy-json'], consumers:['SummaryEngine','ProviderClient'] },
  { key:'chatRequestsPerMinute', label:'同一接口每分钟聊天请求上限', defaultValue:0, type:'integer', min:0, max:6000, consumers:['ProviderScheduler'] },
  { key: 'focusMode', label: '侧重点确认方式', defaultValue: 'ask_manual', type: 'enum', values: ['inherit', 'ask_manual', 'ask_every'], consumers: ['ProductShellController.startSummary', 'SummaryEngine'] },

  { key: 'bm25K1', label: 'BM25 k1', defaultValue: 1.2, type: 'number', min: 0.01, max: 10, consumers: ['ProductShellController.previewRecall', 'LocalBM25Index'] },
  { key: 'bm25B', label: 'BM25 b', defaultValue: 0.75, type: 'number', min: 0, max: 1, consumers: ['ProductShellController.previewRecall', 'LocalBM25Index'] },
  { key: 'retrievalLimit', label: '历史记忆召回数量（不含全量人物档案）', defaultValue: 40, type: 'integer', min: 1, max: 100, consumers: ['ProductShellController.previewRecall', 'retrieveAndPack'] },
  { key: 'retrievalCandidateLimit', label: '检索候选数量', defaultValue: 24, type: 'integer', min: 1, max: 200, consumers: ['ProductApplication.recall', 'retrieveMemories'] },
  { key: 'retrievalTimeoutMs', label: '在线总超时保护（毫秒，0 沿用各接口时限）', defaultValue: 0, type: 'integer', min: 0, max: 60000, consumers: ['ProductApplication.recall', 'retrieveMemories'] },
  { key: 'retrievalBudgetUnits', label: '历史记忆长度上限（不含全量人物档案）', defaultValue: 10000, type: 'integer', min: 0, max: 50000, consumers: ['ProductShellController.previewRecall', 'retrieveAndPack'] },
  { key: 'vectorEnabled', label: '向量召回', defaultValue: false, type: 'boolean', consumers: ['ProductShellController.previewRecall'] },
  { key: 'vectorAutoUpdate', label: '后台更新向量索引', defaultValue: false, type: 'boolean', consumers: ['ProductApplication.scheduleVectorUpdate'] },
  { key: 'vectorWeight', label: '向量融合权重', defaultValue: 1, type: 'number', min: 0, max: 100, consumers: ['ProductShellController.previewRecall', 'retrieveAndPack'] },
  { key: 'fusionRankConstant', label: '融合 rank constant', defaultValue: 60, type: 'number', min: 1, max: 10000, consumers: ['ProductShellController.previewRecall', 'retrieveAndPack'] },
  { key: 'fusionLocalWeight', label: '本地融合权重', defaultValue: 1, type: 'number', min: 0, max: 100, consumers: ['ProductShellController.previewRecall', 'retrieveAndPack'] },
  { key: 'rerankEnabled', label: '重排', defaultValue: true, type: 'boolean', consumers: ['ProductShellController.previewRecall'] },
  { key: 'rerankTimeoutMs', label: '重排截止时间', defaultValue: 4000, type: 'integer', min: 50, max: 60000, consumers: ['ProductShellController.previewRecall', 'retrieveAndPack'] },
  { key: 'distributedEnabled', label: '分类通道召回', defaultValue: true, type: 'boolean', consumers: ['ProductApplication.recall'] },
  { key: 'distributedChannel', label: '指定通道（memory 或 knowledge）', defaultValue: 'disabled', type: 'string', maxLength: 80, consumers: ['ProductApplication.recall'] },
  { key: 'distributedStrategy', label: '分类通道策略', defaultValue: 'broadcast', type: 'enum', values: ['disabled', 'broadcast', 'leader_only'], consumers: ['ProductApplication.recall'] },

  { key: 'providerEndpoint', label: 'Provider 地址', defaultValue: '', type: 'string', maxLength: 2048, consumers: ['ProductShellController.transport', 'ProviderClient'] },
  { key: 'providerEndpointMode', label: 'Provider 地址模式', defaultValue: 'base', type: 'enum', values: ['base', 'exact'], consumers: ['ProductShellController.transport', 'resolveProviderEndpoint'] },
  { key: 'providerModel', label: '总结模型', defaultValue: '', type: 'string', maxLength: 240, consumers: ['ProductShellController.transport', 'SummaryEngine'] },
  { key: 'providerAuthMode', label: '认证模式', defaultValue: 'bearer', type: 'enum', values: ['none', 'bearer', 'api-key'], consumers: ['ProductShellController.transport', 'ProviderClient'] },
  { key: 'embeddingEndpoint', label: 'Embedding 地址', defaultValue: '', type: 'string', maxLength: 2048, consumers: ['ProductApplication.vector'] },
  { key: 'embeddingModel', label: 'Embedding 模型', defaultValue: '', type: 'string', maxLength: 240, consumers: ['ProductApplication.vector'] },
  { key: 'rerankEndpoint', label: 'Rerank 地址', defaultValue: '', type: 'string', maxLength: 2048, consumers: ['ProductApplication.rerank'] },
  { key: 'rerankModel', label: 'Rerank 模型', defaultValue: '', type: 'string', maxLength: 240, consumers: ['ProductApplication.rerank'] },

  { key: 'injectionEnabled', label: '自动注入', defaultValue: true, type: 'boolean', consumers: ['ProductShellController.injectionStatus'] },
  { key: 'injectionLogEnabled', label: '保存注入日志', defaultValue: true, type: 'boolean', consumers: ['ProductApplication.inject'] },
  { key: 'injectionPosition', label: '注入位置', defaultValue: 'before_last', type: 'enum', values: ['start','before_last'], consumers: ['ProductApplication.inject'] },
  { key: 'injectionRole', label: '注入角色', defaultValue: 'system', type: 'enum', values: ['system','user'], consumers: ['ProductApplication.inject'] },
  { key: 'recordingRules', label: '长期记录偏好', defaultValue: '保存有来源的事实和细节；区分计划与完成、事实与推测；记录时间、知情范围和人物变化。', type: 'string', maxLength: 24000, consumers: ['ProductShellController.createBatch'] },
  { key: 'assistantFollowSummary', label: '配置助手使用总结连接', defaultValue: true, type: 'boolean', consumers: ['ProductApplication.assistant'] },
  { key: 'assistantEndpoint', label: '助手 API 地址', defaultValue: '', type: 'string', maxLength: 2048, consumers: ['ProductApplication.assistant'] },
  { key: 'assistantModel', label: '助手模型', defaultValue: '', type: 'string', maxLength: 240, consumers: ['ProductApplication.assistant'] },
  { key: 'assistantEndpointMode', label: '助手地址模式', defaultValue: 'base', type: 'enum', values: ['base', 'exact'], consumers: ['ProductApplication.assistant'] },
  { key: 'assistantAuthMode', label: '助手认证方式', defaultValue: 'bearer', type: 'enum', values: ['none', 'bearer', 'api-key'], consumers: ['ProductApplication.assistant'] },
  { key: 'assistantBudgetUnits', label: '助手输入预算（估算）', defaultValue: 80000, type: 'integer', min: 2000, max: 1000000, consumers: ['ProductApplication.assistant'] },
  { key: 'assistantOutputTokens', label: '助手回复上限（Token）', defaultValue: 4096, type: 'integer', min: 0, max: 131072, consumers: ['ProductApplication.assistant'] },
  { key: 'summaryBatchSize', label: '每多少楼记录一次', defaultValue: 10, type: 'integer', min: 1, max: 200, consumers: ['ProductApplication.summarize'] },
  { key: 'autoSummaryEnabled', label: '回复后自动整理', defaultValue: true, type: 'boolean', consumers: ['ProductApplication.autoSummary'] },
  { key: 'autoSummaryEvery', label: '自动总结每批楼数', defaultValue: 10, type: 'integer', min: 1, max: 200, consumers: ['ProductApplication.autoSummary'] },
  { key: 'autoKeepRecent', label: '自动总结保留最近楼数', defaultValue: 5, type: 'integer', min: 0, max: 1000, consumers: ['ProductApplication.autoSummary'] },
  { key: 'storyDate', label: '当前故事日期（可留空）', defaultValue: '', type: 'string', maxLength: 32, consumers: ['ProductApplication.pack'] },
  { key: 'timeProtection', label: '附带日期与时间参照', defaultValue: true, type: 'boolean', consumers: ['ProductApplication.pack'] },
  { key: 'personaEnabled', label: '携带相关人物身份与变化', defaultValue: true, type: 'boolean', consumers: ['ProductApplication.recall'] },
  { key: 'performanceEnabled', label: '携带有依据的演绎参考', defaultValue: true, type: 'boolean', consumers: ['ProductApplication.recall'] },
  {key:'dialogueEnabled',label:'注入关键对话',defaultValue:true,type:'boolean',consumers:['ProductApplication.recall']},
  {key:'journalEnabled',label:'注入角色心迹',defaultValue:true,type:'boolean',consumers:['ProductApplication.recall']},
  { key: 'knowledgeEnabled', label: '检索外部资料', defaultValue: false, type: 'boolean', consumers: ['ProductApplication.recall'] },
  { key: 'worldMode', label: '故事类型', defaultValue: 'original', type: 'enum', values: ['original', 'fanfiction'], consumers: ['ProductApplication.pack'] },
  { key: 'aliases', label: '人物称呼（每行 主名=别名,别名）', defaultValue: '', type: 'string', maxLength: 12000, consumers: ['ProductApplication.recall'] },
  { key: 'dictionaryEnabled', label: '使用自动字典', defaultValue: true, type: 'boolean', consumers: ['ProductApplication.recall'] },
  { key: 'tagRecallEnabled', label: '按相关标签补充候选', defaultValue: true, type: 'boolean', consumers: ['ProductApplication.recall'] },
  { key: 'tagCandidateLimit', label: '每个标签的候选数', defaultValue: 4, type: 'integer', min: 1, max: 20, consumers: ['ProductApplication.recall'] },
  { key: 'externalStatePaths', label: '只读外部状态路径（每行一项）', defaultValue: '', type: 'string', maxLength: 4000, consumers: ['ProductApplication.externalState'] },
  { key: 'excludedTags', label: '总结忽略的标签（逗号分隔）', defaultValue: 'think,thinking', type: 'string', maxLength: 1000, consumers: ['ProductApplication.summarize'] },
  { key: 'embeddingEndpointMode', label: '向量地址模式', defaultValue: 'base', type: 'enum', values: ['base', 'exact'], consumers: ['ProductApplication.vector'] },
  { key: 'embeddingAuthMode', label: '向量认证方式', defaultValue: 'bearer', type: 'enum', values: ['none', 'bearer', 'api-key'], consumers: ['ProductApplication.vector'] },
  { key: 'vectorTimeoutMs', label: '在线向量等待上限（毫秒）', defaultValue: 4000, type: 'integer', min: 100, max: 60000, consumers: ['ProductApplication.vector'] },
  { key: 'rerankEndpointMode', label: '重排地址模式', defaultValue: 'base', type: 'enum', values: ['base', 'exact'], consumers: ['ProductApplication.rerank'] },
  { key: 'rerankAuthMode', label: '重排认证方式', defaultValue: 'bearer', type: 'enum', values: ['none', 'bearer', 'api-key'], consumers: ['ProductApplication.rerank'] },
  { key: 'rerankMaxCandidates', label: '重排候选上限', defaultValue: 20, type: 'integer', min: 1, max: 100, consumers: ['ProductApplication.rerank'] },
  // This key is deliberately not part of persisted settings.  It documents
  // the shared field and keeps the session-only boundary visible to callers.
  { key: 'providerApiKey', label: '会话密钥', defaultValue: '', type: 'session-secret', consumers: ['ProductShellController.transport'], persisted: false },
];

export const PRODUCT_SETTING_REGISTRY = Object.freeze(Object.fromEntries(
  DEFINITIONS.map((definition) => [definition.key, Object.freeze({ ...definition, consumers: Object.freeze([...definition.consumers]) })]),
));

const PERSISTED_KEYS = Object.freeze(DEFINITIONS.filter((definition) => definition.persisted !== false).map((definition) => definition.key));

function validateDefinition(definition, value) {
  if(definition.key==='summaryPresets'){readSummaryPresets(value??'');return value??'';}
  if (definition.type === 'session-secret') return typeof value === 'string' ? value : '';
  if (definition.type === 'boolean') return Boolean(value);
  if (definition.type === 'integer') {
    const number = Number(value);
    if (!Number.isInteger(number)) return definition.defaultValue;
    return Math.min(definition.max, Math.max(definition.min, number));
  }
  if (definition.type === 'number') {
    const number = Number(value);
    if (!Number.isFinite(number)) return definition.defaultValue;
    return Math.min(definition.max, Math.max(definition.min, number));
  }
  if (definition.type === 'enum') return definition.values.includes(value) ? value : definition.defaultValue;
  if (typeof value !== 'string') return definition.defaultValue;
  return value.slice(0, definition.maxLength ?? value.length);
}

/** UI and AI use identical strict validation; never silently claim a coerced plan applied. */
export function validateProductPatch(patch) {
  if (!isPlainObject(patch)) throw new Error('设置方案必须是对象');
  const result = {};
  for (const [key, value] of Object.entries(patch)) {
    const def = PRODUCT_SETTING_REGISTRY[key];
    if(key==='summaryPresets')readSummaryPresets(value);
    if(key==='narrativeExtraction')getNarrativeConfig(value);
    if (!def || def.persisted === false) throw new Error(`不能通过设置方案修改字段：${key}`);
    if (def.type === 'boolean' && typeof value !== 'boolean') throw new Error(`${def.label}需要开关值`);
    if (['number', 'integer'].includes(def.type) && (typeof value !== 'number' || !Number.isFinite(value) || value < def.min || value > def.max || (def.type === 'integer' && !Number.isInteger(value)))) throw new Error(`${def.label}超出允许范围`);
    if (def.type === 'enum' && !def.values.includes(value)) throw new Error(`${def.label}选项无效`);
    if (def.type === 'string' && (typeof value !== 'string' || value.length > def.maxLength)) throw new Error(`${def.label}格式或长度不正确`);
    if (/Endpoint$/.test(key) && value) { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('API 地址必须是无内嵌凭据的 HTTP(S) 地址'); }
    if (key === 'storyDate' && value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)!==value)) throw new Error('故事日期请使用有效的 YYYY-MM-DD；未知时留空');
    result[key] = clone(value);
  }
  return result;
}

export function defaultProductSettings() {
  return Object.fromEntries(DEFINITIONS.map((definition) => [definition.key, clone(definition.defaultValue)]));
}

/** Normalize only known fields; unknown keys never enter the persisted form. */
export function normalizeProductSettings(input = {}, { includeSessionSecret = true } = {}) {
  const source = isPlainObject(input) ? input : {};
  const result = defaultProductSettings();
  if (!includeSessionSecret) delete result.providerApiKey;
  for (const definition of DEFINITIONS) {
    if (!includeSessionSecret && definition.type === 'session-secret') continue;
    if (Object.prototype.hasOwnProperty.call(source, definition.key)) result[definition.key] = validateDefinition(definition, source[definition.key]);
  }
  return result;
}

export function persistedProductSettings(input = {}) {
  const normalized = normalizeProductSettings(input, { includeSessionSecret: false });
  return Object.fromEntries(PERSISTED_KEYS.map((key) => [key, clone(normalized[key])]));
}

export function listProductSettings(input = {}) {
  const normalized = normalizeProductSettings(input);
  return DEFINITIONS.map((definition) => ({
    key: definition.key,
    label: definition.label,
    value: definition.type === 'session-secret' ? (normalized[definition.key] ? '[session-only]' : '') : clone(normalized[definition.key]),
    persisted: definition.persisted !== false,
    type: definition.type,
    consumers: [...definition.consumers],
    status: definition.type === 'session-secret' ? 'session_only' : 'registered',
  }));
}

export function productSettingConsumers(input = {}) {
  const normalized = normalizeProductSettings(input);
  return DEFINITIONS.map((definition) => ({
    key: definition.key,
    value: definition.type === 'session-secret' ? (normalized[definition.key] ? '[session-only]' : '') : clone(normalized[definition.key]),
    consumers: [...definition.consumers],
    status: definition.type === 'session-secret'
      ? 'session_only'
      : definition.key === 'injectionEnabled'
        ? 'disabled_no_safe_host_hook'
        : definition.key.startsWith('vector') || definition.key.startsWith('rerank') || definition.key.startsWith('embedding') || definition.key.startsWith('distributed')
          ? 'registered_no_active_adapter'
          : 'consumed',
  }));
}

export const PRODUCT_PERSISTED_SETTING_KEYS = PERSISTED_KEYS;

// Connection settings belong to this TT installation, not a story or chat.
// Credentials remain runtime-only and are deliberately absent from this list.
export const PRODUCT_API_SETTING_KEYS = Object.freeze([
  ...['provider','assistant','supplement','embedding','rerank','dynamicPersona','personaReview','knowledge'].flatMap(prefix => ['Endpoint','EndpointMode','Model','AuthMode'].map(suffix => prefix + suffix)),
  'knowledgeFollowAssistant','knowledgeOutputTokens',
  'assistantFollowSummary','supplementFollowSummary','deadlineMs','summaryDeadlineMs','summaryStreaming','summaryRequestMode','chatRequestsPerMinute','assistantBudgetUnits','assistantOutputTokens',
]);
export function splitProductSettings(patch) {
  const api = {}, chat = {};
  for (const [key,value] of Object.entries(patch)) (PRODUCT_API_SETTING_KEYS.includes(key) ? api : chat)[key] = clone(value);
  return {api,chat};
}
