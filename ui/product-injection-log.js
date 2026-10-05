import { readViewState } from '../src/product-view-scheduling.js';
import { esc } from '../src/product-settings-ui.js';
import {INJECTION_DETAIL_LABELS} from '../src/product-injection-log.js';
const status={prepared:'已加入待发送请求',empty:'未找到可注入内容',disabled:'记忆注入未启用',stale:'正文已变化，未注入',unavailable:'聊天不可用',failed:'检索失败，未注入',changed:'处理中聊天或配置变化',auxiliary:'变量更新任务，跳过记忆与人设注入'};
export function injectionDiagnostics(e){
  const ms=v=>Number.isFinite(v)?`${Math.round(v)} ms`:'未记录';
  const p=e.preparation,b=e.budget,c=e.characters;
  const source=({chat_source:'已核对聊天原输入',request_before_rules:'固定规则之前的请求',request_user:'请求末尾用户消息，未匹配聊天原输入'})[e.querySource]??'旧日志未记录';
  return `<p class="sy-help">查询来源：${esc(source)}${e.queryChars>800?`；原查询 ${e.queryChars} 字符，日志仅留前 800 字符`:''}。</p>
  <p class="sy-help">人物当前属性 ${c?.people??0} 人 / ${c?.records??0} 项 / ${c?.units??0} 估算单位；普通记忆与额外台词${b?` ${b.ordinaryUnits??'未知'} / ${b.ordinaryLimit??e.budgetUnits}`:`预算 ${e.budgetUnits}`}。人物属性、知情的明确背景及只读外部状态（${b?.externalUnits??'未记录'} 单位）单独计量；估算单位不是接口精确 Token。</p>
  <p class="sy-help">${p?`拾忆入口总等待 ${ms(p.totalMs)}；人设 ${ms(p.personaMs)} / 模块同步 ${ms(p.syncMs)} / 查询准备 ${ms(p.sourceMs)} / 召回 ${ms(p.recallMs)}。后台可见性记录 ${ms(p.hiddenMs)}，切换 ${p.visibilityChanges??0} 次；墙钟时间包含挂起，不能视为 CPU 耗时。`:'旧日志未记录人设阶段与前后台切换，无法将等待全部归因于计算。'}检索前准备 ${ms(e.timings?.prepareMs)} / 结果组装 ${ms(e.timings?.packingMs)} / 索引退出等待 ${ms(e.timings?.backgroundWaitMs)}。</p>`;
}
export function injectionLogHTML(){return `<h3>逐次注入日志</h3><p class="sy-help">只记录本聊天。可以核对具体片段、来源和耗时；“已加入”不等于模型服务已经收到。最近 30 次，较大的记录会提前淘汰旧项。</p><div class="sy-actions"><button type="button" data-injection-export>导出调试日志</button><button type="button" data-injection-clear>清空日志</button></div><label class="sy-check"><input type="checkbox" data-injection-content>导出时包含剧情查询和注入正文</label><p data-injection-storage class="sy-help"></p><div data-injection-history></div><div class="sy-actions"><button type="button" data-injection-prev>上一页</button><span data-injection-page></span><button type="button" data-injection-next>下一页</button></div>`;}
export function mountInjectionLog({panel,app,run,host,download}){
  const $=s=>panel.querySelector?.(s);let page=1,current=null,stamp='',opened=new Set();
  function paint(state){current=state;const log=state.injectionLog,items=[...(log?.entries??[])].reverse(),pages=Math.max(1,Math.ceil(items.length/5));page=Math.min(page,pages);
    const signature=JSON.stringify([log,page]);if(signature===stamp)return;stamp=signature;
    if($('[data-injection-storage]'))$('[data-injection-storage]').textContent=!state.chatReady?'打开聊天后查看对应日志。':({saved:'已保存到本聊天。',ready:'已读取本聊天日志。',unavailable:'日志存储不可读，本次只在内存保留，可导出。',failed:'日志保存未通过确认，请及时导出。'})[log?.persistence]??'';
    const lines=items.slice((page-1)*5,page*5);
    if($('[data-injection-history]'))$('[data-injection-history]').innerHTML=lines.map(e=>`<details class="sy-card" data-injection-row="${esc(e.id)}" ${opened.has(e.id)?'open':''}><summary>${esc(status[e.status])}<small>${esc(new Date(e.at).toLocaleString())} · ${e.chars} 字符 · ${Math.round(e.elapsedMs)} ms${e.degraded?' · 检索降级':''}</small></summary><p class="sy-help">版本 ${esc(e.version)} · ${e.selectedCount??e.selected.length} 条 · 去重 ${e.duplicates} 条 · 预算 ${e.budgetUnits}</p><p class="sy-help">关键词 ${Math.round(e.timings.localMs)} ms / 向量 ${Math.round(e.timings.vectorMs)} ms / 重排 ${Math.round(e.timings.rerankMs)} ms</p><p class="sy-help">知情关联背景：${e.knowledgeContext?.events??0} 件 · ${e.knowledgeContext?.units??0} 估算单位（随知情带入）；未关联事件的知情 ${e.knowledgeContext?.unresolved??0} 条，可能是独立命题或属性知情。</p>${injectionDiagnostics(e)}${e.personaText?`<details><summary>本次选用的人设正文</summary><p class="sy-help">包含替换原书与补充的档案；不是净新增篇幅，也不是宿主完整请求。</p><div class="sy-packet">${esc(e.personaText)}${e.personaTextTruncated?'（日志展示已截断）':''}</div></details>`:''}<p>字典：${esc(e.dictionary.join('、')||'未命中')}；标签：${esc(e.tags.join('、')||'未触发')}</p><details><summary>本次查询</summary><div class="sy-packet">${esc(e.query||'没有查询')}</div></details><details open><summary>实际加入的记忆正文</summary><div class="sy-packet">${esc(e.text||'本次未加入记忆')}${e.contentTruncated?'\n（日志展示已截断，原请求未截断）':''}</div></details><details><summary>选中来源与候选处理</summary>${e.selected.map(c=>`<p>${esc(c.title)}${c.sourceFloors.length?` · 第 ${c.sourceFloors.join('、')} 楼`:''}</p>`).join('')}${e.decisions.map(d=>`<div class="sy-info-row"><span>${({selected:'已选',duplicate:'去重',name_only:'无当前主题依据（本地）',budget:'篇幅不足',limit:'数量上限'})[d.status]}</span><strong>${esc(d.title)}<small class="sy-help">${esc(d.reason)}${d.detail?` · ${esc(INJECTION_DETAIL_LABELS[d.detail])}`:''}${Object.entries(d.scores??{}).filter(([,v])=>v!==null).map(([k,v])=>` · ${({keyword:'词匹配',vector:'语义',fusion:'融合',final:'最终'})[k]} ${Number(v).toFixed(4)}`).join('')}</small></strong></div>`).join('')}</details><button type="button" data-injection-delete="${esc(e.id)}">删除本条日志</button></details>`).join('')||'<p class="sy-empty">还没有记录。聊天请求经过拾忆的注入入口后会在此出现；手动预览不算实际注入。</p>';
    for(const row of panel.querySelectorAll('[data-injection-row]')){
      const entry=lines.find(e=>e.id===row.dataset.injectionRow);
      if(entry?.persona){const p=panel.ownerDocument.createElement('p');p.className='sy-help';p.textContent=`动态人设：替换 ${entry.persona.replaced} 份 · 补充 ${entry.persona.supplemental} 份。${entry.persona.profiles.map(c=>`${c.name||c.id}（依据至 #${c.through}，${c.mode==='replacement'?'替换':'补充'}，${c.chars} 字符）`).join('；')}`;row.querySelector(':scope > p.sy-help').after(p);}
      if(entry?.importantDialogues?.count){const p=panel.ownerDocument.createElement('p');p.className='sy-help';p.textContent=`人物重要对话：额外带入 ${entry.importantDialogues.count} 句 · ${entry.importantDialogues.units} 估算单位，未新增模型调用。`;row.querySelector(':scope > p.sy-help').after(p);}
      if(entry?.characters?.full)row.querySelector(':scope > p.sy-help').textContent=`版本 ${entry.version} · 人物全量 ${entry.characters.people} 人 / ${entry.characters.records} 项 · 历史记忆 ${entry.memorySelected} 条 · 去重 ${entry.duplicates} 条 · 历史预算 ${entry.budgetUnits}${entry.selectedCount>entry.selected.length?' · 来源列表仅展示前 100 项，注入正文不受此限制':''}`;
      if(entry?.eventPacket?.savedChars){const p=panel.ownerDocument.createElement('p');p.className='sy-help';p.textContent=`同事件归组：${entry.eventPacket.groupedRecords} 条，去掉 ${entry.eventPacket.sharedLines} 行重复说明，减少 ${entry.eventPacket.savedChars} 字符；未改动记忆原文。`;row.querySelector(':scope > p.sy-help').after(p);}
      if(entry?.quarantinedLinks){const p=panel.ownerDocument.createElement('p');p.className='sy-help';p.textContent=`关联隔离：本聊天检测到 ${entry.quarantinedLinks} 处缺少主题及同楼依据的知情—事件关联，不随对应事件注入。知情记录仍保留，未删除或改写。`;row.querySelector(':scope > p.sy-help').after(p);}
      row.addEventListener('toggle',()=>{row.open?opened.add(row.dataset.injectionRow):opened.delete(row.dataset.injectionRow);});
    }
    for(const b of panel.querySelectorAll('[data-injection-delete]'))b.addEventListener('click',()=>run(()=>app.removeInjectionLog(b.dataset.injectionDelete)));
    const _injPage=$('[data-injection-page]'),_injPrev=$('[data-injection-prev]'),_injNext=$('[data-injection-next]');
    if(_injPage)_injPage.textContent=`${page} / ${pages} · ${items.length} 次`;
    if(_injPrev)_injPrev.disabled=page===1;
    if(_injNext)_injNext.disabled=page===pages;
  }
  for(const [sel,delta] of [['[data-injection-prev]',-1],['[data-injection-next]',1]])$(sel)?.addEventListener('click',()=>{page+=delta;paint(current??readViewState(app));});
  $('[data-injection-clear]')?.addEventListener('click',()=>run(async()=>{if(host.confirm?.('只清空本聊天的注入日志？已保存记忆、总结和聊天原文不变。'))await app.clearInjectionLog();}));
  $('[data-injection-export]')?.addEventListener('click',()=>run(async()=>{const includeContent=$('[data-injection-content]')?.checked;if(includeContent&&!host.confirm?.('导出文件将包含剧情查询、记忆正文及人物名称。确认后再分享给他人。'))return;await download(await app.exportInjectionLog({includeContent}),'拾忆-注入日志.json');}));
  return {paint};
}
