import { createProductApplication } from '../src/product-application.js';
import {dynamicPersonaHTML,mountDynamicPersona} from './product-dynamic-persona.js';
import { characterJournalHTML,mountCharacterJournal } from './product-character-journal.js';
import { frameScheduler, readViewState, reconcileMemoryList } from '../src/product-view-scheduling.js';
import { memoryListHTML,memoryPage } from './product-management.js';
import { autoSummaryText,summaryCoverage,autoSummaryPlan,summaryProgress,hasNewerSavedCoverage } from '../src/product-auto-summary.js';
import { mountPersonEditor } from './product-profile-editor.js';
import { knowledgeImportHTML,mountKnowledgeView } from './product-knowledge-view.js';
import { PRODUCT_SETTING_REGISTRY, PRODUCT_API_SETTING_KEYS } from '../src/product-settings.js';
import { CATEGORY_LABELS, recordDescription, renderMemoryCard } from '../src/product-memory.js';
import { exportProductJson } from '../src/product-host-ui.js';
import { PRODUCT_VERSION, PRODUCT_REPOSITORY } from '../src/product-release.js';
import { mountFloatingProduct } from '../src/product-floating.js';
import { esc, button, field, settingsSection, apiSettingsHTML, missingRecommendations, API_INFO } from '../src/product-settings-ui.js';
import { mergeManagementHTML, mountMergeManagement } from './product-merge-view.js';
import { categoryOptions,memoryEditorHTML,batchManagementHTML,mountMemoryManagement,dictionaryHTML,mountDictionary } from './product-management.js';
import { recordTitle, sourceLabel, recallExplanation, narrativeText, sourceFloors } from '../src/product-narrative.js';
import { recentChanges, PERSON_CATEGORIES } from '../src/product-memory.js';
import { failureText } from '../src/product-feedback.js';
import { summarySelection } from '../src/product-batches.js';
import { runtimeLogHTML, mountRuntimeLog } from './product-runtime-log.js';
import { summaryPresetsHTML, mountSummaryPresets } from './product-summary-presets.js';

import { recallSectionsHTML, mountRecallView, RECALL_PAGES } from './product-recall-view.js';
import { ASSISTANT_SKILL_VERSION, ASSISTANT_SKILLS, RECOMMENDED_MEMORY_SETTINGS } from '../src/product-assistant-skills.js';
import { customModulesHTML,mountCustomModules,moduleProposalHTML } from './product-custom-modules.js';
import {qualityPanelHTML,mountQualityView} from './product-quality-view.js';
import {peopleHTML,mountPeopleView} from './product-people-view.js';
import {extractionHTML,mountExtractionView} from './product-extraction-view.js';

const ID='shiyi-product-shell';
const NAV=['memory','people','recording','recall','log','modules'];

export function memoryRetrospectiveHTML(){
 return `<div class="sy-summary-settings" data-memory-retrospective><div class="sy-actions"><button type="button" data-memory-retrospective-start aria-describedby="sy-memory-retrospective-status">复盘记忆</button><button type="button" data-memory-retrospective-stop hidden>停止复盘</button><button type="button" data-memory-retrospective-undo hidden>撤销本次修复</button></div><p class="sy-help" id="sy-memory-retrospective-status" data-memory-retrospective-status role="status" aria-live="polite" aria-atomic="true">检查当前聊天已保存的记忆与人设，沿用主总结模型。</p><details class="sy-summary-settings" data-memory-retrospective-results hidden><summary>复盘结果</summary><div class="sy-help" data-memory-retrospective-result-list></div></details></div>`;
}

export function mountMemoryRetrospective({panel,app,run}){
 const $=selector=>panel.querySelector(selector),start=$('[data-memory-retrospective-start]'),stop=$('[data-memory-retrospective-stop]'),undo=$('[data-memory-retrospective-undo]'),status=$('[data-memory-retrospective-status]'),results=$('[data-memory-retrospective-results]'),resultList=$('[data-memory-retrospective-result-list]');
 let inFlight=false;
 function paint(s){
  if(!start)return;
  const review=s.memoryRetrospective??{},running=review.status==='running',busy=inFlight||Boolean(s.busy)||Boolean(s.dynamicPersona?.busy),resume=['paused','failed'].includes(review.status);
  start.disabled=running||busy||!s.chatReady;
  start.textContent=running?'正在复盘…':resume?'继续复盘':'复盘记忆';
  start.setAttribute('aria-busy',String(running||inFlight));
  stop.hidden=!running;stop.disabled=!running;
  undo.hidden=!review.canUndo;undo.disabled=running||busy||!s.chatReady;
  const count=value=>Math.max(0,Number.isFinite(Number(value))?Math.floor(Number(value)):0);
  const progress=Number(review.total)>0?`已检查 ${count(review.scanned)}/${count(review.total)} 条 · 已修复 ${count(review.repaired)} 条${count(review.unresolved)?` · 待确认 ${count(review.unresolved)} 条`:''}`:'';
  const message=review.message||({running:'正在检查已保存的记录。',paused:'复盘已停止，可继续未完成部分。',failed:'复盘未完成，可再次点击继续。',completed:'本次复盘完成。'}[review.status])||(s.chatReady?'检查当前聊天已保存的记忆与人设，沿用主总结模型。':'打开聊天后可复盘已保存的记录。');
  const text=[message,progress].filter(Boolean).join(' ');if(status.textContent!==text)status.textContent=text;
  const issues=(review.issues??[]).filter(issue=>issue.kind!=='coexist'),repairs=review.repairs??[];
  if(results){results.hidden=!issues.length&&!repairs.length;if(results.open){
   const cards=new Map((s.cards??[]).map(card=>[card.id,card])),personas=new Map((s.dynamicPersona?.profiles??[]).map(profile=>[`persona:${profile.id??profile.name}`,profile.name]));
   const title=(id,fallback)=>fallback||(!id?'':cards.has(id)?recordTitle(cards.get(id)):personas.has(id)?`${personas.get(id)}的人设`:id);
   const pair=(ids,titles=[])=>ids.map((id,i)=>title(id,titles[i])).filter(Boolean).join(' → ');
   const html=[...issues.map(issue=>`<p><b>待确认</b> ${esc(issue.description??issue.reason??'需要核对记录')}<br>${esc(pair(issue.referenceIds??issue.recordIds??[],issue.titles))}</p>`),...repairs.map(repair=>`<p><b>已转为历史</b> ${esc(pair([repair.oldId,repair.newId],[repair.oldTitle,repair.newTitle]))}<br>${esc(repair.reason??'')}</p>`)].join('');
   if(resultList.innerHTML!==html)resultList.innerHTML=html;
  }}
 }
 async function invoke(method,name,control){
  if(inFlight||control.disabled)return;
  inFlight=true;paint(readViewState(app));
  try{await run(()=>app[method](),{name,button:control});}finally{inFlight=false;paint(readViewState(app));}
 }
 start?.addEventListener('click',()=>void invoke('reviewMemoryConsistency','memory-retrospective',start));
 undo?.addEventListener('click',()=>void invoke('undoMemoryConsistency','memory-retrospective-undo',undo));
 stop?.addEventListener('click',()=>void run(()=>typeof app.stopMemoryConsistency==='function'?app.stopMemoryConsistency():app.stop(),{name:'stop',button:stop}));
 results?.addEventListener('toggle',()=>{if(results.open)paint(readViewState(app));});
 return {paint};
}

