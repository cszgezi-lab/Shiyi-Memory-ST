// Shared by the validator, local diagnostics and UI. Only schema vocabulary
// and numeric row positions may cross this boundary, never model values.
const categories = 'events|awarenessChanges|entityFactChanges|relationshipChanges|personaChanges|commitmentChanges|performanceHints|summaryView|conflicts';
const fields = 'id|sourceRefs|sources|state|status|epistemicStatus|perspective|via|learnedAt|eventRef|eventRefs|eventId|eventIds|sourceEventId|evidenceKind|expression|response|mutualConfirmation|publicScope|object|context|scope|expiresAt|term|title|description|recallSummary|entities|tags|mergeInto|subject|actorId|person|personId|audience|entity|entityId|field|key|value|from|to|newValue|aspect|objectRef|content|text|action|time|location|participants|floorIndex|confidence|knowledge|fact|strength|reason';
const index = '\\[(?:0|[1-9]\\d{0,6})\\]';
const pathPattern = new RegExp(`^(?:bundle|scope|operationId|expectedRevision|(?:${categories})(?:${index}(?:\\.(?:${fields})(?:${index})?)?)?|coverage(?:\\.(?:sourceRefs|bridgeRefs|processed|excluded|unprocessed)(?:${index})?)?)$`);
const compactPathPattern = new RegExp(`^(?:summaryView${index}\\.(?:sourceId|changes(?:\\.(?:knowledge|facts|relationships|persona|commitments|performance|conflicts))?)|entityFactChanges${index}\\.knowledge(?:${index})?|awarenessChanges${index}\\.recordRef)$`);
const types = new Set(['array','object','string','number','boolean','null','undefined']);
const locatorFields = new Set(['version','swipeId','fragmentId','hash','contentHash']);
export const VALIDATION_ISSUE_LABELS = Object.freeze({
  unauthorized_module_field:'使用了未授权或只读的扩展字段；普通人物属性应使用中文名称，不加 custom: 前缀',
  event_merge_deferred:'合并建议已转交独立任务，不阻止总结保存',
  invalid_event_merge:'合并目标未提供或事件发生时间冲突，旧记忆未改变',
  event_merge_target_missing:'合并目标不在本次提供的事件中，旧记忆未改变',
  event_merge_time_conflict:'新旧记录的事件发生时间确实冲突，旧记忆未改变',
  event_merge_time_unresolved:'新旧记录的时间表述暂无法确认一致，未强行合并',
  type_mismatch:'字段类型不正确', invalid_source_ref:'来源引用格式不正确', source_mismatch:'来源版本、片段或校验信息与本批正文不一致',
  source_ambiguous:'来源对应多个片段，缺少准确定位', unknown_source:'引用了本批未提供的来源', missing_source:'缺少有效的正文来源',
  required:'缺少必填字段', invalid_enum:'字段值不在支持的选项中', duplicate_id:'记录编号重复', unknown_event:'引用的事件不存在',
  invalid_event:'依赖的事件未通过校验', context_only:'只引用了旧上下文，没有本批新证据', confirmed_fact_conflict:'修改了已确认事实，但没有确认依据',
  unknown_fact:'知情关联的人物属性不在本次或当前聊天的有效记录中',
  missing_actor:'缺少知情人物', missing_knowledge:'缺少知情内容', missing_entity:'缺少人物或实体', missing_field:'缺少属性名称', missing_value:'缺少属性值',
  missing_participants:'缺少关系方向或约定参与者', missing_subject:'缺少人物主体', missing_aspect:'缺少人设变化维度', missing_content:'缺少事件或约定内容',
  invalid_shape:'字段结构不正确', coverage_reason:'排除或未处理的楼层缺少原因', coverage_overlap:'同一来源出现多个处理状态',
  coverage_missing:'部分输入楼层没有处理状态', binding_mismatch:'执行信息与当前任务不一致', validation_failed:'结构或来源校验失败，未取得更细的分类',
});

export function valueType(value) { return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value; }
export function safeValidationIssues(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0,512).flatMap(issue => {
    if (!issue || typeof issue.path !== 'string' || issue.path.length > 160 || !(pathPattern.test(issue.path)||compactPathPattern.test(issue.path)) || !Object.hasOwn(VALIDATION_ISSUE_LABELS,issue.reason)) return [];
    const safe = {path:issue.path,reason:issue.reason};
    for(const key of ['expectedType','actualType'])if(types.has(issue[key]))safe[key]=issue[key];
    if(Array.isArray(issue.locatorFields))safe.locatorFields=[...new Set(issue.locatorFields.filter(f=>locatorFields.has(f)))];
    if(Number.isSafeInteger(issue.candidateCount)&&issue.candidateCount>=0)safe.candidateCount=issue.candidateCount;
    return [safe];
  });
}

