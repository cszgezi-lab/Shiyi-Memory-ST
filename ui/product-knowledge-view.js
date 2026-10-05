import { readViewState } from '../src/product-view-scheduling.js';
import { esc,field } from '../src/product-settings-ui.js';
import { knowledgeImportPlan } from '../src/product-knowledge-import.js';

export function knowledgeImportHTML(){return `<div class="sy-card"><h4>导入资料</h4>
<div class="sy-actions"><button type="button" data-kb-choose class="sy-primary">选择文件</button><button type="button" data-kb-clear disabled>清除选择</button></div>
<input type="file" accept=".txt,.md,.json" multiple data-files hidden aria-label="选择资料文件">
<p class="sy-help" data-kb-selected aria-live="polite">尚未选择文件；支持 TXT、MD、JSON，可多选。</p>
<p class="sy-help">选择文件 → 预览内容 → 确认导入。默认生成字典、关键词和向量索引；资料是参考设定，不代表角色已经知道。</p><p class="sy-help" data-kb-api-status></p><div class="sy-actions"><button type="button" data-api-jump="knowledge">资料分析 API</button><button type="button" data-api-jump="embedding">向量 API</button></div><p class="sy-help">预览不调用模型；确认导入后才会调用所选服务。</p>${field('文件用途','<select data-purpose><option value="knowledge">作品 / 世界资料</option><option value="rules">配置规则 MD / SKILL / JSON</option></select>')}<details data-knowledge-options><summary>分段与索引 · 已填推荐值</summary>${field('每段最多多少字','<input type="number" min="200" max="6000" value="600" data-kb-size>')}${field('分隔符（可留空）','<input data-kb-delimiter maxlength="100" placeholder="例如：###">')}<label class="sy-toggle"><span>关键词索引（本地 BM25）</span><input type="checkbox" data-kb-keyword checked></label><label class="sy-toggle"><span>向量索引（调用向量 API）</span><input type="checkbox" data-kb-vector checked></label><label class="sy-toggle"><span>分析资料并生成字典（资料分析 API）</span><input type="checkbox" data-kb-analysis checked></label></details><p class="sy-help">文件在本机解析为文字；确认导入后，所选的分析 / 向量服务会收到相关文字。世界书 JSON 读取已启用条目，不执行脚本。</p><div class="sy-actions"><button type="button" data-kb-preview disabled>预览文件</button><button type="button" data-kb-import disabled class="sy-primary">确认导入</button></div><p class="sy-help" data-kb-plan>先选择文件并预览，确认内容后即可导入。</p><div data-kb-preview-list></div></div><div data-documents></div>`;}

