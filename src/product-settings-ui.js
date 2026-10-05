import { PRODUCT_SETTING_REGISTRY as registry } from './product-settings.js';

export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const button = (action, label, primary = false) => `<button type="button" data-action="${action}" ${primary ? 'class="sy-primary"' : ''}>${label}</button>`;
export const field = (label, input) => `<label class="sy-field"><span>${label}</span>${input}</label>`;
const names = { base:'自动补接口路径', exact:'完整地址（不补路径）', none:'无需 Key', bearer:'标准 Key（默认）', 'api-key':'x-api-key（服务商要求时）', inherit:'沿用记录偏好', ask_manual:'手动总结时填写', ask_every:'每次总结前填写', disabled:'关闭', broadcast:'各类别均衡召回', leader_only:'仅指定通道', original:'原创', fanfiction:'同人', system:'系统', user:'用户', start:'请求开头', before_last:'最后一条消息前' };
const copy = {
  knowledgeFollowAssistant:['沿用配置助手连接（默认）','已有助手 / 总结 API 就能分析资料，无需重复填写。关闭后使用本卡的独立地址、模型与 Key；不改其他任务。'],
  knowledgeOutputTokens:['字典分析回复上限（Token）','推荐 4096；每次最多分析约 6000 字原文，原文始终完整保存，AI 不负责压缩或改写资料。'],
  dynamicPersonaEvery:['每多少楼更新人物',''],
  dynamicPersonaKeepRecent:['保留最近多少楼（推荐 2）',''],
  dynamicPersonaInputUnits:['人设输入预算（估算）','推荐 24000；包含正文、原书和已有材料。超限会明确提示，不偷偷拆分你选的批次。'],
  dynamicPersonaOutputTokens:['人设回复上限（Token，0 为不设上限）','默认 0：不发送上限，跟随接口上限，避免浓缩人物输出。设数值则限制本次回复长度；不影响已保存的完整档案。'],
  dynamicPersonaJsonMode:['人设强制 JSON 输出','仅供支持 response_format 的接口按需开启。空响应可能触发一次不带此参数的重试；普通人设更新无需开启。'],
  dynamicPersonaDeadlineMs:['人设请求超时（毫秒）','推荐 60000，即 1 分钟；后台更新，不增加前台召回等待时间。初次生成与纠错请求均使用此上限。'],
  dynamicPersonaMvuMode:['人物演绎主次','推荐剧情主导：MVU 数值只作参考，不把人物锁在固定阶段。不会改写变量、阈值或脚本；旧卡也可选择严格阶段兼容。'],
  summaryRequestMode:['总结请求方式','推荐方式不强制服务端 JSON 模式；仍按预设输出、完整校验后保存。不支持流式的接口可选兼容非流式。'],
  summaryReviewEnabled:['完整总结＋查漏纠错（候选）','先完整记录全部模块，再对照原文只补漏、纠错。一批最多两次，后台进行，不阻塞聊天；失败保留已返回结果。'],
  summaryStaged:['两阶段分工（可选）','关闭时一次请求整理全部模块；开启后每个内部片段通常两次请求，可分配不同模型。失败按已有结果续跑。'],
  supplementFollowSummary:['沿用总结连接','共用地址和 Key；下方仍可单独选择辅助模型，留空时也沿用总结模型。'],
  autoQualityEnabled:['自动追加内容校对','每组疑点会额外调用一次模型。关闭时保留疑点，可手动校对。'],
  qualityBatchRecords:['每次校对条数','仅影响后台内容校对，推荐 6；每组一次请求，预览后固定，不拆主总结。'],
  messageCount:['默认总结楼数','手动总结的初始值；本次以范围选择中的输入为准。'],
  autoSummaryEnabled:['自动总结状态','启用和暂停只影响自动总结。'],
  autoKeepRecent:['保留最近多少楼不总结','给重生成和修改留出空间；只影响自动总结。'],
  autoMergeEnabled:['自动追加合并核对','每对候选额外调用一次模型，单次最多 10 对。关闭时仍保留候选和批内合并，可手动处理。'],
  autoSummaryEvery:['自动总结每批楼数','从连续已完成位置的下一楼开始。'],
  recordingRules:['长期记录偏好','告诉总结模型哪些内容值得记住。'],
  focusMode:['总结侧重点','手动总结时可以临时补充要求。'],
    inputBudgetUnits:['总结输入预算','包括正文、提示词和相关记忆；直接按此预算规划请求，不再额外限制为 46,000。不是回复上限。'],
  outputBudgetUnits:['总结回复上限（Token）','0 表示沿用服务商默认值。'],
  excludedTags:['忽略的正文标签','标签中的内容不参与总结，用逗号分隔。'],
  injectionEnabled:['自动注入相关记忆','发送聊天时，把相关记忆加入本轮请求。'],
  injectionLogEnabled:['保存注入日志','本聊天保留最近 30 次结果及注入片段；不保存 Key 或完整 API 请求，导出默认不含剧情内容。'],
  retrievalLimit:['历史记忆最多注入几条','不含全量人物档案。'],
  retrievalBudgetUnits:['历史记忆注入长度上限','不限制每人当前属性。关系、台词和人设变化算在这条上限里。'],
  timeProtection:['注入日期参照','附带事件日期和时间关系。'],
  personaEnabled:['全量注入相关人物信息','整份带入已启用的属性、人设变化与关系，不设人物篇幅上限。'],
  performanceEnabled:['注入人物演绎参考','使用有记录依据的变化，不编造内心。'],
  dialogueEnabled:['注入关键对话','仍重要的台词随相关人物带入；历史台词按需使用，不要求复读。'],
  journalEnabled:['注入角色心迹','当前阶段随人物带入，私密心迹不赋予他人知情；过去阶段在回顾时调用。'],
  injectionPosition:['记忆放置位置',''], injectionRole:['记忆消息角色',''],
  vectorEnabled:['向量检索','按语义寻找记忆；需要配置向量 API。'],
  vectorAutoUpdate:['后台更新索引','启用向量后，记忆变化会自动调用向量 API 补建索引，不等待发送聊天时才处理。'],
  rerankEnabled:['重排筛选','再次比较候选记忆的相关性；需要配置重排 API。'],
  retrievalCandidateLimit:['初选记忆数量','先找出候选，再筛选用于注入的记忆。'],
  rerankMaxCandidates:['交给重排的记忆数量',''],
  bm25K1:['重复关键词的影响','决定同一个词重复出现时，对排名的影响。'],
  bm25B:['长短记忆的平衡','减少长记录仅因字多而靠前的情况。'],
  vectorWeight:['语义检索权重',''], fusionLocalWeight:['关键词检索权重',''],
  fusionRankConstant:['合并排名平滑值','数值越大，前后名次的差距越平缓。'],
  distributedEnabled:['分类检索','先从事件、人物、约定和资料等分类找候选，再统一筛选。'],
  distributedStrategy:['分类检索方式',''],
  distributedChannel:['指定检索类别','仅指定通道时填写 memory 或 knowledge。'],
  retrievalTimeoutMs:['总检索超时（毫秒）','0 表示分别使用向量与重排的超时设置。'],
  vectorTimeoutMs:['向量超时（毫秒）',''], rerankTimeoutMs:['重排超时（毫秒）',''],
  worldMode:['故事类型','同人的原作设定不等于当前聊天已经发生的事实。'],
  knowledgeEnabled:['检索已导入资料','全局资料库作为原作参照，不会合并其他聊天的经历。'],
  aliases:['人物别名','每行填写：主名=别名,别名。'],
  dictionaryEnabled:['使用自动字典','总结和资料分析时生成；别称有歧义时不自动归并。'],
  tagRecallEnabled:['标签辅助召回','结合本轮相关主题补充候选，仍保留普通语义检索。'],
  tagCandidateLimit:['每个标签初选几条','与普通候选合并去重，再统一重排。'],
  externalStatePaths:['额外读取哪些变量','默认不额外读取：普通卡和动态人设都可正常使用。需要时填写 chatMetadata 或 lastMessageExtra 的具体路径；只读、不改 MVU。'],
  storyDate:['缺少正文日期时的参照','默认留空＝自动以正文日期为准。仅在剧情明确、正文没有日期时手填；不会用现实日期猜填，也不覆盖正文。'],
  deadlineMs:['模型请求超时（毫秒）','120000 即 2 分钟。'],
  summaryDeadlineMs:['后台总结与复核超时（毫秒）','300000 即单次最多等待 5 分钟，可修改；不延长召回的等待时间。'],
  summaryStreaming:['旧版模式使用流式','仅“旧版 JSON 模式”读取此项；其他方式由上方选项决定。'],
  chatRequestsPerMinute:['同一接口每分钟聊天请求上限','填服务商的 RPM；0 不猜测固定配额。总结、合并与助手按相同接口和 Key 共用队列，异常后自动等待；向量和重排不受此项限制。'],
  assistantBudgetUnits:['助手输入预算','估算对话、文件和工具说明的输入长度；不是回复上限。'],
  assistantOutputTokens:['助手回复上限（Token）','0 表示沿用服务商默认值。'],
  summaryBatchSize:['每多少楼记录一次','10 楼一批：1–300 楼会分成 30 批。'],
  assistantFollowSummary:['沿用总结模型','共用地址、模型和已保存的 Key，无需再填一遍。'],
};
Object.assign(names,{'chat-stream':'酒馆兼容 · 流式（推荐）','chat-buffered':'兼容非流式','legacy-json':'旧版 JSON 模式'});
Object.assign(names,{narrative:'剧情主导 · MVU作参考（推荐）',strict:'严格遵守 MVU 阶段（兼容）'});

