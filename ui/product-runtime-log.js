import { readViewState } from '../src/product-view-scheduling.js';
import { LOG_TASKS, LOG_PHASES, safeLogDetails } from '../src/product-runtime-log.js';
import { esc } from '../src/product-settings-ui.js';
import { failureText,productFailure } from '../src/product-feedback.js';
import { safeValidationIssues, validationIssueText } from '../src/validation-diagnostics.js';
import {PERSONA_ISSUES} from '../src/persona-validation.js';
import {DIAGNOSTIC_REASONS,DIAGNOSTIC_PURPOSES,DIAGNOSTIC_STAGES,DIAGNOSTIC_ACTIONS,UPSTREAM_CODES,UPSTREAM_HINTS,PERSONA_STEPS,errorDiagnostics} from '../src/diagnostics.js';

export function runtimeLogHTML(){return `<h3>运行日志</h3><p class="sy-help">保留最近 2000 条，最多 2 MB。记录请求、解析、校验与保存过程；不包含 Key、聊天正文或模型原文。导出当前内存快照，不等待任务或写盘完成，不受筛选和分页影响。</p><div class="sy-actions"><button type="button" data-log-export>导出日志</button><button type="button" data-log-issues-text>只看失败（最近 50 条）</button><button type="button" data-log-text>查看／复制全部文本</button><button type="button" data-log-clear>清空日志</button></div><p data-log-export-status class="sy-help" role="status"></p><details data-log-fallback hidden><summary>日志文本（文件导出不可用时也能复制）</summary><textarea data-log-text-value readonly rows="6" aria-label="日志文本"></textarea><div class="sy-actions"><button type="button" data-log-copy>复制全部文本</button><button type="button" data-log-close>收起文本</button></div></details><label class="sy-field"><span>显示</span><select data-log-filter><option value="all">全部记录</option><option value="issues">失败与警告</option><option value="vectors">向量索引</option><option value="summary">总结</option><option value="merge">事件合并</option><option value="api">API 与助手</option></select></label><label class="sy-field"><span>每页条数</span><select data-log-page-size><option value="10">10 条</option><option value="20">20 条</option><option value="50">50 条</option><option value="120">120 条</option></select></label><p data-log-storage class="sy-help" role="status"></p><div data-log-list></div><div class="sy-batch-pagination" data-log-pager><button type="button" data-log-prev>上一页</button><span data-log-page></span><button type="button" data-log-next>下一页</button></div>`;}
const fields={personaSystemChars:'人设规则字符数',personaSourceChars:'本批正文字符数',personaBaselineChars:'人物底稿字符数',personaNotesChars:'当前补充字符数',personaDevelopmentChars:'人物变化记录字符数',personaMaterialsChars:'可选参考材料字符数',personaRequestChars:'人设消息字符数（不是 Token）',personaSourceParts:'人物底稿片段数',personaNoteParts:'当前补充段落数',personaPeople:'本批人物数',personaRequestView:'请求视图版本',readingOriginalChars:'原始正文字符数',readingSafeChars:'安全正文字符数',readingOutputChars:'读取副本字符数',readingFilteredChars:'额外过滤字符数',readingFallbacks:'回退原安全正文的楼数',requestNumber:'向量请求序号',requestItems:'输入片段数',receivedVectors:'返回向量数',inputChars:'本次输入字符数',longestInputChars:'最长片段字符数',vectorDimensions:'向量维度',indexedItems:'已保存索引条数',pendingItems:'未完成索引条数',failedItems:'失败索引条数',batchNumber:'总结批次',childIndex:'内部子批（从 0 计）',sourceCount:'读取消息数',inputLimit:'输入预算',inputUnits:'实际输入估算',elapsedMs:'耗时（毫秒）',status:'HTTP 状态',expected:'应有逐楼摘要',received:'收到摘要条数',covered:'完整对应楼数',invalidRows:'来源无效或多楼合并',duplicateCount:'重复摘要条数',promptTokens:'服务报告输入 Token',completionTokens:'服务报告输出 Token',totalTokens:'服务报告总 Token',reasoningTokens:'其中推理 Token',responseChars:'回复文本字符数',savedBatches:'保存批数'};
export function runtimeLogSummary(entry){
  // 一条任务一条摘要，一次看到任务名 / 范围 / 结果，避免把技术详情全堆在一行里。
  const d=entry.details??{};
  const range=d.startIndex!==undefined?` · #${d.startIndex}–${d.endIndex??d.startIndex}`:'';
  const batch=d.batchNumber!==undefined?` · 第 ${d.batchNumber} 批`:'';
  const tail=[];
  if(d.sourceTimeCorrections){
    tail.push(`对照原文场景修正 ${d.sourceTimeCorrections} 处日期错位；未调用校对模型`);
  }
  if(d.code){
    // 失败时把可读失败原因放第一行；其余字段（耗时、已保存批数等）放后两行
    tail.push(productFailure({code:d.code,details:{...d,...(['vectors','knowledge-vectors'].includes(entry.task)?{purpose:'embeddings'}:{})}}).message);
  }
  if(d.savedBatches!==undefined)tail.push(`本次已保存 ${d.savedBatches} 批${d.pendingBatches?`，另有 ${d.pendingBatches} 批待处理`:''}`);
  if(d.plannedBatches!==undefined)tail.push(`计划 ${d.plannedBatches} 批，每批 ${d.batchSize} 楼`);
  if(d.indexedItems!==undefined)tail.push(`索引已建 ${d.indexedItems} 条，待建 ${d.pendingItems??0} 条${d.failedItems?`（${d.failedItems} 条失败）`:''}`);
  if(d.elapsedMs!==undefined){
    const sec=Math.round(d.elapsedMs/1000);
    tail.push(sec>=60?`耗时 ${Math.floor(sec/60)} 分 ${sec%60} 秒`:`耗时 ${sec} 秒`);
  }
  return `${LOG_TASKS[entry.task]??entry.task} · ${LOG_PHASES[entry.phase]??'操作记录'}${range}${batch}。${tail.join('；')||'无附加信息'}`.replace(/[。；]+$/u,'')+'。';
}
function detailsHTML(entry){
  const d=entry.details,lines=[];
  if(PERSONA_STEPS[d.personaStep])lines.push(['人设出错步骤',PERSONA_STEPS[d.personaStep]]);
  if(d.historyStep)lines.push(['原文读取位置',d.historyStep==='tail'?'当前聊天末页':'较早历史分页']);
  if(d.historyReadAttempts!==undefined)lines.push(['本地读取尝试次数',d.historyReadAttempts]);
  if(d.modelRequested!==undefined)lines.push(['本次调用模型',d.modelRequested?'是':'否']);
  if(d.jsonMode!==undefined)lines.push(['强制服务端 JSON 模式',d.jsonMode?'是':'否']);
  if(d.messageCount!==undefined)lines.push(['请求消息数（不是调用次数）',d.messageCount]);
  if(d.responseHeadersMs!==undefined)lines.push(['收到响应头（毫秒）',d.responseHeadersMs]);
  if(d.firstBodyMs!==undefined)lines.push([d.bufferedBody?'宿主交回完整正文（毫秒）':'收到首段传输数据（毫秒，不代表总结完成）',d.firstBodyMs]);
  if(d.providerFingerprint)lines.push(['接口与模型指纹',d.providerFingerprint.slice(0,16)]);
  if(d.requestBytes!==undefined)lines.push(['请求体字节数（UTF-8，不是 Token）',d.requestBytes]);
  for(const [key,label]of [['prepareMs','首次请求前准备（毫秒）'],['modelMs','总结模型等待合计（毫秒）'],['publishMs','发布已保存记忆（毫秒）'],['historyPages','读取历史页数'],['fetchedMessages','宿主返回楼数'],['normalizedMessages','实际处理正文楼数']])if(d[key]!==undefined)lines.push([label,d[key]]);
  fields.requestNumber='本任务请求序号';
  lines.push(['执行版本',entry.pluginVersion??'旧日志未记录']);
  if(d.action)lines.push(['执行操作',DIAGNOSTIC_ACTIONS[d.action]]);
  if(d.purpose)lines.push(['请求用途',DIAGNOSTIC_PURPOSES[d.purpose]]);
  if(d.requestId)lines.push(['请求编号',d.requestId]);
  if(d.stage)lines.push(['具体阶段',DIAGNOSTIC_STAGES[d.stage]]);
  if(d.summaryStage)lines.push(['分工阶段',d.summaryStage==='narrative'?'事件与逐楼摘要':'人物、知情与关系']);
  if(d.compactFloors!==undefined)lines.push(['一次响应归档',`${d.compactFloors} 楼、${d.compactChanges??0} 项模块记录（本地整理，未新增模型调用）`]);
  if(d.linkedEventSources)lines.push(['来源补齐',`${d.linkedEventSources} 条事件使用摘要中明确的事件关联（未猜测来源）`]);
  if(d.unknownEventPerspectives)lines.push(['叙述视角',`${d.unknownEventPerspectives} 条未提供，保留为未知`]);
  if(d.inferredModuleFormats)lines.push(['格式识别','响应未写格式标记；已按完整九模块结构识别，来源与内容校验不变，未新增模型调用']);
  if(d.unwrappedSummaryRoots)lines.push(['格式兼容','已展开包住单份完整总结的外层数组；原内容未改，来源校验不变，未新增模型调用']);
  if(d.unknownKnowledgeMetadata)lines.push(['知情辅助信息未填写',`${d.unknownKnowledgeMetadata} 处获知渠道或时间保留为未注明；知情状态与来源未改，未新增模型调用`]);
  if(d.liftedPersonaContexts)lines.push(['人物情境兼容',`${d.liftedPersonaContexts} 条采用该记录中已明确的同人同对象台词情境，未推测新内容，未新增模型调用`]);
  if(d.unknownPersonaContexts)lines.push(['人物情境未填写',`${d.unknownPersonaContexts} 条保留为未注明；只适用于记录中的对象和范围，不扩大为永久人设，未新增模型调用`]);
  if(d.restrictedPersonaScopes)lines.push(['人设适用范围未填写',`${d.restrictedPersonaScopes} 条仅保留为来源场景中的观察，不外推为长期人设；未新增模型调用`]);
  if(d.resolvedSourceTextHints)lines.push(['原文片段标注兼容',`${d.resolvedSourceTextHints} 处短语已在指定原楼层内唯一匹配，仍引用该完整楼层；未换楼、未新增模型调用`]);
  if(d.wholeFloorEventAnnotations)lines.push(['事件来源备注兼容',`${d.wholeFloorEventAnnotations} 处非真实片段的文字备注已改用同一楼层的完整依据；逐楼摘要另行校验，未换楼、未新增模型调用`]);
  if(d.wholeFloorRecordAnnotations)lines.push(['模块来源备注兼容',`${d.wholeFloorRecordAnnotations} 处中文备注使用已明确的同一完整楼层；未改事实或知情状态，未换楼、未新增模型调用`]);
  if(d.duplicateEmptyModules)lines.push(['重复空区块兼容',`${d.duplicateEmptyModules} 个重复空区块未覆盖原有内容；保留唯一非空结果，未拼接不同回答、未新增模型调用`]);
  if(d.misplacedEvidenceKinds)lines.push(['依据分类兼容',`${d.misplacedEvidenceKinds} 处互动类型误填为事实性质；原记录保留，性质标为未确认，不提升为已证实`]);
  if(d.unwrappedSourceGroups)lines.push(['来源数组兼容',`${d.unwrappedSourceGroups} 处多套一层的来源数组已展开；每条来源仍逐项校验，未丢弃无效引用`]);
  if(d.unknownEvidenceTypes)lines.push(['证据类型未填写',`${d.unknownEvidenceTypes} 条已保留为未确认，未推定为事实或用户确认；未新增模型调用`]);
  for(const [key,label]of [['plannedRequests','本批预计总结请求（不含重试）'],['totalChildren','本批处理片段数'],['completedChildren','已保存片段数'],['actualWaitMs','实际等待（毫秒）'],['timerLagMs','计时器延迟（毫秒）']])if(d[key]!==undefined)lines.push([label,d[key]]);
  for(const [key,label]of [['sourceInputUnits','正文输入估算'],['historyInputUnits','相关旧记忆估算'],['schemaInputUnits','结构约束估算'],['bridgeInputUnits','衔接上下文估算']])if(d[key]!==undefined)lines.push([label,d[key]]);
  if(d.reason)lines.push(['具体原因',DIAGNOSTIC_REASONS[d.reason]]);
  if(d.personaField)lines.push(['人设检查字段',({name:'人物姓名',text:'档案正文',sourceFloors:'原文楼号'})[d.personaField]]);
  if(Number.isSafeInteger(d.profileIndex))lines.push(['回答中第几份档案',d.profileIndex+1]);
  if(PERSONA_ISSUES[d.personaIssue])lines.push(['人物检查原因',PERSONA_ISSUES[d.personaIssue]]);
  if(Number.isSafeInteger(d.editIndex))lines.push(['档案中第几项修改',d.editIndex+1]);
  if(Number.isSafeInteger(d.personaProfiles))lines.push(['通过检查的人物档案',d.personaProfiles]);
  if(Number.isSafeInteger(d.personaBindings))lines.push(['程序确认的原设定片段',d.personaBindings]);
  if(d.streaming!==undefined)lines.push(['流式接收',d.streaming?'是':'否']);
  if(d.streamChunks!==undefined)lines.push(['流式片段数',d.streamChunks]);
  if(d.degraded!==undefined)lines.push(['召回结果',d.degraded?'已使用回退结果；在线召回未全部成功':'未使用故障回退']);
  for(const [key,label]of [['vectorStatus','向量召回'],['rerankStatus','重排']])if(d[key])lines.push([label,({passed:'成功',disabled:'未启用',fallback:'未完成，使用回退结果',skipped:'未调用'})[d[key]]??'状态未知']);
  if(d.qualityReason)lines.push(['校对校验',d.qualityReason]);
  for(const r of d.qualityShape??[])lines.push([`返回结构 · ${({root:'最外层',updates:'原位修改',additions:'新增',issues:'待确认',reviews:'知情判断'})[r.field]}`,`${({missing:'未返回',null:'空值',array:'列表',object:'对象',string:'文本',number:'数字',boolean:'布尔值'})[r.type]}${r.count!==undefined?`，${r.count} 项`:''}`]);
  for(const [key,label]of [['accepted','通过校验的修改/新增'],['rejected','未通过的校对项'],['rejectedRows','未通过的校对项']])if(d[key]!==undefined)lines.push([label,d[key]]);
  for(const r of d.qualityRejections??[])lines.push([`${({update:'修改',addition:'新增',issue:'疑点'})[r.kind]}第 ${r.index+1} 项`,`${r.reason}${r.fields?.length?`；字段：${r.fields.join('、')}`:''}`]);
  if(d.backgroundSeen!==undefined)lines.push(['请求期间切到后台',d.backgroundSeen?'已观察到':'未观察到（不能排除宿主暂停）']);
  if(d.timerLagMs>=5000)lines.push(['等待时间说明','页面计时器明显延迟，不能将全部等待当作模型计算耗时；已保存批次保留。']);
  if(d.upstreamCode)lines.push(['服务错误分类',UPSTREAM_CODES[d.upstreamCode]]);
  if(d.upstreamHint)lines.push(['服务报文提示',UPSTREAM_HINTS[d.upstreamHint]]);
  if(d.requestChars!==undefined)lines.push(['请求 JSON 字符数（不是 Token）',d.requestChars]);
  if(d.modelRole)lines.push(['模型用途',({knowledge:'知识库分析模型',dynamicPersona:'动态人设模型',summary:'总结模型',supplement:'辅助整理模型',assistant:'配置助手',embedding:'向量模型',rerank:'重排模型'})[d.modelRole]]);
  if(d.errorType)lines.push(['错误类型',d.errorType]);
  for(const [key,label]of [['bodyChars','接口正文字符数'],['jsonPosition','JSON 出错字符位置'],['jsonLine','JSON 出错行'],['jsonColumn','JSON 出错列'],['choicesCount','回复候选数量'],['toolCallsCount','工具调用数量'],['timeoutMs','请求等待上限（毫秒）']])if(d[key]!==undefined)lines.push([label,d[key]]);
  if(d.contentType)lines.push(['返回结构',({object:'对象',array:'数组',string:'文字',null:'空值',undefined:'缺失',number:'数值',boolean:'是/否'})[d.contentType]]);
  if(d.responseType)lines.push(['接口正文类型',({json:'JSON',html:'HTML 网页',text:'纯文本',other:'其它',unknown:'接口未提供'})[d.responseType]]);
  if(d.statusKnown===false)lines.push(['HTTP 状态来源','适配器未提供；状态值使用兼容默认值']);
  if(d.repairCategories?.length)lines.push(['补全区块',d.repairCategories.map(k=>({events:'事件',awarenessChanges:'知情',entityFactChanges:'人物与事实',relationshipChanges:'关系',personaChanges:'人设变化',commitmentChanges:'约定',performanceHints:'演绎参考',summaryView:'楼层摘要',conflicts:'冲突与疑点'})[k]).join('、')]);
  if(d.stackFrames?.length)lines.push(['插件代码位置',d.stackFrames.join(' → ')]);
  for(const cause of d.causes??[])lines.push(['上层错误的原因',[cause.errorType,DIAGNOSTIC_REASONS[cause.reason],DIAGNOSTIC_STAGES[cause.stage]].filter(Boolean).join(' · ')]);
  if(d.transport)lines.push(['请求通道',d.transport==='st_native'?'原版酒馆模型通道':d.transport==='tt_native'?'TT 原生模型通道':'浏览器直接请求；无法区分网络 / TLS / 跨域拦截']);
  if(d.storageStage)lines.push(['本机存储阶段',({write:'写入存档',read:'读取存档',readback:'写入后的读回',compare:'读回内容比对',decode:'存档完整性校验',unknown:'旧存储接口未报告阶段'})[d.storageStage]??'未识别']);
  if(d.storageArtifact)lines.push(['存档类型',({vector_jobs:'向量续传检查点',vector_index:'已完成向量索引',vector_staging:'重建中的暂存索引',runtime_log:'运行日志',workspace:'插件资料',memory:'故事记忆',checkpoint:'任务进度',credentials:'密钥存储',settings:'设置'})[d.storageArtifact]??'未识别']);
  if(d.startIndex!==undefined)lines.push(['楼层范围',`#${d.startIndex}–${d.endIndex??d.startIndex}`]);
  if(entry.phase==='review_notes'){
    if(d.expectedChecks!==undefined)lines.push(['原文检查说明',`${d.reviewedChecks??0}/${d.expectedChecks} 项已返回；这是模型说明数量，不是事实准确率`]);
    if(d.invalidCheckNotes)lines.push(['重复或无效的说明编号',d.invalidCheckNotes]);
    lines.push(['复核说明',`${d.received??0}/${d.expected??0} 楼；不代表内容已通过质量验收`]);
    if(d.expectedPassages!==undefined)lines.push(['分段说明',`${d.reviewedPassages??0}/${d.expectedPassages} 段`]);
  }else if(entry.task==='quality'){
    if(d.expected!==undefined)lines.push(['待校对记录',d.expected]);
    if(d.received!==undefined)lines.push(['校正或补充',d.received]);
    if(d.invalidRows!==undefined)lines.push(['待确认疑点',d.invalidRows]);
  }else if(d.expected!==undefined)lines.push(['逐楼摘要',`完整对应 ${d.covered??0}/${d.expected} 楼；收到 ${d.received??0} 条`]);
  for(const [key,label] of [['missingFloors','缺失楼层'],['duplicateFloors','重复楼层'],['emptyFloors','正文为空的楼层']])if(d[key]?.length)lines.push([label,d[key].map(n=>'#'+n).join('、')]);
  if(d.maxTokens!==undefined)lines.push(['实际发送回复上限',d.maxTokens===0?'沿用服务端默认（未发送 max_tokens）':`${d.maxTokens} Token`]);
  if(d.finishReason!==undefined)lines.push(['服务结束原因',d.finishReason==='unknown'?'服务未提供 / 未识别':d.finishReason]);
  if(d.truncated!==undefined)lines.push(['截断标记',d.truncated?'服务明确报告截断':'未收到截断标记']);
  for(const [key,label] of Object.entries(fields))if(d[key]!==undefined&&!['expected','received','covered','childIndex'].includes(key)&&!(entry.task==='quality'&&key==='invalidRows')&&!(d[key]===0&&['invalidRows','duplicateCount'].includes(key)))lines.push([label,d[key]]);
  if(d.childIndex>0)lines.push(['拆分序号',d.childIndex+1]);
  if(d.normalizedFields!==undefined)lines.push(['本地兼容字段',d.normalizedFields]);
  if(d.defaultedValidityFields)lines.push(['未注明有效期的人设变化',`${d.defaultedValidityFields} 条；保留为期限未确认，不推定永久变化`]);
  if(d.repairFields!==undefined)lines.push([d.purpose==='enum_repair'?'自动纠错字段':'待补全或纠错项',d.repairFields]);
  for(const [key,label]of [['deferredRecords','单独保留待核对记录'],['deferredCommitments','其中约定状态待核对'],['deferredKnowledge','其中获知依据待核对'],['journalCount','角色心迹'],['stageObservations','其中第三人称阶段观察'],['rejectedDialogues','未通过原话校验的台词']])if(d[key]!==undefined)lines.push([label,d[key]]);
  const rejection={response_shape:'纠错结果结构或条数不符',unexpected_path:'字段路径不符或重复',model_unresolved:'模型明确表示无法确定',unexpected_fields:'返回了未授权字段',invalid_value:'纠正值仍不在允许范围',missing_evidence:'没有提供原文来源',invalid_evidence_shape:'来源格式不正确',evidence_mismatch:'来源不属于原记录'}[d.repairRejection];
  if(rejection)lines.push(['纠错拒绝原因',rejection]);
  if(d.recoveryCalls!==undefined)lines.push(['当前片段额外恢复调用',`${d.recoveryCalls} / 2`]);
  if(d.retryDelayMs!==undefined)lines.push(['重试前等待',`${d.retryDelayMs} 毫秒`]);
  if(d.queuePosition!==undefined)lines.push(['队列位置',`第 ${d.queuePosition} 个`]);
  if(d.queueWaitMs!==undefined)lines.push(['共享队列等待',`${d.queueWaitMs} 毫秒`]);
  if(d.requestElapsedMs!==undefined)lines.push(['实际接口等待',`${d.requestElapsedMs} 毫秒`]);
  if(d.repairAttempted)lines.push(['自动纠错','已尝试一次，未通过校验；没有强行保存']);
  const issues=safeValidationIssues(d.validationIssues);
  if(issues.length){
    // 校验失败要能在摘要里一眼认出来（日志常显在总结页最下面，列表里同时有很多条）。
    lines.push(['校验未通过',`${d.validationIssueCount??issues.length} 项；方括号内是从 0 开始的记录位置，不是聊天楼层`]);
    for(const issue of issues)lines.push(['校验字段',validationIssueText(issue)]);
  }
  if(d.code)lines.push(['错误',failureText({code:d.code,details:d})]);
  return `<p class="sy-log-summary">${esc(runtimeLogSummary(entry))}</p><details class="sy-log-technical"><summary>技术详情（排错用，可导出）</summary>${lines.map(([label,value])=>`<div class="sy-log-detail${['错误','校验问题','校验字段'].includes(label)?' sy-log-wide':''}"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('')}</details>`;
}
export function mountRuntimeLog({panel,app,run,host,download}){
  const $=s=>panel.querySelector?.(s);let page=1,pageSize=10,state=null,signature='';const opened=new Set();
  function paint(next){
    state=next;const data=state.runtimeLog??{entries:[],persistence:'not_loaded'};
    const filter=$('[data-log-filter]')?.value??'all';
    const selected=[...data.entries].reverse().filter(e=>filter==='all'||filter==='issues'&&['error','warning'].includes(e.level)||filter==='vectors'&&['vectors','knowledge-vectors'].includes(e.task)||filter==='summary'&&e.task==='summary'||filter==='merge'&&e.task==='merge'||filter==='api'&&['transport','connection','models','assistant','knowledge','knowledge-edit'].includes(e.task));
    // 默认一页 10 条，可选 10/20/50/120；最新失败默认就在第 1 页，不会掉到第二页。
    const perPage=pageSize;
    const pages=Math.max(1,Math.ceil(selected.length/perPage));page=Math.min(page,pages);
    const items=selected.slice((page-1)*perPage,page*perPage);
    const nextSignature=JSON.stringify([items.map(e=>e.id),page,filter,data.persistence,data.droppedEntries]);
    if(signature===nextSignature)return;signature=nextSignature;
    // 日志现在常显在总结页最下面。它不能按签名跳过重绘，否则「刚发生的失败」
    // 会因为上一次已渲染过同一页而被丢掉；一页只有 10 条，重绘成本可以接受。
    const _logStorage=$('[data-log-storage]');
    if(_logStorage){
      _logStorage.textContent={not_loaded:'打开日志后读取。',ready:'日志已读取。',saved:'日志已保存在本机。',pending:'日志仍在写盘，不影响查看或导出当前内存快照。',unavailable:'日志存储读取失败；本次仅在内存保留，可立即导出。',failed:'日志保存失败；本次仅在内存保留，可立即导出。'}[data.persistence]??'';
      if(data.droppedEntries)_logStorage.textContent+=` 已清理 ${data.droppedEntries} 条旧记录。`;
      if(data.partialRuns?.length)_logStorage.textContent+=` 任务 ${data.partialRuns.join('、')} 的早期记录已清理。`;
      if(data.legacyRetentionUnknown)_logStorage.textContent+=' 旧版本是否已丢弃日志无法确认。';
      if(data.storageFailure)_logStorage.textContent+=` 日志存储原因：${DIAGNOSTIC_REASONS[data.storageFailure.reason]??'未提供可识别原因'}。`;
    }
    const _logList=$('[data-log-list]');
    if(_logList){
      _logList.innerHTML=items.map(e=>`<details class="sy-card sy-log-row" data-log-id="${e.id}" data-level="${e.level}" ${opened.has(e.id)?'open':''}><summary>任务 ${e.run} · ${LOG_TASKS[e.task]} · ${LOG_PHASES[e.phase]}<small>${esc(new Date(e.at).toLocaleString())} · ${{info:'信息',success:'成功',warning:'提醒',error:'失败'}[e.level]}</small></summary>${detailsHTML(e)}</details>`).join('')||'<p class="sy-empty">没有符合条件的日志。更新前的请求无法补录。</p>';
      for(const el of _logList.querySelectorAll?.('[data-log-id]')??[])el.addEventListener('toggle',()=>{const id=Number(el.dataset.logId);if(el.open)opened.add(id);else opened.delete(id);});
    }
    const _logPage=$('[data-log-page]');if(_logPage)_logPage.textContent=`${page} / ${pages} · ${selected.length} 条`;
    $('[data-log-prev]')&&($('[data-log-prev]').disabled=page===1);
    $('[data-log-next]')&&($('[data-log-next]').disabled=page===pages);
  }
  $('[data-log-filter]')?.addEventListener('change',()=>{page=1;paint(state??readViewState(app));});
  $('[data-log-page-size]')?.addEventListener('change',e=>{pageSize=Math.max(1,Number(e.target?.value)||10);page=1;paint(state??readViewState(app));});
  for(const [sel,delta]of [['[data-log-prev]',-1],['[data-log-next]',1]])$(sel)?.addEventListener('click',()=>{page+=delta;paint(state??readViewState(app));});
  let exporting=false;
  const status=text=>{$('[data-log-export-status]').textContent=text;};
  // Pretty-printing a 50-record report adds a third of its bytes in indentation
  // on a phone; a compact report is stored as one line instead.
  const showText=(data,message,compact=false)=>{const fallback=$('[data-log-fallback]');const area=$('[data-log-text-value]');area.value=compact?JSON.stringify(data):JSON.stringify(data,null,2);fallback.hidden=false;fallback.open=true;status(`${message}（共 ${area.value.length} 字，可长按选择或点复制）`);};
  const report=error=>{try{Promise.resolve(app.reportError?.(error,{stage:'ui',action:'exportRuntimeLog'})).catch(()=>{});}catch{/* exporting diagnostics must not need diagnostics storage */}};
  // Copying the whole snapshot is impractical on a phone (up to 2 MB). This
  // returns only the newest failing records in compact form: enough to locate a
  // failure, small enough to read and copy on a phone.
  $('[data-log-issues-text]')?.addEventListener('click',async()=>{try{showText(await app.exportRuntimeLog({filter:{levels:['error','warning'],limit:50,compact:true}}),'最近 50 条失败与提醒（精简）；可直接复制。需要全部记录请用“查看／复制全部文本”。',true);}catch(error){report(error);status(`失败记录未读取：${failureText(error)}`);}});
  $('[data-log-text]')?.addEventListener('click',async()=>{try{showText(await app.exportRuntimeLog(),'这是当前日志快照；可复制文本，不调用模型。');}catch(error){report(error);status(`日志快照未读取：${failureText(error)}`);}});
  $('[data-log-copy]')?.addEventListener('click',async()=>{const area=$('[data-log-text-value]');try{if(!host.navigator?.clipboard?.writeText)throw new Error('clipboard unavailable');await host.navigator.clipboard.writeText(area.value);status('日志文本已复制。');}catch{area.focus();area.select();status('自动复制不可用；已选中文本，可长按复制。');}});
  $('[data-log-close]')?.addEventListener('click',()=>{$('[data-log-fallback]').hidden=true;$('[data-log-text-value]').value='';});
  $('[data-log-export]')?.addEventListener('click',async()=>{
    if(exporting)return;exporting=true;$('[data-log-export]').disabled=true;let snapshot;
    status('正在导出当前日志快照；若系统保存无响应，可点“查看／复制文本”。');
    try{snapshot=await app.exportRuntimeLog();const result=await download(snapshot,'拾忆-运行日志.json');if(result?.saved===true)status(`日志已保存到${result.saveLocation??'你选择的保存位置'}。`);else showText(snapshot,'日志导出状态未确认；未收到系统保存确认，可在下方复制文本，无需重跑任务。');}
    catch(error){report(error);if(snapshot)showText({...snapshot,exportFailure:safeLogDetails(errorDiagnostics(error))},`文件未导出：${failureText(error)}。日志已在下方展开，可直接复制，无需重跑任务。`);else status(`日志未导出：${failureText(error)}`);}
    finally{exporting=false;$('[data-log-export]').disabled=false;}
  });
  $('[data-log-clear]')?.addEventListener('click',()=>run(async()=>{if(host.confirm?.('清空运行日志？记忆、总结批次、设置和助手对话不会删除。')){await app.clearRuntimeLog();opened.clear();page=1;signature='';paint(readViewState(app));}}));
  return {paint};
}