export function mountKnowledgeView({panel,app,run,host}){
  const $=s=>panel.querySelector?.(s);let drafts=[],stamp='',selectionVersion=0;const previews=new Map(),partsById=new Map(),edits=new Map();
  const fileInput=$('[data-files]');
  function updateFileSelection(){
    if(!fileInput)return 0;
    const files=Array.from(fileInput.files??[]);
    $('[data-kb-selected]').textContent=files.length?`已选 ${files.length} 个文件：${files.map(f=>f.name).join('、')}`:'尚未选择文件；支持 TXT、MD、JSON，可多选。';
    $('[data-kb-choose]').textContent=files.length?'重新选择文件':'选择文件';
    $('[data-kb-clear]').disabled=!files.length;$('[data-kb-preview]').disabled=!files.length;
    return files.length;
  }
  function invalidate(){selectionVersion++;drafts=[];$('[data-kb-import]').disabled=true;$('[data-kb-preview-list]').textContent='';$('[data-kb-plan]').textContent=updateFileSelection()?'已选择文件，请点击“预览文件”，确认内容后导入。':'先选择文件并预览，确认内容后即可导入。';}
  // Keep the native picker inside the direct user gesture; awaiting run() can
  // lose mobile WebView activation. The host intentionally hides file inputs.
  $('[data-kb-choose]')?.addEventListener('click',()=>fileInput?.click());
  $('[data-kb-clear]')?.addEventListener('click',()=>{if(fileInput)fileInput.value='';invalidate();});
  updateFileSelection();
  for(const el of panel.querySelectorAll('[data-files],[data-purpose],[data-kb-size],[data-kb-delimiter],[data-kb-keyword],[data-kb-vector],[data-kb-analysis]'))el.addEventListener('change',invalidate);
  $('[data-purpose]')?.addEventListener('change',()=>{$('[data-knowledge-options]').hidden=$('[data-purpose]').value==='rules';});
  $('[data-kb-preview]')?.addEventListener('click',()=>run(async()=>{
    invalidate();const version=selectionVersion,purpose=$('[data-purpose]').value,files=Array.from($('[data-files]').files??[]);if(!files.length)throw new Error('请先选择文件');if(files.some(f=>f.size>20*1024*1024))throw new Error('单个文件上限 20 MB');
    const options={chunkSize:Number($('[data-kb-size]').value),delimiter:$('[data-kb-delimiter]').value,keywordEnabled:$('[data-kb-keyword]').checked,vectorEligible:$('[data-kb-vector]').checked,autoAnalyze:$('[data-kb-analysis]').checked};
    const selected=await Promise.all(files.map(async f=>({name:f.name,text:await f.text(),purpose,options})));if(version!==selectionVersion)return;
    const plans=selected.map(knowledgeImportPlan);drafts=selected;
    $('[data-kb-preview-list]').innerHTML=plans.map(p=>`<article><h4>${esc(p.name)}</h4><p>${esc(p.format)} · ${p.chars} 字 · ${p.chunks.length} 段</p>${p.chunks.slice(0,3).map((c,i)=>`<details><summary>第 ${i+1} 段 · ${c.text.length} 字</summary><div class="sy-packet">${esc(c.text)}</div></details>`).join('')}${p.chunks.length>3?'<p class="sy-help">预览前 3 段，导入时保存全部。</p>':''}</article>`).join('');$('[data-kb-import]').disabled=false;$('[data-kb-plan]').textContent='预览完成，点击“确认导入”保存原文并建立所选索引。';
  }));
  $('[data-kb-import]')?.addEventListener('click',()=>run(async()=>{
    if(!drafts.length)throw new Error('请先预览切片');const pending=drafts;invalidate();const errors=[];
    for(const input of pending){const doc=await app.addDocument(input);
      if(input.purpose==='rules'||input.options.autoAnalyze)try{const result=await app.analyzeDocuments([doc.id]);if(result.partial)errors.push(`${doc.name}：字典待补全`);}catch(e){if(e.code==='CANCELED')throw e;errors.push(`${doc.name}：资料分析未完成`);}
      if(input.purpose==='knowledge'&&input.options.vectorEligible)try{const result=await app.buildKnowledgeVectors([doc.id]);if(result.pending)errors.push(`${doc.name}：部分向量未完成`);}catch(e){if(e.code==='CANCELED')throw e;errors.push(`${doc.name}：向量索引未完成`);}
    }
    fileInput&&(fileInput.value='');invalidate();if(errors.length)throw new Error(`文字资料已保存。${errors.join('；')}。请检查对应 API，再在资料下点击继续；不必重新导入。`);
  },{name:'import'}));
  function paint(s){
    const c=s.settings??{},inherited=c.knowledgeFollowAssistant!==false,model=inherited?(c.assistantFollowSummary?c.providerModel:c.assistantModel):c.knowledgeModel;
    if($('[data-kb-api-status]'))$('[data-kb-api-status]').textContent='资料分析：'+(inherited?'沿用配置助手（可单独配置）':'独立 API')+' · '+(model||'未配置模型')+'；向量：'+(c.embeddingModel||'未配置模型')+'。';
    const signature=JSON.stringify([s.documents,[...previews]]);if(panel.ownerDocument.activeElement?.matches('[data-kb-edit-text]')||stamp===signature)return;stamp=signature;
    if($('[data-documents]'))$('[data-documents]').innerHTML=(s.documents??[]).map(d=>`<article class="sy-card" data-kb-doc="${esc(d.id)}"><h4>${esc(d.name)}</h4><p class="sy-help">${d.purpose==='rules'?'配置规则':'世界资料'} · ${d.chars} 字 · ${d.chunks} 段${d.importOptions?.enabled===false?' · 已停用':''}</p><p>关键词：${d.purpose==='rules'?'不参与召回':d.importOptions?.keywordEnabled===false?'未启用':'可检索'}<br>资料分析：${d.analyzed??0}/${d.chunks} 段 · 字典${d.dictionaryStatus==='ready'?'已生成':d.dictionaryStatus==='partial'?'待补全':'待分析'}${d.purpose==='knowledge'?`<br>向量：${d.importOptions?.vectorEligible===false?'未启用':d.vectorStatus?`上次建成 ${d.vectorStatus.indexed}/${d.vectorStatus.total} 条`:'待建立'}`:''}</p><div class="sy-actions"><button type="button" data-kb-read="${esc(d.id)}">查看 / 修改资料</button><button type="button" data-kb-analyze="${esc(d.id)}">继续分析 / 字典</button>${d.purpose==='knowledge'&&d.importOptions?.vectorEligible!==false?`<button type="button" data-kb-build="${esc(d.id)}">继续建索引</button>`:''}<button type="button" data-kb-toggle="${esc(d.id)}">${d.importOptions?.enabled===false?'启用资料':'停用资料'}</button><button type="button" data-remove-doc="${esc(d.id)}">删除资料</button></div>${previews.get(d.id)??''}</article>`).join('')||'<p class="sy-empty">还没有资料库。先选择文件并预览切片。</p>';
  }
  async function loadParts(id,page=1){const d=readViewState(app).documents.find(d=>d.id===id);if(!d)return;page=Math.max(1,Math.min(Math.ceil(d.chunks/3),page));const parts=await app.documentPreview(id,{page,pageSize:3});partsById.set(id,{page,parts});renderParts(id);}
  function renderParts(id,paintNow=true){const v=partsById.get(id),d=readViewState(app).documents.find(d=>d.id===id);if(!v||!d)return;
    previews.set(id,v.parts.map(p=>{const key=id+':'+p.index,e=edits.get(key);return `<details open><summary>第 ${p.index+1} 段</summary>${e?`<label class="sy-field">资料正文<textarea data-kb-edit-text="${esc(key)}" rows="8" maxlength="6000">${esc(e.text)}</textarea></label><div class="sy-actions"><button data-kb-save="${esc(key)}">保存并更新检索</button><button data-kb-cancel="${esc(key)}">取消</button></div>`:`<div class="sy-packet">${esc(p.text)}</div><button data-kb-edit="${esc(key)}">修改这一段</button>`}</details>`;}).join('')+`<div class="sy-actions"><button data-kb-prev="${esc(id)}" ${v.page<=1?'disabled':''}>上一页</button><span>${v.page}/${Math.ceil(d.chunks/3)} 页</span><button data-kb-next="${esc(id)}" ${v.page>=Math.ceil(d.chunks/3)?'disabled':''}>下一页</button></div>`);
    if(paintNow)paint(readViewState(app));
  }
  $('[data-documents]')?.addEventListener('input',e=>{const key=e.target.dataset.kbEditText;if(key&&edits.has(key)){const edit=edits.get(key);edit.text=e.target.value;renderParts(edit.id,false);}});
  $('[data-documents]')?.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
    run(async()=>{
      if(b.dataset.kbRead)return loadParts(b.dataset.kbRead);
      const move=b.dataset.kbPrev||b.dataset.kbNext;if(move)return loadParts(move,(partsById.get(move)?.page??1)+(b.dataset.kbNext?1:-1));
      if(b.dataset.kbEdit){const key=b.dataset.kbEdit,cut=key.lastIndexOf(':'),id=key.slice(0,cut),index=Number(key.slice(cut+1)),part=partsById.get(id)?.parts.find(p=>p.index===index);if(part){edits.set(key,{id,index,text:part.text,expected:part.expected});renderParts(id);}return;}
      if(b.dataset.kbCancel){const edit=edits.get(b.dataset.kbCancel);edits.delete(b.dataset.kbCancel);if(edit)renderParts(edit.id);return;}
      if(b.dataset.kbSave){const key=b.dataset.kbSave,edit=edits.get(key);if(!edit)return;const doc=await app.editDocumentChunk(edit.id,edit.index,edit);edits.delete(key);await loadParts(edit.id,partsById.get(edit.id)?.page??1);const errors=[];
        if(doc.importOptions?.autoAnalyze!==false)try{const r=await app.analyzeDocuments([doc.id]);if(r.partial)errors.push('字典待补全');}catch(e){if(e.code==='CANCELED')throw e;errors.push('资料分析未完成');}
        if(doc.importOptions?.vectorEligible!==false)try{const r=await app.buildKnowledgeVectors([doc.id]);if(r.pending)errors.push('部分向量待补全');}catch(e){if(e.code==='CANCELED')throw e;errors.push('向量未完成');}
        if(errors.length)throw new Error('修改已保存；'+errors.join('；')+'。可在本资料下继续，无需重新导入。');return;
      }
      if(b.dataset.kbAnalyze)return app.analyzeDocuments([b.dataset.kbAnalyze]);
      if(b.dataset.kbBuild)return app.buildKnowledgeVectors([b.dataset.kbBuild]);
      if(b.dataset.kbToggle){const d=readViewState(app).documents.find(d=>d.id===b.dataset.kbToggle);await app.updateDocument(d.id,{enabled:d.importOptions?.enabled===false});}
      if(b.dataset.removeDoc&&host.confirm?.('删除这份资料？无法在插件内撤销，请保留原文件；聊天原文不受影响。'))await app.removeDocument(b.dataset.removeDoc);
    },{name:b.dataset.kbBuild?'vectors':b.dataset.kbAnalyze?'analyze':b.dataset.kbSave?'knowledge-edit':'',button:b});
  });
  return {paint};
}
