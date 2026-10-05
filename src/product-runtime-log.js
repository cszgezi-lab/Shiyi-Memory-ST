import { clone, stableStringify } from './utils.js';
import { productStoreFromSession } from './product-host-adapters.js';
import { PRODUCT_VERSION } from './product-release.js';
import { safeValidationIssues } from './validation-diagnostics.js';
import { safeDiagnosticFields, errorDiagnostics } from './diagnostics.js';

export const RUNTIME_LOG_ADDRESS = Object.freeze({ namespace: 'shiyi-product-diagnostics', key: 'runtime-v1' });
export const RUNTIME_LOG_LIMIT = 2000;
export const RUNTIME_LOG_BYTES = 2 * 1024 * 1024;
export const LOG_TASKS = Object.freeze({'memory-retrospective':'记忆复盘',recall:'记忆召回', persona:'动态人设',quality:'内容校对',operation:'插件操作',transport:'API 请求',background:'后台任务',storage:'存档', 'knowledge-vectors':'知识库向量',summary:'总结', merge:'事件合并', connection:'连接测试', models:'拉取模型', assistant:'配置助手', 'knowledge-edit':'修改知识库资料',knowledge:'知识库分析', vectors:'建立向量索引', import:'导入文件', recall:'召回预览' });
export const LOG_PHASES = Object.freeze({auto_start_floor:'更新自动起点',prepared:'准备注入内容', waiting:'等待条件（本次检查结束）',skipped:'跳过本次处理', reading:'正文读取与过滤（本地，无额外模型请求）',queue_plan:'已保存整段总结计划',queue_remaining:'剩余总结队列已保留', body_start:'收到首段传输数据（不是总结完成）', resolution:'本次实际解决与仍需确认', records_deferred:'个别记录待核对，其他内容正常保存', character_details:'检查心迹与关键对话', service_paused:'接口异常，暂停剩余队列', queued:'等待共享请求队列', resume_rejected_source:'旧回答的来源无效，仅重做当前失败子批', review_notes:'复核说明条数（不是摘要覆盖率）', source_check:'校验当前聊天原文',plan:'本批请求计划',wait_complete:'等待结束', retry_wait:'等待并重试临时错误',stage_start:'开始分工阶段',stage_complete:'分工阶段已暂存',stage_resume:'复用已完成阶段',quality_split:'拆小校对范围',recovery_compact:'失败后压缩可选上下文',response_saved:'模型结果已暂存',resume_response:'复用已返回结果',resume_commit:'确认上次已提交',checkpoint_warning:'进度记录待恢复',partial_repair:'补齐缺失内容',start:'任务开始', vector_storage_failed:'向量本机保存失败', vector_failed:'向量请求失败', vector_split:'拆小向量批次重试', vector_commit:'保存向量检查点', range:'读取楼层', request:'发送模型请求', response:'收到模型响应', merge_deferred:'总结先保存，合并单独处理', merge_accepted:'确认同一次事件', merge_separate:'暂不合并', normalize:'兼容模型字段', repair_request:'正在自动纠正字段', repair_response:'收到字段纠错结果', repair_complete:'字段纠错通过', repair_failed:'字段纠错未通过', repair_skipped:'跳过字段纠错', floors:'检查逐楼摘要', validate:'逐条校验记忆内容', commit:'保存记忆', complete:'任务完成', failed:'任务失败', canceled:'任务停止' });
const CODES = new Set(['PERSONA_RESPONSE_INVALID','PERSONA_STAGE_CHANGED','RECOVERY_LIMIT','RESUME_UNAVAILABLE','VECTOR_RESPONSE_COUNT','VECTOR_RESPONSE_INDEX','VECTOR_RESPONSE_INVALID','VECTOR_DIMENSION_MISMATCH','VECTOR_INPUT_EMPTY','VECTOR_INPUT_TOO_LARGE','VECTOR_INDEX_INCOMPLETE','OPERATION_FAILED','MERGE_RESPONSE_INVALID','FLOOR_SUMMARY_MISSING','MODEL_OUTPUT_TRUNCATED','MODEL_OUTPUT_BLOCKED','INPUT_BUDGET_EXCEEDED','COVERAGE_INCOMPLETE','SUMMARY_RESPONSE_ERROR','SUMMARY_RESPONSE_INVALID','VALIDATION_ERROR','PROVIDER_HTTP_ERROR','PROVIDER_REQUEST_FAILED','PROVIDER_PROFILE_INVALID','MODEL_UNAVAILABLE','TIMEOUT','CANCELED','CHAT_REF_UNAVAILABLE','CHAT_HANDLE_UNAVAILABLE','CHAT_IDENTITY_NOT_READY','HISTORY_UNAVAILABLE','CHAT_CHANGED','SOURCE_INVALIDATED','SCOPE_CONFLICT','REVISION_CONFLICT','PERSISTENCE_ERROR','PERSISTENCE_UNAVAILABLE','HOST_CONTRACT_INVALID','network.timeout','network.connect_failed','network.proxy_failed','network.dns_failed','network.tls_failed','network.body_interrupted','network.request_failed']);
const FINISH_REASONS = new Set(['stop','length','max_tokens','truncated','abort','content_filter','tool_calls','end_turn','unknown']);
CODES.add('QUALITY_RESPONSE_INVALID');
CODES.add('PROVIDER_STREAM_ERROR');
CODES.add('FILE_EXPORT_FAILED');
CODES.add('RETROSPECTIVE_INVALID');
CODES.add('RETROSPECTIVE_BUDGET');
CODES.add('RETROSPECTIVE_BUSY');
const NUMBERS = ['plannedBatches','pendingBatches','batchSize','deferredRecords','deferredCommitments','deferredKnowledge','enumQuarantined','journalCount','stageObservations','rejectedDialogues','queueWaitMs','queuePosition','requestElapsedMs','plannedRequests','totalChildren','completedChildren','actualWaitMs','timerLagMs','sourceInputUnits','historyInputUnits','schemaInputUnits','bridgeInputUnits','retryDelayMs','recoveryCalls','batchNumber','childIndex','startIndex','endIndex','sourceCount','inputLimit','inputUnits','maxTokens','elapsedMs','status','expected','received','covered','invalidRows','duplicateCount','promptTokens','completionTokens','totalTokens','reasoningTokens','responseChars','rewrittenSourceSentences','retainedSourceSentences','savedBatches','normalizedFields','normalizedIdentifiers','defaultedValidityFields','repairFields','requestNumber','requestItems','receivedVectors','inputChars','longestInputChars','vectorDimensions','indexedItems','pendingItems','failedItems','beforeInputUnits','afterInputUnits','removedRelevantRecords','recoveryInputTarget','requestedMaxTokens','effectiveMaxTokens','relevantCandidateCount','localMs','vectorMs','rerankMs','totalMs','deadlineMs','usedUnits','candidateCount'];
NUMBERS.push('personaSystemChars','personaSourceChars','personaBaselineChars','personaNotesChars','personaDevelopmentChars','personaMaterialsChars','personaRequestChars','personaSourceParts','personaNoteParts','personaPeople','personaRequestView');
export function safeLogDetails(value = {}) {
  const result = safeDiagnosticFields(value);
  if(['manual','manual_card_next','auto'].includes(value.trigger))result.trigger=value.trigger;
  for(const key of ['startFloor','from'])if(Number.isSafeInteger(value[key])&&value[key]>=0)result[key]=value[key];
  for(const key of ['beforeBatches','afterBatches','retainedBatches','removedBatches','candidateBatches'])if(Number.isSafeInteger(value[key])&&value[key]>=0)result[key]=value[key];
  if(typeof value.archived==='boolean')result.archived=value.archived;
  for(const key of ['readingOriginalChars','readingSafeChars','readingOutputChars','readingFilteredChars','readingFallbacks'])if(Number.isSafeInteger(value[key])&&value[key]>=0)result[key]=value[key];
  if(Number.isSafeInteger(value?.sourceTimeCorrections)&&value.sourceTimeCorrections>0)result.sourceTimeCorrections=value.sourceTimeCorrections;
  if(['response_shape','unexpected_path','model_unresolved','unexpected_fields','invalid_value','missing_evidence','invalid_evidence_shape','evidence_mismatch'].includes(value.repairRejection))result.repairRejection=value.repairRejection;
  if(Number.isSafeInteger(value?.requestChars)&&value.requestChars>=0)result.requestChars=value.requestChars;
  if(Number.isSafeInteger(value?.requestBytes)&&value.requestBytes>=0)result.requestBytes=value.requestBytes;
  if(Number.isSafeInteger(value?.liftedPersonaContexts)&&value.liftedPersonaContexts>0)result.liftedPersonaContexts=value.liftedPersonaContexts;
  if(Number.isSafeInteger(value?.unknownPersonaContexts)&&value.unknownPersonaContexts>0)result.unknownPersonaContexts=value.unknownPersonaContexts;
  if(Number.isSafeInteger(value?.restrictedPersonaScopes)&&value.restrictedPersonaScopes>0)result.restrictedPersonaScopes=value.restrictedPersonaScopes;
  if(Number.isSafeInteger(value?.resolvedSourceTextHints)&&value.resolvedSourceTextHints>0)result.resolvedSourceTextHints=value.resolvedSourceTextHints;
  if(Number.isSafeInteger(value?.wholeFloorEventAnnotations)&&value.wholeFloorEventAnnotations>0)result.wholeFloorEventAnnotations=value.wholeFloorEventAnnotations;
  if(Number.isSafeInteger(value?.wholeFloorRecordAnnotations)&&value.wholeFloorRecordAnnotations>0)result.wholeFloorRecordAnnotations=value.wholeFloorRecordAnnotations;
  if(Number.isSafeInteger(value?.duplicateEmptyModules)&&value.duplicateEmptyModules>0)result.duplicateEmptyModules=value.duplicateEmptyModules;
  if(Number.isSafeInteger(value?.misplacedEvidenceKinds)&&value.misplacedEvidenceKinds>0)result.misplacedEvidenceKinds=value.misplacedEvidenceKinds;
  if(Number.isSafeInteger(value?.unwrappedSourceGroups)&&value.unwrappedSourceGroups>0)result.unwrappedSourceGroups=value.unwrappedSourceGroups;
  for(const key of ['historyPages','fetchedMessages','normalizedMessages','prepareMs','modelMs','publishMs','reviewedPassages','expectedPassages','reviewedChecks','expectedChecks','invalidCheckNotes'])if(Number.isSafeInteger(value?.[key])&&value[key]>=0)result[key]=value[key];
  if(['narrative','details'].includes(value?.summaryStage))result.summaryStage=value.summaryStage;
  for(const key of ['compactFloors','compactChanges','normalizedSourceRefs','linkedEventSources','eventLinkFieldCorrections','unknownEventPerspectives','inferredModuleFormats','unwrappedSummaryRoots','unknownEvidenceTypes','unknownKnowledgeMetadata','accepted','rejected','rejectedRows'])if(Number.isSafeInteger(value?.[key])&&value[key]>=0)result[key]=value[key];
  const issues=safeValidationIssues(value?.validationIssues);
  if(issues.length)result.validationIssues=issues;
  if(Number.isSafeInteger(value?.validationIssueCount)&&value.validationIssueCount>issues.length)result.validationIssuesOmitted=value.validationIssueCount-issues.length;
  if(Number.isSafeInteger(value?.validationIssueCount)&&value.validationIssueCount>=0)result.validationIssueCount=value.validationIssueCount;
  for (const key of NUMBERS) if (Number.isSafeInteger(value?.[key]) && value[key] >= 0) result[key] = value[key];
  for (const key of ['missingFloors','duplicateFloors','emptyFloors']) if (Array.isArray(value?.[key])) result[key] = [...new Set(value[key].filter(n => Number.isSafeInteger(n) && n >= 0))].slice(0,200);
  if (value?.finishReason !== undefined) result.finishReason = FINISH_REASONS.has(value.finishReason) ? value.finishReason : 'unknown';
  if (typeof value?.truncated === 'boolean') result.truncated = value.truncated;
  if(typeof value?.streaming==='boolean')result.streaming=value.streaming;
  if(Number.isSafeInteger(value?.streamChunks)&&value.streamChunks>=0)result.streamChunks=value.streamChunks;
  if (typeof value?.degraded === 'boolean') result.degraded = value.degraded;
  for(const key of ['vectorStatus','rerankStatus'])if(['passed','disabled','fallback','skipped'].includes(value?.[key]))result[key]=value[key];
  if(['shared','per_api'].includes(value?.deadlineScope))result.deadlineScope=value.deadlineScope;
  if (typeof value?.repairAttempted === 'boolean') result.repairAttempted = value.repairAttempted;
  if (value?.code !== undefined) result.code = CODES.has(value.code) ? value.code : 'OPERATION_FAILED';
  if (['summary','supplement','assistant','embedding','rerank','dynamicPersona','knowledge'].includes(value?.modelRole)) result.modelRole = value.modelRole;
  if (['st_native','tt_native','browser_direct'].includes(value?.transport)) result.transport=value.transport;
  if (['write','read','readback','compare','decode','unknown'].includes(value?.storageStage)) result.storageStage=value.storageStage;
  if (['vector_jobs','vector_index','vector_staging','runtime_log','workspace','memory','checkpoint','batch-recovery','response-cache','credentials','settings'].includes(value?.storageArtifact)) result.storageArtifact=value.storageArtifact;
  return result;
}
function safeEntry(value) {
  if (!Object.hasOwn(LOG_TASKS,value?.task) || !Object.hasOwn(LOG_PHASES,value?.phase)) return null;
  if (![value.id,value.run,value.at].every(n => Number.isSafeInteger(n) && n >= 0)) return null;
  return { id:value.id, run:value.run, at:value.at, pluginVersion:/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(value.pluginVersion)?value.pluginVersion:null, task:value.task, phase:value.phase, level:['info','success','warning','error'].includes(value.level)?value.level:'info', details:safeLogDetails(value.details) };
}

