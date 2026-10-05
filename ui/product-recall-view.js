import { readViewState } from '../src/product-view-scheduling.js';
import { esc,button,settingsSection } from '../src/product-settings-ui.js';
import { dictionaryHTML } from './product-management.js';
import { dictionaryQuery } from '../src/product-dictionary.js';
import { injectionLogHTML, mountInjectionLog } from './product-injection-log.js';

const tabs=[['recall','概览'],['dictionary','字典'],['vectors','向量'],['retrieval','策略'],['injection','注入'],['current','本轮']];
export const RECALL_PAGES=tabs.map(([page])=>page);
export function recallSectionsHTML(){return `
  <section data-view="recall" hidden><h3>记忆召回</h3><div data-recall-overview></div><p class="sy-help">完整纪要留在记忆中，本轮只带入相关内容。</p><div class="sy-recall-links">${[['dictionary','字典与标签','查看名称、别称和资料关联'],['vectors','向量索引','检查哪些记忆已可按语义查找'],['retrieval','召回策略','关键词、标签、分类和重排'],['current','本轮注入','查看命中、去重、篇幅与耗时']].map(([page,title,help])=>`<button type="button" data-recall-jump="${page}"><span>${title}<small>${help}</small></span><span aria-hidden="true">›</span></button>`).join('')}</div><button type="button" data-recall-jump="world">管理世界与知识库</button></section>
  <section data-view="dictionary" hidden><h3>字典与标签</h3><details class="sy-card"><summary>试试一句话会命中什么</summary><input data-dictionary-query aria-label="字典匹配测试" placeholder="输入人物别称或剧情关键词"><div data-dictionary-match class="sy-help" role="status"></div><p class="sy-help">本地匹配，不调用 API；命中人物不代表该人物在场或知情。</p></details>${dictionaryHTML()}<details class="sy-card"><summary>字典设置与高级文本</summary>${settingsSection('dictionary')}${button('save-settings','保存字典设置',true)}</details></section>
  <section data-view="vectors" hidden><h3>向量索引</h3><div data-vector-overview></div>${settingsSection('vectors')}<div class="sy-actions">${button('save-settings','保存向量设置',true)}${button('vector-status','刷新状态')}${button('vectors','建立 / 更新索引')}<button type="button" data-vector-retry-all>重试全部未完成</button>${button('stop','停止')}</div><p class="sy-help">开启向量召回与后台更新后自动维护。按记忆记录建索引，一次向量请求可处理多条；不是重新总结。</p><button type="button" data-recall-jump="api">配置向量 API 与模型</button><details class="sy-advanced"><summary>索引维护</summary><p class="sy-help">服务更换了向量维度时，可重建当前聊天的派生索引。会调用向量 API，不删除记忆。</p><button type="button" data-vector-rebuild>重建全部索引</button></details><details class="sy-card" open><summary>索引中的记忆</summary><input data-vector-search aria-label="搜索索引" placeholder="搜索记忆标题"><select data-vector-filter aria-label="筛选索引状态"><option value="all">全部</option><option value="unfinished">全部未完成</option><option value="failed">失败项</option><option value="indexed">已索引</option><option value="stale">内容已改变</option><option value="missing">尚未索引</option><option value="excluded">已排除</option></select><div data-vector-entries></div><div class="sy-actions"><button type="button" data-vector-prev>上一页</button><span data-vector-page></span><button type="button" data-vector-next>下一页</button></div></details><p class="sy-help">“已索引”是本机索引状态，不代表 API 已连接成功。修改记忆后自动更新对应索引；DIY 排除、单项重试和重建入口仍保留。</p></section>`;}

