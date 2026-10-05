import { readViewState } from '../src/product-view-scheduling.js';
import { esc,field,button } from '../src/product-settings-ui.js';
import { recordDescription } from '../src/product-memory.js';
import { moduleBinding } from '../src/product-custom-modules.js';
import { makeId } from '../src/utils.js';

export function customModulesHTML(){return `<details class="sy-card sy-custom" data-custom-modules><summary>扩展模块 <span data-module-count>0</span></summary>
  <p class="sy-help">区块全局共用，内容按聊天保存。</p>
  <div class="sy-actions">${button('new-module','新增区块')}</div><div data-module-list></div>
  <section class="sy-card" data-module-editor hidden><h4>区块设置</h4>
    ${field('区块名称','<input data-module-name maxlength="80" placeholder="例如：主角等级">')}
    ${field('记录对象','<input data-module-subject maxlength="120" placeholder="例如：主角姓名">')}
    ${field('数据来源','<select data-module-mode><option value="summary">随总结自动记录</option><option value="manual">手动记录</option><option value="mvu">MVU 变量（只读）</option></select>')}
    ${field('记录要求','<textarea data-module-description rows="3" maxlength="1600" placeholder="例如：记录等级变化和升级原因"></textarea>')}
    ${field('启用区块','<input data-module-enabled type="checkbox" checked>')}${field('参与记忆召回','<input data-module-inject type="checkbox">')}
    <div data-module-fields></div>${button('add-module-field','添加字段')}
    <div class="sy-actions">${button('save-module','保存区块',true)}${button('cancel-module','取消')}</div>
  </section>
  <section class="sy-card" data-module-record-editor hidden><h4>填写记录</h4><p data-module-record-label></p>${field('内容','<textarea data-module-value rows="3"></textarea>')}<div class="sy-actions">${button('save-module-value','保存记录',true)}${button('cancel-module-value','取消')}</div></section>
</details>`;}

export function moduleProposalHTML(p){return `<p><strong>${esc(p.module.name)}</strong> · ${p.module.archived?'删除（可恢复）':p.before?'修改区块':'新增区块'}</p><p>${esc(({manual:'手动记录',summary:'随总结记录',mvu:'MVU 只读'})[p.module.mode])} · ${esc(p.module.subject||'未指定对象')}</p><p>${esc(p.module.description)}</p>${p.module.fields.map(f=>`<p>${esc(f.label)} · ${esc(({text:'文字',number:'数值',boolean:'开关'})[f.type])}${f.path?`<br>MVU：${esc(f.path.join(' → '))}`:''}</p>`).join('')}<p>参与召回：${p.module.inject?'是':'否'}；启用：${p.module.enabled?'是':'否'}。${p.before?'修改前：'+esc(JSON.stringify(p.before)):''}</p>`;}