export function initProductShell({documentRef=globalThis.document,host=globalThis,application=null,controller=null,controllerOptions={}}={}){
 if(!documentRef||documentRef.getElementById?.(ID))return null;
 const panel=documentRef.createElement('section');panel.id=ID;panel.className='sy-root';
 panel.innerHTML=`<div class="sy-shell"><div class="sy-brand"><span class="sy-mark">拾</span><span>拾忆<small>让故事有迹可循</small></span><span class="sy-version">${PRODUCT_VERSION}</span></div><div class="sy-body">
 <div class="sy-top"><span data-scope>尚未打开聊天</span></div><p role="status" aria-live="polite" class="sy-status" data-status>连接一个模型，就可以开始整理故事。</p>
 <nav class="sy-nav" aria-label="拾忆导航">${['记忆','人物','总结','召回','日志','设置'].map((v,i)=>`<button type="button" data-page="${NAV[i]}" ${i===0?'class="active"':''}>${v}</button>`).join('')}</nav>
 <section data-view="memory"><div class="sy-top"><h3>故事记忆</h3>${button('refresh','刷新')}</div>
 <div class="sy-progress" data-memory-progress><div class="sy-dial" data-memory-dial><span data-memory-floor>0</span></div><div class="sy-progress-text"><b data-memory-through>尚未开始记录</b><p data-memory-gap></p><p data-memory-next-batch></p></div></div>
 <div class="sy-memory-bar"><details class="sy-add-memory" data-add-memory-inline><summary>新增记忆</summary><div data-add-memory-body></div></details><input data-search aria-label="搜索记忆" placeholder="搜索记忆"><span class="sy-memory-total" data-memory-total></span><select data-category aria-label="记忆类别" class="sy-sr-only"><option value="none">未展开</option><option value="all">全部类别</option>${categoryOptions()}</select></div>
 <div data-memory-categories class="sy-category-grid"></div><p data-category-help class="sy-help" hidden></p>
 <div data-memory-pager class="sy-memory-pager" hidden><span data-memory-count></span><label>每页 <select data-memory-size aria-label="每页记忆条数"><option value="10" selected>10</option><option value="20">20</option><option value="50">50</option></select></label><div><button type="button" data-memory-prev>上一页</button><label><span class="sy-sr-only">跳转记忆页码</span><input data-memory-page aria-label="记忆页码" type="number" min="1" value="1"></label><span data-memory-pages></span><button type="button" data-memory-next>下一页</button></div></div>
 <div data-cards></div>
 <div class="sy-recent" data-recent-changes><h4>最近修改</h4><div data-recent-list><p class="sy-help">还没有记录。</p></div></div>
 <div class="sy-memory-tools">${qualityPanelHTML()}${memoryEditorHTML()}${customModulesHTML()}</div>
 </section>
 <div data-summary-overview hidden><div class="sy-feature-switches" aria-label="启用功能"><button type="button" data-feature="memory" aria-pressed="false" aria-describedby="sy-memory-feature-status">记忆功能</button><span id="sy-memory-feature-status" data-feature-status="memory" class="sy-sr-only">未启用</span><button type="button" data-feature="persona" aria-pressed="false" aria-describedby="sy-persona-feature-status">动态人设</button><span id="sy-persona-feature-status" data-feature-status="persona" class="sy-sr-only">未启用</span></div><div class="sy-top"><h3>聊天总结</h3><span class="sy-help">进度按已保存的自动设置计算</span><button type="button" data-action="auto-inspect">检查进度</button></div><div data-summary-modules>${summaryModulesHTML()}</div>${memoryRetrospectiveHTML()}<details class="sy-summary-settings sy-tag-settings" data-tag-settings><summary>标签管理</summary>${extractionHTML({embedded:true})}</details></div>
 <div class="sy-record-tabs" hidden><button type="button" data-record-tab="compose" class="active">手动总结</button><button type="button" data-record-tab="automatic">自动总结</button><button type="button" data-record-tab="presets">主总结设置</button><button type="button" data-record-tab="dynamic-persona">人设更新设置</button></div>
 <section data-view="recording" hidden><div data-record-panel="compose"><div class="sy-card"><h4>手动总结</h4>${field('总结范围','<select data-range-mode><option value="recent">最近 N 楼</option><option value="range">指定起止楼层</option></select>')}<div data-range-fields="recent">${field('最近多少楼','<input type="number" min="1" max="100000" value="8" data-count>')}<p class="sy-help">最后一楼为 20、填 10，即整理 11–20。</p></div><div data-range-fields="range" hidden><div class="sy-grid">${field('从哪一楼','<input type="number" min="0" data-start placeholder="与聊天楼号相同" disabled>')}${field('到哪一楼','<input type="number" min="0" data-end placeholder="包含结束楼" disabled>')}</div></div>${field('每多少楼记录一次','<input type="number" min="1" max="200" value="5" data-batch-size>')}<p class="sy-help" data-summary-selection role="status"></p>${field('本次想记得更细的内容','<textarea rows="3" data-focus placeholder="留空时沿用长期记录偏好"></textarea>')}<div class="sy-actions">${button('focus-summary','开始总结',true)}${button('stop','停止')}</div></div>${settingsSection('recording')}${button('save-settings','保存总结设置',true)}</div><div data-record-panel="automatic" hidden>${settingsSection('automatic')}</div><div data-record-panel="presets" hidden>${summaryPresetsHTML()}</div></section>
 <section data-view="current" hidden><h3>本轮记忆</h3><p class="sy-help">本地预览不发送模型请求。向量与重排仅在启用且实际使用时调用。</p>${field('当前剧情查询','<textarea rows="3" data-query></textarea>')}${button('preview','预览本地召回',true)}${button('preview-online','按已启用接口试召回')}<div data-preview></div><h3>最近一次请求准备</h3><div data-actual><p class="sy-empty">尚未向宿主请求加入记忆。</p></div></section>
 <section data-view="assistant" hidden><div class="sy-top"><h3>配置助手</h3><span data-model></span></div><div class="sy-actions"><button type="button" data-jump="api">模型设置</button><button type="button" data-jump="world">添加 TXT / MD / JSON</button></div><div class="sy-actions"><select data-conversation aria-label="历史对话"><option value="main">配置对话</option></select>${button('new-conversation','新对话')}${button('delete-conversation','删除本次对话')}</div><details class="sy-card" data-builtin-skills><summary>内置配置规则 v${ASSISTANT_SKILL_VERSION} · ${ASSISTANT_SKILLS.length} 组</summary>${ASSISTANT_SKILLS.map(skill=>`<details><summary>${esc(skill.title)}</summary><p class="sy-help">${esc(skill.text)}</p></details>`).join('')}</details><div data-history><p class="sy-empty">说说想怎样记忆，也可以一次说完全部要求。</p></div><div data-proposal></div>${field('你的要求','<textarea rows="4" data-input placeholder="描述你的卡、想保留的细节、希望避免的问题，或让我按导入的规则配置。"></textarea>')}<div class="sy-actions">${button('assistant','发送',true)}${button('builtin-beginner','按内置新手规则配置')}${button('beginner','按导入的规则配置')}${button('assistant-stop','停止')}</div><p class="sy-help">Key 不会发送给助手；设置方案应用后才生效。</p></section>
 <section data-view="api" hidden><h3>API 与模型</h3><p class="sy-help">所有聊天共用，无需打开聊天即可配置、拉取模型和测试连接。</p>${apiSettingsHTML()}${button('save-settings','保存 API 设置',true)}</section>
 ${recallSectionsHTML()}
 ${characterJournalHTML()}
 ${dynamicPersonaHTML()}
 ${peopleHTML()}
 <section data-view="log" hidden><div class="sy-top"><h3>运行日志</h3></div><div data-log-view>${runtimeLogHTML()}</div></section>
 <section data-view="modules" hidden><header class="sy-section-heading"><small>工作台</small><h3>设置与工具</h3><p>连接模型、调整读取方式，或管理资料与备份。</p></header><details class="sy-card" data-update-center open><summary>更新中心 <small>进度与更新入口</small></summary><div class="sy-packet" data-update-progress role="status"></div><div class="sy-actions"><button type="button" data-jump-page="recording">手动总结</button><button type="button" data-jump-page="dynamic-persona">动态人设设置</button><button type="button" data-jump-page="api">API 与模型</button></div><p class="sy-help">进度只在这里汇总；勾选框、周期与执行按钮在各自面板内，避免同一动作出现两份。这里不会自动开启任何任务。</p></details><div class="sy-tool-list">${[['api','API 与模型','总结、人设、向量各自的连接'],['injection','注入方式','调整实际发给 AI 的记忆'],['retrieval','检索策略','关键词、向量与重排'],['world','世界与知识库','导入、编辑资料与自动建索引'],['compatibility','变量与剧情日期','只读变量、日期来源与兼容选项'],['settings','数据与备份','配置、导出与版本']].map(([key,title,help],i)=>`<button type="button" data-page="${key}"><span class="sy-tool-number">0${i+1}</span><span><strong>${title}</strong><small>${help}</small></span><span aria-hidden="true">›</span></button>`).join('')}</div></section>
 <section data-view="injection" hidden><h3>注入</h3>${settingsSection('injection')}${button('save-settings','保存注入设置',true)}<button type="button" data-page="current">查看本轮记忆与召回预览</button></section>
 <section data-view="retrieval" hidden><h3>检索</h3>${field('筛选档位','<select data-recall-level><option value="24">通用均衡 · 24 条候选</option><option value="48">更细筛选 · 48 条候选</option></select>')}${button('save-recall-preset','应用分类策略')}<p class="sy-help">字典扩展别称与主题 → BM25 精确词匹配、向量找语义近似 → 分类候选合并 → 重排比较相关性 → 去重并按注入预算选取。重排不负责事件合并。扩大候选不增加最终注入上限，但可能增加接口耗时。通用策略是本项目九类记忆的初始配置，并非复制 ANIMA 的特定角色参数，也不是实测最优值；不改变 API、注入上限或向量开关。</p>${settingsSection('retrieval')}<div class="sy-actions">${button('save-settings','保存检索设置',true)}</div></section>
 <section data-view="world" hidden><h3>世界与知识库</h3><p class="sy-help">导入原始资料，自动生成用于检索的字典和索引；资料不等于本聊天的已发生事件或角色知情。</p>${knowledgeImportHTML()}<details class="sy-card"><summary>知识库设置</summary>${settingsSection('world')}${button('save-settings','保存知识库设置',true)}</details></section>
 <section data-view="compatibility" hidden><h3>变量与剧情日期</h3><p class="sy-help">默认已适合普通卡：日期从正文读取，变量不额外扫描。只有卡作者另有要求时才调整。</p>${settingsSection('compatibility')}${button('save-settings','保存兼容设置',true)}</section>
 <section data-view="settings" hidden><h3>设置与备份</h3>${button('recommended-memory','应用推荐记忆参数')}<p class="sy-help">5 楼一批、总结回复上限 8192，字典/标签/分类候选开启。保留你的 API、记录偏好与自动运行开关。</p><p class="sy-help">插件设置、资料库和助手对话为全局；故事记忆按聊天隔离。</p><details class="sy-card" data-recovery><summary>回收站与归档</summary><h4>记忆批次</h4><div data-batch-recycle-list></div><h4>单条记忆</h4><div data-recycle></div><h4>人物批次</h4><p class="sy-help" data-persona-recovery-status></p><button type="button" data-persona-recovery-restore>恢复上次撤下的人物批次</button></details><details class="sy-card" open><summary>数据与备份</summary><div class="sy-actions">${button('export-config','导出纯配置')}${button('export-global','导出全局资料与助手备份')}${button('export-backup','导出当前聊天备份')}${button('export-backup-recent','导出当前聊天备份（仅最近 100 条助手对话）')}${button('restore-hidden','恢复不再召回的记录')}${button('undo','撤销上次助手配置')}</div><p class="sy-help">纯配置不含记忆、附件、历史或 Key；完整备份包含当前聊天私人内容，请自行保管。"最近 100 条"只裁剪助手对话，记忆、设置与记录保持完整。</p></details></section><p data-progress class="sy-help"></p></div></div>`;
 const logBadSelector=(s,e)=>{(globalThis.__SHIYI_BAD_SELECTORS??=[]).push({selector:String(s).slice(0,200),message:String(e.message).slice(0,120),at:new Date().toISOString()});if(globalThis.__SHIYI_BAD_SELECTORS.length>20)globalThis.__SHIYI_BAD_SELECTORS.length=20;console.error('[拾忆] 非法选择器:',s,e.message);};
 const $=s=>{try{return panel.querySelector?.(s);}catch(e){logBadSelector(s,e);return null;}},$$=s=>{let r;try{r=[...(panel.querySelectorAll?.(s)??[])];}catch(e){logBadSelector(s,e);return [];}return r;};let app=application,snapshot=null,currentPage='memory';
 const modelRequests=new Map(),dirtyApi=new Set();let autoStartDirty=false,autoScope=null,personEditor=null,knowledgeView=null;let runtimeLogPage='';let management=null,customManagement=null,logView=null,dictionaryView=null,recallView=null,mergeView=null;let presetView=null,journalView=null,memoryRetrospectiveView=null;let floating=null,lastFeedbackId=null,noticeText='打开聊天后自动加载对应记忆和总结批次。',noticeLevel='info';
 function feedback(text,level='info',toast=false){noticeText=text;noticeLevel=level;floating?.setNotice(text,level);if(toast)host.toastr?.[['success','error','warning','info'].includes(level)?level:'info']?.(text,'拾忆',{escapeHtml:true});}
 function resetModels(kind){const pending=modelRequests.get(kind);pending?.abort();modelRequests.delete(kind);if(pending)feedback('模型列表请求已取消，请按当前配置重新拉取。');const list=$(`[data-model-list="${kind}"]`);if(list){list.innerHTML='<option value="">先拉取模型列表，也可以在下方直接输入</option>';list.disabled=true;}const b=$(`[data-action="models-${kind}"]`);if(b){b.disabled=false;b.textContent='拉取模型列表';}if($(`[data-model-status="${kind}"]`))$(`[data-model-status="${kind}"]`).textContent='';floating?.setBusy(Boolean(app?.state.busy)||modelRequests.size>0);}
 function resetAllModels(){for(const kind of Object.keys(API_INFO))resetModels(kind);}
 function syncInherited(){for(const kind of ['assistant','supplement']){const follow=$(`[data-setting="${kind}FollowSummary"]`)?.checked;if($(`[data-api-fields="${kind}"]`))$(`[data-api-fields="${kind}"]`).hidden=kind==='assistant'&&follow;if(kind==='supplement'){const connection=$('[data-api-connection="supplement"]');if(connection)connection.hidden=follow;const advanced=$('[data-api-card="supplement"] .sy-advanced');if(advanced)advanced.hidden=follow;}const notice=$(`[data-inherited="${kind}"]`);if(notice){const model=$('[data-setting="providerModel"]')?.value||'请先设置总结模型';notice.textContent=follow?(kind==='supplement'?'共用总结地址和 Key；模型以下方选择为准。':`正在沿用：${model}`):'';}}const follow=$('[data-setting="knowledgeFollowAssistant"]')?.checked;$('[data-api-fields="knowledge"]').hidden=Boolean(follow);const model=$('[data-setting="assistantFollowSummary"]')?.checked?$('[data-setting="providerModel"]')?.value:$('[data-setting="assistantModel"]')?.value;$('[data-inherited="knowledge"]').textContent=follow?`沿用配置助手：${model||'请先配置总结或助手 API'}。可关闭此项单独配置。`:'';}
 let cardStamp='',memoryCurrentPage=1,memoryFilter='',memoryScope='',qualityView=null,dynamicPersonaView=null,personaNotice='',peopleView=null,extractionView=null;
 /** 进度圆环 / 总条数 / 最近修改：数据全部来自已保存的记忆，不算预测。
  * 「上次成功时间」只显示真实记录到的时刻，读不到就不显示那一行。 */
 function paintMemoryOverview(s){
   const cards=s.cards??[];
   const timeline=cards.filter(c=>!c.customModuleId&&!PERSON_CATEGORIES.includes(c.category));
   const progress=summaryProgress(s.batches??[],{startFloor:s.autoStartFloor??1,lastIndex:s.automatic?.lastIndex??null,keepRecent:s.settings?.autoKeepRecent??0});
   const through=progress.ranges.at(-1)?.endIndex??0;
   const last=Number.isInteger(s.automatic?.lastIndex)?s.automatic.lastIndex:through;
   const every=Number(s.settings?.summaryEvery??s.settings?.autoSummaryEvery)||5;
   const nextTo=last+every;
   const missing=s.automatic?.coverage?.missingRanges??[];
   const missingText=missing.length?missing.map(r=>r.startIndex===r.endIndex?`${r.startIndex} 楼`:`${r.startIndex}–${r.endIndex} 楼`).join('、'):(s.chatReady?'没有缺口':'尚未读取聊天');
   const chatFloors=Math.max(0,Number(s.automatic?.lastIndex)||0,through);
   const dial=$('[data-memory-dial]');
   if(dial)dial.style.setProperty('--p',String(progress.percent));
   if($('[data-memory-floor]'))$('[data-memory-floor]').textContent=String(through);
   if($('[data-memory-through]'))$('[data-memory-through]').textContent=through?`已记录到第 ${through} 楼`:'还没有记录楼层';
   if($('[data-memory-gap]'))$('[data-memory-gap]').textContent=through?`还差 ${missingText}`:'整理一段聊天后，这里会显示进度';
   const when=s.lastSummaryAt??s.automatic?.lastFinishedAt??null;
   const rangeText=s.automatic?`下一批 ${s.automatic.nextStart}–${s.automatic.nextEnd} 楼`:'等待读取聊天进度';
   const whenText=when?`${rangeText} ｜ 上次：${narrativeText(when)}`:`${rangeText} ｜ 回复结束后按已保存周期检查`;
   if($('[data-memory-next-batch]'))$('[data-memory-next-batch]').textContent=through?whenText:'';
   if($('[data-memory-total]'))$('[data-memory-total]').textContent=`全部 ${timeline.length} 条`;
   const list=$('[data-recent-list]');
   if(list){
     const rows=recentChanges(timeline);
     list.innerHTML=rows.length?rows.map(c=>`<div class="sy-recent-row" data-recent-id="${esc(c.id)}"><span>${esc(recordTitle(c))}</span><em>${sourceFloors(c).length?`${Math.max(...sourceFloors(c))} 楼`:''}</em><span aria-hidden="true">›</span></div>`).join(''):'<p class="sy-help">还没有记录。</p>';
   }
 }
/** 总结页顶部：两个主模块各一张扇形进度卡。数字全部由已保存的设置与批次算出：
 * 记忆用自动总结的起点/每批楼数/保留楼数，人设用动态人设自己那一套设置。 */
 function summaryModulesHTML(){
  return ['memory','persona'].map(kind=>{
    return `<section class="sy-summary-module" data-summary-module="${kind}">
    <div class="sy-pie" data-summary-pie><span data-summary-percent>0%</span></div>
    <div class="sy-module-meta">
      <div class="sy-module-head"><b data-summary-title></b><span class="sy-tag" data-summary-state></span></div>
      <p data-summary-covered></p>
      <p class="sy-help" data-summary-next></p>
      <p class="sy-help" data-summary-detail></p>
      <p class="sy-help" data-summary-coverage hidden></p>
    </div>
    <div class="sy-module-actions">
      <button type="button" class="primary" data-summary-next-batch>总结下一批</button>
      <button type="button" data-summary-pause>暂停</button>
      ${kind==='persona'?'<button type="button" data-persona-resume-auto hidden>继续自动</button>':''}
    </div>
    ${kind==='persona'?'<p class="sy-summary-settings sy-help" data-persona-task-status role="status" aria-live="polite"></p>':''}
    ${kind==='memory'?`<details class="sy-summary-settings" data-summary-memory-batches><summary>总结批次 <small data-summary-batch-count></small></summary>${batchManagementHTML()}</details>`:''}
    ${kind==='persona'?`<details class="sy-summary-settings" data-summary-persona-batches><summary>人设批次 <small data-persona-batch-count></small></summary><p class="sy-help">人设按楼层累积。可单独重试当前未完成批，或应用已完成的连续前段。</p><div class="sy-actions"><button type="button" data-persona-resume-batches>继续全部未完成</button><button type="button" data-persona-pause-batches>暂停任务</button><button type="button" data-persona-apply-prefix>应用已完成部分</button><button type="button" data-persona-discard-plan>放弃本次计划</button></div><div class="sy-actions"><button type="button" data-persona-batch-select-page>选中本页</button><button type="button" data-persona-batch-clear>清空选择</button><button type="button" data-persona-batch-details>详情</button></div><div class="sy-actions"><button type="button" data-persona-batch-retry-selected>重试所选</button><button type="button" data-persona-batch-split-selected>拆小所选</button><button type="button" data-persona-batch-delete-selected>删除所选</button></div><p class="sy-help" data-persona-batch-selection role="status"></p><div data-persona-batch-detail hidden></div><div data-persona-batch-rows></div><div class="sy-batch-pagination"><button type="button" data-persona-batch-prev>上一页</button><span data-persona-batch-page></span><button type="button" data-persona-batch-next>下一页</button></div></details>`:''}
    <p class="sy-help" data-summary-legend></p>
  </section>`;}).join('');
}
/** 按楼层把四种状态画成扇形：已总结（实色）、缺口（红）、按设置不记录（斜纹灰）、未到（浅灰）。 */
function summaryPieGradient({covered=0,missing=0,skipped=0,pending=0}={}){
  const total=Math.max(1,covered+missing+skipped+pending);
  const at=value=>value/total*360;
  const a=at(covered),b=a+at(missing),c=b+at(skipped),d=c+at(pending);
  return `conic-gradient(var(--sy-accent) 0deg ${a}deg,#b04a3a ${a}deg ${b}deg,color-mix(in srgb,currentColor 22%,transparent) ${b}deg ${c}deg,color-mix(in srgb,currentColor 8%,transparent) ${c}deg ${d}deg)`;
}
function summaryModuleText({covered,missing,skipped,pending,next,batches=[],startFloor=1,chatFloors=null}){
  const range=(a,b)=>a===b?`${a} 楼`:`${a}–${b} 楼`;
  // 已总结范围：直接从已保存批次算，挡住窗口外的批次也算「已总结」（这样不会显示 0%）。
  const savedRanges=batches.filter(b=>b.status!=='deleted'&&(b.status==='saved'||b.savedOperationId)&&Number.isSafeInteger(b.startIndex)&&Number.isSafeInteger(b.endIndex)).map(b=>({startIndex:b.startIndex,endIndex:b.endIndex})).sort((a,b)=>a.startIndex-b.startIndex);
  const merged=[];for(const r of savedRanges){const last=merged.at(-1);if(last&&r.startIndex<=last.endIndex+1)last.endIndex=Math.max(last.endIndex,r.endIndex);else merged.push({...r});}
  const fromFloor=merged[0]?.startIndex??null,toFloor=merged.at(-1)?.endIndex??null;
  const savedText=fromFloor===null?'尚未开始记录':merged.length===1?`已总结 ${range(fromFloor,toFloor)}`:`已总结 ${merged.length} 段：${merged.slice(0,3).map(r=>range(r.startIndex,r.endIndex)).join('、')}${merged.length>3?' …':''}`;
  // 状态文案：已总结=无缺口；缺=有缺口；未开始=尚未记录
  const summaryState=fromFloor===null?'未记录':missing?`待记录 ${missing} 楼`:skipped&&chatFloors!==null?`暂留 ${skipped} 楼`:'无缺口';
  return {
    state:summaryState,
    covered:savedText,
    next:next?`下一批 ${range(next.startIndex,next.endIndex)}`:next===null?(missing?'尚未凑齐一批，回复结束后再检查':'可处理范围已记录'):'等待读取聊天进度',
    legend:`实色=已总结 ${covered} 楼 · 红=缺口 ${missing} 楼 · 斜纹=按设置不记录 ${skipped} 楼 · 浅=保留最近/未到 ${pending} 楼`,
  };
}
 let personaBatchPage=0,personaBatchScope='',personaBatchItems=[];
 const personaBatchSelection=new Set();
 function paintSummaryModules(s){
   const box=$('[data-summary-modules]');if(!box)return;
   const fallback={eligibleEnd:null,coveredRanges:[],missingRanges:[],coveredFloors:0,missingFloors:0};
   const settings=s.settings??{};
   const observedChatFloors=Number.isSafeInteger(s.autoLastIndex)?s.autoLastIndex:null;
   const rows=[
     {kind:'memory',title:'记忆总结',batches:s.batches??[],batchSize:settings.autoSummaryEvery,keepRecent:settings.autoKeepRecent,startFloor:s.autoStartFloor??1,detail:`事件 ${countOf(s,'events')} · 知情 ${countOf(s,'awarenessChanges')} · 演绎 ${countOf(s,'performanceHints')} · 楼层摘要 ${countOf(s,'summaryView')} · 疑点 ${countOf(s,'conflicts')}`},
     {kind:'persona',title:'动态人设总结',batches:s.dynamicPersona?.batches??[],batchSize:settings.dynamicPersonaEvery,keepRecent:settings.dynamicPersonaKeepRecent,startFloor:s.dynamicPersona?.startFloor??1,detail:`人物 ${personCount(s)} 位 · 关系 ${countOf(s,'relationshipChanges')} · 约定 ${countOf(s,'commitmentChanges')} · 人设变化 ${countOf(s,'personaChanges')}`},
   ];
  for(const row of rows){
    const node=box.querySelector?.(`[data-summary-module="${row.kind}"]`);if(!node)continue;
    const chatFloors=row.kind==='persona'&&Number.isSafeInteger(s.dynamicPersona?.lastIndex)?s.dynamicPersona.lastIndex:observedChatFloors;
    const plan=autoSummaryPlan(row.batches,{startFloor:row.startFloor,batchSize:row.batchSize,keepRecent:row.keepRecent,lastIndex:chatFloors});
    const {covered,missing,skipped,pending}=summaryProgress(row.batches,{startFloor:row.startFloor,batchSize:row.batchSize,keepRecent:row.keepRecent,lastIndex:chatFloors});
     // The memory card is a manual action: offer the first eligible missing
     // range even when fewer than autoSummaryEvery floors remain. Automatic
     // cadence still uses autoSummaryPlan.ready and does not start a short tail.
     const missingRange=row.kind==='memory'?plan.coverage.missingRanges[0]:null;
     const next=chatFloors===null?undefined:missingRange?{startIndex:missingRange.startIndex,endIndex:Math.min(missingRange.endIndex,missingRange.startIndex+row.batchSize-1)}:plan.ready?{startIndex:plan.nextStart,endIndex:plan.nextEnd}:null;
     const text=summaryModuleText({covered,missing,skipped,pending,next,batches:row.batches,startFloor:row.startFloor,chatFloors});
     const pie=node.querySelector?.('[data-summary-pie]');
     if(pie)pie.style.background=summaryPieGradient({covered,missing,skipped,pending});
     if(node.querySelector?.('[data-summary-percent]'))node.querySelector('[data-summary-percent]').textContent=`${Math.round(covered/Math.max(1,covered+missing+skipped+pending)*100)}%`;
     if(node.querySelector?.('[data-summary-title]'))node.querySelector('[data-summary-title]').textContent=row.title;
     if(node.querySelector?.('[data-summary-state]'))node.querySelector('[data-summary-state]').textContent=text.state;
     if(node.querySelector?.('[data-summary-covered]'))node.querySelector('[data-summary-covered]').textContent=text.covered;
     if(node.querySelector?.('[data-summary-next]'))node.querySelector('[data-summary-next]').textContent=`${text.next} · 自动每 ${row.batchSize??'—'} 楼一次 · 保留最近 ${row.keepRecent??0} 楼`;
    if(row.kind==='persona'){
      const d=s.dynamicPersona??{},scope=JSON.stringify(s.core?.scope);if(scope!==personaBatchScope){personaBatchScope=scope;personaBatchPage=0;personaBatchSelection.clear();}
      const manual=d.manualPlan,unfinished=['running','paused','failed'].includes(manual?.status);
      if(unfinished){
        const done=manual.items.filter(b=>b.status==='saved').length,total=manual.items.length;
        if(pie)pie.style.background=summaryPieGradient({covered:done,pending:total-done});
        node.querySelector('[data-summary-percent]').textContent=`${Math.round(done/Math.max(1,total)*100)}%`;
        node.querySelector('[data-summary-covered]').textContent=`本次重建 ${done}/${total} 批 · ${manual.startIndex}–${manual.endIndex} 楼`;
        node.querySelector('[data-summary-next]').textContent=`${text.covered.replace('已总结','仍生效')}；候选全部成功后替换，也可应用已完成部分`;
      }
      const items=[...(unfinished?manual.items.map(b=>({...b,candidate:true})):[]),...(d.batches??[])].sort((a,b)=>b.startIndex-a.startIndex).map(b=>({...b,selectionKey:JSON.stringify(b.candidate?[manual.id,b.startIndex,b.endIndex]:['formal',b.startIndex,b.endIndex,b.versionId??'',b.sourceHash??'']),selectable:true}));
      personaBatchItems=items;for(const key of personaBatchSelection)if(!items.some(b=>b.selectionKey===key&&b.selectable))personaBatchSelection.delete(key);
      const pages=Math.max(1,Math.ceil(items.length/10));personaBatchPage=Math.min(personaBatchPage,pages-1);
      node.querySelector('[data-persona-batch-count]').textContent=`${items.length} 批${d.busy?' · 处理中':unfinished?' · 有未完成计划':''}`;
      const detail=node.querySelector('[data-summary-persona-batches]');
      if(detail.open)node.querySelector('[data-persona-batch-rows]').innerHTML=items.slice(personaBatchPage*10,personaBatchPage*10+10).map(b=>`<label class="sy-persona-batch-row"><input type="checkbox" data-persona-batch-select="${esc(b.selectionKey)}" aria-label="选择 ${b.startIndex}–${b.endIndex} 楼的人设批次" ${personaBatchSelection.has(b.selectionKey)?'checked':''}><span class="sy-persona-batch-content">${b.startIndex}–${b.endIndex} 楼${b.candidate?' · 候选':''}<small>${b.status==='saved'?(b.candidate?'已保存，尚未应用':'已应用'):b.status==='failed'?'未完成':b.status==='running'?'处理中':'待处理'}</small></span></label>`).join('')||'<p class="sy-help">尚无人设批次。</p>';
      node.querySelector('[data-persona-batch-page]').textContent=`${personaBatchPage+1} / ${pages} 页`;
      const first=unfinished?manual.items.find(b=>b.status!=='saved'):null,selected=items.filter(b=>personaBatchSelection.has(b.selectionKey)),single=selected.length===1?selected[0]:null;
      const retryable=single?.candidate&&first&&single.startIndex===first.startIndex&&single.endIndex===first.endIndex;
      const prefix=[];if(unfinished)for(const b of manual.items){if(b.status!=='saved')break;prefix.push(b);}
      node.querySelector('[data-persona-batch-selection]').textContent=`已选 ${personaBatchSelection.size} 批（跨页保留）${first?`；人设按顺序处理，当前未完成 ${first.startIndex}–${first.endIndex} 楼。`:''}${selected.some(b=>b.candidate)?'候选可重试或拆小；完成前段可在上方应用。':''}`;
      node.querySelector('[data-persona-batch-select-page]').disabled=!items.slice(personaBatchPage*10,personaBatchPage*10+10).some(b=>b.selectable);
      node.querySelector('[data-persona-batch-clear]').disabled=!personaBatchSelection.size;
      node.querySelector('[data-persona-batch-delete-selected]').disabled=Boolean(d.busy)||!selected.length||unfinished||selected.some(b=>b.candidate);
      node.querySelector('[data-persona-batch-retry-selected]').disabled=Boolean(d.busy)||!retryable;
      node.querySelector('[data-persona-batch-split-selected]').disabled=Boolean(d.busy)||!retryable||!['pending','failed'].includes(single?.status)||single.endIndex<=single.startIndex;
      node.querySelector('[data-persona-apply-prefix]').disabled=Boolean(d.busy)||!prefix.some(b=>b.endIndex>=(manual?.requestedStartIndex??manual?.startIndex));
      node.querySelector('[data-persona-batch-details]').disabled=personaBatchSelection.size!==1;
      node.querySelector('[data-persona-discard-plan]').disabled=!unfinished;
      if(personaBatchSelection.size!==1)node.querySelector('[data-persona-batch-detail]').hidden=true;
      node.querySelector('[data-persona-batch-prev]').disabled=personaBatchPage===0;
      node.querySelector('[data-persona-batch-next]').disabled=personaBatchPage===pages-1;
      node.querySelector('[data-persona-resume-batches]').disabled=Boolean(d.busy)||!unfinished&&!items.some(b=>b.status==='failed');
    }
     // 减负：summary card 只显示已总结范围和缺口；详细数字和图例太啰嗦。
     if(node.querySelector?.('[data-summary-detail]'))node.querySelector('[data-summary-detail]').hidden=true;
     if(node.querySelector?.('[data-summary-legend]'))node.querySelector('[data-summary-legend]').hidden=true;
     const coverageLine=node.querySelector?.('[data-summary-coverage]');
     if(coverageLine){coverageLine.hidden=true;coverageLine.textContent='';}
     const nextButton=node.querySelector?.('[data-summary-next-batch]');
     if(nextButton){
       const pending=row.kind==='memory'?(s.batches??[]).filter(batch=>['queued','running','failed','interrupted'].includes(batch.status)&&!hasNewerSavedCoverage(batch,s.batches??[])):[];
       nextButton.disabled=row.kind==='memory'?Boolean(s.busy)||!next:!next;
       nextButton.textContent=next?`总结下一批 ${next.startIndex}–${next.endIndex} 楼`:'没有可总结的批次';
       nextButton.dataset.summaryStart=next?String(next.startIndex):'';
       nextButton.dataset.summaryEnd=next?String(next.endIndex):'';
       const count=node.querySelector?.('[data-summary-batch-count]');
       if(count)count.textContent=`${(s.batches??[]).filter(batch=>batch.status!=='deleted').length} 批${pending.length?` · ${pending.length} 批未完成`:''}`;
     }
     if(row.kind==='memory'&&s.summaryHold){node.querySelector('[data-summary-state]').textContent='自动接续已暂停';node.querySelector('[data-summary-next]').textContent='已按所选终点撤下后续记录；点击“总结下一批”处理一批，或在自动总结中启用接续。';}
     const pause=node.querySelector?.('[data-summary-pause]');
     if(pause)pause.hidden=row.kind!=='memory';
     if(row.kind==='persona'){
       const d=s.dynamicPersona??{},manual=d.manualPlan,unfinished=['running','paused','failed'].includes(manual?.status);
       const current=unfinished?manual.items?.find(b=>b.status!=='saved'):(d.batches??[]).find(b=>b.status==='failed'&&b.startIndex===plan.nextStart);
       const range=current?` ${current.startIndex}–${current.endIndex} 楼`:'';
       const retrying=current?.retryAt>Date.now()&&(!unfinished||manual.status==='running')&&!(!unfinished&&d.paused);
       const stopping=d.busy&&d.status==='paused',running=d.busy&&!stopping;
       const blocked=s.enabled===false?'插件已暂停':s.foregroundBusy?'等待当前聊天回复／注入结束':null;
       const label=stopping?'正在停止':running?'正在处理':retrying?'等待自动重试':unfinished?(manual.status==='paused'?'已暂停':manual.status==='failed'?'未完成':'已排队'):current||d.status==='failed'?'未完成':d.status==='saved'?'已保存':d.paused?'自动已暂停':settings.dynamicPersonaEnabled?'自动等待':'自动未开启';
       const status=node.querySelector('[data-persona-task-status]');
       const progress=unfinished?`已完成 ${manual.items.filter(b=>b.status==='saved').length}/${manual.items.length} 批；可应用连续已完成前段。`:'';
       const failureCode=current?.errorCode??d.failureDetails?.code;
       const reason=failureText({code:failureCode,details:{...d.failureDetails,modelRole:'dynamicPersona'},message:current?.message??d.message});
       const detail=retrying?`${reason} 将在 ${new Date(current.retryAt).toLocaleTimeString()} 自动重试（${Math.min(current.attempts??1,3)}/3）。`:current?.status==='failed'||d.status==='failed'?`${reason} 处理后可继续未完成批次。`:running||d.status==='saved'?d.message:'';
       const queued=unfinished&&manual.status==='running'||settings.dynamicPersonaEnabled&&!d.paused;
       status.textContent=`${running?'':`${label}${range}。`}${blocked?`${blocked}${queued?'；恢复后自动接续':''}。`:''}${s.requestQueueNotice?.startsWith('动态人设：')&&running?`${s.requestQueueNotice}。`:''}${detail??''}${progress}`;
       node.querySelector('[data-summary-state]').textContent=label;
       nextButton.disabled=Boolean(d.busy)||(!unfinished&&!next);
       nextButton.textContent=stopping?'等待当前请求退出…':running?'正在处理…':unfinished?(retrying?'重试未完成计划':'继续全部未完成'):current?(retrying?'重试未完成计划':`继续未完成${range}`):next?`总结下一批 ${next.startIndex}–${next.endIndex} 楼`:'没有可总结的批次';
       pause.hidden=!d.busy&&!(unfinished&&manual.status==='running')&&!retrying;
       pause.disabled=stopping;pause.textContent='暂停任务';
       const resume=node.querySelector('[data-persona-resume-auto]');
       if(resume){resume.hidden=!settings.dynamicPersonaEnabled||!d.paused||unfinished;resume.disabled=Boolean(d.busy);}
     }
     node.dataset.ready=chatFloors===null?'waiting':'ready';
     void fallback;
   }
 }
 function countOf(s,category){return (s.cards??[]).filter(c=>!c.customModuleId&&c.category===category).length;}
 function personCount(s){return new Set((s.cards??[]).filter(c=>!c.customModuleId&&c.category==='entityFactChanges').map(c=>c.entity??c.entityId).filter(Boolean)).size;}
 function paintCards(){
    if(!snapshot||!$('[data-cards]'))return;
    if(floating?.window.hidden||currentPage!=='memory')return;
    const scope=JSON.stringify(snapshot.core?.scope);if(scope!==memoryScope){memoryScope=scope;memoryCurrentPage=1;}
    const filter=JSON.stringify([$('[data-search]')?.value,$('[data-category]')?.value,$('[data-memory-size]').value]);if(filter!==memoryFilter){memoryFilter=filter;memoryCurrentPage=1;}
    const stamp=JSON.stringify([snapshot.cardRevision??snapshot.cards,snapshot.settings,filter,memoryCurrentPage]);
    if(stamp===cardStamp)return;cardStamp=stamp;
   const q=($('[data-search]')?.value??'').trim(),category=$('[data-category]')?.value??'none',opened=new Set($$('[data-memory-detail][open]').map(n=>n.dataset.memoryDetail));
   const paging=memoryPage(snapshot.cards,{q,category,page:memoryCurrentPage,pageSize:Number($('[data-memory-size]').value)});memoryCurrentPage=paging.page;
   $('[data-memory-pager]').hidden=category==='none'&&!q;$('[data-memory-count]').textContent=`共 ${paging.total} 项`;$('[data-memory-page]').value=paging.page;$('[data-memory-page]').max=paging.pages;$('[data-memory-pages]').textContent=`/ ${paging.pages} 页`;$('[data-memory-prev]').disabled=paging.page===1;$('[data-memory-next]').disabled=paging.page===paging.pages;
   const updated=reconcileMemoryList($('[data-cards]'),memoryListHTML(snapshot.cards,{settings:snapshot.settings,q,category,opened,page:paging.page,pageSize:paging.pageSize}));
   paintMemoryOverview(snapshot);
   const changedButtons=selector=>updated.flatMap(el=>[...el.querySelectorAll(selector)]);
   for(const b of changedButtons('[data-hide]'))b.addEventListener('click',()=>run(()=>app.hideRecord(b.dataset.hide)));
   for(const b of changedButtons('[data-edit]'))b.addEventListener('click',()=>management?.edit(b.dataset.edit));
   for(const b of changedButtons('[data-edit-profile]'))b.addEventListener('click',()=>personEditor?.open(b.dataset.editProfile));personEditor?.reattach();
   for(const b of changedButtons('[data-delete]'))b.addEventListener('click',()=>run(async()=>{if(host.confirm?.('删除这条记忆？可从回收站恢复，不影响聊天原文。'))await app.deleteRecord(b.dataset.delete);}));
   for(const b of changedButtons('[data-delete-profile]'))b.addEventListener('click',()=>run(async()=>{
     const ids=snapshot.cards.filter(c=>!c.customModuleId&&c.category==='entityFactChanges'&&(c.entity??c.entityId)===b.dataset.deleteProfile).map(c=>c.id);
     if(host.confirm?.(`删除“${b.dataset.deleteProfile}”档案中的 ${ids.length} 条属性记录？可在回收站恢复，不删除聊天原文及其他模块。`))await app.deleteRecords(ids);
   }));
 }
 function paint(s){snapshot=s;for(const [sel,value]of [['[data-status]',s.message],['[data-scope]',s.chatReady?`当前聊天 · 已连接${s.enabled?'':' · 自动任务未启用'}`:s.status==='loading'?'正在加载当前聊天…':s.status==='no_chat'?'尚未打开聊天':s.stale?'正在重新核对聊天来源…':'等待当前聊天就绪'],['[data-progress]',s.progress]])if($(sel)&&$(sel).textContent!==value)$(sel).textContent=value;
   // 更新中心只汇总进度：未读取到数据时明确说“未读取”，不假装一切正常。
   const updateProgress=$('[data-update-progress]');
   if(updateProgress){
     const auto=s.automatic,plan=auto?.plan,persona=s.dynamicPersona;
     let summaryLine='总结：尚未读取进度';
     if(auto&&plan){
       summaryLine=`总结：已记录至 ${plan.coveredThrough} 楼 ｜ 下次 ${plan.nextStart}–${plan.nextEnd} 楼`;
       if(plan.pendingBatches)summaryLine+=` ｜ 待处理 ${plan.pendingBatches} 批`;
     }
     let personaLine='人设：尚未启用';
     if(persona&&Number.isFinite(persona.plan?.coveredThrough)){
       personaLine=`人设：依据至 ${persona.plan.coveredThrough} 楼 ｜ 下次 ${persona.plan.nextStart} 楼`;
       if(persona.paused)personaLine+='（已暂停）';
     }else if(persona)personaLine='人设：进度未读取';
     const next=summaryLine+'\n'+personaLine;
     if(updateProgress.textContent!==next)updateProgress.textContent=next;
   }
   if(s.feedback&&s.feedback.id!==lastFeedbackId){lastFeedbackId=s.feedback.id;feedback(s.feedback.text,s.feedback.level,['success','error'].includes(s.feedback.level));if(currentPage==='recording'&&s.feedback.kind==='summary'&&['error','warning'].includes(s.feedback.level)&&(s.batches??[]).some(batch=>['queued','running','failed','interrupted'].includes(batch.status))){const batches=$('[data-summary-memory-batches]');if(batches)batches.open=true;}}
   if(panel.dataset.queueNotice!==(s.requestQueueNotice??'')){
     const previous=panel.dataset.queueNotice;panel.dataset.queueNotice=s.requestQueueNotice??'';
     if(s.requestQueueNotice)feedback(s.requestQueueNotice,'info');
     else if(previous)feedback(s.feedback?.text??s.message,s.feedback?.level??'info');
   }
   // Background diagnostic persistence must not erase a visible operation error.
   if(noticeLevel==='error'&&$('[data-status]'))$('[data-status]').textContent=noticeText;
    floating?.setBusy(s.busy||modelRequests.size>0);
    if(floating?.window.hidden)return;
    journalView?.paint(s,currentPage);
    if(['dynamic-persona','persona-profiles'].includes(currentPage)){
      dynamicPersonaView?.paint(s);
      const d=s.dynamicPersona,key=JSON.stringify([s.core?.scope,d?.status,d?.message]);
      if(personaNotice!==key){personaNotice=key;if(d?.message&&['running','saved','failed','paused'].includes(d.status))feedback(d.message,({running:'running',saved:'success',failed:'error',paused:'info'})[d.status]);}
    }
    const memory=currentPage==='memory',recording=currentPage==='recording',recordTab=$('[data-record-tab].active')?.dataset.recordTab;
    if(memory){paintCards();customManagement?.paint(s);}
    if(memory||recording||currentPage==='settings')management?.paint(s,{memory,batches:recording||currentPage==='settings'});
    if(currentPage==='settings'){
      const removal=s.dynamicPersona?.batchRemoval,archived=Boolean(removal),busy=Boolean(s.dynamicPersona?.busy);
      $('[data-persona-recovery-status]').textContent=removal?.reason==='source_changed'?`原文校验发现变化，已撤下 ${removal.startIndex}–${removal.endIndex} 楼；归档保留，恢复时会重新核对原文。`:archived?'有上次撤下的人物批次归档；恢复前会核对原文和当前档案。':'没有可恢复的人物批次归档。';
      $('[data-persona-recovery-restore]').disabled=!archived||busy;
    }
    if(recording||currentPage==='dynamic-persona'){
     paintSummaryModules(s);
     memoryRetrospectiveView?.paint(s);
     for(const kind of ['memory','persona']){const control=$(`[data-feature="${kind}"]`),enabled=kind==='memory'?Boolean(s.settings.autoSummaryEnabled||s.settings.injectionEnabled):Boolean(s.settings.dynamicPersonaEnabled);control.setAttribute('aria-pressed',String(enabled));const status=kind==='memory'?`自动总结${s.settings.autoSummaryEnabled?'开':'关'} · 注入${s.settings.injectionEnabled?'开':'关'}`:!s.settings.dynamicPersonaEnabled?'未启用':s.dynamicPersona?.paused?'更新已暂停 · 档案启用':'自动更新 · 档案启用';control.title=status;$(`[data-feature-status="${kind}"]`).textContent=status;}
    }
    // 日志在独立 page：切到 log page 时加载，加载完重画。
    if(currentPage==='log'){
      logView?.paint(s);
      void app.loadRuntimeLog?.().then(()=>{if(currentPage==='log')logView?.paint(readViewState(app));}).catch(()=>{});
    }
    if(currentPage==='dictionary')dictionaryView?.paint(s);
    if(currentPage==='people')peopleView?.paint(s);
    if(recording&&$('[data-tag-settings]')?.open)extractionView?.paint(s);
    if(RECALL_PAGES.includes(currentPage))recallView?.paint(s);
    if(memory){
   qualityView?.paint(s);
    }
    if(recording&&recordTab==='automatic'&&$('[data-auto-progress]')&&s.automatic){$('[data-auto-progress]').textContent=autoSummaryText(s.automatic);const scope=JSON.stringify(s.core?.scope);if(autoScope!==scope){autoScope=scope;autoStartDirty=false;}if(!autoStartDirty)$('[data-auto-start]').value=s.automatic.startFloor;}
   if($('[data-setting="autoSummaryEnabled"]'))$('[data-setting="autoSummaryEnabled"]').checked=s.settings.autoSummaryEnabled;
    if(currentPage==='api')for(const f of $$('[data-key]')){const kind=f.getAttribute('data-key');f.placeholder=s.credentialPresent?.[kind]?'已保存 / 已填入；输入新 Key 可替换':'无需认证的服务可以留空';const status=$(`[data-key-status="${kind}"]`);if(status)status.textContent=s.credentialErrors?.[kind]??(s.credentialDirty?.[kind]?'新输入的 Key 尚未保存。':s.credentialSaved?.[kind]?(s.credentialPresent?.[kind]?'Key 已保存，重启后自动使用。':'已保存的 Key 属于其他地址；请重新输入本地址的 Key。'):(s.credentialPresent?.[kind]?'Key 尚未保存，点击本模型的保存按钮。':'尚未保存 Key；无需认证的服务可以留空。'));}
    if(currentPage==='assistant'){
    if($('[data-model]'))$('[data-model]').textContent=s.settings.assistantFollowSummary?s.settings.providerModel:s.settings.assistantModel;
   if($('[data-history]'))$('[data-history]').innerHTML=s.history.map(m=>`<article class="sy-message ${m.role==='user'?'is-user':''}"><strong>${m.role==='user'?'你':'配置助手'}</strong><div>${esc(m.content)}</div></article>`).join('')||'<p class="sy-empty">描述你的想法，助手会生成可应用的方案。</p>';
   if($('[data-proposal]')){const p=s.proposal;$('[data-proposal]').innerHTML=p?`<div class="sy-plan"><h4>待应用方案</h4><p>${esc(p.explanation)}</p>${p.kind==='module'?moduleProposalHTML(p):Object.entries(p.patch).map(([k,v])=>`<p><strong>${esc(PRODUCT_SETTING_REGISTRY[k]?.label??k)}</strong><br>${esc(p.before[k])} → ${esc(v)}</p>`).join('')}${button('apply','应用并保存',true)}</div>`:'';$('[data-action="apply"]')?.addEventListener('click',()=>run(async()=>{await app.applyProposal();fill();}));}
    }
    if(recording&&recordTab==='presets')presetView?.paint(s);
    if(currentPage==='world')knowledgeView?.paint(s);
    if(currentPage==='current'){
    if($('[data-preview]'))$('[data-preview]').innerHTML=s.preview?`<p class="sy-help">预览 · ${s.preview.usedUnits} 估算单位 · ${s.preview.cards.length} 条（非精确 TOKEN 数）</p>${s.preview.degraded?'<p role="status">本轮召回已降级：在线接口失败或向量索引不完整，可能遗漏相关记忆。</p>':''}<div class="sy-packet">${esc(s.preview.text||'没有相关记忆')}</div><details><summary>这次如何找到记忆</summary><div class="sy-packet sy-help">${esc(recallExplanation(s.preview.trace))}</div></details>`:'';
   if($('[data-actual]'))$('[data-actual]').innerHTML=s.actual?`<p class="sy-help">已加入待发送请求；不代表服务端已接收。${s.actual.usedUnits} 估算单位</p>${s.actual.degraded?'<p role="status">本轮召回已降级，不能视为完整检索结果。</p>':''}<div class="sy-packet">${esc(s.actual.text)}</div><details><summary>这次如何找到记忆</summary><div class="sy-packet sy-help">${esc(recallExplanation(s.actual.trace))}</div></details>`:'<p class="sy-empty">尚未向宿主请求加入记忆。</p>';
    }
  }
  const painting=frameScheduler(documentRef.defaultView??host,()=>paint(readViewState(app)));
  app??=createProductApplication({host,controller,...controllerOptions,onChange:paint,onInvalidate:()=>painting.request()});
  memoryRetrospectiveView=mountMemoryRetrospective({panel,app,run});
  dynamicPersonaView=mountDynamicPersona({panel,app,run,host});
 function fill({apiOnly=false}={}){const s=readViewState(app);for(const f of $$('[data-setting]')){const key=f.getAttribute('data-setting');if(dirtyApi.has(key))continue;if(f.type==='checkbox')f.checked=Boolean(s.settings[key]);else f.value=s.settings[key]??'';}{if($('[data-input]'))$('[data-input]').value=s.draft??'';if($('[data-count]'))$('[data-count]').value=s.settings.messageCount;if($('[data-batch-size]'))$('[data-batch-size]').value=s.settings.summaryBatchSize;const select=$('[data-conversation]');if(select){select.innerHTML=s.conversations.map(c=>`<option value="${esc(c.id)}">${esc(c.title)}</option>`).join('')||'<option value="main">配置对话</option>';select.value=s.conversationId;}}syncInherited();syncSummaryRange();}
 function collect(root=panel){const patch={};for(const f of root.querySelectorAll('[data-setting]')){const k=f.getAttribute('data-setting'),d=PRODUCT_SETTING_REGISTRY[k];if(['number','integer'].includes(d.type)&&f.value.trim()==='')throw new Error(`${d.label}不能为空`);patch[k]=d.type==='boolean'?f.checked:['number','integer'].includes(d.type)?Number(f.value):f.value;}return patch;}
 function apiPatch(kind,forRequest=false){const patch=collect($(`[data-api-card="${kind}"]`));if(forRequest&&kind==='knowledge'&&patch.knowledgeFollowAssistant)Object.assign(patch,apiPatch('assistant',true));if(forRequest&&['assistant','supplement'].includes(kind)&&patch[`${kind}FollowSummary`])Object.assign(patch,collect($('[data-api-card="summary"]')));return patch;}
 async function loadModels(kind){
   resetModels(kind);const request=new AbortController();modelRequests.set(kind,request);
   const status=$(`[data-model-status="${kind}"]`),fetchButton=$(`[data-action="models-${kind}"]`),title=API_INFO[kind].title;
   fetchButton.disabled=true;fetchButton.textContent='正在拉取…';status.textContent='正在拉取…';feedback(`${title}：正在拉取模型列表…`,'running');floating?.setBusy(true);
   try{const models=await app.listModels(kind,{patch:apiPatch(kind,true),modelsUrl:$(`[data-models-url="${kind}"]`).value,signal:request.signal});if(modelRequests.get(kind)!==request)return;
     const select=$(`[data-model-list="${kind}"]`),value=$(`[data-setting="${API_INFO[kind].prefix}Model"]`).value;
     select.innerHTML='<option value="">请选择模型</option>'+models.map(id=>`<option value="${esc(id)}">${esc(id)}</option>`).join('');select.disabled=!models.length;select.value=models.includes(value)?value:'';
     status.textContent=models.length?`已获取 ${models.length} 个模型`:'服务返回空列表，可直接输入模型名称。';feedback(`${title}：${status.textContent}`,models.length?'success':'info',models.length>0);
   }catch(error){if(modelRequests.get(kind)===request){status.textContent=`拉取${error.code==='CANCELED'?'已停止':'失败'}：${failureText(error)}`;feedback(`${title}：${status.textContent}`,error.code==='CANCELED'?'info':'error',error.code!=='CANCELED');}}
   finally{if(modelRequests.get(kind)===request){modelRequests.delete(kind);fetchButton.disabled=false;fetchButton.textContent='拉取模型列表';floating?.setBusy(Boolean(readViewState(app).busy)||modelRequests.size>0);}}
 }
 async function run(fn,{name='',button:control}={}){
const label=name.startsWith('test-')?`${API_INFO[name.slice(5)]?.title??'模型'}连接测试`:name.startsWith('save-')?'保存设置':({'dynamic-persona':'动态人设操作','journal-write':'更新角色记录','custom-save-module':'保存区块','custom-save-module-value':'保存记录','custom-read-mvu':'读取 MVU','custom-import-modules':'导入区块',open:'启用自动任务',assistant:'配置助手',beginner:'规则配置',summarize:'总结','focus-summary':'总结',analyze:'分析资料',vectors:'建立向量索引',import:'导入文件',remember:'保存记事'})[name];
   const isSummary=['summarize','focus-summary'].includes(name),isModels=name.startsWith('models-'),before=lastFeedbackId;
   const oldLabel=control?.textContent;if(label){feedback(`${label}中…`,'running');if(control){control.disabled=true;control.textContent=`${label}中…`;}}
   try{const result=await fn();painting.request();if(name.startsWith('test-')&&result?.message)feedback(`${API_INFO[name.slice(5)]?.title??'模型'}：${result.message}`,result.level??'info',true);else if(name==='vectors'&&result?.message)feedback(result.message,result.pending?'warning':'success',true);else if(result?.message&&result?.level&&!isSummary)feedback(result.message,result.level,true);else if(name==='dynamic-persona')feedback(result?.message??'操作已处理；状态与进度见本页动态人设卡。','info');else if(name==='extraction')feedback('正文提取操作完成；预览和保存状态见当前页面。','success');else if(label&&!isSummary&&!isModels)feedback(`${label}完成`,'success',true);}
   catch(e){void app.reportError?.(e,{stage:'ui'});const text=`${label??'操作'}未完成：${failureText(e)}`;if($('[data-status]'))$('[data-status]').textContent=text;if(!isSummary||before===lastFeedbackId)feedback(text,['CANCELED','CHAT_CHANGED','SOURCE_INVALIDATED'].includes(e?.code)?'info':'error',!['CANCELED','CHAT_CHANGED','SOURCE_INVALIDATED'].includes(e?.code));}
   finally{if(control&&label){control.disabled=false;control.textContent=oldLabel;}painting.request();floating?.setBusy(Boolean(readViewState(app).busy)||modelRequests.size>0);}
 }
 function selectedSummary(withFocus=true){return summarySelection({mode:$('[data-range-mode]').value,count:$('[data-count]').value,startIndex:$('[data-start]').value,endIndex:$('[data-end]').value,batchSize:$('[data-batch-size]').value,focus:withFocus?$('[data-focus]').value:''});}
 function syncSummaryRange(){
   const mode=$('[data-range-mode]')?.value??'recent';
   for(const section of $$('[data-range-fields]')){section.hidden=section.dataset.rangeFields!==mode;for(const input of section.querySelectorAll('input'))input.disabled=section.hidden;}
   const preview=$('[data-summary-selection]');if(!preview)return;
   try{const value=selectedSummary(false);preview.textContent=mode==='range'?`本次：${value.startIndex}–${value.endIndex} 楼，共 ${value.endIndex-value.startIndex+1} 楼，每 ${value.batchSize} 楼一批。`:`本次：最近 ${value.count} 楼，每 ${value.batchSize} 楼一批。`;}catch{preview.textContent=mode==='range'?'请填写起止楼层。':'请填写楼数与每批楼数。';}
 }
 async function summarize(withFocus){
   const options=selectedSummary(withFocus);
   if(!app.previewSummary)return app.summarize(options);
   const preview=await app.previewSummary(options);
   const extra=[...preview.prefix,...preview.suffix].map(r=>`${r.startIndex}–${r.endIndex} 楼`).join('、');
   const text=`本次 ${preview.requested.startIndex}–${preview.requested.endIndex} 楼，共 ${preview.plannedBatches} 批。${preview.grouped?'旧结果在整组成功后替换；失败保留旧记忆。':''}${preview.discardedTail?`完成后撤下旧 ${preview.discardedTail.startIndex}–${preview.discardedTail.endIndex} 楼，不重算后续；自动接续暂停，需主动继续。`:''}${extra?`为保留起点前的完整事实，另需重算 ${extra}，额外 ${preview.extraBatches} 批（已计入总数）。`:''}输入预算、分工或复核可能增加请求。`;
   $('[data-summary-selection]').textContent=text;
   if((preview.extraBatches||preview.discardedTail)&&await host.confirm?.(text+' 是否继续？')!==true)return {status:'canceled'};
   return app.summarize({...options,previewHash:preview.previewHash});
 }
 async function download(data,name,{preferBrowser='picker'}={}){
    // Only a host-confirmed save may be reported as success. A dispatched
    // payload (anchor / TT download-bridge hand-off) is explicitly unconfirmed,
    // and a failure must stay a failure while the text exit stays usable.
    let result;
    try{result=await exportProductJson(data,name,{host,documentRef,preferBrowser});}
    catch(error){
      const text=`文件导出未完成：${failureText(error)}`;
      if($('[data-status]'))$('[data-status]').textContent=text;
      feedback(text,'error',true);
      try{void Promise.resolve(app.reportError?.(error,{stage:'ui',action:'exportFile'})).catch(()=>{});}catch{/*导出诊断不能反过来阻止失败提示*/}
      throw error;
    }
    if(result?.saved===true){
      const text=result.exportAttempt==='picker'?`文件已保存到${result.saveLocation??'你选择的保存位置'}`:`文件已保存到${result.saveLocation??'手机 Downloads'}`;
      if($('[data-status]'))$('[data-status]').textContent=text;
      feedback(text,'success');host.toastr?.success?.(text);
    }
    else if(result?.status==='dispatched')host.toastr?.warning?.(result.dispatch==='share-unconfirmed'?'导出未确认保存：已交给系统分享，请确认目标位置已收到文件，或改用日志 → 查看／复制文本。':'导出未确认保存：当前宿主下载通道返回成功但未真正写入文件，请到日志 → 查看／复制文本 自行保存。');
    return result;
  }
 const actions={open:async()=>{await app.open();fill();},disable:()=>app.disable(),refresh:()=>app.refresh(),summarize:()=>summarize(false),'focus-summary':()=>summarize(true),stop:()=>app.stop(),'assistant-stop':()=>app.stop(),remember:async()=>{await app.remember($('[data-note]')?.value??'',$('[data-people]')?.value??'',{category:$('[data-note-category]')?.value??'events',subject:$('[data-note-subject]')?.value??'',target:$('[data-note-target]')?.value??'',field:$('[data-note-field]')?.value??'',eventRef:$('[data-note-event]')?.value??''});if($('[data-note]'))$('[data-note]').value='';},preview:()=>app.preview($('[data-query]')?.value??''),'preview-online':()=>app.preview($('[data-query]')?.value??'',{online:true}),'vector-status':()=>app.refreshVectorStatus(),'save-settings':()=>app.saveSettings(collect()),'test-summary':()=>app.testConnection('summary'),'test-assistant':()=>app.testConnection('assistant'),'test-embedding':()=>app.testConnection('embedding'),'test-rerank':()=>app.testConnection('rerank'),import:async()=>{for(const f of Array.from($('[data-files]')?.files??[]))await app.addDocument({name:f.name,text:await f.text(),purpose:$('[data-purpose]')?.value});},analyze:()=>app.analyzeDocuments(),assistant:async()=>{await app.assistant($('[data-input]')?.value??'');if($('[data-input]'))$('[data-input]').value='';},beginner:async()=>{await app.analyzeDocuments();await app.assistant('按我导入的配置规则一次性生成完整设置方案，只有必要信息缺失才询问，不需要逐项问卷。');},'new-conversation':async()=>{await app.newConversation();fill();},'delete-conversation':async()=>{if(host.confirm?.('删除当前助手对话？已应用设置和记忆不会删除。')){await app.deleteConversation();fill();}},'restore-hidden':()=>app.restoreHidden(),vectors:()=>app.buildVectors(),undo:async()=>{await app.undoSettings();fill();},'export-config':()=>download(app.exportSettings(),'拾忆-配置.json'),'export-global':async()=>download(await app.exportGlobalBackup(),'拾忆-全局备份.json'),'export-backup':async()=>download(await app.exportBackup(),'拾忆-聊天备份.json'),'export-backup-recent':async()=>download(await app.exportBackup({assistantLimit:100}),'拾忆-聊天备份-最近100条.json')};
 actions.remember=()=>management?.remember();
 actions['variable-template']=()=>{const value=$('[data-variable-template]').value;if(!value)return;const input=$('[data-setting="externalStatePaths"]'),paths=input.value.split('\n').map(s=>s.trim()).filter(Boolean);if(!paths.includes(value))input.value=[...paths,value].join('\n');dirtyApi.add('externalStatePaths');feedback('路径模板已填入，检查后保存；未读取或改写变量。');};
 qualityView=mountQualityView({panel,app,run});
 actions['review-memory']=()=>app.previewQuality();
 actions['undo-quality']=async()=>{if(host.confirm?.('撤销此聊天的自动校对？恢复原总结；校对补入的属性和知情项将撤下，人工修改的原记录保留。'))await app.undoQuality();};
 actions['builtin-beginner']=()=>app.assistant('按内置新手配置规则帮助我配置拾忆。先查看当前设置和相关规则，保留已经填好的模型连接。只有卡类型、变量系统或记录偏好等必要信息缺失时才询问；生成可确认应用的方案。');
 $('[data-auto-start]')?.addEventListener('input',()=>{autoStartDirty=true;});
 for(const control of $$('[data-feature]'))control.addEventListener('click',()=>{if(control.disabled)return;const value=control.getAttribute('aria-pressed')!=='true';void run(()=>app.setFeature(control.dataset.feature,value),{name:'save-feature',button:control});});
 const saveAutomatic=async()=>{const floor=Number($('[data-auto-start]').value),scope=readViewState(app).core?.scope,patch=collect($('[data-record-panel="automatic"]'));await app.saveSettings(patch);await app.setAutoStartFloor(floor,scope);autoStartDirty=false;};
 actions['auto-save']=saveAutomatic;actions['auto-inspect']=()=>app.inspectAutomaticProgress();actions['auto-process']=()=>app.processAutomatic();
 // 扇形卡片上的按钮：记忆走主总结（只补缺口，按已保存的自动设置）；
 // 人设入口统一从已保存设置计算，未完成任务原地续做，不读取隐藏表单。
 panel.addEventListener?.('click',event=>{
   const button=event.target?.closest?.('[data-summary-module="persona"] [data-summary-pause]');
   if(button)void run(()=>app.pauseDynamicPersona(),{name:'dynamic-persona',button});
 });
 panel.addEventListener?.('click',event=>{
   const button=event.target?.closest?.('[data-summary-next-batch]');
   if(!button)return;
   const kind=button.closest?.('[data-summary-module]')?.dataset.summaryModule;
   const start=Number(button.dataset?.summaryStart??NaN),end=Number(button.dataset?.summaryEnd??NaN);
   if(kind==='persona'){
     return void run(()=>app.queueDynamicPersona(),{name:'dynamic-persona',button});
   }
   // 记忆卡的「总结下一批 起始–结束楼」必须真正调用 summarize：之前只发一条
   // toast 就 return，按钮按了什么都不发生。补走 run() 反馈链路，确保按钮
   // 被禁用、状态行刷新、运行日志记到一条 start/complete/failed。
   if(Number.isInteger(start)&&Number.isInteger(end))return void run(()=>app.summarize({startIndex:start,endIndex:end,batchSize:end-start+1,missingOnly:true,focus:'',trigger:'manual_card_next'}),{name:'focus-summary',button});
   void run(()=>app.catchUpAutomatic());
 });
 actions['auto-start']=async()=>{await saveAutomatic();await app.setAutomatic(true);fill();};actions['auto-pause']=async()=>{await app.setAutomatic(false);fill();};
 // 总结页第二行：动态人设「启用/暂停」按钮直接通过 application 操作；周期设到人设页调整。
 $('[data-persona-enable-inline]')?.addEventListener('click',()=>run(()=>app.setDynamicPersona(true),{name:'dynamic-persona',button:$('[data-persona-enable-inline]')}));
 $('[data-persona-pause-inline]')?.addEventListener('click',()=>run(()=>app.pauseDynamicPersona(),{name:'dynamic-persona',button:$('[data-persona-pause-inline]')}));
 $('[data-persona-resume-batches]')?.addEventListener('click',()=>run(()=>app.queueDynamicPersona(),{name:'dynamic-persona',button:$('[data-persona-resume-batches]')}));
 $('[data-persona-pause-batches]')?.addEventListener('click',()=>run(()=>app.pauseDynamicPersona(),{name:'dynamic-persona',button:$('[data-persona-pause-batches]')}));
 $('[data-persona-discard-plan]')?.addEventListener('click',e=>void run(async()=>{const scope=JSON.stringify(readViewState(app).core?.scope),plan=readViewState(app).dynamicPersona?.manualPlan;if(!plan||!['running','paused','failed'].includes(plan.status))throw new Error('没有待放弃的人设计划');if(!await host.confirm?.(`放弃 ${plan.startIndex}–${plan.endIndex} 楼的人设补建计划？候选会归档，原档案和主总结保留。`))return;if(readViewState(app).dynamicPersona?.busy)await app.pauseDynamicPersonaManual();for(let i=0;i<100&&readViewState(app).dynamicPersona?.busy;i++)await new Promise(resolve=>setTimeout(resolve,100));checkPersonaBatchScope(scope);if(readViewState(app).dynamicPersona?.manualPlan?.id!==plan.id)throw new Error('人设计划已变化，请重新查看');if(readViewState(app).dynamicPersona?.busy)throw new Error('当前请求尚未退出，已暂停；稍后可直接放弃计划');await app.discardDynamicPersonaManual({planId:plan.id});},{name:'dynamic-persona',button:e.currentTarget}));
 $('[data-persona-resume-auto]')?.addEventListener('click',e=>run(()=>app.setFeature('persona',true),{name:'dynamic-persona',button:e.currentTarget}));
 $('[data-summary-persona-batches]')?.addEventListener('toggle',()=>paintSummaryModules(readViewState(app)));
 const checkPersonaBatchScope=scope=>{if(JSON.stringify(readViewState(app).core?.scope)!==scope)throw new Error('聊天已切换，请重新选择批次');};
 const selectedPersonaCandidate=()=>{
   const s=readViewState(app),scope=JSON.stringify(s.core?.scope),row=personaBatchItems.find(b=>personaBatchSelection.has(b.selectionKey)),plan=s.dynamicPersona?.manualPlan;
   if(scope!==personaBatchScope)throw new Error('聊天已切换，请重新选择批次');
   if(personaBatchSelection.size!==1||!row?.candidate||!plan||JSON.parse(row.selectionKey)[0]!==plan.id)throw new Error('请单选本次计划中当前未完成的一批');
   const first=plan.items.find(b=>b.status!=='saved');
   if(!first||row.startIndex!==first.startIndex||row.endIndex!==first.endIndex)throw new Error('人设按顺序累积，请先处理当前未完成的一批');
   return {scope,row,plan,options:{planId:plan.id,startIndex:row.startIndex,endIndex:row.endIndex}};
 };
 const deletePersonaSelection=async keys=>{
   const scope=JSON.stringify(readViewState(app).core?.scope),rows=keys.map(key=>personaBatchItems.find(b=>b.selectionKey===key&&b.selectable));
   if(scope!==personaBatchScope)throw new Error('聊天已切换，请重新选择批次');
   if(!rows.length||rows.some(b=>!b))throw new Error('批次已变化，请重新选择');
   if(rows.some(b=>b.candidate)){
     throw new Error('候选人设不能跳过中间一批。可重试或拆小当前未完成批，也可应用已完成前段。');
   }else{
     const selected={batches:rows.map(b=>({startIndex:b.startIndex,endIndex:b.endIndex,versionId:b.versionId,sourceHash:b.sourceHash}))},preview=await app.previewDeleteDynamicPersonaBatch(selected);checkPersonaBatchScope(scope);
     if(!await host.confirm?.(`已选 ${preview.selectedCount} 批，另有 ${preview.dependentCount} 批后续累积人设需一起撤下。实际删除 ${preview.startIndex}–${preview.endIndex} 楼共 ${preview.count} 批；保存归档并暂停自动补回，手工档案、主总结与原文保留。继续？`))return;
     checkPersonaBatchScope(scope);await app.deleteDynamicPersonaBatch({...selected,hash:preview.hash});
   }
   personaBatchSelection.clear();paintSummaryModules(readViewState(app));
 };
 $('[data-persona-batch-rows]')?.addEventListener('change',e=>{const input=e.target.closest?.('[data-persona-batch-select]');if(!input||input.disabled)return;input.checked?personaBatchSelection.add(input.dataset.personaBatchSelect):personaBatchSelection.delete(input.dataset.personaBatchSelect);paintSummaryModules(readViewState(app));});
 $('[data-persona-batch-select-page]')?.addEventListener('click',()=>{for(const b of personaBatchItems.slice(personaBatchPage*10,personaBatchPage*10+10))if(b.selectable)personaBatchSelection.add(b.selectionKey);paintSummaryModules(readViewState(app));});
 $('[data-persona-batch-clear]')?.addEventListener('click',()=>{personaBatchSelection.clear();paintSummaryModules(readViewState(app));});
 $('[data-persona-batch-delete-selected]')?.addEventListener('click',e=>void run(()=>deletePersonaSelection([...personaBatchSelection]),{name:'dynamic-persona',button:e.currentTarget}));
 $('[data-persona-batch-retry-selected]')?.addEventListener('click',e=>void run(async()=>{const {scope,options}=selectedPersonaCandidate();checkPersonaBatchScope(scope);await app.retryDynamicPersonaManualBatch(options);return {message:`已排队重试 ${options.startIndex}–${options.endIndex} 楼；本批结束后暂停。`,level:'info'};},{name:'dynamic-persona',button:e.currentTarget}));
 $('[data-persona-batch-split-selected]')?.addEventListener('click',e=>void run(async()=>{
   const {scope,row,plan,options}=selectedPersonaCandidate(),batchSize=Math.ceil((row.endIndex-row.startIndex+1)/2);
   if(!['pending','failed'].includes(row.status)||row.endIndex<=row.startIndex)throw new Error('请单选可拆分的未完成批次');
   if(!await host.confirm?.(`把 ${row.startIndex}–${row.endIndex} 楼拆为每 ${batchSize} 楼一批？仅调整待处理计划，不调用模型；已有成功候选保留。`))return;
   checkPersonaBatchScope(scope);if(plan.status==='running')await app.pauseDynamicPersonaManual();checkPersonaBatchScope(scope);
   if(readViewState(app).dynamicPersona?.manualPlan?.id!==plan.id)throw new Error('人设计划已变化，请重新查看');
   const result=await app.splitDynamicPersonaManualBatch({...options,batchSize});personaBatchSelection.clear();return result;
 },{name:'dynamic-persona',button:e.currentTarget}));
 $('[data-persona-apply-prefix]')?.addEventListener('click',e=>void run(async()=>{
   const s=readViewState(app),scope=JSON.stringify(s.core?.scope),plan=s.dynamicPersona?.manualPlan;
   if(!plan||!['running','paused','failed'].includes(plan.status))throw new Error('没有可应用的人设计划');
   if(plan.status==='running')await app.pauseDynamicPersonaManual();checkPersonaBatchScope(scope);
   const preview=await app.previewDynamicPersonaManualPrefix({planId:plan.id});checkPersonaBatchScope(scope);
   const tail=preview.discardedTail?`旧 ${preview.discardedTail.startIndex}–${preview.discardedTail.endIndex} 楼人设将撤下归档。`:'';
   const rest=preview.unappliedRange?`剩余 ${preview.unappliedRange.startIndex}–${preview.unappliedRange.endIndex} 楼共 ${preview.pendingCount} 批取消并归档，可稍后手动补建。`:'';
   if(!await host.confirm?.(`应用已完成的 ${preview.startIndex}–${preview.endIndex} 楼（${preview.savedCount} 批）？${tail}${rest}自动接续暂停；不调用模型，主总结与聊天原文保留。`))return;
   checkPersonaBatchScope(scope);
   if(readViewState(app).dynamicPersona?.manualPlan?.id!==plan.id)throw new Error('人设计划已变化，请重新查看');
   const result=await app.applyDynamicPersonaManualPrefix(preview);personaBatchSelection.clear();return result;
 },{name:'dynamic-persona',button:e.currentTarget}));
 $('[data-persona-batch-details]')?.addEventListener('click',()=>{const key=[...personaBatchSelection][0],row=personaBatchItems.find(item=>item.selectionKey===key),detail=$('[data-persona-batch-detail]');if(!row||!detail)return;detail.textContent=`${row.startIndex}–${row.endIndex} 楼 · ${row.candidate?'本次计划候选':'正式人物批次'} · ${row.status==='saved'?'已保存':row.status==='failed'?'未完成':row.status==='running'?'处理中':'待处理'}${row.message?` · ${row.message}`:''}`;detail.hidden=false;detail.scrollIntoView?.({block:'nearest'});});
 $('[data-persona-recovery-restore]')?.addEventListener('click',e=>void run(async()=>{const scope=JSON.stringify(readViewState(app).core?.scope);if(await host.confirm?.('恢复上次撤下的人物批次？恢复前会核对原文、归档和当前档案状态。')){checkPersonaBatchScope(scope);await app.restoreDynamicPersonaBatch();}},{name:'dynamic-persona',button:e.currentTarget}));
 for(const [key,delta] of [['prev',-1],['next',1]])$(`[data-persona-batch-${key}]`)?.addEventListener('click',()=>{personaBatchPage=Math.max(0,personaBatchPage+delta);paintSummaryModules(readViewState(app));});
 actions['per-call-mode']=async()=>{const patch={summaryReviewEnabled:false,summaryStaged:false,autoMergeEnabled:false,autoQualityEnabled:false};await app.saveSettings(patch);for(const key of Object.keys(patch))dirtyApi.delete(key);fill();feedback('已改为一次主总结；不自动追加分工、合并和校对请求。API、楼数、回复上限不变。','success');};
 actions['recommended-memory']=async()=>{if(!host.confirm?.('将总结与召回参数设为推荐值（5楼一批、回复8192）。不改 API、Key、记录偏好和自动运行开关。确认应用？'))return;await app.saveSettings(RECOMMENDED_MEMORY_SETTINGS);for(const k of Object.keys(RECOMMENDED_MEMORY_SETTINGS))dirtyApi.delete(k);fill();};
 actions['save-recall-preset']=async()=>{const count=Number($('[data-recall-level]').value),patch={dictionaryEnabled:true,tagRecallEnabled:true,distributedEnabled:true,distributedStrategy:'broadcast',retrievalCandidateLimit:count,rerankMaxCandidates:count};await app.saveSettings(patch);for(const key of Object.keys(patch))dirtyApi.delete(key);fill();};
 async function savePatch(patch,save=()=>app.saveSettings(patch)){await save();for(const [key,value]of Object.entries(patch)){const f=$(`[data-setting="${key}"]`);if(f&&(f.type==='checkbox'?f.checked===value:f.value===String(value)))dirtyApi.delete(key);}}
 actions['save-settings']=async()=>{if(currentPage==='api'){for(const kind of Object.keys(API_INFO))await saveApiCard(kind);await savePatch(collect($('[data-view="api"]')));}else await savePatch(collect($(`[data-view="${currentPage}"]`)));};
 actions['save-persona-compat']=()=>savePatch({dynamicPersonaJsonMode:Boolean($('[data-setting="dynamicPersonaJsonMode"]')?.checked)});
 async function saveApiCard(kind){const input=$(`[data-key="${kind}"]`),value=input.value,patch=apiPatch(kind);if(value)app.setKey(kind,value,patch[`${API_INFO[kind].prefix}Endpoint`]);await savePatch(patch,()=>app.saveApi(kind,patch,{keyValue:value}));if(input.value===value)input.value='';}
 for(const kind of Object.keys(API_INFO)){
   actions[`save-api-${kind}`]=()=>saveApiCard(kind);
   actions[`forget-key-${kind}`]=async()=>{if(host.confirm?.('清除此模型保存的 Key？地址、模型和记忆不会删除。')){await app.forgetKey(kind);$(`[data-key="${kind}"]`).value='';resetModels(kind);}};
   actions[`test-${kind}`]=()=>app.testConnection(kind,apiPatch(kind,true));
   actions[`models-${kind}`]=()=>loadModels(kind);
   actions[`recommend-${kind}`]=()=>{const patch=missingRecommendations(apiPatch(kind),kind);for(const [k,v]of Object.entries(patch)){$(`[data-setting="${k}"]`).value=v;dirtyApi.add(k);}resetModels(kind);$(`[data-model-status="${kind}"]`).textContent=Object.keys(patch).length?'已补齐，点击保存后生效。':'已有配置保持不变。';};
 }
 for(const [name,fn]of Object.entries(actions))for(const b of $$(`[data-action="${name}"]`))b.addEventListener?.('click',()=>run(fn,{name,button:b}));
 for(const selector of ['[data-range-mode]','[data-count]','[data-start]','[data-end]','[data-batch-size]'])$(selector)?.addEventListener(selector==='[data-range-mode]'?'change':'input',syncSummaryRange);
 function showRecordTab(name){if(name==='dynamic-persona'){setPage(name);return;}for(const section of $$('[data-record-panel]'))if(section.dataset.recordPanel!=='logs')section.hidden=section.dataset.recordPanel!==name;for(const tab of $$('[data-record-tab]'))tab.classList.toggle('active',tab.dataset.recordTab===name);setPage('recording');recordTabs.scrollIntoView?.({block:'start'});if(name==='logs')void app.loadRuntimeLog?.().then(()=>paint(readViewState(app)));}
 for(const b of $$('[data-record-tab]'))b.addEventListener('click',()=>showRecordTab(b.dataset.recordTab));
 const openLogs=()=>{setPage('log');};
 const logJump=documentRef.createElement('button');logJump.type='button';logJump.textContent='查看运行日志';logJump.dataset.openLogs='';logJump.addEventListener('click',openLogs);$('[data-status]')?.after(logJump);
 const recordTabs=$('.sy-record-tabs'),summaryOverview=$('[data-summary-overview]');
 const pageButtons=$$('[data-page]');
 function setPage(page){
   if(page==='extraction'){const target=setPage('recording'),tag=$('[data-tag-settings]');if(tag){tag.open=true;tag.scrollIntoView?.({block:'start'});}extractionView?.paint(readViewState(app));return target;}
   if(!$(`[data-view="${page}"]`))return currentPage;
   currentPage=page;
   recordTabs.hidden=!['recording','dynamic-persona'].includes(page);
   summaryOverview.hidden=recordTabs.hidden;
   if(page==='dynamic-persona')for(const tab of $$('[data-record-tab]'))tab.classList.toggle('active',tab.dataset.recordTab===page);
   else if(page==='recording'&&$('[data-record-tab="dynamic-persona"]').classList.contains('active')){for(const tab of $$('[data-record-tab]'))tab.classList.toggle('active',tab.dataset.recordTab==='compose');for(const p of $$('[data-record-panel]'))p.hidden=p.dataset.recordPanel!=='compose';}
   if(['recall','vectors'].includes(page))void app.refreshVectorStatus?.({cached:true});
   const group=page==='dynamic-persona'?'recording':['people','dialogue','diary','persona-profiles'].includes(page)?'people':RECALL_PAGES.includes(page)?'recall':NAV.includes(page)?page:'modules';
   for(const s of $$('[data-view]'))s.hidden=s.getAttribute('data-view')!==page;
   if($('[data-view="extraction"]'))$('[data-view="extraction"]').hidden=page!=='recording';
   for(const b of pageButtons){const selected=b.getAttribute('data-page')===page||b.closest('.sy-nav')&&b.getAttribute('data-page')===group;b.classList?.toggle('active',Boolean(selected));if(b.closest('.sy-nav'))b.setAttribute('aria-current',selected?'page':'false');}
   if($('[data-open-logs]'))$('[data-open-logs]').hidden=true;
   const chatControls=$('[data-scope]')?.closest?.('.sy-top');if(chatControls)chatControls.hidden=!['recording','current'].includes(page);
   if($('[data-status]'))$('[data-status]').hidden=!['recording','current'].includes(page);
   if(page==='recording'){if(chatControls)chatControls.hidden=false;}
   if(page!=='recording')runtimeLogPage='';
   panel.closest?.('.sy-workbench-content')?.scrollTo?.(0,0);painting.flush();if(page==='dynamic-persona')recordTabs.scrollIntoView?.({block:'start'});return page; }
 for(const b of pageButtons)b.addEventListener?.('click',()=>setPage(b.getAttribute('data-page')));
 for(const b of $$('[data-jump]'))b.addEventListener?.('click',()=>setPage(b.getAttribute('data-jump')));
 // 更新中心里的跳转：把用户送到真正带勾选框与周期的面板。
 for(const b of $$('[data-jump-page]'))b.addEventListener?.('click',()=>setPage(b.getAttribute('data-jump-page')));
 panel.addEventListener('click',e=>{const row=e.target.closest?.('[data-recent-id]');if(row){setPage('memory');management?.edit?.(row.dataset.recentId);}});
 panel.addEventListener('click',e=>{const b=e.target.closest?.('[data-api-jump]');if(b){setPage('api');$(`[data-api-card="${b.dataset.apiJump}"]`)?.scrollIntoView({block:'start'});}});
 // A person-owned record has no tile on this page. Another page can still hand
 // one over to this single editor instead of growing a second editor elsewhere.
 const openMemoryRecord=id=>{const card=readViewState(app).cards.find(c=>c.id===id);if(!card)return false;management?.selectCategory?.(card.category);management?.edit?.(id);return true;};
 for(const f of $$('[data-key]'))f.addEventListener?.('input',()=>{const kind=f.getAttribute('data-key');app.setKey(kind,f.value,$(`[data-setting="${API_INFO[kind].prefix}Endpoint"]`)?.value);resetModels(kind);if(kind==='summary'){resetModels('assistant');resetModels('supplement');}if(['summary','assistant'].includes(kind))resetModels('knowledge');});
 for(const [kind,{prefix}]of Object.entries(API_INFO)){
   for(const f of $$(`[data-api-card="${kind}"] [data-setting], [data-models-url="${kind}"]`))f.addEventListener('input',()=>{if(f.getAttribute('data-setting')!==`${prefix}Model`)resetModels(kind);if(kind==='summary'){resetModels('assistant');resetModels('supplement');}if(['summary','assistant'].includes(kind))resetModels('knowledge');syncInherited();});
   $(`[data-model-list="${kind}"]`)?.addEventListener('change',e=>{if(e.target.value){$(`[data-setting="${prefix}Model"]`).value=e.target.value;dirtyApi.add(`${prefix}Model`);}syncInherited();});
 }
 for(const f of $$('[data-setting]'))f.addEventListener?.('input',()=>{dirtyApi.add(f.dataset.setting);});
 $('[data-search]')?.addEventListener?.('input',()=>painting.request());$('[data-category]')?.addEventListener?.('change',()=>painting.flush());$('[data-conversation]')?.addEventListener?.('change',()=>run(async()=>{await app.selectConversation($('[data-conversation]').value);fill();}));
$('[data-memory-size]')?.addEventListener('change',()=>painting.flush());
for(const [selector,delta]of [['[data-memory-prev]',-1],['[data-memory-next]',1]])$(selector)?.addEventListener('click',()=>{memoryCurrentPage+=delta;painting.flush();});
$('[data-memory-page]')?.addEventListener('change',()=>{memoryCurrentPage=Math.max(1,Math.floor(Number($('[data-memory-page]').value)||1));painting.flush();});
 let timer;$('[data-input]')?.addEventListener?.('input',()=>{clearTimeout(timer);const value=$('[data-input]').value,context=app.draftContext;timer=setTimeout(()=>run(()=>app.setDraft(value,context)),350);});
 const updates=documentRef.createElement('details');updates.className='sy-card';
 updates.innerHTML=`<summary>版本与更新 · ${PRODUCT_VERSION}</summary><p class="sy-help">从 Git 安装后，在酒馆的扩展管理中检查拾忆更新。更新完成，等待当前任务结束、保存设置后重载页面即可生效，不需要重装酒馆。记忆与已保存的 Key 保留。</p><a href="${PRODUCT_REPOSITORY}" target="_blank" rel="noopener noreferrer">安装地址与更新说明</a>`;
 $('[data-view="settings"]')?.appendChild(updates);
 // Populate the real form at mount, before any explicit chat binding or request.
 presetView=mountSummaryPresets({panel,app,run,host,download});mergeView=mountMergeManagement({panel,app,run,host});recallView=mountRecallView({panel,app,run,setPage,host,download});logView=mountRuntimeLog({panel,app,run,host,download});management=mountMemoryManagement({panel,app,run,host});
 // 「新增记忆」在工具栏里，但表单本体只有一份：把它移进工具条内的容器。
 if($('[data-add-memory-body]')&&$('[data-add-memory-body-fields]'))$('[data-add-memory-body]').append($('[data-add-memory-body-fields]'));
 dictionaryView=mountDictionary({panel,app,run,save:async input=>{if(dirtyApi.has('aliases'))throw new Error('字典高级文本尚未保存，请先保存字典设置');await app.saveDictionaryEntry(input);$('[data-setting="aliases"]').value=readViewState(app).settings.aliases;}});customManagement=mountCustomModules({panel,app,run,host,download,onAssistant:async text=>{await app.setDraft(text);fill();setPage('assistant');}});fill();paint(readViewState(app));
 personEditor=mountPersonEditor({panel,app,run});
 journalView=mountCharacterJournal({panel,app,run,host});
 peopleView=mountPeopleView({panel,app,run,host,setPage:page=>{setPage(page);if(page==='dynamic-persona')$('[data-persona-controls]').open=true;},onSelect:({name,profileId,kind})=>{
   if(kind==='facts'){$('[data-search]').value=name;$('[data-category]').value='entityFactChanges';cardStamp='';setPage('memory');return;}
   if(kind==='dynamic-persona'){setPage(profileId?'persona-profiles':'dynamic-persona');dynamicPersonaView.focus?.(profileId??name);return;}
   setPage(kind);journalView.selectPerson?.(kind,name);
 }});
 extractionView=mountExtractionView({panel,app,run,host,download});
 knowledgeView=mountKnowledgeView({panel,app,run,host});
 floating=mountFloatingProduct({panel,documentRef,host,version:PRODUCT_VERSION,onOpen:()=>{painting.flush();void app.followCurrentChat?.().catch(e=>feedback(`聊天记忆读取未完成：${failureText(e)}`,'warning'));},onClose:()=>painting.request(),onStop:()=>run(()=>app.stop()),onLogs:()=>{openLogs();}});floating.setNotice(noticeText,noticeLevel);
 let destroyed=false;
 Promise.resolve(app.loadApiSettings?.()).then(()=>{if(!destroyed){fill({apiOnly:true});paint(readViewState(app));return app.startChatTracking?.();}}).catch(e=>{if(!destroyed)feedback(`读取全局配置失败：${failureText(e)}`,'error');});
 return {panel,application:app,controller:controller??app.core,setPage,floating,openMemoryRecord,
   async destroy(){destroyed=true;painting.dispose();clearTimeout(timer);resetAllModels();floating.destroy();await app.dispose?.();}};
}