// Existing validators retain their internal diagnostic strings for tests and
// callers. Translate only fixed phrases; dynamic IDs / values are discarded.
export function validationDetails(errors = []) {
  const issues = (Array.isArray(errors)?errors:[]).map(error => {
    const text=typeof error==='string'?error:'';
    let [path,...tail]=text.split(' '),suffix=tail.join(' ');
    if(path?.endsWith('.expiresAt/term'))path=path.replace('/term','');
    if(text.startsWith('missing required category ')){path=text.slice(26);suffix='is required';}
    if(!pathPattern.test(path??'')&&!compactPathPattern.test(path??''))return {path:'bundle',reason:'validation_failed'};
    let reason='validation_failed',expectedType;
    if(/^must be an? (array|object|non-empty string)/.test(suffix)){reason='type_mismatch';expectedType=suffix.includes('array')?'array':suffix.includes('object')?'object':'string';}
    else if(/^is required|^must identify/.test(suffix))reason='required';
    else if(/^must be one of /.test(suffix))reason='invalid_enum';
    else if(/^is duplicated/.test(suffix))reason='duplicate_id';
    else if(/^references unknown event /.test(suffix))reason='unknown_event';
    else if(suffix==='references unknown fact')reason='unknown_fact';
    else if(/^depends on invalid event /.test(suffix))reason='invalid_event';
    else if(/^references (unknown source|source outside frozen range) /.test(suffix))reason='unknown_source';
    else if(/^must contain a stable source/.test(suffix))reason='missing_source';
    else if(/^contains an invalid|^must be a valid source/.test(suffix))reason='invalid_source_ref';
    else if(/^is supported only by bridge/.test(suffix))reason='context_only';
    else if(/^conflicts with confirmed fact /.test(suffix))reason='confirmed_fact_conflict';
    else if(suffix==='needs an actor/person/audience')reason='missing_actor';
    else if(suffix==='needs a knowledge payload')reason='missing_knowledge';
    else if(suffix==='needs an entity')reason='missing_entity';
    else if(suffix==='needs a field/key')reason='missing_field';
    else if(suffix==='needs a new value (null is allowed)')reason='missing_value';
    else if(suffix==='needs directional participants'||suffix==='needs participants')reason='missing_participants';
    else if(suffix==='needs a subject')reason='missing_subject';
    else if(suffix==='needs an aspect')reason='missing_aspect';
    else if(suffix==='needs an action or description'||suffix==='needs commitment content')reason='missing_content';
    else if(suffix==='has an invalid shape')reason='invalid_shape';
    else if(path.startsWith('coverage.')&&/^entry for .* requires a reason$/s.test(suffix))reason='coverage_reason';
    else if(path==='coverage'&&/^source .* appears in multiple status sets$/s.test(suffix))reason='coverage_overlap';
    else if(path==='coverage'&&suffix.startsWith('is missing status for frozen source '))reason='coverage_missing';
    else if(suffix==='does not match program binding')reason='binding_mismatch';
    return {path,reason,...(expectedType?{expectedType}:{})};
  });
  return {validationIssueCount:issues.length,validationIssues:safeValidationIssues(issues)};
}

export function validationIssueText(value) {
  const issue=safeValidationIssues([value])[0];if(!issue)return '';
  let text=`${issue.path}：${VALIDATION_ISSUE_LABELS[issue.reason]}`;
  const awareness=/^awarenessChanges\[(\d+)\]\.(status|via)$/.exec(issue.path);
  if(awareness)text=`第 ${Number(awareness[1])+1} 条知情记录的${awareness[2]==='status'?'知情状态':'获知途径'}（${issue.path}）：${VALIDATION_ISSUE_LABELS[issue.reason]}`;
  if(issue.expectedType)text+=`（需要 ${issue.expectedType}${issue.actualType?`，收到 ${issue.actualType}`:''}）`;
  if(issue.locatorFields?.length)text+=`；检查字段：${issue.locatorFields.join('、')}`;
  if(issue.candidateCount!==undefined)text+=`；候选来源 ${issue.candidateCount} 个`;
  return text;
}

export function humanValidationIssueText(value){
  const issue=safeValidationIssues([value])[0];if(!issue)return '';
  const match=/^(\w+)(?:\[(\d+)\])?(?:\.(\w+))?/.exec(issue.path);
  const module={events:'事件',awarenessChanges:'知情',entityFactChanges:'人物信息',relationshipChanges:'关系',personaChanges:'人设变化',commitmentChanges:'约定',performanceHints:'演绎参考',summaryView:'楼层摘要',conflicts:'疑点',coverage:'楼层覆盖',bundle:'总结内容'}[match?.[1]]??'总结内容';
  const field={sourceId:'原文引用',sourceRefs:'原文引用',eventRef:'关联事件',eventRefs:'关联事件',status:'状态',via:'获知途径',learnedAt:'获知时间',knowledge:'知情内容',field:'属性名称',value:'属性值',floorIndex:'楼号'}[match?.[3]];
  const reason=issue.reason==='source_mismatch'?'未能对应本批提供的原文；并不表示你修改了聊天':VALIDATION_ISSUE_LABELS[issue.reason];
  return `${module}${match?.[2]!==undefined?`中的第 ${Number(match[2])+1} 条`:''}${field?`的${field}`:''}：${reason}`;
}