export function mountCustomModules({panel,app,run,host,onAssistant,download}){
  const $=s=>panel.querySelector?.(s),root=$('[data-custom-modules]');
  if(!root)return {paint(){}};
  let editing=null,recordEdit=null,fieldDefs=[],lastList='';
  const action=(name,fn)=>$(`[data-action="${name}"]`)?.addEventListener('click',()=>run(fn,{name:`custom-${name}`}));
  function fields(){
    const mode=$('[data-module-mode]').value,paths=readViewState(app).mvuPaths??[];
    $('[data-module-fields]').innerHTML=fieldDefs.map((f,i)=>`<div class="sy-card" data-field-row="${i}">${field('字段名称',`<input data-field-label value="${esc(f.label)}" maxlength="80">`)}${field('字段类型',`<select data-field-type>${[['text','文字'],['number','数值'],['boolean','开关']].map(([v,l])=>`<option value="${v}" ${f.type===v?'selected':''}>${l}</option>`).join('')}</select>`)}${mode==='mvu'?field('MVU 变量',`<select data-field-path><option value="">先读取变量，然后选择</option>${[...(f.path&&!paths.some(p=>JSON.stringify(p.path)===JSON.stringify(f.path))?[{path:f.path}]:[]),...paths].map(p=>`<option value="${esc(JSON.stringify(p.path))}" ${JSON.stringify(f.path)===JSON.stringify(p.path)?'selected':''}>${esc(p.path.join(' → '))}</option>`).join('')}</select>`):''}<button type="button" data-remove-field="${i}">移除字段</button></div>`).join('');
    for(const b of root.querySelectorAll('[data-remove-field]'))b.addEventListener('click',()=>{captureFields();fieldDefs.splice(Number(b.dataset.removeField),1);fields();});
  }
  function captureFields(){for(const row of root.querySelectorAll('[data-field-row]')){const f=fieldDefs[Number(row.dataset.fieldRow)];f.label=row.querySelector('[data-field-label]').value;f.type=row.querySelector('[data-field-type]').value;const path=row.querySelector('[data-field-path]');if(path)f.path=path.value?JSON.parse(path.value):[];}}
  function edit(m=null){editing=m;fieldDefs=structuredClone(m?.fields??[{id:'value',label:'等级',type:'number'}]);for(const [key,value]of Object.entries({name:m?.name??'',subject:m?.subject??'',description:m?.description??'',mode:m?.mode??'summary'}))$(`[data-module-${key}]`).value=value;$('[data-module-enabled]').checked=m?.enabled??true;$('[data-module-inject]').checked=m?.inject??false;$('[data-module-mode]').disabled=Boolean(m);fields();$('[data-module-editor]').hidden=false;root.open=true;$('[data-module-editor]').scrollIntoView({block:'nearest'});}
  action('new-module',()=>edit());action('cancel-module',()=>{$('[data-module-editor]').hidden=true;editing=null;});
  action('module-assistant',()=>onAssistant('我想新增一个记忆区块，请先问我要记录什么、从哪里读取。'));
  action('add-module-field',()=>{captureFields();if(fieldDefs.length>=16)throw new Error('每个区块最多 16 个字段');fieldDefs.push({id:makeId('field'),label:'',type:'text'});fields();});
  $('[data-module-mode]')?.addEventListener('change',()=>{captureFields();fields();});
  action('read-mvu',async()=>{captureFields();const result=await app.inspectMvu();await app.syncModules();fields();if(result.status!=='ready')throw new Error('尚未读取到 MVU 变量，请确认当前角色卡已初始化变量框架');});
  action('save-module',async()=>{captureFields();await app.saveModule({id:editing?.id??makeId('module'),name:$('[data-module-name]').value,subject:$('[data-module-subject]').value,description:$('[data-module-description]').value,mode:$('[data-module-mode]').value,fields:fieldDefs,enabled:$('[data-module-enabled]').checked,inject:$('[data-module-inject]').checked,archived:false},{expected:editing});$('[data-module-editor]').hidden=true;editing=null;});
  action('save-module-value',async()=>{const raw=$('[data-module-value]').value;let value=raw;if(recordEdit.field.type==='number'){if(!raw.trim())throw new Error('数值不能为空');value=Number(raw);}if(recordEdit.field.type==='boolean'){if(!['true','false'].includes(raw.trim()))throw new Error('开关填写 true 或 false');value=raw.trim()==='true';}if(recordEdit.card)await app.editModuleRecord(recordEdit.card.id,value);else await app.rememberModule(recordEdit.module.id,recordEdit.field.id,value);$('[data-module-record-editor]').hidden=true;});
  action('cancel-module-value',()=>{$('[data-module-record-editor]').hidden=true;});
  action('export-modules',()=>download(app.exportModules(),'拾忆-扩展区块.json'));
  action('import-modules',async()=>{const file=$('[data-module-import]').files?.[0];if(!file)throw new Error('请选择区块定义 JSON');if(file.size>1024*1024)throw new Error('区块定义文件上限 1 MB');await app.importModules(JSON.parse(await file.text()));});
  function record(m,field,card=null){recordEdit={module:m,field,card};$('[data-module-record-label]').textContent=`${m.name} · ${field.label}`;$('[data-module-value]').value=card?String(card.to??card.value??card.newValue):'';$('[data-module-record-editor]').hidden=false;$('[data-module-record-editor]').scrollIntoView({block:'nearest'});}
  function paint(s){
    const modules=s.modules??[];$('[data-module-count]').textContent=String(modules.filter(m=>!m.archived).length);
    const signature=JSON.stringify([modules,s.cardRevision??s.cards.filter(c=>c.customModuleId),s.moduleSnapshots,s.moduleCurrent,s.stale]);if(signature===lastList)return;lastList=signature;
    const expanded=new Set([...root.querySelectorAll('details[data-module-id][open]')].map(e=>e.dataset.moduleId));
    $('[data-module-list]').innerHTML=modules.filter(m=>!m.archived).map(m=>{
      const cards=s.cards.filter(c=>c.customModuleId===m.id),history=(s.moduleSnapshots??[]).filter(r=>r.moduleId===m.id&&r.definition===moduleBinding(m));
      return `<details class="sy-card" data-module-id="${esc(m.id)}" ${expanded.has(m.id)?'open':''}><summary>${esc(m.name)} · ${cards.length} 条${m.enabled?'':' · 已停用'}</summary><p class="sy-help">${esc(m.description)} · ${m.mode==='mvu'?'MVU 只读':m.mode==='summary'?'随总结记录':'手动记录'}${m.inject?' · 参与召回':''}</p><div class="sy-actions"><button type="button" data-edit-module="${esc(m.id)}">编辑区块</button><button type="button" data-archive-module="${esc(m.id)}">删除区块</button></div>${cards.map(c=>`<div class="sy-card"><p>${esc(recordDescription(c))}</p>${!c.readonly?`<button type="button" data-edit-module-record="${esc(c.id)}">修改</button> <button type="button" data-delete-module-record="${esc(c.id)}">删除记录</button>`:''}</div>`).join('')||'<p class="sy-help">暂无记录。MVU 缺失值不会猜测补齐。</p>'}${m.mode!=='mvu'?m.fields.map(f=>`<button type="button" data-add-module-record="${esc(m.id)}" data-module-field="${esc(f.id)}">新增${esc(f.label)}</button>`).join(''):`<details><summary>变量历史 · ${history.length} 楼</summary>${history.slice(-100).reverse().map(r=>`<p>#${r.floor} · ${m.fields.map(f=>`${esc(f.label)}：${Object.hasOwn(r.values,f.id)?esc(String(r.values[f.id])):'未读取到'}${r.changes?.[f.id]?`（${esc(r.changes[f.id].from)} → ${esc(r.changes[f.id].to)}）`:''}`).join('；')}</p>`).join('')}${history.length>100?'<p>显示最近 100 楼，其余保留在聊天备份中。</p>':''}</details>`}</details>`;
    }).join('')||'<p class="sy-help">还没有扩展区块。</p>';
    const bind=(selector,fn)=>{for(const b of root.querySelectorAll(selector))b.addEventListener('click',()=>run(()=>fn(b)));};
    bind('[data-edit-module]',b=>edit(modules.find(m=>m.id===b.dataset.editModule)));
    bind('[data-archive-module]',async b=>{if(host.confirm?.('删除这个区块？可以恢复，已有记录和原 MVU 数据不会被删除。'))await app.archiveModule(b.dataset.archiveModule);});
    bind('[data-restore-module]',b=>app.archiveModule(b.dataset.restoreModule,false));
    bind('[data-add-module-record]',b=>{const m=modules.find(m=>m.id===b.dataset.addModuleRecord);record(m,m.fields.find(f=>f.id===b.dataset.moduleField));});
    bind('[data-edit-module-record]',b=>{const c=s.cards.find(c=>c.id===b.dataset.editModuleRecord),m=modules.find(m=>m.id===c.customModuleId);record(m,m.fields.find(f=>f.id===c.fieldId),c);});
    bind('[data-delete-module-record]',async b=>{if(host.confirm?.('删除这条记录？可从记录页回收站恢复。'))await app.deleteRecord(b.dataset.deleteModuleRecord);});
  }
  return {paint};
}
