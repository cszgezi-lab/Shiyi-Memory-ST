import { humanValidationIssueText } from './validation-diagnostics.js';
import {PERSONA_ISSUES} from './persona-validation.js';
import { upstreamErrorCode,upstreamErrorHint,PERSONA_STEPS,DIAGNOSTIC_REASONS } from './diagnostics.js';
import {PRODUCT_SETTING_REGISTRY} from './product-settings.js';

const NETWORK = {
  'network.timeout':'请求超时，请重试或调整请求超时。',
  'network.connect_failed':'无法连接模型服务，请检查地址和网络。',
  'network.proxy_failed':'模型服务的网络代理连接失败。',
  'network.dns_failed':'找不到模型服务的地址，请检查服务地址和网络。',
  'network.tls_failed':'没能与模型服务建立安全连接，请检查服务地址和网络。',
  'network.body_interrupted':'响应传输中断，请重试。',
  'network.request_failed':'网络请求失败，请检查服务是否可访问。',
};
const CODES = {
  NARRATIVE_REGEX_INVALID:'标签规则无法使用。请编辑这条正则，先预览再保存；聊天原文和已保存内容保留。',
  NARRATIVE_READING_EMPTY:'按当前正则，本批没有可读取的正文，已停止请求。请先打开“标签管理”预览并调整提取或排除范围，再继续；原文、已有档案和成功批次保留。',
  FILE_EXPORT_FAILED:'文件导出未完成；可在日志页查看／复制文本，不需要重新运行任务。',
  PERSONA_RESPONSE_INVALID:'人设回答的格式、人物或来源未通过检查；旧档案保留，可在动态人设页重试。具体原因见运行日志。',
  PERSONA_STAGE_CHANGED:'MVU阶段或原设定已改变，本批旧阶段回答未覆盖档案；可在动态人设页重试，不需重新总结。',
  PERSONA_REBUILD_CONFLICT:'重建期间人物档案有新的修改；修改与旧档案均保留。请放弃本次候选并重新预览范围，不要重复继续旧计划。',
  SUMMARY_REBUILD_CONFLICT:'覆盖期间记忆有新的人工修改，候选没有覆盖它。请在批次管理撤下本次未应用候选，再重新预览范围。',
  QUALITY_RESPONSE_INVALID:'校对结果的格式、对象或原文证据未通过验证；原总结保留，可在内容校对中单独重试。',
  RECOVERY_LIMIT:'本批自动恢复已达到 2 次，已返回的结果暂存保留。可继续未完成任务；不会无上限调用模型。',
  RESUME_UNAVAILABLE:'本批没有可续跑的暂存任务（旧版本或已过保留期），请点击重新生成；旧记忆不会提前删除。',
  VECTOR_RESPONSE_COUNT:'向量返回数量与输入不符；已保存的索引保留，请在向量页重试未完成项。',
  VECTOR_RESPONSE_INDEX:'服务返回的向量序号缺失、重复或越界，无法安全对应记忆。',
  VECTOR_RESPONSE_INVALID:'服务没有返回有效的浮点向量；请确认选择的是向量模型。',
  VECTOR_DIMENSION_MISMATCH:'向量维度发生变化；旧记忆保留，请在索引维护中重建索引。',
  VECTOR_INPUT_EMPTY:'这条记忆没有可编码的文字，请修改原记忆后重试。',
  VECTOR_INPUT_TOO_LARGE:'单条记忆过长，未自动发送，请在向量列表检查原记忆。',
  VECTOR_INDEX_INCOMPLETE:'部分向量未完成；成功项已保存，可一键重试未完成项，无需重新总结。',
  PROVIDER_REQUEST_FAILED:'模型服务返回异常，未得到可用结果。请查看运行日志后重试。',
  MERGE_RESPONSE_INVALID:'合并接口返回的判断或依据不完整。总结已经保存，可以只重试合并。',
  CHAT_REF_UNAVAILABLE:'未能取得 TT 当前聊天。请确认已进入具体对话、正文加载完成后重试；不会读取其他聊天。',
  CHAT_IDENTITY_NOT_READY:'TT 尚未提供当前聊天的持久标识，请等待聊天保存完成后重试。',
  CHAT_HANDLE_UNAVAILABLE:'TT 未能提供当前聊天读取接口，请重新进入这段对话后重试。',
  HISTORY_UNAVAILABLE:'当前聊天正文未读到，或所选范围为空。请等待正文加载完成并检查楼层范围。',
  CHAT_CHANGED:'聊天已切换，旧聊天操作已停止；当前聊天会自动加载。',
  SOURCE_INVALIDATED:'所选正文或记录规则已变化，本次已停止；请按修改后的内容重新生成。',
  REVISION_CONFLICT:'当前聊天记忆已发生变化，旧草稿未覆盖新记录。请重新生成此批；旧成功结果仍保留。',
  SCOPE_CONFLICT:'暂存任务与当前聊天或批次不一致，已阻止混用；请确认聊天后重新生成。',
  FLOOR_SUMMARY_MISSING:'逐楼摘要未完整对应所选楼层，本批未保存。这不等于回复上限不足；请查看运行日志中的缺失楼层和结束原因。',
  MODEL_OUTPUT_TRUNCATED:'服务明确报告输出被截断，本批未保存。请查看运行日志中的实际回复上限、结束原因和用量。',
  MODEL_OUTPUT_BLOCKED:'模型服务拦截了输出，本批未保存；提高回复上限不能解决此问题。',
  INPUT_BUDGET_EXCEEDED:'输入超过预算，请提高总结输入预算或减少每批楼数；未完成部分不会注入。',
  TIMEOUT:NETWORK['network.timeout'], CANCELED:'任务已停止；已保存内容保留。',
  MODEL_UNAVAILABLE:'请先在 API 中填写并保存总结地址与模型。',
  PROVIDER_PROFILE_INVALID:'API 地址或认证配置不正确。',
  SUMMARY_RESPONSE_INVALID:'模型返回的内容不符合总结格式，本次结果未标记为成功。',
  VALIDATION_ERROR:'返回内容未通过结构或来源校验，本次结果未保存。请查看运行日志的校验字段；这不等于回复上限不足。',
  SUMMARY_RESPONSE_ERROR:'模型响应中断或内容格式不正确，请重试。',
  PERSISTENCE_ERROR:'保存或读回校验失败，不能确认本次结果已保存。',
  PERSISTENCE_UNAVAILABLE:'当前聊天存储不可用，请确认聊天已保存。',
};
const HTTP = {400:'服务拒绝请求参数，请检查所选模型、接口格式和输入长度。',413:'服务拒绝过大的输入，请减少本次输入或检查模型限制。',422:'服务无法处理这些输入参数，请检查模型和接口格式。',401:'认证失败，请检查本模型的 Key 和认证方式。',403:'服务拒绝访问，请检查账号权限。',404:'接口不存在，请检查地址和资源路径；不会自动添加 /v1。',408:'服务处理超时，请重试。',429:'服务限流或额度不足，请稍后重试或检查余额。',500:'模型服务内部错误，请稍后重试。',502:'模型服务网关错误，请稍后重试。',503:'模型服务暂时不可用，请稍后重试。',504:'模型服务网关超时，请重试或减少本次输入。'};
const SAFE_CODES=new Set([...Object.keys(CODES),...Object.keys(NETWORK),'OPERATION_FAILED','PROVIDER_HTTP_ERROR','PROVIDER_STREAM_ERROR','PROVIDER_FETCH_UNAVAILABLE','PROVIDER_RESOURCE_INVALID','COVERAGE_INCOMPLETE','HOST_CONTRACT_INVALID','RETROSPECTIVE_INVALID','RETROSPECTIVE_BUDGET','RETROSPECTIVE_BUSY']);
const MODEL_LABELS={summary:'总结模型',supplement:'辅助整理模型',dynamicPersona:'动态人设模型',personaReview:'人设辅助精修',assistant:'配置助手',embedding:'向量模型',rerank:'重排模型',knowledge:'知识库分析模型'};
function modelLocation(role){return Object.hasOwn(MODEL_LABELS,role)?`API → ${MODEL_LABELS[role]}`:'API 中本次使用的模型卡';}
const FAILURE_LOG='请打开“日志”→“只看失败”，导出日志交给开发者检查。';
// Only closed, source-declared local guards can become display text. Unknown
// Error.message and provider prose are never echoed, even when written in Chinese.
const LOCAL_VALIDATION_MESSAGES = new Map([
  // Existing manual-persona guards in product-view.js use this exact text.
  "人设计划已变化，请重新查看",
  "人设任务已停止，已保存档案保留",
  "当前要求最多 8 句",
  "请用普通句子写下要求，不要包含脚本",
  "请选择两个不同的人物档案",
  "人设接口报告内容过滤；原档案保留，可更换配置后重试",
  "人设回答未完整结束；原档案保留",
  "请在 API 设置中配置人设辅助精修",
  "精修队列已有新版本",
  "人物档案已变，精修候选未覆盖",
  "事实核查队列已有新版本",
  "档案、设置或核查候选已变化",
  "档案已变化，核查未覆盖",
  "核查来源已变化，旧档案保留",
  "人物档案版本无法读取，未覆盖",
  "手动人设恢复点缺失，旧档案保留；请放弃后重新建立计划",
  "请先暂停正在运行的人设任务，再开始手动补建",
  "已有未完成的手动计划，请继续或暂停后再新建",
  "覆盖范围或后续档案已变化，请重新预览实际范围与请求数",
  "原人设批次缺少重建前的版本，未清空旧档案；请从第1楼干净重建",
  "自动人设任务刚开始，请先暂停，再开始手动补建",
  "已有新的手动计划，请先查看当前进度",
  "人物档案刚有变化，请重新预览后建立计划",
  "动态人设已关闭，请先启用后继续手动计划",
  "候选计划已变化，请重新选择",
  "只能重试首个未完成批次；后续人设依赖此前的档案",
  "所选批次已变化，请重新选择首个未完成批次",
  "请先暂停当前人设任务，待请求退出后再管理候选批次",
  "只能管理首个未完成批次；后续人设依赖此前的档案",
  "拆分楼数需为1–200的整数，并小于当前批次楼数",
  "候选计划刚有变化，请重新选择",
  "拆分后超过5000批，请选择较大的每批楼数",
  "请先暂停人设任务，待当前请求退出后再应用已完成部分",
  "没有对应的未完成人设计划，请重新选择",
  "已保存批次存在缺楼，不能应用为连续人设档案",
  "尚无所选范围内可应用的连续已完成批次",
  "失败中段后存在独立候选，不能用未来档案覆盖前缀",
  "计划或档案已变化，请重新确认应用范围",
  "计划或档案刚有变化，请重新确认",
  "重建期间人物档案已被编辑，原档案保留；请重新建立计划",
  "已完成范围超出当前聊天，未应用候选",
  "已完成前缀原文已变化，未应用候选；请重新加载核对",
  "核对期间档案或计划已变化，未应用候选",
  "已完成前缀的人设快照缺失，原档案保留",
  "候选档案含有未确认或更晚的楼层，不能应用到此终点；原档案保留",
  "请先停止手动补建，待当前请求退出后再放弃",
  "人物来源尚未验证，请重新加载当前聊天",
  "手动计划范围已不适用于当前聊天，请停止后核对原文楼层",
  "重建期间人物档案已被编辑；新编辑和旧档案均保留，请放弃候选并重新预览范围",
  "人设运行期间设置已变化；结果未覆盖旧档案",
  "人设来源正文已变化",
  "人设阶段或原设定已变化；等待当前阶段重试",
  "重建前缀或已完成批次原文已变化，未应用候选；请重新加载核对后继续或重新建计划",
  "请先完成或放弃未完成的人设候选计划，再删除正式批次",
  "请先选择要删除的人设批次",
  "人设批次已变化，请刷新后重试",
  "请先暂停人设任务，待请求退出后再删除批次",
  "批次或档案已变化，请重新确认删除范围",
  "批次恢复点缺失，未删除任何档案",
  "删除期间档案已变化",
  "请先结束当前人设任务",
  "没有可恢复的撤下归档",
  "撤下后已有新档案或批次，不能覆盖；本聊天的本地归档仍保留",
  "撤下归档缺失，当前档案保留",
  "精修范围或档案已变，请重新预览",
  "请先完成或删除当前精修计划",
  "档案或精修计划刚有变化，请重新预览",
  "未知精修批次操作",
  "还没有手动精修计划",
  "精修计划已切换，请重新选择",
  "这组精修没有正在运行的批次",
  "已应用精修需整组撤回，不能只删一条历史伪装撤销",
  "精修后档案已有新版本，不能覆盖；旧候选仍可查看",
  "精修前恢复点缺失，当前档案保留",
  "精修批次不存在或已删除，请重新选择",
  "这组精修已结束，不能删除候选",
  "请先完成或删除未完成的精修批次",
  "档案已改变，旧精修候选不能覆盖",
  "没有可应用的候选",
  "最新依据所在批次已删除；早期候选不能倒退当前档案",
  "精修期间档案或计划已改变",
  "不同批次对同一片段给出了不同修改；请核对Markdown并撤下不适用的候选",
  "候选对同一片段同时建议修改和移入历史，请先核对",
  "旧候选涉及原书引语片段，不能改写或只移除半句；请用真实原话重新核对",
  "当前补充已改变，候选未应用",
  "原片段已改变，候选未应用",
  "候选对当前补充同时整段改写与局部纠错，请先核对",
  "起算楼层必须是非负整数",
  "请先暂停人设任务再更改起算楼层",
  "要并入的人物档案不存在或已经删除",
  "要保留的人物档案不存在或已经删除",
  "待确认称呼不能为空",
  "归入目标人物档案不存在",
  "请选择人物",
  "人物档案不存在",
  "请输入人物档案文本，不要写入脚本代码",
  "人物片段不存在或档案已锁定",
  "不能只移除引语的一段并拼接剩余台词；请保留原话并核对当前表达",
  "建议对应的片段已经改变，请先重新核对",
  "没有可恢复的旧版",
  "请填写姓名和完整人物信息，不要包含脚本",
  "已有这个人物的档案，请直接修改（简繁和已确认别称视为同一人）",
  "请填写有效的起止楼层，结束楼不能早于起始楼",
  "手动人设每批楼数需为1–200",
  "自动接续选项无效",
  "一次计划超过5000批，请分段补建",
  "完整档案与最新一轮仍超精修上限；未截断、未调用模型",
  "精修已让出前台",
  "档案已有新版本，请删除旧计划后重新预览；未覆盖档案",
  "精修来源已变化，未改档案",
  "本批完整原文超出精修预算；未调用模型，请减小每批楼数后重新预览",
  "精修设置已变",
  "没有可继续的手动精修计划",
  "这批已保存或已删除，无需重试",
  "宿主没有提供全局扩展存储",
  "任务已停止",
  "聊天或来源已变化，旧聊天操作已停止",
  "已有任务正在运行",
  "已停止",
  "记忆不存在，请刷新",
  "记忆已变化，请刷新索引列表",
  "请先停止当前任务",
  "聊天加载已取消",
  "读取期间聊天已切换",
  "当前没有可读取的聊天",
  "未知模型用途",
  "此按钮只保存当前模型连接",
  "已停止拉取模型",
  "服务没有返回重排结果",
  "已有任务正在运行，请等待完成或停止",
  "无法读取 TT 当前聊天",
  "所选候选已被删除，未重新应用；可在回收站恢复仍开放的任务",
  "覆盖期间旧记忆有新的人工修改，请撤下候选后重新预览；没有覆盖该修改",
  "覆盖期间记录规则已变化；请撤下候选后重新覆盖，旧记忆保留",
  "所选候选已被删除，没有重新应用",
  "覆盖期间旧记忆有新的人工修改，没有覆盖该修改",
  "覆盖期间记录规则已变化，旧记忆保留；请重新建立覆盖计划",
  "当前聊天尚未读取",
  "请重新打开当前聊天",
  "总结批次不存在",
  "重生保留原批次范围",
  "所选范围已有未完成覆盖候选。请展开本页“总结批次”，勾选后“重试所选”；要重建则“删除所选”候选，旧正式记忆保留。",
  "总结覆盖范围已变化，请重新确认预览",
  "这对事件超过总结输入预算，请核对后缩短记录或提高预算",
  "事件内容已变化，本次合并结果未应用",
  "这条记忆已变化，请刷新",
  "请先停止当前任务，再保存人工校对",
  "这条记忆已被更新，请重新打开后修改",
  "校对计划已变化，请重新预览",
  "记忆已变化，请重新预览校对计划",
  "待校对记忆已变化",
  "校对期间记忆已变化，结果未应用",
  "合并记录已变化",
  "批次不存在",
  "旧批次已被范围覆盖，请从手动总结选择需要重新覆盖的范围",
  "旧版未保存楼层范围，请在手动总结中指定范围重新整理",
  "此批次当前不能续跑",
  "请先停止总结",
  "只能拆分未完成的总结批次；已完成结果无需重做",
  "此批次只有一楼或没有范围，不能继续按楼层拆分",
  "拆分后每批楼数应小于当前批次，且为1–200的整数",
  "请选择尚未应用的覆盖候选；普通成功批次已经保存",
  "覆盖计划成员缺失，请先恢复或重新建立所选批次",
  "计划最前一批尚未成功，请先重试或拆小该批；没有撤下旧记忆",
  "已完成范围发生变化，请重新查看并确认应用范围",
  "已完成候选状态变化，没有应用覆盖",
  "请选择仍存在的批次",
  "所选旧批次没有楼层范围，请取消选择",
  "未知批量操作",
  "此范围已有生效的覆盖结果，请先撤下重叠批次再恢复；没有叠加旧记忆",
  "所选批次尚无结果可恢复",
  "记忆不存在",
  "原记录已变化，请刷新人物页后重试",
  "请先撤销事件合并，再移除其中的台词或心迹",
  "这是合并视图，请先在记录 → 事件合并中撤销合并，再修改对应原记录。",
  "人物和属性名称需要 1–160 字",
  "属性内容不是有效的 JSON，请检查格式",
  "标题或召回速览过长",
  "人物档案需要 1–200 项属性",
  "属性名称需要 1–160 字",
  "每项属性内容不能超过 12000 字",
  "人物属性已变化，请重新打开档案",
  "人物属性已被更新，请重新打开档案后修改",
  "新增属性内容不能为空",
  "角色记录的编辑来源无效，请重新打开",
  "原记录已变化，请重新打开后修改",
  "请先在事件合并中撤销合并，再修改原记录的台词",
  "请先停止当前总结",
  "聊天已切换，起算楼层未修改",
  "起算楼层必须是 0 或正整数",
  "请等当前任务结束后启用自动总结",
  "正文已修改，先重新整理",
  "记忆正在更新，请稍后检索",
  "记忆或设置已更新，请重新检索",
  "向量索引尚未建立或已过期",
  "重排结果数量不匹配",
  "重排索引无效",
  "向量索引正在更新",
  "正在准备本轮记忆，请稍后更新索引",
  "记忆已更新，本次索引任务停止",
  "批次不存在或已删除",
  "请先停止或等待资料任务结束",
  "资料任务正在运行",
  "请先导入要分析的资料",
  "资料片段读取失败",
  "请等当前资料任务结束",
  "资料不存在",
  "请等资料分析或建索引结束后修改",
  "助手正在运行",
  "文件分析结果仍过长，原文和分段结果已保存；请提高助手预算",
  "本次资料超过助手预算，请提高助手输入预算或减少同时分析的资料；历史已保存",
  "兼容模式输入超过预算，请提高助手输入预算",
  "资料或段号无效",
  "不支持的工具",
  "还没有设置方案",
  "这是旧版聊天方案，请重新生成全局方案",
  "设置已变化，请让助手重新生成差异",
  "没有可撤销的配置",
  "部分设置后来被修改，不能直接覆盖",
  "请先停止助手",
  "会话不存在",
  "请先停止复盘，再处理人物批次",
  "人设任务正在准备，请稍后再试",
  "人设启动已取消",
  "插件已暂停，请先启用插件，再更新人设",
  "人设单批重试已取消",
  "人设任务正在准备，请先暂停后管理批次",
  "人设批次操作已取消",
  "请填写要预览的聊天楼号",
  "没有读到这一楼的原文",
  "插件已暂停，请先启用插件，再开始手动人设补建",
  "插件已暂停，请先启用插件，再继续手动人设补建",
  "未知功能开关",
  "未知连接",
  "请先填写 API 地址",
  "API 地址格式不正确",
  "模型列表地址必须是无内嵌凭据的 HTTP(S) 地址",
  "此完整端点无法推导模型列表，请展开地址选项填写列表地址，或直接输入模型名称",
  "接口没有返回模型列表，请直接输入模型名称",
  "设置方案必须是对象",
  "API 地址必须是无内嵌凭据的 HTTP(S) 地址",
  "故事日期请使用有效的 YYYY-MM-DD；未知时留空",
  "请填写起止楼层与每批楼数",
  "请选择合并目标",
  "来源记忆已变化，请刷新人物页",
  "角色记录已变化，请刷新后重试",
].map(message=>[message,message]));
for(const setting of Object.values(PRODUCT_SETTING_REGISTRY)){
  for(const suffix of ['需要开关值','超出允许范围','选项无效','格式或长度不正确','不能为空']){
    const message=setting.label+suffix;LOCAL_VALIDATION_MESSAGES.set(message,message);
  }
}
// Narrative validation joins fixed reasons into multiple lines. Match whole
// lines against this closed table; never echo a rule name, pattern or JSON.
const NARRATIVE_FAILURE_MESSAGES=new Map([
  ['提取配置 JSON 超过 16384 字符上限。','提取配置过长，请减少规则后重新导入。'],
  ['提取配置不是有效的 JSON。','提取配置格式不正确，请检查导入文件，或在当前页面重新添加规则。'],
  ['提取配置必须是对象。','提取配置格式不正确，请在当前页面重新添加规则。'],
  ['不支持此提取配置版本，目前仅支持 version:1。','暂不支持这份提取配置的版本，请在当前页面重新建立规则。'],
  ['enabled 与 preferChinese 必须为布尔值。','提取配置的开关格式不正确，请使用页面上的开关重新设置。'],
  ['rules 必须是数组，且不能超过 16 条规则。','提取配置格式不正确，最多添加16条规则；请在当前页面检查并减少规则。'],
]);
const NARRATIVE_RULE_FAILURES=[
  ['不支持分支或独立量词，请拆成多条规则。','这条正则写法太复杂，请拆成几条简单规则，或改用标签正文。'],
  ['不支持前后查找、命名分组或特殊分组。','这条正则使用了暂不支持的分组写法，请简化正则或改用标签正文。'],
  ['最多支持一个捕获组。','每条正则最多提取一组内容，请减少括号分组。'],
  ['正则分组层数过多。','括号分组太多，请简化正则。'],
  ['正则括号不完整。','正则的括号没有配对，请补齐或删掉多余括号。'],
  ['不支持重复分组、嵌套量词或连续量词。','重复的括号或量词可能让提取卡住，请改成简单正则或标签正文。'],
  ['一条正则最多使用一个量词，请拆分规则或使用标签规则。','每条正则最多使用一个量词，请拆成几条规则或改用标签正文。'],
  ['字符类转义不完整。','字符范围中的转义没有写完整，请补齐或删掉多余的反斜杠。'],
  ['正则字符类不完整。','字符范围的方括号没有配对，请补齐方括号。'],
  ['不支持反向引用或数字转义，请使用捕获组或直接写字符。','暂不支持这种数字转义，请直接填写要匹配的字符，或改用一个括号分组。'],
  ['请使用实际字符或简单字符类，暂不支持此转义。','暂不支持这种转义，请改成实际字符或简单的字符范围。'],
  ['不支持此转义，请直接填写字符。','暂不支持这种转义，请直接填写要匹配的字符。'],
  ['正则字符类括号不完整。','字符范围的方括号没有配对，请补齐或删掉多余方括号。'],
  ['暂不支持花括号量词，请使用简单量词或标签规则。','暂不支持用花括号指定重复次数，请改用简单正则或标签正文。'],
  ['正则为空或过于复杂。','正则没有填写或过于复杂，请填写简单正则，或改用标签正文。'],
  ['每条规则须且只能填写 tag 或 pattern。','请选择一种提取方式，并填写标签名称或正则。'],
  ['标签名不合法。','标签名称格式不正确，请填写有效的标签名。'],
  ['标签规则不使用正则 flags。','标签规则不需要填写正则选项，请清空该项。'],
  ['正则必须是 1～256 字符的字符串。','正则没有填写或超出允许长度，请改成简短的正则。'],
  ['正则 flags 仅支持不重复的 g、i、m、s、u。','正则选项只能填写 g、i、m、s、u，且每个字母只能出现一次。'],
  ['capture:1 需要一个捕获组。','选择提取括号中的内容时，正则必须包含一个括号分组。'],
  ['正则语法错误，或当前浏览器不支持精确捕获位置。','正则语法有误，或当前浏览器不支持这种提取方式，请改用简单正则或标签正文。'],
];
const NARRATIVE_RULE_FIELDS=[
  [' 必须是对象。','格式不正确，请在页面重新添加这条规则。'],
  [' 的 id 必须唯一且为 1～100 字符。','规则标识重复或格式不正确，请在页面重新添加这条规则。'],
  [' 的名称必须为不超过 200 字符的字符串。','规则名称格式不正确或太长，请重新填写名称。'],
  [' 的 enabled 必须为布尔值。','开关格式不正确，请用页面上的开关重新设置。'],
  [' 的 kind 仅支持 include 或 exclude。','提取方式格式不正确，请选择保留正文或排除内容。'],
  [' 的 capture 仅支持 0 或 1。','提取位置格式不正确，请在页面重新选择提取完整匹配或括号中的内容。'],
];
for(let number=1;number<=16;number++){
  for(const [reason,message]of NARRATIVE_RULE_FAILURES)NARRATIVE_FAILURE_MESSAGES.set(`规则 ${number}：${reason}`,`第${number}条规则：${message}`);
  for(const [suffix,message]of NARRATIVE_RULE_FIELDS)NARRATIVE_FAILURE_MESSAGES.set(`规则 ${number}${suffix}`,`第${number}条规则：${message}`);
}
function narrativeValidationFailure(text){
  if(typeof text!=='string')return undefined;
  const lines=text.split(/\r?\n/);if(lines.length>100)return undefined;
  const messages=lines.map(line=>NARRATIVE_FAILURE_MESSAGES.get(line));
  return messages.every(Boolean)?`${messages.join('\n')}\n请在“提取规则”中修改后重新保存。`:undefined;
}
function localValidationFailure(error){
  const text=error?.message;
  if(LOCAL_VALIDATION_MESSAGES.has(text))return LOCAL_VALIDATION_MESSAGES.get(text);
  if(typeof text==='string'&&/^手动范围超出当前聊天，最新楼层为 #(?:\d{1,7}|未读取)$/.test(text))return '手动范围超出当前聊天，请把结束楼层改到当前聊天已有的楼层。';
  return narrativeValidationFailure(text);
}

/** No response body, prompt, URL, or credential is used as a diagnostic payload. */
export function productFailure(error) {
  const rawCode=error?.code ?? (error?.name==='AbortError'?'CANCELED':null);
  const code=SAFE_CODES.has(rawCode)?rawCode:'OPERATION_FAILED';
  const rawStatus=Number(error?.details?.status);
  const status=Number.isInteger(rawStatus)&&rawStatus>=400&&rawStatus<=599?rawStatus:null;
  let message=HTTP[status]??NETWORK[code]??CODES[code];
  if(code==='NARRATIVE_REGEX_INVALID'){
    const fields={includeRegex:'提取正则',excludeRegex:'排除正则',config:'标签规则'};
    const reasons={schema:'保存的规则格式不完整，请编辑相应标签并重新保存。',syntax:'写法不正确，请检查括号、方括号和转义。',flags:'末尾标志不支持或重复，请检查斜杠后的字母。',length:'表达式太长，请缩短。',unsafe:'重复匹配过于复杂，请简化重复分组和量词。', 'work-limit':'这些规则处理当前正文的负担过大，请简化表达式。','match-limit':'匹配次数过多，请缩小要匹配的范围。'};
    const label=Object.hasOwn(fields,error?.details?.field)?fields[error.details.field]:'标签规则';
    const index=error?.details?.ruleIndex;
    const field=Number.isSafeInteger(index)&&index>=0&&index<64?`第 ${index+1} 条${label}`:label;
    const reason=Object.hasOwn(reasons,error?.details?.reason)?reasons[error.details.reason]:'暂时无法使用，请重新检查写法。';
    message=`${field}：${reason}修改后先预览再保存；聊天原文和已保存内容保留。`;
  }
  const location=modelLocation(error?.details?.modelRole),upstreamCode=upstreamErrorCode({code:error?.details?.upstreamCode})??upstreamErrorCode(error);
  if(code==='MODEL_UNAVAILABLE')message=error?.details?.modelRole==='dynamicPersona'?'请打开 API → 动态人设模型，补齐地址和模型并保存；该项地址、模型和 Key 均留空时沿用总结连接，请检查“总结模型”的地址和模型。':`请打开${location}，填写地址和模型并保存。`;
  if(code==='PROVIDER_PROFILE_INVALID')message=`请打开${location}，检查服务地址格式、地址模式和认证方式；本次未发送模型请求。`;
  if(code==='PROVIDER_FETCH_UNAVAILABLE')message=`当前宿主没有提供可用的模型请求接口；请重新加载 TT 后重试。仍失败时，${FAILURE_LOG}`;
  if(status===401||['invalid_api_key','api_key_missing'].includes(upstreamCode))message=`模型服务认证失败，请打开${location}，检查该连接的 Key 与认证方式并保存。`;
  else if(upstreamCode==='model_not_found')message=`服务明确报告模型不存在，请打开${location}，核对模型名称是否在该服务可用。`;
  if(code==='FILE_EXPORT_FAILED'&&Object.hasOwn(DIAGNOSTIC_REASONS,error?.details?.reason))message=DIAGNOSTIC_REASONS[error.details.reason];
  if(['TIMEOUT','network.timeout'].includes(code)&&error?.details?.timerLagMs>=5000){
    message=error.details.backgroundSeen?'请求超时，期间页面曾切到后台，超时计时也明显延迟；这段等待不能当作模型计算时间。已保存批次保留，回到前台后只重试未完成项，不必全部重新总结。':'请求超时，页面计时器明显延迟，可能发生后台暂停或界面阻塞，具体原因未确认。已保存批次保留，只需重试未完成项；不能把全部等待当作模型计算时间。';
  }
  if(upstreamCode==='insufficient_quota')message='模型服务额度已用尽，已停止自动重试。请恢复额度或在 API 中选择可用服务；已保存记忆保留。';
  else if(status===524)message='模型服务的网关等待回答超时。已有档案和成功批次保留，等服务恢复后继续未完成批次即可。';
  else if(status===429)message=error?.details?.retryAfterMs>0?'服务限流，请按接口提示等待后重试；已保存记忆保留。':'服务限流，未提供恢复时间，已停止自动重试。请稍后重试或检查服务额度；已保存记忆保留。';
  else if([502,503,504].includes(status)){
    const hint=error?.details?.upstreamHint;
    const cause=({timeout:'服务报文提示上游等待超时。',overloaded:'服务报文提示模型繁忙。',connection_reset:'服务报文提示上游连接断开。',context_limit:'服务报文提示输入上下文超限。'})[hint]??'接口未提供可确认的具体原因。';
    const label=({502:'网关错误',503:'暂时不可用',504:'网关超时'})[status];
    message=`模型服务${label}。${cause}已保存批次保留，在批次管理中继续未完成任务即可，不必重新总结成功批次。${error?.details?.streaming===false&&hint==='timeout'?'可在 API → 请求设置开启总结流式接收后再试；不会自动追加收费请求。':''}`;
  }
  if(code==='PERSISTENCE_ERROR'&&['vector_jobs','vector_index','vector_staging'].includes(error?.details?.storageArtifact)){
    message='向量本机保存未通过校验，已保存的故事记忆不受影响。可在召回 → 向量重试未完成项，无需重新总结；具体保存阶段见日志。';
  }
  if(error?.details?.upstreamHint==='content_blocked')message='服务错误报文明确提到内容过滤；这不是 JSON 填写或回复上限问题。请检查服务规则与输入内容，已保存的记忆保留。';
  if(error?.details?.upstreamHint==='context_limit')message='服务报文明确提到上下文超限；请核对该接口实际支持的上下文及日志中的输入体积。增大回复上限不能解决输入超限。已保存批次保留。';
  if(code==='VALIDATION_ERROR'){
    const issue=humanValidationIssueText(error?.details?.validationIssues?.[0]);
    if(issue)message=`${error?.details?.repairAttempted?'已自动纠错一次，但仍未通过：':''}${issue}。本批未保存，其他已保存批次保留；可继续未完成任务。`;
    if(error?.details?.reason==='quality_validation'&&Number.isSafeInteger(error.details.accepted)&&Number.isSafeInteger(error.details.rejected)&&error.details.rejected>0)
      message=`已缓存 ${error.details.accepted} 项复核改动，${error.details.rejected} 项仍需修复。本批尚未进入正式记忆；点击继续未完成任务，仅重试复核，不重做主总结。`;
  }
  if(code==='FLOOR_SUMMARY_MISSING'&&['expected','received','covered'].every(k=>Number.isSafeInteger(error?.details?.[k])&&error.details[k]>=0)){
    const d=error.details;message=`收到 ${d.received} 条逐楼摘要，完整对应 ${d.covered}/${d.expected} 楼，本批未保存。请查看运行日志；这不代表回复上限不足。`;
  }
  if(code==='INPUT_BUDGET_EXCEEDED'&&Number.isSafeInteger(error?.details?.inputUnits)&&Number.isSafeInteger(error?.details?.inputLimit))message=`本次模型输入估算 ${error.details.inputUnits}，超过设置的 ${error.details.inputLimit}；该请求尚未发送。已返回的结果保留，可调整输入预算后继续。`;
  if(error?.details?.reason==='stream_incomplete')message='模型流式传输中断，未收到完整结束标记；半份结果没有保存。已完成阶段保留，可继续未完成任务。';
  if(error?.details?.reason==='stream_invalid')message='服务返回的流式格式不兼容，本次结果未保存。可在 API → 请求设置选择“兼容非流式”后重试；不会自动追加一次收费请求。';
  if(error?.details?.reason==='stream_error'&&!status&&error?.details?.upstreamCode!=='insufficient_quota'&&!message){
    const nativeText={'network.timeout':'等待模型服务的回答超时','network.connect_failed':'没有连上模型服务','network.proxy_failed':'连接模型服务所用的代理没有连上','network.dns_failed':'找不到模型服务的地址','network.tls_failed':'没能与模型服务建立安全连接','network.request_failed':'请求模型服务失败，暂时没有更多原因'},upstreamText={timeout:'模型服务报告等待回答超时',connection_reset:'模型服务报告连接中断',overloaded:'模型服务报告当前繁忙'};
    const cause=(Object.hasOwn(nativeText,error.details.nativeErrorCode)?nativeText[error.details.nativeErrorCode]:undefined)??(Object.hasOwn(upstreamText,error.details.upstreamHint)?upstreamText[error.details.upstreamHint]:undefined);
    message=error.details.nativeErrorCode==='network.body_interrupted'?'回答还没接收完整就中断了；已有档案和成功批次保留，稍后继续未完成批次即可。':cause?`${cause}；本批没有得到完整回答。已有档案和成功批次保留，稍后继续未完成批次即可。`:`回答接收途中发生错误，暂时无法确认具体原因；本批未保存，已有档案和成功批次保留。${FAILURE_LOG}`;
  }
  if((error?.details?.purpose==='embeddings'||error?.details?.modelRole==='embedding')&&message){
    message=message.replace('在批次管理中继续未完成任务即可，不必重新总结成功批次。','').replace('已保存批次保留，','');
    message+= ' 故事记忆已保存的部分不受影响；请在批次或召回页补建未完成索引，只调用向量模型，不重新总结。';
  }
  if(error?.details?.modelRole==='dynamicPersona'&&message){
    const field=PERSONA_ISSUES[error.details.personaIssue]??({name:'姓名无法唯一对应本批人物',text:'档案正文或局部修改未通过检查',sourceFloors:'来源楼号缺失或不在本批原文中'})[error.details.personaField];
    if(code==='PERSONA_RESPONSE_INVALID'&&field)message=`第${Number.isSafeInteger(error.details.profileIndex)?error.details.profileIndex+1:'?'}份人设${Number.isSafeInteger(error.details.editIndex)?`的第${error.details.editIndex+1}项修改`:''}：${field}。旧档案与有效候选保留；自动恢复只处理未完成部分，也可在总结页继续。`;
    if(code==='MODEL_OUTPUT_TRUNCATED'&&error.details.recoveryExhausted)message='人设回答拆小后仍被截断，已停止重复相同请求；原档案与已完成候选保留。请检查服务输出能力或人设回复预算后继续，本批尚未应用。';
    message=message.replace('在批次管理中继续未完成任务即可，不必重新总结成功批次。','手动补建请点“继续未完成”；自动更新可重试下一批。无需重做主总结。').replace('提高总结输入预算','调整人设输入预算');
  }
  // Unknown messages and vendor codes may contain URLs, keys or request prose.
  // A TypeError alone also does not establish a network/configuration failure.
  if(!message&&code==='OPERATION_FAILED')message=localValidationFailure(error);
  if(!message)message=`暂时无法确认这次失败的原因。${FAILURE_LOG}`;
  if(Object.hasOwn(PERSONA_STEPS,error?.details?.personaStep))message=`${PERSONA_STEPS[error.details.personaStep]}未完成：${message}`;
  return {code,status,message};
}

export function failureText(error) { return productFailure(error).message; }

/** TT's status route reports upstream errors in an HTTP-200 envelope. */
export function providerEnvelopeFailure(response) {
  const code=Object.hasOwn(NETWORK,response?.code)?response.code:'PROVIDER_REQUEST_FAILED';
  const rawStatus=response?.status??response?.error?.status??String(response?.message??'').match(/\b(?:HTTP(?:\s+error)?|status(?:\s+code)?)\s*[:=]?\s*([45]\d\d)\b/i)?.[1];
  const status=Number(rawStatus);
  const upstreamCode=upstreamErrorCode(response);
  return Object.assign(new Error('模型服务返回错误'),{code,details:{...(Number.isInteger(status)&&status>=400&&status<=599?{status}:{}),...(upstreamCode?{upstreamCode}:{}),upstreamHint:upstreamErrorHint(response)}});
}
export const modelListFailure = providerEnvelopeFailure;