export function setting(key, label, help, placeholder = '') {
  if(key==='summaryPresets')return '<p class="sy-help">总提示词和各模块填写规则，可到“总结 → 主总结设置”修改。</p>';
  const d = registry[key]; if (!d || d.persisted === false) throw new Error(`未知设置：${key}`);
  const [name, hint] = [label ?? copy[key]?.[0] ?? d.label, help ?? copy[key]?.[1] ?? ''];
  let input;
  const attr = `data-setting="${key}"`;
  if (d.type === 'boolean') input = `<input type="checkbox" ${attr} ${d.defaultValue ? 'checked' : ''}>`;
  else if (d.type === 'enum') input = `<select ${attr}>${d.values.map(v => `<option value="${esc(v)}" ${v === d.defaultValue ? 'selected' : ''}>${esc(names[v] ?? v)}</option>`).join('')}</select>`;
  else if (['recordingRules','aliases','externalStatePaths'].includes(key)) input = `<textarea rows="4" ${attr} maxlength="${d.maxLength}">${esc(d.defaultValue)}</textarea>`;
  else input = `<input ${attr} type="${['integer','number'].includes(d.type) ? 'number' : key === 'storyDate' ? 'date' : 'text'}" ${d.min !== undefined ? `min="${d.min}" max="${d.max}" step="${d.type === 'integer' ? 1 : 'any'}"` : `maxlength="${d.maxLength}"`} value="${esc(d.defaultValue)}" placeholder="${esc(placeholder)}" autocomplete="off">`;
  const html=`<label class="sy-field ${d.type === 'boolean' ? 'sy-toggle' : ''}"><span>${esc(name)}${hint ? `<small class="sy-help">${esc(hint)}</small>` : ''}</span>${input}</label>`;
  return key==='aliases'?`<details><summary>手动字典文本（高级）</summary>${html}</details>`:html;
}
const fields = keys => keys.map(key => setting(key)).join('');
const advanced = (title, keys) => `<details class="sy-advanced"><summary>${title}</summary>${fields(keys)}</details>`;
const card = (title, body) => `<div class="sy-card"><h4>${title}</h4>${body}</div>`;

