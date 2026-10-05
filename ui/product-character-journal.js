import { characterKeepsakes } from '../src/character-journal.js';
import { sha256 } from '../src/utils.js';
import { readViewState } from '../src/product-view-scheduling.js';
import { recordTitle,sourceLabel,narrativeText } from '../src/product-narrative.js';
import { esc,field } from '../src/product-settings-ui.js';
import {foldName} from '../src/persona-identity.js';
import {peopleGroups} from './product-people-view.js';

export function characterJournalHTML(){return ['dialogue','diary'].map(kind=>`<section data-view="${kind}" hidden data-keepsake="${kind}"><div class="sy-top"><h3>${kind==='dialogue'?'关键对话':'角色心迹'}</h3><button type="button" data-jump="people">返回人物</button></div><p class="sy-help">${kind==='dialogue'?'保留重要原话、双方回应与关系边界。仍重要的台词随相关人物带入；不要求每轮复读。':'按角色和阶段查看内心变化。日记式演绎参考，不代表剧情中实际写过日记；私密想法不会赋予他人知情。'}</p><div class="sy-filters"><input data-keepsake-search placeholder="搜索角色、台词、阶段…" aria-label="搜索${kind==='dialogue'?'关键对话':'角色心迹'}"><button type="button" data-keepsake-add>新增${kind==='dialogue'?'台词':'心迹'}</button></div><p data-keepsake-count class="sy-help" role="status"></p><div data-keepsake-new></div><div data-keepsake-list></div><div class="sy-actions"><button type="button" data-keepsake-prev>上一页</button><button type="button" data-keepsake-next>下一页</button></div></section>`).join('');}
const input=(key,label,value='',multi=false)=>field(label,multi?`<textarea rows="4" data-keep-field="${key}">${esc(value)}</textarea>`:`<input data-keep-field="${key}" value="${esc(value)}">`);
const select=(key,label,options,value)=>field(label,`<select data-keep-field="${key}">${options.map(([v,l])=>`<option value="${v}" ${v===value?'selected':''}>${l}</option>`).join('')}</select>`);
export function mountCharacterJournal({panel,app,run,host}){
  const panes=new Map();
  for(const kind of ['dialogue','diary']){
    const root=panel.querySelector?.(`[data-keepsake="${kind}"]`),$=s=>root?.querySelector?.(s);
    if(!root)continue;
    const state={page:1,stamp:'',scope:null,rows:[],drafts:new Map(),snapshot:null,person:''};panes.set(kind,state);
    function editor(key,d){
      const data=d.data??{},fresh=key==='new';
      return `<div class="sy-card sy-keepsake-editor" data-keep-editor="${esc(key)}">${fresh&&kind==='dialogue'?field('关联事件或关系',`<select data-keep-parent>${state.snapshot.cards.filter(c=>['events','relationshipChanges','personaChanges','performanceHints'].includes(c.category)&&!c.mergedIds?.length).map(c=>`<option value="${esc(c.id)}" ${c.id===d.recordId?'selected':''}>${esc(recordTitle(c))}</option>`).join('')}</select>`):''}${kind==='dialogue'?input('speaker','说话人',data.speaker)+input('to','对谁说',data.to)+input('text','台词原话',data.text,true)+input('context','当时语境与对方回应',data.context,true)+input('meaning','重要之处',data.meaning,true)+select('status','后续使用',[['active','仍重要 · 随相关人物带入'],['historical','过去阶段 · 按需召回']],data.status??'active'):(fresh?input('subject','所属角色',d.subject)+input('target','涉及对象（可留空）',d.target):'')+input('stage','阶段名称（可自由填写）',data.stage)+input('text','角色心迹',data.text,true)+input('cause','变化缘由／对应经历',data.cause,true)+select('status','阶段',[['current','按本条情境适用'],['historical','过去阶段']],data.status??'current')}<p class="sy-help">手工新增或修改会标为用户编写，保留原记录来源。不会替其他角色增加知情。</p><div class="sy-actions"><button type="button" data-keep-save="${esc(key)}">保存</button><button type="button" data-keep-cancel="${esc(key)}">取消</button></div></div>`;
    }
    function capture(node){
      const key=node.dataset.keepEditor,d=state.drafts.get(key);if(!d)return;
      for(const e of node.querySelectorAll('[data-keep-field]')){if(['subject','target'].includes(e.dataset.keepField))d[e.dataset.keepField]=e.value;else d.data[e.dataset.keepField]=e.value;}
      const parent=node.querySelector('[data-keep-parent]');if(parent){d.recordId=parent.value;d.expected=sha256(state.snapshot.cards.find(c=>c.id===parent.value));}
    }
    function draw(s){
      state.snapshot=s;const scope=JSON.stringify(s.scope??app.core?.state?.scope??null);
      if(state.scope!==scope){state.drafts.clear();state.page=1;state.scope=scope;state.stamp='';state.person='';}
      const stamp=JSON.stringify([s.cardRevision??s.cards,$('[data-keepsake-search]').value,state.page,[...state.drafts.keys()]]);if(stamp===state.stamp)return;state.stamp=stamp;
      const all=characterKeepsakes(s.cards),q=foldName($('[data-keepsake-search]').value);
      const group=state.person?peopleGroups(s).find(g=>foldName(g.name)===foldName(state.person)):null;
      const selected=new Set((group?.[kind==='dialogue'?'dialogues':'diaries']??[]).map(r=>r.id));
      state.rows=(kind==='dialogue'?all.dialogues:all.diaries).filter(r=>state.person?selected.has(r.id):foldName(`${r.subject} ${r.target} ${JSON.stringify(r.data)}`).includes(q));
      const pages=Math.max(1,Math.ceil(state.rows.length/12));state.page=Math.min(state.page,pages);
      $('[data-keepsake-count]').textContent=`${state.rows.length} 项 · ${state.page} / ${pages} 页`;
      $('[data-keepsake-prev]').disabled=state.page===1;$('[data-keepsake-next]').disabled=state.page===pages;
      $('[data-keepsake-list]').innerHTML=state.rows.slice((state.page-1)*12,state.page*12).map(r=>{
        const d=r.record.innerLifeHistorical?{...r.data,status:'historical'}:r.data,basis=({observed:'依据正文',character_claim:'角色自述',inferred:'演绎推测，非事实',user_asserted:'用户编写'})[d.basis]??'';
        const body=kind==='dialogue'?`<blockquote>${esc(d.text)}</blockquote><p>${esc(d.context??'')}</p>${d.meaning?`<p class="sy-help">${esc(d.meaning)}</p>`:''}`:`<p class="sy-help">${esc(basis)} · ${d.origin==='stage_observation'?'阶段观察（非逐字心声）':d.origin==='source_monologue'?'原文明示心声':'私密心迹'}</p><div class="sy-narrative">${esc(d.text)}</div>${d.cause?`<p>缘由：${esc(d.cause)}</p>`:''}`;
        return `<article class="sy-card" data-keep-row="${esc(r.id)}"><span class="sy-tag">${d.disabled?'不再注入':d.status==='historical'?'过去阶段':kind==='dialogue'?'仍重要':'情境阶段'}</span><h4>${esc(r.subject)}${r.target?` → ${esc(r.target)}`:''}${kind==='diary'?` · ${esc(d.stage)}`:''}</h4>${body}<p class="sy-help">${esc(sourceLabel(r.record))}${r.record.temporal?` · ${esc(narrativeText(r.record.temporal))}`:''}</p>${kind==='dialogue'&&d.provenance==='user_authored'?'<p class="sy-help">用户编写，非程序核对的逐字原文</p>':''}<details><summary>关联记忆</summary><p>${esc(r.record.description??'')}</p></details><div class="sy-actions"><button type="button" data-keep-edit="${esc(r.id)}">修改</button><button type="button" data-keep-delete="${esc(r.id)}">删除</button><button type="button" data-keep-toggle="${esc(r.id)}">${d.disabled?'恢复注入':'不再注入'}</button></div>${state.drafts.has(r.id)?editor(r.id,state.drafts.get(r.id)):''}</article>`;
      }).join('')||'<p class="sy-empty">暂无记录。新总结会按预设提取，也可手动添加；旧内容不会自动调用模型重写。</p>';
      $('[data-keepsake-new]').innerHTML=state.drafts.has('new')?editor('new',state.drafts.get('new')):'';
    }
    state.draw=draw;
    root.addEventListener('input',e=>{const node=e.target.closest('[data-keep-editor]');if(node)capture(node);});
    root.addEventListener('change',e=>{const node=e.target.closest('[data-keep-editor]');if(node)capture(node);});
    root.addEventListener('click',e=>{
      const b=e.target.closest('button');if(!b)return;
      const snap=()=>readViewState(app),refresh=()=>{state.stamp='';draw(snap());};
      if(b.hasAttribute('data-keepsake-add')){
        const r=snap().cards.find(c=>['events','relationshipChanges','personaChanges','performanceHints'].includes(c.category)&&!c.mergedIds?.length);
        state.drafts.set('new',{recordId:r?.id,expected:r?sha256(r):'',kind,index:null,data:{}});refresh();return;
      }
      if(b.hasAttribute('data-keep-cancel')){state.drafts.delete(b.dataset.keepCancel);refresh();return;}
      if(b.hasAttribute('data-keep-edit')){const row=state.rows.find(r=>r.id===b.dataset.keepEdit);if(row){state.drafts.set(row.id,structuredClone(row));refresh();}return;}
      if(b.hasAttribute('data-keep-save')){
        const key=b.dataset.keepSave,node=b.closest('[data-keep-editor]');capture(node);const d=structuredClone(state.drafts.get(key));
        void run(async()=>{if(kind==='diary'&&key==='new')await app.remember(d.data.text,'',{category:'performanceHints',subject:d.subject??'',target:d.target??'',context:d.data.stage,innerLife:d.data});else await app.saveCharacterKeepsake({...d,kind});state.drafts.delete(key);refresh();return {message:kind==='diary'?'角色心迹已保存':'关键对话已保存',level:'success'};},{name:'journal-write',button:b});return;
      }
      const id=b.dataset.keepDelete??b.dataset.keepToggle,row=state.rows.find(r=>r.id===id);
      if(row)void run(async()=>{const remove=b.hasAttribute('data-keep-delete');if(remove){if(!host.confirm?.('删除这一项？仅移除台词／心迹，不删除关联事件或聊天原文。'))return {message:'已取消删除',level:'info'};await app.saveCharacterKeepsake({...row,remove:true});}else await app.saveCharacterKeepsake({...row,data:{...row.data,disabled:!row.data.disabled}});state.drafts.delete(id);refresh();return {message:remove?'此项已删除，关联事件保留':row.data.disabled?'已恢复此项注入':'此项不再单独注入，原事件和人物事实保留',level:'success'};},{name:'journal-write',button:b});
    });
    $('[data-keepsake-search]')?.addEventListener('input',()=>{state.person='';state.page=1;draw(readViewState(app));});
    for(const [sel,step]of [['prev',-1],['next',1]])$(`[data-keepsake-${sel}]`)?.addEventListener('click',()=>{state.page+=step;draw(readViewState(app));});
  }
  return {paint(s,page){panes.get(page)?.draw(s);},selectPerson(kind,name){
    const state=panes.get(kind),root=panel.querySelector(`[data-keepsake="${kind}"]`);if(!state||!root)return;
    const snapshot=readViewState(app);state.draw(snapshot);root.querySelector('[data-keepsake-search]').value=name??'';state.person=name??'';state.page=1;state.stamp='';state.draw(snapshot);
  }};
}