/** Fields a phone-sized failure report actually needs. Everything else (stack
 * frames, nested cause chains, validation issue lists) is what made even a
 * filtered export tens of thousands of characters long. */
const COMPACT_KEYS=['action','reason','stage','storageStage','storageArtifact','saveStage','exportAttempt','exportBytes','hostOperations','code','errorType','causeErrorType','personaStep','personaIssue','personaField','profileIndex','editIndex','recoveryExhausted','modelRequested','modelRole','status','upstreamCode','upstreamHint','startIndex','endIndex','beforeBatches','afterBatches','retainedBatches','removedBatches','candidateBatches','archived','retryDelayMs','stackFrames','validationIssues'];
/** Local bounded diagnostics. Never accepts prompts, response bodies, keys or URLs. */
export function createRuntimeLog({getStore,onChange=()=>{},now=()=>Date.now(),ioWaitMs=1000} = {}) {
  let entries=[],store,loaded=false,loading,queue=Promise.resolve(),nextRun=0,nextId=0,persistence='not_loaded';
  let pending=false,writing=false,droppedEntries=0,partialRuns=[],storageFailure=null,legacyRetentionUnknown=false;
  let timer=null,entryBytes=2;
  const byteSize=e=>new TextEncoder().encode(JSON.stringify(e)).length;
  const notify=()=>{try{onChange();}catch{/* diagnostics must not break a task */}};
  async function bounded(work){
    let timeout;
    try{return await Promise.race([work,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Object.assign(new Error('日志存储响应超时'),{details:{reason:'log_io_timeout'}})),ioWaitMs);})]);}
    finally{clearTimeout(timeout);}
  }
  function trim(){
    const removed=[];
    if(entries.length>RUNTIME_LOG_LIMIT)removed.push(...entries.splice(0,entries.length-RUNTIME_LOG_LIMIT));
    entryBytes-=removed.reduce((n,e)=>n+byteSize(e)+1,0);
    while(entries.length&&entryBytes>RUNTIME_LOG_BYTES){const chunk=entries.splice(0,Math.max(1,Math.ceil(entries.length/10)));removed.push(...chunk);entryBytes-=chunk.reduce((n,e)=>n+byteSize(e)+1,0);}
    droppedEntries+=removed.length;
    const retained=new Set(entries.map(e=>e.run));partialRuns=[...new Set([...partialRuns,...removed.map(e=>e.run)])].filter(r=>retained.has(r));
  }
  async function load() {
    if(loaded)return;
    if(loading)return loading;
    loading=(async()=>{
      try {
        const loadedStore=await bounded((async()=>{const candidate=productStoreFromSession({store:await getStore()});return {candidate,found:await candidate.tryGetJson(RUNTIME_LOG_ADDRESS)};})());
        const {candidate,found}=loadedStore;
        if(found.found){
          if(found.value?.version!==1||!Array.isArray(found.value.entries))throw Object.assign(new Error('invalid log document'),{details:{reason:'log_document_invalid'}});
          entries=found.value.entries.map(safeEntry).filter(Boolean);entryBytes=2+entries.reduce((n,e)=>n+byteSize(e)+1,0);
          droppedEntries=Number.isSafeInteger(found.value.droppedEntries)?Math.max(0,found.value.droppedEntries):0;
          droppedEntries+=found.value.entries.length-entries.length;
          legacyRetentionUnknown=found.value.diagnosticVersion!==2||found.value.legacyRetentionUnknown===true;
          partialRuns=Array.isArray(found.value.partialRuns)?found.value.partialRuns.filter(Number.isSafeInteger):[];trim();
          nextRun=Math.max(0,...entries.map(e=>e.run));nextId=Math.max(0,...entries.map(e=>e.id));
        }
        store=candidate;persistence='ready';
      } catch(error) {store=null;persistence='unavailable';storageFailure=safeLogDetails({...errorDiagnostics(error),storageStage:'read',storageArtifact:'runtime_log'});}
      loaded=true;notify();
    })().finally(()=>{loading=null;});return loading;
  }
  function persist() {
    clearTimeout(timer);timer=null;
    pending=true;
    if(writing)return queue;
    writing=true;
    queue=queue.catch(()=>{}).then(async()=>{
      while(pending){
      pending=false;
      if(!store)continue;
      const document={version:1,diagnosticVersion:2,droppedEntries,partialRuns:clone(partialRuns),legacyRetentionUnknown,entries:clone(entries)};
      let storageStage='write';
      try {
        await store.setJson({...RUNTIME_LOG_ADDRESS,value:document});
        storageStage='readback';
        const check=await store.tryGetJson(RUNTIME_LOG_ADDRESS);
        if(!check.found||stableStringify(check.value)!==stableStringify(document))throw Object.assign(new Error('log readback mismatch'),{details:{reason:'storage_mismatch',storageStage:'compare'}});
        persistence='saved';storageFailure=null;
      } catch(error) {persistence='failed';storageFailure=safeLogDetails({storageStage,...errorDiagnostics(error),storageArtifact:'runtime_log'});}
      notify();
      }
    }).finally(()=>{writing=false;});return queue;
  }
  function record({run,task,phase,level='info',details={}}) {
    const entry=safeEntry({id:++nextId,run:Number.isSafeInteger(run)?run:++nextRun,task:Object.hasOwn(LOG_TASKS,task)?task:'operation',phase:Object.hasOwn(LOG_PHASES,phase)?phase:'failed',level,details,at:now(),pluginVersion:PRODUCT_VERSION});
    if(!entry)return;
    entries.push(entry);entryBytes+=byteSize(entry)+1;trim();notify();
    // Keep every entry in memory; coalesce disk writes, not diagnostics.
    // Terminal states/export/flush force a verified write immediately.
    if(['complete','failed','canceled','waiting','skipped'].includes(phase))void persist();
    else if(timer===null){timer=setTimeout(()=>{timer=null;void persist();},100);timer?.unref?.();}
  }
  return {
    load,record,async start(task,details={}){await load();const run=++nextRun;record({run,task,phase:'start',details});return run;},
    get state(){return {entries:clone(entries),persistence,limit:RUNTIME_LOG_LIMIT,byteLimit:RUNTIME_LOG_BYTES,droppedEntries,partialRuns:clone(partialRuns),legacyRetentionUnknown,storageFailure:clone(storageFailure)};},
    async flush(){try{await bounded(timer!==null?persist():queue);}catch(error){persistence='pending';storageFailure=safeLogDetails({...errorDiagnostics(error),storageStage:'write',storageArtifact:'runtime_log'});notify();}},
    async clear(){await load();entries=[];entryBytes=2;droppedEntries=0;partialRuns=[];legacyRetentionUnknown=false;nextId=0;nextRun=0;storageFailure=null;notify();await persist();if(!store||persistence!=='saved')throw new Error('日志清空未通过保存确认，请重试');},
    async export({filter}={}){await load();
      // Drain already-queued error callbacks, not their storage promises. A
      // failed action immediately followed by export must include its error.
      await new Promise(resolve=>setTimeout(resolve,0));return snapshot(filter);},
  };
  /** A phone report needs the facts that locate a failure, not the full
   * diagnostic dump: stack frames and nested cause chains are what made even a
   * filtered export tens of thousands of characters long. `COMPACT_KEYS` is
   * hoisted into the factory scope below so `snapshot` can use it. */
  function compactEntry(entry){
    const details={};
    for(const key of COMPACT_KEYS)if(entry.details?.[key]!==undefined)details[key]=entry.details[key];
    // Native failures already identify the exact bridge operation. For other
    // failures retain one safe code location and one validation path instead of
    // removing the only clue (or exporting an entire repeated stack).
    if(details.hostOperations?.length){delete details.stackFrames;delete details.validationIssues;}
    else {if(details.stackFrames)details.stackFrames=details.stackFrames.slice(0,1);if(details.validationIssues)details.validationIssues=details.validationIssues.slice(0,1);}
    return {id:entry.id,task:entry.task,phase:entry.phase,level:entry.level,details};
  }
  function snapshot(filter){
    const wants=filter?{levels:Array.isArray(filter.levels)&&filter.levels.length?filter.levels:null,task:typeof filter.task==='string'&&filter.task?filter.task:null,limit:Number.isSafeInteger(filter.limit)&&filter.limit>0?filter.limit:null}:null;
    let selected=entries;
    if(wants&&(wants.levels||wants.task)){
      selected=[];
      for(const entry of entries){
        if(wants.levels&&!wants.levels.includes(entry.level))continue;
        if(wants.task&&entry.task!==wants.task)continue;
        selected.push(entry);
      }
    }
    // A phone report only needs the newest few records; older history stays
    // available through the unfiltered export.
    let truncated=false;
    if(wants?.limit&&selected.length>wants.limit){truncated=true;selected=selected.slice(-wants.limit);}
    const terminal=new Set(entries.filter(e=>['complete','failed','canceled','waiting','skipped'].includes(e.phase)).map(e=>e.run));
    const filtered=selected.length!==entries.length;
    // A filtered snapshot is meant to be read and copied on a phone, so the bulk
    // metadata (retention limits, limitation list, unfinished runs) is left to
    // the full export and only the failing records are returned.
    if(filtered)return {kind:'shiyi-runtime-log',version:1,diagnosticVersion:2,pluginVersion:PRODUCT_VERSION,exportedAt:now(),filtered:true,truncated,
      filter:{levels:wants.levels,task:wants.task,limit:wants.limit,compact:Boolean(filter.compact),total:entries.length,returned:selected.length},entries:clone(selected).map(filter.compact?compactEntry:entry=>entry)};
    return {kind:'shiyi-runtime-log',version:1,diagnosticVersion:2,pluginVersion:PRODUCT_VERSION,exportedAt:now(),persistence,pendingWrites:writing||pending||timer!==null,
      filtered:false,retention:{limit:RUNTIME_LOG_LIMIT,byteLimit:RUNTIME_LOG_BYTES,droppedEntries,partialRuns:clone(partialRuns),legacyRetentionUnknown,firstId:entries[0]?.id??null,lastId:entries.at(-1)?.id??null},unfinishedRuns:[...new Set(entries.filter(e=>e.phase==='start'&&!terminal.has(e.run)).map(e=>e.run))],storageFailure:clone(storageFailure),limitations:['不含密钥、请求正文、模型原文或私人文件路径。','宿主或服务未提供的错误原因无法还原。','未结束任务可能仍在运行或曾被强制退出；不能据此断定崩溃。','旧版本丢失的日志不能补录。','导出为当前内存快照，不等待写盘或正在运行的任务结束；pendingWrites 表示本机保存仍在进行。','运行中日志最多合并 100ms 后写盘；强制退出可能丢失尚未写入的最后几条。'],entries:clone(selected)};
  }
}