export const SETTING_GROUPS = Object.freeze({
  recording: ['messageCount','summaryReviewEnabled','summaryStaged','recordingRules','focusMode','autoMergeEnabled','autoQualityEnabled','qualityBatchRecords','inputBudgetUnits','outputBudgetUnits','excludedTags','summaryBatchSize'],
  automatic: ['autoSummaryEnabled','autoSummaryEvery','autoKeepRecent'],
  injection: ['injectionEnabled','retrievalLimit','retrievalBudgetUnits','timeProtection','personaEnabled','performanceEnabled','dialogueEnabled','journalEnabled','injectionPosition','injectionRole','injectionLogEnabled'],
  vectors: ['vectorEnabled','vectorAutoUpdate'],
  retrieval: ['rerankEnabled','tagRecallEnabled','tagCandidateLimit','retrievalCandidateLimit','rerankMaxCandidates','bm25K1','bm25B','vectorWeight','fusionLocalWeight','fusionRankConstant','distributedEnabled','distributedStrategy','distributedChannel','retrievalTimeoutMs','vectorTimeoutMs','rerankTimeoutMs'],
  world: ['knowledgeEnabled'],
  dictionary: ['dictionaryEnabled','aliases'],
  compatibility: ['externalStatePaths','storyDate'],
});
export function settingsSection(kind) {
  const keys = SETTING_GROUPS[kind];
  if (kind === 'recording') return card('共同记录偏好',fields(['recordingRules','focusMode'])+'<p class="sy-help">正常游戏只需配置 API 与自动楼层规则。下方校对不是必需，开启会增加请求与等待；已有选择不会因升级改变。</p>'+advanced('可选校对（额外调用）',['summaryReviewEnabled','summaryStaged','autoMergeEnabled','autoQualityEnabled','qualityBatchRecords'])+button('per-call-mode','使用单次主总结（关闭额外校对）')+'<p class="sy-help">双次复核：每批两次；分工总结：每批两次；自动校对与合并还会按候选追加请求。双次模式超过预算会提示调整，不暗中拆批。</p>'+advanced('总结高级设置',['messageCount','inputBudgetUnits','outputBudgetUnits','excludedTags','summaryBatchSize']));
  if (kind === 'automatic') return card('自动总结',setting('autoSummaryEnabled').replace('<input','<input disabled')+fields(['autoSummaryEvery','autoKeepRecent'])+field('当前聊天从哪楼起算','<input data-auto-start type="number" min="0" value="1">')+'<p class="sy-help">新聊天默认从第 1 楼；需要包含开场白可填 0。老聊天会接着已连续总结的楼层处理。改起点只改变后续处理范围，不伪造此前的总结。</p><div class="sy-packet" data-auto-progress role="status"></div><div class="sy-actions"><button type="button" data-action="auto-save">保存自动设置</button></div><div class="sy-actions"><button type="button" data-action="auto-start">启用自动</button><button type="button" data-action="auto-pause">暂停自动</button><button type="button" data-action="auto-process">处理下一批</button></div>');
  if (kind === 'injection') return card('把记忆交给 AI', '<p class="sy-help">相关人物带入整份已启用档案；关键台词与当前心迹随人物使用，私密想法不赋予其他角色知情。动态人设在人物模块独立开关；本轮实际内容可看“召回 → 注入日志”。</p>'+fields(keys.slice(0,8)) + advanced('注入位置与日志', keys.slice(8)));
  if (kind === 'vectors') return card('向量索引',fields(keys));
  if (kind === 'retrieval') return card('召回策略', fields(['rerankEnabled','retrievalCandidateLimit','rerankMaxCandidates']) + advanced('标签辅助召回',['tagRecallEnabled','tagCandidateLimit']) + advanced('关键词与融合',['bm25K1','bm25B','vectorWeight','fusionLocalWeight','fusionRankConstant']) + advanced('分类检索',['distributedEnabled','distributedStrategy','distributedChannel']) + advanced('超时保护',['retrievalTimeoutMs','vectorTimeoutMs','rerankTimeoutMs']));
  if(kind==='dictionary')return card('字典设置',fields(keys));
  if(kind==='compatibility')return card('剧情日期',`<p class="sy-help">推荐：自动读取聊天正文；没有日期就保持未知。这是有效默认值，不需要你设置今天的日期。</p>${setting('storyDate')}`)+card('变量读取',`<p class="sy-help">推荐：不额外读取。它不是 MVU 安装器，也不负责驱动阶段。若你的卡需要让总结模型参考少量变量，可选择下方模板，再把路径缩小到必要字段。</p>${field('可选路径模板','<select data-variable-template><option value="">不添加模板（推荐）</option><option value="lastMessageExtra.stat_data">最后一楼 MVU 数据 · lastMessageExtra.stat_data</option><option value="chatMetadata.stat_data">聊天元数据 · chatMetadata.stat_data</option></select>')}${button('variable-template','填入所选模板')}${setting('externalStatePaths')}<p class="sy-help">路径因卡而异，模板不保证存在；不要导入整个变量树。未知路径不会杜撰数值，已有自定义路径不会被更新重置。</p>`);
  return card('知识库参与召回', fields(keys));
}