const indexLabels={no_chat:'请先打开聊天',not_checked:'待检查',unavailable:'暂不可用',empty:'没有可索引的记忆',pending:'待补建',ready:'索引完整',updating:'后台更新中',error:'更新未完成',stopped:'已停止',mixed:'向量维度不一致'};
export function mountRecallView({panel,app,run,setPage,download,host=globalThis}){
  const $=s=>panel.querySelector?.(s);
  $('[data-view="current"]').insertAdjacentHTML('beforeend',injectionLogHTML());
  const injectionView=mountInjectionLog({panel,app,run,host,download});
  for(const page of RECALL_PAGES){const section=$(`[data-view="${page}"]`);if(!section)continue;const nav=panel.ownerDocument.createElement('nav');nav.className='sy-subnav';nav.setAttribute('aria-label','召回导航');nav.innerHTML=tabs.map(([id,label])=>`<button type="button" data-recall-page="${id}" ${id===page?'class="active" aria-current="page"':''}>${label}</button>`).join('');section.prepend(nav);for(const b of nav.querySelectorAll('button'))b.addEventListener('click',()=>setPage(b.dataset.recallPage));}
  for(const b of panel.querySelectorAll('[data-recall-jump]'))b.addEventListener('click',()=>setPage(b.dataset.recallJump));
  $('[data-vector-rebuild]')?.addEventListener('click',()=>{if(host.confirm?.('重建当前聊天全部向量索引？会调用已配置的向量 API，记忆正文保留。'))void run(()=>app.buildVectors({rebuild:true}),{name:'vectors'});});
  let rowVersion=0,rowPage=1,indexStamp='',lastState=null;
  $('[data-vector-retry-all]')?.addEventListener('click',event=>void run(()=>app.retryVectors(),{name:'vectors',button:event.currentTarget}));
  $('[data-vector-entries]')?.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.vectorRetry)void run(()=>app.retryVectors([b.dataset.vectorRetry]),{name:'vectors',button:b});if(b.dataset.vectorExclude)void run(async()=>{await app.excludeVector(b.dataset.vectorExclude,b.dataset.excluded!=='true');await loadRows();});if(b.dataset.vectorSource){setPage(b.dataset.vectorCategory==='knowledge'?'world':'memory');if(b.dataset.vectorCategory!=='knowledge')panel.dispatchEvent(new panel.ownerDocument.defaultView.CustomEvent('shiyi-edit-memory',{detail:b.dataset.vectorSource}));}});
  async function loadRows(){
    const version=++rowVersion;
    if(!lastState?.chatReady){$('[data-vector-entries]').textContent='打开聊天后查看对应索引。';$('[data-vector-page]').textContent='';return;}
    try{const result=await app.listVectorEntries({query:$('[data-vector-search]')?.value,status:$('[data-vector-filter]')?.value,page:rowPage});if(version!==rowVersion)return;rowPage=result.page;
      $('[data-vector-entries]').innerHTML=result.rows.map(row=>`<div class="sy-info-row"><span>${({failed:'失败',indexed:'已索引',stale:'待更新',missing:'未索引',excluded:'已排除'})[row.status]}</span><strong>${esc(row.title)}</strong>${row.error?`<small class="sy-vector-error">${esc(row.error)}</small>`:""}${row.segments>1?`<small>${row.segments} 段全文索引</small>`:""}${["failed","missing","stale"].includes(row.status)?`<button type="button" data-vector-retry="${esc(row.id)}">重试此项</button>`:""}<button type="button" data-vector-source="${esc(row.id)}" data-vector-category="${esc(row.category)}">修改原记忆</button><button type="button" data-vector-exclude="${esc(row.id)}" data-excluded="${row.status==='excluded'}">${row.status==='excluded'?'恢复索引':'排除向量'}</button></div>`).join('')||'<p class="sy-help">没有符合条件的记忆。</p>';
      $('[data-vector-page]').textContent=`${result.page} / ${result.pages} · ${result.total} 条`;
      $('[data-vector-prev]').disabled=result.page===1;$('[data-vector-next]').disabled=result.page===result.pages;
    }catch{if(version===rowVersion)$('[data-vector-entries]').textContent='索引暂不可读，检查配置后刷新。';}
  }
  $('[data-vector-search]')?.addEventListener('input',()=>{rowPage=1;void loadRows();});
  $('[data-vector-filter]')?.addEventListener('change',()=>{rowPage=1;void loadRows();});
  $('[data-vector-prev]')?.addEventListener('click',()=>{rowPage--;void loadRows();});$('[data-vector-next]')?.addEventListener('click',()=>{rowPage++;void loadRows();});
  function match(){const query=$('[data-dictionary-query]')?.value??'',dict=readViewState(app).dictionary??{};if(!$('[data-dictionary-match]'))return;const found=dictionaryQuery(query,dict);$('[data-dictionary-match]').textContent=query?[...found.terms.map(t=>`${t.matched.join('、')} → ${t.name}`),...found.ambiguities.map(a=>`${a.name} 有歧义：${a.owners.join('、')}`),found.tags.length?`标签：${found.tags.join('、')}`:''].filter(Boolean).join('\n')||'没有命中词条；仍可通过普通关键词或向量检索。':'输入后立即查看匹配结果。';}
  $('[data-dictionary-query]')?.addEventListener('input',match);
  function paint(s){
    lastState=s;
    if(!$('[data-view="current"]').hidden)injectionView.paint(s);
    if(!$('[data-view="dictionary"]').hidden)match();
    const vectors=!$('[data-view="vectors"]').hidden,overview=!$('[data-view="recall"]').hidden;
    if(!vectors&&!overview)return;
    const v=s.vectorIndex??{},label=v.automatic&&v.status!=='updating'?'等待后台自动续建':indexLabels[v.status]??'待检查';
    const row=(name,value)=>`<div class="sy-info-row"><span>${name}</span><strong>${esc(value)}</strong></div>`;
    const mode=s.settings.vectorEnabled?'已开启':'未开启';
    if(vectors){
    $('[data-vector-retry-all]').disabled=s.busy||s.vectorIndex?.status==='updating'||!s.chatReady;
    $('[data-vector-overview]').innerHTML=`<div class="sy-card sy-index-status">${row('向量召回',mode)}${row('索引状态',label)}${row('当前模型',s.settings.embeddingModel||'未配置')}${v.rebuilding?row('重建暂存','全部完成后替换旧索引'):''}${row('索引进度',Number.isInteger(v.total)?`${v.indexed??0} / ${v.total}`:'尚未检查')}${row('后台剩余',v.pending??'—')}${v.automatic?'<p class="sy-help">自动续建中，无需逐批补建。临时服务错误会冷却后重试，已有记忆正常保留。</p>':''}${v.stale?row('内容已改变',v.stale):''}${v.dimensions?.length?row('向量维度',v.dimensions.join(' / ')):''}${v.message?`<p class="sy-help" role="status">${esc(v.message)}</p>`:''}</div>`;
    }
    if(overview){const n=s.dictionary?.entries?.filter(e=>!e.disabled).length??0;
    $('[data-recall-overview]').innerHTML=`<div class="sy-card">${row('自动注入',s.enabled&&s.settings.injectionEnabled?'已开启':'未开启')}${row('关键词检索','本地 BM25')}${row('有效字典',`${n} 个词条 · ${s.dictionary?.tags?.length??0} 个标签`)}${row('向量召回',`${mode} · ${label}`)}${row('重排',s.settings.rerankEnabled?'已开启（调用时验证）':'未开启')}${row('分类检索',s.settings.distributedEnabled&&s.settings.distributedStrategy!=='disabled'?'已开启':'未开启')}${row('最近一次注入',s.actual?`${s.actual.cards.length} 条 · ${Math.round(s.actual.trace?.timings?.recallMs??0)} ms`:'尚无记录')}</div>`;
    }
    const stamp=JSON.stringify([s.vectorIndex,s.chatReady]);if(vectors&&stamp!==indexStamp){indexStamp=stamp;void loadRows();}
  }
  return {paint};
}
