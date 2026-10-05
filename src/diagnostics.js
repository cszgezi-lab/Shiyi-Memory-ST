import {PERSONA_ISSUES} from './persona-validation.js';
// Shared, content-free diagnostics. Never serialize Error.message, API bodies,
// headers, URLs, user filenames or arbitrary server error objects into exports.
export const DIAGNOSTIC_REASONS = Object.freeze({
  retrospective_validation:'复盘材料或返回格式未通过检查，原记录保留',
  retrospective_record_too_large:'单条已存记录超过复盘输入预算，未截断或发送',
  retrospective_input_budget:'完整复盘请求超过输入预算，未发送',
  retrospective_persona_busy:'人物任务尚未结束，本次未启动复盘',
  retrospective_chat_busy:'聊天回复尚未结束，本次未启动复盘',
  summary_batch_split:'已将所选未完成总结批次按完整楼层拆小，其它批次与已完成结果保留，未调用模型',
  summary_prefix_applied:'已按确认终点应用连续完成的总结前段，剩余任务已取消，旧结果已归档，自动接续暂停',
  summary_batches_deleted:'已按所选范围或已确认的级联范围撤下总结批次，原文保留',
  summary_batches_restored:'已恢复所选总结批次；未完成候选仍需继续处理或应用',
  persona_source_changed:'原文校验发现变化，已归档并撤下受影响的人设批次，自动更新暂停',
  persona_plan_created:'已保存人设计划；正式档案与批次尚未替换',
  persona_plan_discarded:'已归档并放弃本次人设候选计划，正式档案保留',
  persona_prefix_applied:'已按确认终点应用连续完成的人设前段，其余候选和旧状态已归档，自动更新暂停',
  persona_append_saved:'新增人设批次已保存，早期正式批次保留',
  persona_range_applied:'手动人设计划整组完成，已按范围应用；保留与撤下批次数见记录',
  persona_rebuild_applied:'人设重建整组完成，已按确认范围替换并保留归档',
  persona_batches_deleted:'已按累积依赖撤下所选及后续人设批次，归档已保存',
  persona_batches_restored:'已核对原文并恢复上次撤下的人设批次',
  persona_start_changed:'已修改人设起算楼层，已有正式批次保留',
  queue_foreground:'正在生成聊天回复，后台请求等待本轮结束',
  log_io_timeout:'日志存储响应超时；本次保留在内存，不阻止任务或日志导出',
  export_module_unavailable:'宿主文件导出接口加载失败，可复制日志文本',
  export_permission_denied:'系统拒绝保存文件的权限，可复制日志文本',
  export_native_failed:'宿主文件保存失败，可复制日志文本；不代表记忆丢失',
  export_host_exception:'宿主原生下载接口抛出 Java 异常，本次未确认文件已保存；请改用文本导出',
  export_dispatched_unconfirmed:'文件已交给系统下载但本机无法确认落盘；Downloads 中无文件时请改用文本导出',
  export_stage_file_missing:'宿主导出桥找不到暂存文件，文件未保存；用户数据不受影响',
  export_picker_fallback_used:'宿主直存 Downloads 失败，已改用系统文件选择器保存成功',
  export_picker_unavailable:'TT 未提供完整的系统保存接口；未回退到原生 Downloads 直存，请复制日志文本',
  export_picker_open_failed:'TT 未能打开系统“选择保存位置”窗口；未调用 Downloads 直存，文件未保存，可复制文本',
  export_picker_busy:'另一个保存窗口尚未结束，请先返回并关闭；仍提示占用时刷新 TT 后重试，文本仍可复制',
  export_picker_timeout:'系统保存窗口未按时返回；未写入文件，请先返回并关闭窗口；窗口未出现时刷新 TT，文本仍可复制',
  export_picker_invalid:'系统未返回有效保存位置；未写入文件，可重试或复制文本',
  export_stage_write_failed:'已选择位置，但 TT 写入暂存文件失败；目标可能为空文件，未确认保存，可复制文本',
  export_picker_copy_failed:'已选择位置，但 TT 未确认文件写入完成；目标可能为空或不完整文件，可复制文本',
  history_decode_failed:'宿主聊天历史不是完整JSON，尚未交给模型处理',
  history_tail_failed:'读取当前聊天末页失败，尚不能判断原文是否变化',
  history_save_pending:'TT 本次回复尚未保存，等待后有限重读；已有结果保留',
  history_before_failed:'读取较早聊天分页失败，未跳过缺失楼层',
  history_retry_wait:'等待聊天原文就绪后重读；这不是模型调用成功',
  persona_waiting:'楼层尚未满足自动人设周期，未调用模型',
  persona_previous_failure:'上一批尚未恢复，本次没有调用人设模型',
  persona_recovery_upgraded:'恢复协议已更新，重新排入旧的回答失败批次；已保存结果不重做',
  persona_host_binding:'忽略模型填写的旧绑定字段；由程序按唯一人物身份绑定本次已提供的原设定',
  persona_fields:'动态人设的姓名、正文格式或来源楼层不合要求，旧档案保留',persona_character:'人设姓名未在本批原文或既有档案中确认',persona_binding:'所选原设定无法确认属于当前人物，未替换原书',persona_duplicate:'同一人物阶段被重复返回，未覆盖旧档案',persona_stage_changed:'原设定或MVU当前阶段已改变，本批旧阶段回答未应用',
  queue_busy:'等待同一接口的上一条聊天请求完成',queue_cooldown:'接口异常后冷却等待',queue_rpm:'等待每分钟请求名额',
  input_budget_exceeded:'模型输入超过配置预算，请求尚未发送；已返回的结果保留',
  stream_invalid:'流式响应格式异常，未保存不完整内容',stream_incomplete:'流式响应在完成标记之前中断，未保存半份总结',stream_error:'服务在流式返回途中报告错误',
  chat_ref_unavailable:'宿主未能返回当前聊天标识',
  source_task_inactive:'原文校验所属任务已停止或被切换',
  source_plan_mismatch:'待校验请求与本次冻结的请求计划不一致',
  source_chat_changed:'原文校验期间当前聊天已切换',
  source_content_changed:'本批聊天正文或来源标识确实发生变化',
  source_read_failed:'读取原文失败，尚不能判断正文是否变化',
  quality_validation:'校对结果的结构、修改权限或原文证据未通过',
  empty_body:'接口返回空正文', invalid_envelope_json:'接口外层响应不是有效 JSON',
  empty_model_content:'模型回复正文为空', invalid_model_json:'模型正文不是有效 JSON',
  invalid_model_root:'模型结果不是要求的 JSON 对象', missing_categories:'模型结果缺少必需区块',
  invalid_repair_shape:'补全结果改变了区块结构或遗漏原有记录', body_interrupted:'读取响应正文时中断',
  http_error:'接口返回非成功 HTTP 状态', network_unclassified:'网络请求失败；宿主未提供更具体的网络原因',
  timeout:'请求超过等待时间', canceled:'请求被取消', output_truncated:'接口明确报告输出被截断',
  output_blocked:'接口明确报告内容过滤', invalid_chat_response:'接口缺少聊天回复',
  storage_read:'读取存档失败', storage_write:'写入存档失败', storage_readback:'写入后无法读回',
  storage_mismatch:'写入内容与读回内容不一致', storage_decode:'存档完整性校验失败',
  schema:'正则配置结构检查未通过', syntax:'正则语法检查未通过', flags:'正则选项检查未通过',
  length:'正则表达式超过允许长度', unsafe:'正则包含可能反复计算的结构',
  'work-limit':'启用规则累计预计工作量达到本地保护上限；规则序号仅表示触限位置',
  'match-limit':'启用规则累计匹配数量达到本地保护上限',
  person_delete_busy:'人物记录正在更新，本次尚未开始删除',
  person_delete_stale:'人物记录或删除范围已变化，本次尚未开始删除',
  person_delete_merged:'要移除的心迹或台词来自合并事件，本次尚未开始删除',
  person_delete_missing:'要删除的人物记录已不存在，本次尚未开始删除',
  person_delete_storage:'人物删除前的存储检查未通过，本次尚未开始删除',
  person_delete_partial:'人物删除的保存结果尚未全部确认，需核对已处理与剩余项',
  log_document_invalid:'旧日志格式无法读取，未覆盖旧文件', unclassified:'错误未提供可识别原因；请结合阶段与代码位置定位',
});
export const PERSONA_STEPS=Object.freeze({history_tail:'读取当前聊天进度',history_range:'读取本批原文',api_config:'检查人设 API 配置',worldbook_read:'读取角色原世界书',prepare_profile:'整理人设输入',cached_response:'读取暂存回答',model_request:'请求人设模型',parse_profile:'解析与检查人设回答',source_verify:'保存前复查原文',worldbook_verify:'保存前复查世界书',profile_save:'保存人物档案',failure_save:'保存失败进度'});
export const DIAGNOSTIC_PURPOSES=Object.freeze({summary_verification:'原文复核与补漏',summary_narrative:'事件与楼层整理',summary_details:'人物与知情整理',reference_repair:'纠正事件引用',summary:'主总结',floor_repair:'逐楼摘要补全',category_repair:'区块补全',enum_repair:'字段纠错',chat:'聊天模型',embeddings:'向量',rerank:'重排',models:'模型列表',ui:'界面操作',background:'后台任务'});
export const DIAGNOSTIC_STAGES=Object.freeze({export_picker_open:'打开系统保存位置窗口',export_native_save:'调用宿主保存接口（内部阶段未确认）',queue:'等待共享请求队列',prepare:'准备请求',request:'等待接口',read_body:'读取响应正文',parse_envelope:'解析接口响应',parse_content:'解析模型正文',validate:'校验结果',repair:'补全结果',storage:'本机保存',ui:'界面操作',background:'后台处理',export_load:'加载宿主导出接口',export_prepare:'准备导出文件',export_dispatch:'派发下载动作',export_save_verify:'校验导出暂存文件',export_save_copy:'写入导出文件',export_save_publish:'发布到系统下载目录'});
export const UPSTREAM_CODES=Object.freeze({invalid_api_key:'密钥无效',api_key_missing:'服务要求密钥',context_length_exceeded:'超出模型上下文',insufficient_quota:'额度不足',rate_limit_exceeded:'服务限流',model_not_found:'模型不存在',server_error:'服务内部错误',invalid_request_error:'服务拒绝请求格式',outbound_host_denied:'出站地址被服务拒绝'});
// Providers may put a vendor-specific code beside a standard error type.
// An unrecognized code must not hide a recognized quota/authentication cause.
function errorLayers(value){
  const layers=[],queue=[value],seen=new Set();
  while(queue.length&&layers.length<12){
    const row=queue.shift();if(!row||typeof row!=='object'||Array.isArray(row)||seen.has(row))continue;
    seen.add(row);layers.push(row);
    for(const key of ['error','details','cause','upstream','upstream_error'])if(row[key]&&typeof row[key]==='object')queue.push(row[key]);
  }
  return layers;
}
export function upstreamErrorCode(value){
  const candidates=errorLayers(value).flatMap(row=>[row.code,row.type]);
  const recognized=candidates.map(code=>code==='quota_exceeded'?'insufficient_quota':code).filter(code=>typeof code==='string'&&Object.hasOwn(UPSTREAM_CODES,code));
  return recognized.includes('insufficient_quota')?'insufficient_quota':recognized[0];
}
// Interpret only the service's error fields, never generated model content.
// Persist fixed labels rather than raw messages (which may echo keys/prompts).
// These are reported causes, not proof inferred from HTTP 502 or elapsed time.
export const UPSTREAM_HINTS=Object.freeze({timeout:'服务报文提到上游等待超时',overloaded:'服务报文提到模型繁忙',connection_reset:'服务报文提到上游连接断开',context_limit:'服务报文提到输入上下文超限',content_blocked:'服务错误报文明确提到内容过滤',unknown:'服务未提供可识别的原因'});
export function upstreamErrorHint(value){
  const fields=errorLayers(value).flatMap(row=>[row.message,row.code,row.type,typeof row.error==='string'?row.error:null]);
  const text=fields.filter(v=>typeof v==='string').map(v=>v.slice(0,4096)).join(' ');
  if(/\b(?:content_filter|content_policy_violation|safety_blocked|blocked by safety|blocked due to safety)\b|(?:内容|安全策略)(?:审查|过滤|拦截|违规)|因安全.{0,6}(?:拦截|阻止)/i.test(text))return 'content_blocked';
  if(/context_length_exceeded|maximum context length|context (?:window|length|limit).{0,40}(?:exceed|limit)|上下文.{0,12}(?:超限|超过)/i.test(text))return 'context_limit';
  if(/\b(?:timeout|timed out|deadline exceeded|DEADLINE_EXCEEDED)\b|(?:请求|上游|等待|连接)超时/i.test(text))return 'timeout';
  if(/\b(?:overloaded|overload|model is busy|capacity exhausted)\b|(?:模型|服务).{0,4}(?:繁忙|过载)/i.test(text))return 'overloaded';
  if(/\b(?:ECONNRESET|connection reset|unexpected EOF|connection closed|socket hang up)\b|上游连接.{0,4}(?:断开|关闭|重置)/i.test(text))return 'connection_reset';
  return 'unknown';
}
// Read only the first message line inside a reserved host error envelope.
// Never search a generated answer, an endpoint, or arbitrary follow-up advice.
export const NATIVE_NETWORK_MESSAGES=Object.freeze({
  'network.timeout':'TT 原生请求等待目标服务超时',
  'network.connect_failed':'TT 原生请求未能连接目标服务',
  'network.proxy_failed':'TT 原生请求的代理连接失败',
  'network.dns_failed':'TT 原生请求无法解析目标服务地址',
  'network.tls_failed':'TT 原生请求的安全连接未建立',
  'network.body_interrupted':'TT 原生响应在读取时中断',
  'network.request_failed':'TT 原生网络请求失败，宿主未提供更细原因',
});
export function nativeStreamErrorCode(message){
  const lines=String(message??'').slice(0,4096).split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if(/^\[[^\]\r\n]{1,40}\]$/.test(lines[0]??''))lines.shift();
  const line=lines[0]??'';
  const prefixes=[
    ['network.timeout',/^(?:请求超时：|請求逾時：|The request timed out before the target service responded\.)/],
    ['network.connect_failed',/^(?:连接目标服务失败：|連線到目標服務失敗：|Could not connect to the target service\.)/],
    ['network.proxy_failed',/^(?:代理连接失败：|代理連線失敗：|Could not connect through the configured proxy\.)/],
    ['network.dns_failed',/^(?:找不到目标服务地址：|找不到目標服務位址：|Could not find the target service address\.)/],
    ['network.tls_failed',/^(?:安全连接失败：|安全連線失敗：|Could not establish a secure connection\.)/],
    ['network.body_interrupted',/^(?:响应读取中断：|回應讀取中斷：|The response was interrupted while it was being read\.)/],
    ['network.request_failed',/^(?:网络请求失败：|網路請求失敗：|Network request failed\.)/],
  ];
  return prefixes.find(([,pattern])=>pattern.test(line))?.[0];
}
export const DIAGNOSTIC_ACTIONS=Object.freeze({editDocumentChunk:'修改资料片段',catchUpAutomatic:'补采未记录楼层',inspectAutomaticProgress:'检查记录覆盖',open:'打开聊天',refresh:'刷新记忆',saveSettings:'保存设置',saveApi:'保存 API',forgetKey:'清除密钥',editRecord:'修改记忆',editPersonProfile:'修改人物档案',previewNarrativeExtraction:'预览正文提取',readNarrativeSource:'读取聊天原文',prepareNarrativeReading:'准备正文读取',deletePerson:'删除人物',deleteRecord:'删除记忆',deleteRecords:'批量删除记忆',remember:'新增记忆',manageBatches:'管理总结批次',deleteBatch:'删除批次',regenerateBatch:'重新总结',retryBatch:'重试总结',retryIncompleteBatches:'重试未完成批次',saveModule:'保存扩展模块',editModuleRecord:'修改扩展记忆',rememberModule:'新增扩展记忆',importModules:'导入模块',exportModules:'导出模块',inspectMvu:'读取 MVU',syncModules:'同步 MVU',applyProposal:'应用助手方案',undoSettings:'撤销配置',saveDictionaryEntry:'修改字典',exportBackup:'导出聊天备份',exportGlobalBackup:'导出全局备份',setAutoStartFloor:'设置自动总结起点',setAutomatic:'配置自动总结',processAutomatic:'执行自动总结',setDraft:'保存助手草稿',newConversation:'新建助手对话',selectConversation:'切换助手对话',deleteConversation:'删除助手对话',hideRecord:'排除记忆',restoreHidden:'恢复被排除记忆',removeDocument:'删除知识库资料',updateDocument:'更新知识库资料',stop:'停止任务',disable:'暂停插件'});
const files=new Set(['provider-scheduler.js','summary-planner.js','request-deadline.js','provider.js','summary-stages.js','summary-context.js','summary-reference-repair.js','summary-engine.js','summary-recovery.js','contracts.js','repository.js','reliable-storage.js','host-adapter.js','dynamic-persona.js','dynamic-persona-worldbook.js','dynamic-persona-stage.js','product-application.js','product-workspace.js','product-network.js','product-shell-controller.js','product-host-adapters.js','product-view.js','product-runtime-log.js','product-model-list.js','product-vector-indexer.js','product-vector-cache.js','product-vector-storage.js','product-dictionary.js','product-event-merge.js','product-credentials.js','product-global-settings.js','product-module-controller.js','diagnostics.js']);
// JavaException is the WebView wrapper around a throwable raised inside an
// Android @JavascriptInterface method (TT's native export bridge). Only the
// fixed type name is ever recorded; its message may contain host paths and is
// never stored.
const errorTypes=new Set(['Error','TypeError','SyntaxError','RangeError','ReferenceError','AbortError','NotAllowedError','DOMException','JavaException','ShiyiError','SummaryResponseError','ValidationError','PersistenceError','ScopeConflictError','RevisionConflictError']);
files.add('product-host-ui.js');
files.add('product-people-view.js');
files.add('product-dynamic-persona.js');
files.add('narrative-extraction.js');
files.add('narrative-reading.js');
files.add('product-android-export.js');
files.add('summary-verification.js');
files.add('provider-stream.js');
files.add('quality-response.js');
files.add('product-memory-quality.js');
files.add('product-quality-evidence.js');
files.add('product-knowledge-review.js');
files.add('persona-composition.js');
files.add('persona-response-recovery.js');
files.add('product-memory-retrospective.js');
files.add('product-memory-retrospective-controller.js');
const verificationCodes=new Set(['invalid_shape','missing_evidence','quote_not_in_source','protected_or_unknown_field','source_mismatch','source_removal','unknown_or_duplicate_target','unknown_category','missing_sources','duplicate_id']);
const verificationPath=/^(?:verification|reviewedSourceIds|reviews|checks|updates|repartitions|(?:edits|splitEvents|updates|additions|repartition)\[\d{1,6}\](?:\.events\[\d{1,6}\])?(?:\.(?:value|sources)|\.evidence\[\d{1,6}\]\.(?:sourceId|quote))?)$/;
let sequence=0;
export const QUALITY_REASONS=Object.freeze(['证据片段不存在或已变化','获知证据未对应人物与原文','约定状态不正确','知情状态不正确','知情途径不正确','角色心迹字段不正确','关键台词字段不正确','台词不属于原文发言','返回格式或条数不正确','缺少原文依据','依据不能对应原文','含不允许修改的字段','事实性质不正确','文字字段不正确','列表字段不正确','更新对象不在本批或重复','更新依据不属于原记录','新增区块或来源锚点不正确','新增记录不正确','新增依据不属于来源锚点','新增依据不属于本次校对来源','新增记录过长','新增记录含未知字段','知情字段缺失或事件不存在','知情字段缺失或关联事件/属性不存在','人物属性缺失或越权确认','疑点没有关联原记录','没有一项校对结果通过验证','校对项未通过原文与字段校验']);
export function diagnosticRequestId(){return `req-${Date.now().toString(36)}-${(++sequence).toString(36)}`;}
export function safeDiagnosticFields(value={}){
  const result={};
  // Fixed regex metadata locates a failed rule without storing its expression,
  // name, id, source prose or arbitrary exception text. The index is only the
  // cumulative guard's trigger position, not a per-rule performance judgment.
  if(['includeRegex','excludeRegex','config'].includes(value?.field))result.field=value.field;
  if(Number.isSafeInteger(value?.ruleIndex)&&value.ruleIndex>=0&&value.ruleIndex<64)result.ruleIndex=value.ruleIndex;
  if(['include','exclude'].includes(value?.kind))result.kind=value.kind;
  if(Object.hasOwn(NATIVE_NETWORK_MESSAGES,value?.nativeErrorCode))result.nativeErrorCode=value.nativeErrorCode;
  if(Object.hasOwn(PERSONA_STEPS,value?.personaStep))result.personaStep=value.personaStep;
  if(['tail','before'].includes(value?.historyStep))result.historyStep=value.historyStep;
  for(const key of ['historyReadAttempts','lastIndex','keepRecent'])if(Number.isSafeInteger(value?.[key])&&value[key]>=0)result[key]=value[key];
  if(typeof value?.modelRequested==='boolean')result.modelRequested=value.modelRequested;
  const qualityReasons=new Set([...QUALITY_REASONS,'获知者与校对目标不一致','知情状态或渠道不正确']);
  const qualityFields=new Set(['description','text','knowledge','content','recallSummary','entities','tags','temporal','learnedAt','epistemicStatus','before','after','context','scope','object','field','to','validFrom','validUntil','participants','location','state','status','via','innerLife','keyDialogues','acquisitionEvidence','id','category','unknown']);
  if(Array.isArray(value?.verificationIssues))result.verificationIssues=value.verificationIssues.slice(0,100).flatMap(r=>typeof r?.path==='string'&&verificationPath.test(r.path)&&verificationCodes.has(r.code)?[{path:r.path,code:r.code,...(Number.isSafeInteger(r.sourceFloor)&&r.sourceFloor>=0?{sourceFloor:r.sourceFloor}:{})}]:[]);
  if(qualityReasons.has(value?.qualityReason))result.qualityReason=value.qualityReason;
  if(Array.isArray(value?.qualityShape))result.qualityShape=value.qualityShape.slice(0,6).flatMap(r=>['root','updates','additions','issues','reviews'].includes(r?.field)&&['missing','null','array','object','string','number','boolean'].includes(r.type)?[{field:r.field,type:r.type,...(Number.isSafeInteger(r.count)&&r.count>=0?{count:r.count}:{})}]:[]);
  if(Array.isArray(value?.qualityRejections))result.qualityRejections=value.qualityRejections.slice(0,100).flatMap(r=>['update','addition','issue'].includes(r?.kind)&&Number.isSafeInteger(r.index)&&r.index>=0?[{kind:r.kind,index:r.index,reason:qualityReasons.has(r.reason)?r.reason:'校对项未通过原文与字段校验',...(Array.isArray(r.fields)?{fields:r.fields.slice(0,40).map(k=>qualityFields.has(k)?k:'unknown')}: {})}]:[]);
  // A narrower stage for the exact failing step wins over the generic one. It
  // never carries host text, only a fixed key.
  const stageAliases={file_missing:'export_save_verify',write_failed:'export_save_copy',publish_failed:'export_save_publish',staging_failed:'export_prepare'};
  for(const [key,labels]of [['reason',DIAGNOSTIC_REASONS],['purpose',DIAGNOSTIC_PURPOSES]])if(Object.hasOwn(labels,value?.[key]))result[key]=value[key];
  for(const key of ['saveStage','stage','exportStage']){
    const raw=value?.[key];
    if(stageAliases[raw]){result.stage=stageAliases[raw];result.saveStage=raw;break;}
    if(Object.hasOwn(DIAGNOSTIC_STAGES,raw)){result.stage=raw;break;}
  }
  // Which host save path was used, and whether the direct one already failed.
  if(['direct','picker','picker_failed','browser'].includes(value?.exportAttempt))result.exportAttempt=value.exportAttempt;
  // Which TT bridge operations the export actually reached, and how each failed.
  // Fixed operation keys and reason enums only: never a path or host message.
  if(Number.isSafeInteger(value?.exportBytes)&&value.exportBytes>=0)result.exportBytes=value.exportBytes;
  if(Array.isArray(value?.hostOperations))result.hostOperations=value.hostOperations.slice(0,8).flatMap(row=>{
    // Attribution is the operation name plus the fixed error type. The failing
    // save step is already carried by saveStage/stage, so no host text is needed
    // here and unknown operation names are dropped.
    const operation=['saveFileToDownloads','requestCreateDocumentPicker','copyFileToContentUri'].includes(row?.operation)?row.operation:null;
    if(!operation)return [];
    const errorType=errorTypes.has(row?.errorType)?row.errorType:undefined;
    return [{operation,...(errorType?{errorType}:{})}];
  });
  if(typeof value?.requestId==='string'&&/^req-[a-z0-9]{1,16}-[a-z0-9]{1,10}$/.test(value.requestId))result.requestId=value.requestId;
  if(errorTypes.has(value?.errorType))result.errorType=value.errorType;
  if(errorTypes.has(value?.causeErrorType))result.causeErrorType=value.causeErrorType;
  if(['name','text','sourceFloors'].includes(value?.personaField))result.personaField=value.personaField;
  if(Object.hasOwn(PERSONA_ISSUES,value?.personaIssue))result.personaIssue=value.personaIssue;
  if(Number.isSafeInteger(value?.editIndex)&&value.editIndex>=0)result.editIndex=value.editIndex;
  if(typeof value?.recoveryExhausted==='boolean')result.recoveryExhausted=value.recoveryExhausted;
  for(const key of ['profileIndex','personaProfiles','personaBindings'])if(Number.isSafeInteger(value?.[key])&&value[key]>=0)result[key]=value[key];
  if(typeof value?.legacyBindingsIgnored==='boolean')result.legacyBindingsIgnored=value.legacyBindingsIgnored;
  if(Object.hasOwn(UPSTREAM_CODES,value?.upstreamCode))result.upstreamCode=value.upstreamCode;
  if(Object.hasOwn(UPSTREAM_HINTS,value?.upstreamHint))result.upstreamHint=value.upstreamHint;
  for(const key of ['firstBodyMs','responseHeadersMs','messageCount'])if(Number.isSafeInteger(value?.[key])&&value[key]>=0)result[key]=value[key];
  for(const key of ['jsonMode','bufferedBody'])if(typeof value?.[key]==='boolean')result[key]=value[key];
  if(typeof value?.providerFingerprint==='string'&&/^[a-f0-9]{64}$/.test(value.providerFingerprint))result.providerFingerprint=value.providerFingerprint;
  if(Object.hasOwn(DIAGNOSTIC_ACTIONS,value?.action))result.action=value.action;
  for(const key of ['bodyChars','jsonPosition','jsonLine','jsonColumn','choicesCount','toolCallsCount','attempt','repairCategoriesCount','timeoutMs','retryAfterMs','validationIssuesOmitted','stackFramesOmitted','causeCount'])if(Number.isSafeInteger(value?.[key])&&value[key]>=0)result[key]=value[key];
  for(const key of ['statusKnown','upstreamDetailsProvided','backgroundSeen'])if(typeof value?.[key]==='boolean')result[key]=value[key];
  if(['object','array','string','null','undefined','number','boolean'].includes(value?.contentType))result.contentType=value.contentType;
  if(['json','html','text','other','unknown'].includes(value?.responseType))result.responseType=value.responseType;
  if(Array.isArray(value?.repairCategories))result.repairCategories=value.repairCategories.filter(k=>['events','awarenessChanges','entityFactChanges','relationshipChanges','personaChanges','commitmentChanges','performanceHints','summaryView','conflicts'].includes(k));
  if(Array.isArray(value?.stackFrames))result.stackFrames=value.stackFrames.filter(frame=>{const m=/^([a-z-]+\.js):(\d{1,7}):(\d{1,7})$/.exec(frame);return m&&files.has(m[1]);}).slice(0,12);
  if(Array.isArray(value?.causes))result.causes=value.causes.slice(0,4).map(c=>safeDiagnosticFields({...c,causes:undefined}));
  return result;
}
export function errorDiagnostics(error){
  const frames=[...String(error?.stack??'').matchAll(/(?:[/\\])([a-z-]+\.js):(\d{1,7}):(\d{1,7})/g)].filter(m=>files.has(m[1])).map(m=>`${m[1]}:${m[2]}:${m[3]}`);
  const allFrames=[...new Set([...(safeDiagnosticFields(error?.details).stackFrames??[]),...frames])];
  const details={...error?.details,errorType:errorTypes.has(error?.name)?error.name:'Error',code:error?.code??'OPERATION_FAILED',stackFrames:allFrames.slice(0,12),stackFramesOmitted:Math.max(0,allFrames.length-12)};
  if(!details.reason)details.reason='unclassified';
  // The wrapped host error keeps its own type beside the wrapper, so a Java
  // bridge failure stays identifiable without any raw message or path.
  const rootCause=error?.cause??error?.details?.causeError;
  if(rootCause&&typeof rootCause==='object'&&errorTypes.has(rootCause.name))details.causeErrorType=rootCause.name;
  const seen=new Set([error]),causes=[];let cause=error?.cause??error?.details?.causeError;
  while(cause&&typeof cause==='object'&&!seen.has(cause)&&causes.length<4){seen.add(cause);causes.push(safeDiagnosticFields({...cause.details,errorType:errorTypes.has(cause.name)?cause.name:'Error'}));cause=cause.cause??cause.details?.causeError;}
  if(causes.length)details.causes=causes;
  return details;
}
export function jsonFailure(error,text,{stage='parse_content',...details}={}){
  const empty=!String(text??'').trim(),position=/position\s+(\d+)/i.exec(error?.message??''),line=/line\s+(\d+)\s+column\s+(\d+)/i.exec(error?.message??'');
  return {...details,stage,reason:stage==='parse_envelope'?(empty?'empty_body':'invalid_envelope_json'):(empty?'empty_model_content':'invalid_model_json'),bodyChars:String(text??'').length,...(position?{jsonPosition:Number(position[1])}:{}),...(line?{jsonLine:Number(line[1]),jsonColumn:Number(line[2])}:{}),causeError:error};
}
export function contentType(value){return value===null?'null':Array.isArray(value)?'array':typeof value;}

/** Last-resort listener only for this extension's own source URLs. It never
 * intercepts another extension's failures or suppresses host error reporting. */
export function installDiagnosticBoundary(host,report){
  if(typeof host?.addEventListener!=='function')return()=>{};
  const root=new URL('../',import.meta.url).href;
  const onError=event=>{
    const error=event?.error??event?.reason;
    if(!String(error?.stack??'').includes(root)&&!String(event?.filename??'').startsWith(root))return;
    try{report(error??new Error('plugin runtime error'),{stage:'background',task:'background'});}catch{/* no recursive reporting */}
  };
  host.addEventListener('error',onError);host.addEventListener('unhandledrejection',onError);
  return()=>{host.removeEventListener?.('error',onError);host.removeEventListener?.('unhandledrejection',onError);};
}