export const API_INFO = Object.freeze({
  personaReview:{prefix:'personaReview',title:'人设辅助精修（可选）',help:'每批最多选择一个重要且需要整理的人物，独立配置快速模型；默认不启用，不改变动态人设主模型。',resource:'/chat/completions'},
  knowledge: {prefix:'knowledge',title:'知识库分析模型',help:'导入世界书或资料后提取人物、别称与检索标签。原文由本机解析并完整保存；向量索引使用单独的向量 API。',resource:'/chat/completions'},
  summary: { prefix:'provider', title:'总结模型', help:'整理你选择的聊天楼层，提取事件、人物、关系与知情者。不会替代主聊天模型。', resource:'/chat/completions' },
  dynamicPersona: {prefix:'dynamicPersona',title:'动态人设模型',help:'有自己的开关和楼层周期。独立地址、模型和 Key 都留空时沿用总结连接；也可单独配置。',resource:'/chat/completions'},
  supplement: { prefix:'supplement', title:'辅助整理模型', help:'分工总结的第二阶段：人物属性、知情、关系与演绎；同时负责合并核对、缺项校对和引用纠错。可选择服务商提供的 Flash 等快速模型。', resource:'/chat/completions' },
  assistant: { prefix:'assistant', title:'配置助手', help:'理解你的要求和配置文件，生成可确认、可应用的设置方案。', resource:'/chat/completions' },
  embedding: { prefix:'embedding', title:'向量模型', help:'按意思寻找相关记忆。可点击补齐推荐值，再填写对应服务商的 Key；也可使用其他服务商。', resource:'/embeddings' },
  rerank: { prefix:'rerank', title:'重排模型', help:'配置后从候选记忆里挑出更相关的内容；未配置时使用本地检索。', resource:'/rerank' },
});
export function apiSettingsHTML() {
  const order=['summary','dynamicPersona','assistant','knowledge','embedding','rerank','personaReview','supplement'];
  const renderCard=([kind, {prefix, title, help, resource}]) => `<section class="sy-card sy-api-card" data-api-card="${kind}"><div class="sy-top"><h4>${title}</h4>${['embedding','rerank'].includes(kind) ? button(`recommend-${kind}`, '补齐推荐值') : ''}</div><p class="sy-help">${help}</p>
    ${['assistant','supplement','knowledge'].includes(kind) ? setting(kind==='knowledge'?'knowledgeFollowAssistant':`${kind}FollowSummary`) + `<p class="sy-inherited sy-help" data-inherited="${kind}"></p>` : ''}
    <div data-api-fields="${kind}">
    <div data-api-connection="${kind}">
    ${setting(`${prefix}Endpoint`, 'API 地址', `基础地址只补 ${resource}，不自动添加 /v1。`, '填写你的服务商地址')}
    ${field('API Key', `<input type="password" autocomplete="new-password" data-key="${kind}" placeholder="无需认证的服务可以留空"><small class="sy-help">随 API 保存到本机 TT 数据，重启自动恢复；不加入助手消息或拾忆导出。${['embedding','rerank'].includes(kind) ? '硅基流动需要填写 Key。' : ''}</small>`)}
    <p class="sy-help" data-key-status="${kind}" role="status"></p>${button(`forget-key-${kind}`,'清除已保存 Key')}
    </div>
    <div class="sy-model-picker"><div class="sy-top"><span>选择模型</span>${button(`models-${kind}`, '拉取模型列表')}</div>
    <label class="sy-field"><span class="sy-sr-only">${title}模型列表</span><select data-model-list="${kind}" disabled><option value="">先拉取模型列表，也可以在下方直接输入</option></select></label>
    ${setting(`${prefix}Model`, '模型名称', '', kind==='supplement'?'留空沿用总结模型；也可选择快速模型':'选择列表中的模型，或手动填写')}
    <p class="sy-help" role="status" data-model-status="${kind}"></p></div>
    <details class="sy-advanced"><summary>高级连接选项（通常不用改）</summary>${setting(`${prefix}EndpointMode`, '地址如何使用', `默认只补 ${resource}，绝不补 /v1。填完整接口地址时可选“不补路径”。`)}${setting(`${prefix}AuthMode`, 'Key 发送方式', '一般保持“标准 Key”；不需要 Key 可留空或选“无需 Key”。只有服务商明确要求时才改用 x-api-key。')}${field('模型列表地址（可选）', `<input data-models-url="${kind}" placeholder="留空时按 API 地址推导 /models" autocomplete="off">`)}</details>
    </div>${kind==='knowledge'?setting('knowledgeOutputTokens'):''}<div class="sy-actions">${button(`save-api-${kind}`, '保存', true)}${button(`test-${kind}`, '测试连接')}</div></section>`;
  const entries=Object.entries(API_INFO).sort(([a],[b])=>order.indexOf(a)-order.indexOf(b));
  const main=entries.filter(([kind])=>!['personaReview','supplement'].includes(kind)).map(renderCard).join('');
  const optional=entries.filter(([kind])=>['personaReview','supplement'].includes(kind)).map(renderCard).join('');
  return main+`<details class="sy-card sy-advanced" data-optional-models><summary>可选模型与人设兼容</summary><p class="sy-help">仅在使用辅助精修或额外整理时配置；已有连接和 Key 保留。</p>${optional}${setting('dynamicPersonaJsonMode')}${button('save-persona-compat','保存人设兼容设置')}</details>`
    +`<details class="sy-card sy-advanced" data-request-compatibility><summary>请求兼容与超时</summary>${setting('summaryRequestMode')}${advanced('旧版请求兼容选项',['summaryStreaming'])}${setting('chatRequestsPerMinute')}${setting('summaryDeadlineMs')}${setting('deadlineMs')}${setting('assistantBudgetUnits')}${setting('assistantOutputTokens')}</details>`;
}

// Upgrade opt-in: never replace a custom endpoint, model, or a deliberate zero/false.
export function missingRecommendations(settings, kind) {
  if (!['embedding','rerank'].includes(kind)) return {};
  const endpointKey = `${kind}Endpoint`, modelKey = `${kind}Model`;
  const endpoint = String(settings[endpointKey] ?? '').trim();
  const model = String(settings[modelKey] ?? '').trim();
  const recommendedEndpoint = 'https://api.siliconflow.cn/v1';
  const recommendedModel=kind==='embedding'?'BAAI/bge-m3':'BAAI/bge-reranker-v2-m3';
  if (!endpoint && !model) return { [endpointKey]: recommendedEndpoint, [modelKey]: recommendedModel };
  if (endpoint === recommendedEndpoint && !model) return { [modelKey]: recommendedModel };
  return {};
}
