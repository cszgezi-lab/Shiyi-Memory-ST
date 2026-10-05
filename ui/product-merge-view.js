import { readViewState } from '../src/product-view-scheduling.js';
import { esc } from '../src/product-settings-ui.js';
import { MERGE_STATUS } from '../src/product-event-merge.js';
import { narrativeText } from '../src/product-narrative.js';

export function mergeManagementHTML(){return `<h3>事件合并</h3><p class="sy-help">总结先保存，合并单独处理。这里核对同一件事的补充与复述；不改动聊天原文或原始批次。</p><div class="sy-actions"><button type="button" data-merge-retry-all>处理待办 / 重试失败</button><button type="button" data-merge-stop>停止</button></div><label class="sy-field"><span>显示</span><select data-merge-filter><option value="pending">待处理</option><option value="merged">已合并</option><option value="all">全部</option></select></label><p data-merge-total class="sy-help" role="status"></p><div data-merge-list></div><div class="sy-actions"><button type="button" data-merge-prev>上一页</button><span data-merge-page></span><button type="button" data-merge-next>下一页</button></div>`;}

export function mountMergeManagement({panel,app,run,host}){
  const $=s=>panel.querySelector?.(s);let page=1,last='',scope='';
  $('[data-merge-retry-all]')?.addEventListener('click',e=>run(()=>app.retryMerges(),{name:'merge',button:e.currentTarget}));
  $('[data-merge-stop]')?.addEventListener('click',()=>run(()=>app.stop()));
  $('[data-merge-filter]')?.addEventListener('change',()=>{page=1;paint(readViewState(app));});
  $('[data-merge-prev]')?.addEventListener('click',()=>{page--;paint(readViewState(app));});
  $('[data-merge-next]')?.addEventListener('click',()=>{page++;paint(readViewState(app));});
  function paint(s){
    const next=JSON.stringify(s.core?.scope);if(next!==scope){scope=next;page=1;last='';}
    const filter=$('[data-merge-filter]')?.value??'all',all=s.merges??[];
    const rows=all.filter(j=>filter==='all'||filter==='merged'?filter==='all'||j.status==='merged':['pending','failed','uncertain','missing'].includes(j.status));
    const pages=Math.max(1,Math.ceil(rows.length/10));page=Math.max(1,Math.min(page,pages));
    const stamp=JSON.stringify([all,page,filter,s.busy]);if(stamp===last)return;last=stamp;
    if($('[data-merge-total]'))$('[data-merge-total]').textContent=`待处理 ${all.filter(j=>['pending','failed','uncertain','missing'].includes(j.status)).length} 对 · 已合并 ${all.filter(j=>j.status==='merged').length} 对；每次最多处理 10 对。`;
    if($('[data-merge-retry-all]'))$('[data-merge-retry-all]').disabled=s.busy||!s.chatReady;
    const _pageEl=$('[data-merge-page]'),_prevEl=$('[data-merge-prev]'),_nextEl=$('[data-merge-next]');
    if(_pageEl)_pageEl.textContent=`${page} / ${pages}`;
    if(_prevEl)_prevEl.disabled=page===1;
    if(_nextEl)_nextEl.disabled=page===pages;
    const _listEl=$('[data-merge-list]');
    if(_listEl)_listEl.innerHTML=rows.slice((page-1)*10,page*10).map(j=>`<details class="sy-card" data-merge-row="${esc(j.id)}" ${open.has(j.id)?'open':''}><summary>${esc(j.fromTitle)}<span class="sy-help">${MERGE_STATUS[j.status]}</span></summary><p>目标：${esc(j.targetTitle)}</p><p class="sy-help">本条时间：${esc(narrativeText(j.fromTime)||'未提取')}<br>目标时间：${esc(narrativeText(j.toTime)||'未提取')}</p><p>${esc(j.reason)}</p><div class="sy-actions"><button type="button" data-merge-retry ${s.busy||j.status==='missing'?'disabled':''}>只重试合并</button><button type="button" data-merge-separate ${s.busy?'disabled':''}>${j.status==='merged'?'撤销合并':'保持独立'}</button></div><details data-merge-target-editor><summary>改选合并目标</summary><label class="sy-field"><span>搜索事件</span><input data-merge-search placeholder="标题或关键词"></label><label class="sy-field"><span>目标记录</span><select data-merge-target aria-label="合并目标"></select></label><button type="button" data-merge-target-save ${s.busy?'disabled':''}>保存目标</button></details></details>`).join('')||'<p class="sy-empty">暂无合并任务。总结模型提出的跨批合并会自动出现在这里。</p>';
    for(const row of panel.querySelectorAll('[data-merge-row]')){
      const id=row.dataset.mergeRow;
      row.querySelector('[data-merge-retry]').addEventListener('click',e=>run(()=>app.retryMerges([id]),{name:'merge',button:e.currentTarget}));
      row.querySelector('[data-merge-separate]').addEventListener('click',()=>run(async()=>{if(host.confirm?.('保持两条原记录独立？如已合并，将撤销该合并关系。'))await app.keepMergeSeparate(id);},{name:'merge'}));
      const fill=()=>{const q=row.querySelector('[data-merge-search]').value.trim();row.querySelector('[data-merge-target]').innerHTML='<option value="">请选择</option>'+(readViewState(app).records.events??[]).filter(e=>e.id!==id&&`${e.title??''} ${e.description??''}`.includes(q)).slice(0,30).map(e=>`<option value="${esc(e.id)}">${esc(e.title||e.description?.slice(0,80)||'事件')}</option>`).join('');};
      row.querySelector('[data-merge-target-editor]').addEventListener('toggle',e=>{if(e.currentTarget.open)fill();});
      row.querySelector('[data-merge-search]').addEventListener('input',fill);
      row.querySelector('[data-merge-target-save]').addEventListener('click',()=>run(()=>app.chooseMergeTarget(id,row.querySelector('[data-merge-target]').value),{name:'merge'}));
    }
  }
  return {paint};
}
