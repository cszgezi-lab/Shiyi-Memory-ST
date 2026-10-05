import {esc,field,setting} from '../src/product-settings-ui.js';
import {DYNAMIC_PERSONA_PROMPT,currentPersonaProfiles} from '../src/dynamic-persona.js';
import {PERSONA_SOURCE_LABELS,PERSONA_SOURCE_REASONS} from '../src/persona-source-index.js';
import {failureText} from '../src/product-feedback.js';
import {markPersonaQuoteParts} from '../src/persona-edit-evidence.js';
export function personaSourceDetails(p,guide,sources){
  const bindings=[...new Map((p.bindings??[]).map(b=>[JSON.stringify([b.book,b.uid]),{book:b.book,title:b.originalName??b.name}])).values()];
  // The panel must explain itself. A bare "0 个条目" left the user unable to tell
  // "the card binds no world book" from "the entry names nobody".
  const reason=sources?.length?null:PERSONA_SOURCE_REASONS[guide?.reason]??PERSONA_SOURCE_REASONS.no_named_entry;
  const hint=sources?.length?'':`<p>${esc(reason)}</p>${guide?.candidates?.length?`<p>已读取到的条目（前 ${guide.candidates.length} 个，未确认归属）：${guide.candidates.map(c=>esc(c)).join('；')}</p>`:''}`;
  const kept=p.composition?.parts?.length||p.composition?.sourceBaseline?.length||0;
  const rewritten=p.composition?.changes?.length??0;
  const pending=p.composition?.pendingEdits??[],revision=p.composition?.pendingRevision;
  const protectedQuotes=markPersonaQuoteParts(p.composition?.parts??[]).filter(q=>q.sourceQuote&&q.original!==q.text).length;
  const pendingHTML=(pending.length||revision)?`<details data-persona-pending><summary>有待核对改动，尚未应用</summary><p>批次完成不代表这些改动已确认；原有可用内容保留。</p>${revision?`<p>待核对的当前描述</p><div class="sy-packet">${esc(revision.notes??'')}</div>`:''}${pending.map(q=>`<p>${esc(q.ref??'当前补充')} · 缺少完整依据或对应片段</p>${q.text?`<div class="sy-packet">${esc(q.text)}</div>`:''}`).join('')}</details>`:'';
  const quoteHTML=protectedQuotes?`<p>${protectedQuotes} 处历史语料改写不作为原话注入；原记录仍可追溯，当前只保留原书范例及已核对实说。</p>`:'';
  const summary=p.composition?`<p>保留 ${kept} 个${sources?.length?'原书原文':'聊天档案'}片段；本次改写原设定 ${rewritten} 处。未修改部分沿用${sources?.length?'原文':'已保存底稿'}，不靠模型重写。</p>${rewritten?p.composition.changes.map(c=>`<details><summary>${esc(c.title)} · 第${esc(c.sourceFloors.join('、'))}楼依据</summary><p>修改前</p><div class="sy-packet">${esc(c.before)}</div><p>修改后</p><div class="sy-packet">${esc(c.after)}</div></details>`).join(''):`<p>本次未改写底稿。对特定对象的新态度可以与原有性格并存；是否冲突以本轮实际注入内容为准。</p>`}${p.composition.rejectedExamples?`<p>${p.composition.rejectedExamples} 条语料未确认原话或说话人，未纳入示例；其他档案内容保留。</p>`:''}${p.composition.rejectedDevelopment?`<p>${p.composition.rejectedDevelopment} 项成长补充缺少对应正文依据，未纳入成长脉络；原档案及已保存内容保留，不会自动另开校对任务。</p>`:''}`:'<p>此为旧版或手工档案；不会在升级时重写。下次明确更新时建立原文保留版本。</p>';
  return `<details data-persona-sources><summary>原书来源与本次修改 · ${bindings.length} 个条目</summary>${bindings.length?bindings.map(s=>`<p>${esc(s.book)} · ${esc(s.title)}</p>`).join(''):''}${hint}${pendingHTML}${quoteHTML}${summary}</details>`;
}
export function dynamicPersonaProgressText(d){
  if(!d.plan)return '独立进度尚未读取';
  const p=d.plan;
  return `${p.coveredThrough>=p.startFloor?`连续已处理 ${p.startFloor}–${p.coveredThrough} 楼`:'起点后尚未处理'} · 下一批 ${p.nextStart}–${p.nextEnd} 楼 · 最新 ${d.lastIndex??'未读取'} 楼 · 保留 ${p.keepRecent} 楼。${p.pendingBatches===null?'点击检查进度读取待处理数量。':`当前 ${p.pendingBatches} 个完整待处理批次，正常每批 1 次人设请求。`}旧聊天不继承主总结进度；从 1 开始会分批补读原文。修改起算楼层会跳过更早原文，不代表已建立那些楼层的人设。`;
}
export function dynamicPersonaFailureText(d){
  const f=d.failureDetails;
  return f?[failureText({code:f.code,details:f}),f.modelRequested===false?'本次尚未请求模型':f.modelRequested?'本次已请求模型':null,d.failureStorage?'失败进度另未保存；原有档案仍保留':null].filter(Boolean).join(' · '):'';
}
export function dynamicPersonaHTML(){return `<section data-view="dynamic-persona" hidden>
<div class="sy-top"><h3>人设更新设置</h3></div>
<p data-persona-status role="status"></p>
<details data-persona-failure hidden><summary>本次失败详情（不依赖日志导出）</summary><p data-persona-failure-text class="sy-help"></p></details>
<details class="sy-card" data-persona-controls open><summary>更新人物 <small>自动更新 / 手动补建</small></summary>
<div class="sy-actions"><button type="button" data-persona-tab="auto" aria-pressed="true">自动更新</button><button type="button" data-persona-tab="manual" aria-pressed="false">手动补建</button></div>
<div class="sy-card" data-persona-auto>
<div class="sy-grid">${setting('dynamicPersonaEvery')}${setting('dynamicPersonaKeepRecent')}</div>
${field('当前聊天自动起算楼层','<input data-persona-start type="number" min="0" value="1">')}
<div class="sy-actions"><button type="button" data-persona-save>保存设置</button></div>
</div>
<div class="sy-card" data-persona-manual hidden>
<h4>旧聊天 · 手动补建 / 重建</h4><p class="sy-help">重建已有范围会重新生成该范围的人设；全部完成后应用。旧档案在成功前继续生效。</p>
<div class="sy-grid">${field('从哪一楼','<input type="number" min="0" value="1" data-persona-manual-start>')}${field('到哪一楼','<input type="number" min="0" data-persona-manual-end>')}${field('每批多少楼','<input type="number" min="1" max="200" value="20" data-persona-manual-size>')}</div>
<label><input type="checkbox" checked data-persona-manual-handoff> 完成后衔接自动起点（不改变自动开关）</label>
<div class="sy-actions"><button type="button" data-persona-manual-start-run>开始人设总结</button></div>
<p role="status" data-persona-manual-status></p>
<div class="sy-actions"><button type="button" data-persona-manual-pause>暂停补建</button><button type="button" data-persona-manual-continue>继续未完成</button><button type="button" data-persona-manual-discard>放弃本次补建</button></div>
<div data-persona-manual-items></div><div class="sy-actions"><button type="button" data-persona-manual-prev>上一页</button><span data-persona-manual-page></span><button type="button" data-persona-manual-next>下一页</button></div>
</div>
</details>
<details class="sy-card" data-persona-settings><summary>共用预设与请求预算</summary>
${setting('dynamicPersonaMvuMode')}${setting('dynamicPersonaInputUnits')}${setting('dynamicPersonaOutputTokens')}${setting('dynamicPersonaDeadlineMs')}${field('发给人设模型的指导词',`<textarea rows="12" data-persona-prompt>${esc(DYNAMIC_PERSONA_PROMPT)}</textarea>`)}<div class="sy-actions"><button type="button" data-persona-budget-save>保存预设与预算</button><button type="button" data-persona-default>恢复内置预设</button></div></details>
<div class="sy-actions"><button type="button" data-persona-worldbook-sync>同步世界书</button></div>
<p class="sy-help" data-persona-worldbook-read></p><p class="sy-help" data-persona-worldbook></p>
<details class="sy-card" data-persona-source-audit><summary>原书条目识别结果（不是已替换清单）</summary><div data-persona-source-audit-list></div></details>
<details class="sy-card"><summary>本轮动态人设注入</summary><p data-persona-injected-info></p><div class="sy-packet" data-persona-injected-text></div></details>
</section><section data-view="persona-profiles" hidden><div class="sy-top"><h3>人物档案</h3><button type="button" data-jump="people">返回人物</button></div>
<div class="sy-actions"><button type="button" data-persona-profile-prev>上一组人物</button><button type="button" data-persona-profile-next>下一组人物</button><span data-persona-profile-page></span></div><div data-persona-profiles></div>
</section>`;}
export function mountDynamicPersona({panel,app,run,host=globalThis}){
  const $=s=>panel.querySelector?.(s),root=$('[data-view="dynamic-persona"]'),drafts=new Map();let stamp='',scope='',profilePage=0,startDirty=false,promptDirty=false,manualDirty=false,manualPage=0,manualStamp='',auditStamp='';
  if(!root)return {paint(){},focus(){},select(){},tab(){},dispose(){}};
  $('[data-persona-source-audit]')?.addEventListener('toggle',()=>paint(app.state));
  const bind=(s,fn)=>$(s)?.addEventListener('click',e=>run(fn,{name:'dynamic-persona',button:e.currentTarget}));
  $('[data-persona-start]')?.addEventListener('input',()=>{startDirty=true;});$('[data-persona-prompt]')?.addEventListener('input',()=>{promptDirty=true;});
  // Only this form edits the cadence; summary cards read the saved values.
  const save=async()=>{const patch={dynamicPersonaEvery:Number($('[data-setting="dynamicPersonaEvery"]')?.value),dynamicPersonaKeepRecent:Number($('[data-setting="dynamicPersonaKeepRecent"]')?.value)};await app.saveSettings(patch);await app.setDynamicPersonaStart(Number($('[data-persona-start]').value));startDirty=false;};
  bind('[data-persona-save]',save);
  bind('[data-persona-default]',()=>{$('[data-persona-prompt]').value=DYNAMIC_PERSONA_PROMPT;promptDirty=true;});
  bind('[data-persona-budget-save]',async()=>{const patch={dynamicPersonaPrompt:$('[data-persona-prompt]').value,dynamicPersonaMvuMode:$('[data-setting="dynamicPersonaMvuMode"]').value};for(const key of ['dynamicPersonaInputUnits','dynamicPersonaOutputTokens','dynamicPersonaDeadlineMs'])patch[key]=Number($('[data-setting="'+key+'"]').value);await app.saveSettings(patch);promptDirty=false;});
  const manualOptions=()=>({startIndex:Number($('[data-persona-manual-start]').value),endIndex:Number($('[data-persona-manual-end]').value),batchSize:Number($('[data-persona-manual-size]').value),handoff:$('[data-persona-manual-handoff]').checked});
  for(const sel of ['start','end','size','handoff'])$('[data-persona-manual-'+sel+']')?.addEventListener('input',()=>{manualDirty=true;});
  for(const tab of root.querySelectorAll('[data-persona-tab]'))tab.addEventListener('click',()=>{
    const manual=tab.dataset.personaTab==='manual';$('[data-persona-auto]').hidden=manual;$('[data-persona-manual]').hidden=!manual;
    for(const button of root.querySelectorAll('[data-persona-tab]'))button.setAttribute('aria-pressed',String(button===tab));
    if(manual)run(()=>app.inspectDynamicPersona(),{name:'dynamic-persona'});
  });
  bind('[data-persona-manual-start-run]',async()=>{if(['start','end','size'].some(k=>$('[data-persona-manual-'+k+']').value===''))throw Error('请填写起止楼层与每批楼数');return app.startDynamicPersonaManual(manualOptions());});
  bind('[data-persona-manual-pause]',()=>app.pauseDynamicPersonaManual());bind('[data-persona-manual-continue]',()=>app.continueDynamicPersonaManual());
  bind('[data-persona-manual-discard]',async()=>{if(await host.confirm?.('放弃本次补建候选？原人物档案、主总结保留；候选会归档。'))await app.discardDynamicPersonaManual();});
  bind('[data-persona-manual-prev]',()=>{manualPage=Math.max(0,manualPage-1);manualStamp='';paint(app.state);});
  bind('[data-persona-manual-next]',()=>{manualPage++;manualStamp='';paint(app.state);});
  bind('[data-persona-worldbook-sync]',()=>app.syncDynamicPersonaWorldbook());
  bind('[data-persona-profile-prev]',()=>{profilePage=Math.max(0,profilePage-1);stamp='';paint(app.state);});bind('[data-persona-profile-next]',()=>{profilePage++;stamp='';paint(app.state);});
  function paint(s){
    const d=s.dynamicPersona??{profiles:[],batches:[]},nextScope=JSON.stringify(s.core?.scope);
    if(scope!==nextScope){scope=nextScope;stamp=manualStamp='';startDirty=promptDirty=manualDirty=false;profilePage=manualPage=0;drafts.clear();$('[data-persona-profiles]').replaceChildren();$('[data-persona-manual-start]').value=1;$('[data-persona-manual-end]').value='';$('[data-persona-manual-size]').value=20;$('[data-persona-manual-handoff]').checked=true;}
    $('[data-persona-status]').textContent=`${s.settings.dynamicPersonaEnabled?'已启用':'未启用'} · ${d.message??'打开聊天后读取档案'}`;
    $('[data-persona-failure]').hidden=!d.failureDetails;
    if(d.failureDetails)$('[data-persona-failure-text]').textContent=dynamicPersonaFailureText(d);
    if(!startDirty)$('[data-persona-start]').value=d.startFloor??1;if(!promptDirty)$('[data-persona-prompt]').value=s.settings.dynamicPersonaPrompt||DYNAMIC_PERSONA_PROMPT;
    if(!manualDirty&&d.lastIndex!==null&&d.lastIndex!==undefined)$('[data-persona-manual-end]').value=d.lastIndex;
    const manual=d.manualPlan,items=manual?.items??[],saved=items.filter(b=>b.status==='saved').length,unfinished=['paused','running','failed'].includes(manual?.status);
    $('[data-persona-manual-status]').textContent=manual?`${manual.startIndex}–${manual.endIndex} 楼 · ${{paused:'已暂停',running:'正在后台补建',failed:'本批未完成，可继续',completed:'已完成并应用',discarded:'已放弃，原档案保留'}[manual.status]??manual.status} · ${saved}/${items.length} 批。${unfinished?'候选进度已保存；全部完成前继续使用原人物档案。':''}${manual.message??''}`:'还没有手动人设计划。';
    $('[data-persona-manual-continue]').disabled=!unfinished||Boolean(d.busy)||(manual?.status==='running'&&!manual.items.some(b=>b.status==='failed'));
    $('[data-persona-manual-pause]').disabled=manual?.status!=='running';
    $('[data-persona-manual-discard]').disabled=!unfinished||Boolean(d.busy);
    const manualPages=Math.max(1,Math.ceil(items.length/10));manualPage=Math.min(manualPage,manualPages-1);
    $('[data-persona-manual-page]').textContent=items.length?`${manualPage+1}/${manualPages} 页`:'';
    $('[data-persona-manual-prev]').disabled=manualPage===0;$('[data-persona-manual-next]').disabled=manualPage>=manualPages-1;
    const nextManualStamp=JSON.stringify([manual?.id,manual?.status,items.slice(manualPage*10,manualPage*10+10),manualPage]);
    if(manualStamp!==nextManualStamp){manualStamp=nextManualStamp;$('[data-persona-manual-items]').innerHTML=items.slice(manualPage*10,manualPage*10+10).map(b=>`<p>${b.startIndex}–${b.endIndex} 楼 · ${b.status==='saved'?(manual.status==='completed'?'已应用':'候选已保存'):b.status==='failed'?'未完成：'+esc(b.message??'可继续重试'):'等待处理'}</p>`).join('');}
    const wb=d.worldbook;$('[data-persona-worldbook-read]').textContent=wb?wb.status==='unavailable'?'当前宿主未提供世界书读取接口；可以保存补充档案，但不能替换原条目。':`已读取 ${wb.books.length} 本世界书、${wb.entries} 个条目，${wb.safeFragments} 个可安全读取的文字片段（不等于全是人物条目）。来源：${wb.books.join('、')||'当前角色未绑定世界书'}`:'可以检查当前角色卡和聊天绑定的世界书。';
    const audit=JSON.stringify(wb?.audit??[]);if($('[data-persona-source-audit]').open&&audit!==auditStamp){auditStamp=audit;$('[data-persona-source-audit-list]').innerHTML=(wb?.audit??[]).map(e=>`<p>${esc(e.book)} · ${esc(e.title)}：${esc(PERSONA_SOURCE_LABELS[e.status]??'未确认')}${e.owner?' · '+esc(e.owner):''}</p>`).join('')||'<p>请点击“同步世界书”。</p>';}
    $('[data-persona-worldbook]').textContent=d.mirror?.status==='saved'?`世界书镜像：${d.mirror.name}（存档查看用，不重复绑定注入）。${(d.profiles??[]).some(p=>!p.deleted)?'人物是否生成成功以已应用档案为准。':'目前没有已应用的人物档案；空镜像不代表补建完成。'}`:d.mirror?.status==='failed'?'档案已保存，世界书镜像未同步；可单独重试同步，无需重新补建。':'人物档案保存在本聊天的拾忆存档中；原版版仅读取原世界书，不创建世界书镜像。';
    $('[data-persona-injected-info]').textContent=d.lastInjection?`替换 ${d.lastInjection.replaced} 份当前人设，补充 ${d.lastInjection.supplemental} 份；只是加入待发请求，不代表模型一定采纳。`:'还没有本轮注入记录。';
    $('[data-persona-injected-text]').textContent=d.lastInjection?.text??'';
    const visible=currentPersonaProfiles((d.profiles??[]).filter(p=>!p.deleted),s.settings.dynamicPersonaMvuMode),pages=Math.max(1,Math.ceil(visible.length/6));profilePage=Math.min(profilePage,pages-1);$('[data-persona-profile-page]').textContent=`${profilePage+1}/${pages} · ${visible.length} 份档案`;
    const nextStamp=JSON.stringify([d.profiles,d.batches,profilePage,s.settings.dynamicPersonaMvuMode]);if(stamp===nextStamp)return;stamp=nextStamp;
    const list=$('[data-persona-profiles]');for(const e of list.querySelectorAll('[data-persona-id]')){if(e.querySelector('[data-persona-editor][open]'))drafts.set(e.dataset.personaId,e);else drafts.delete(e.dataset.personaId);}for(const id of drafts.keys())if(!visible.some(p=>p.id===id))drafts.delete(id);const editing=drafts;
    const cards=[];
    for(const p of visible.slice(profilePage*6,profilePage*6+6)){if(p.deleted)continue;if(editing.has(p.id)){cards.push(editing.get(p.id));continue;}
      const card=panel.ownerDocument.createElement('article');card.className='sy-card';card.dataset.personaId=p.id;
      const targets=visible.filter(other=>other.id!==p.id).sort((a,b)=>b.name.length-a.name.length||a.name.localeCompare(b.name,'zh-CN'));
      const suggested=targets[0]?.id??'';
      const mergeEditor=targets.length?`<details data-persona-merge><summary>合并到其他人物档案</summary><p class="sy-help">适合“濑名紫阳花／紫阳花”这种重复档案。选择要保留正式姓名的目标；本档案的内容、来源、台词和别称会并入目标，当前档案进入可恢复的合并记录，不调用模型。</p><select data-persona-merge-target aria-label="合并目标">${targets.map(other=>`<option value="${esc(other.id)}" ${other.id===suggested?'selected':''}>保留“${esc(other.name)}”${other.bindings?.length?' · 已关联原书':''}</option>`).join('')}</select><button type="button" data-persona-merge-commit>确认合并</button></details>`:'';
      const editorText=String(p.text??'').replace(/^【强调】[\s\S]*?\n\n/u,'').replace(/\n\n【强调 · 收束】[\s\S]*$/u,'');
      card.innerHTML=`<h4>${esc(p.name)}</h4><p class="sy-help">${p.locked?'已锁定 · ':''}依据至 ${p.through} 楼 · ${p.bindings?.length?'已关联原书，实际替换见本轮注入':'尚未接管原书 · 仅补充'}</p><div class="sy-packet">${esc(p.text)}</div><details data-persona-editor><summary>修改整份人物档案</summary><textarea rows="12" data-persona-edit>${esc(editorText)}</textarea><label>别称与简称（逗号分隔）<input data-persona-aliases value="${esc((p.aliases??[]).join('，'))}"></label><p class="sy-help">简繁自动识别；同一别称对应多人时不自动选人。召回字典中的手工校正优先。</p><label><input type="checkbox" data-persona-lock ${p.locked?'checked':''}>锁定，不让 AI 覆盖</label><button type="button" data-persona-commit>保存人物</button></details>${mergeEditor}${personaSourceDetails(p,d.worldbook?.guide,[...new Map((p.bindings??[]).map(b=>[JSON.stringify([b.book,b.uid]),b])).values()])}<div class="sy-actions"><button type="button" data-persona-undo>恢复上一版并锁定</button><button type="button" data-persona-delete>删除档案</button></div>`;
      const action=(sel,fn)=>card.querySelector(sel).addEventListener('click',()=>run(fn,{name:'dynamic-persona'}));
      action('[data-persona-commit]',async()=>{await app.editDynamicPersona(p.id,{text:card.querySelector('[data-persona-edit]').value,aliases:card.querySelector('[data-persona-aliases]').value,locked:card.querySelector('[data-persona-lock]').checked});card.querySelector('details').open=false;stamp='';paint(app.state);});
      action('[data-persona-delete]',()=>app.editDynamicPersona(p.id,{deleted:true,locked:true}));action('[data-persona-undo]',()=>app.undoDynamicPersona(p.id));
      if(targets.length)action('[data-persona-merge-commit]',async()=>{const targetId=card.querySelector('[data-persona-merge-target]').value;const target=targets.find(row=>row.id===targetId);if(!target)throw new Error('请选择合并目标');if(await host.confirm?.(`将“${p.name}”并入“${target.name}”？原档案会保留在可恢复版本中。`)!==true)return;await app.mergeDynamicPersona(p.id,targetId);stamp='';paint(app.state);});
      cards.push(card);
    }
    list.replaceChildren(...cards);
  }
  return {paint,focus(idOrName){
    const s=app.state,visible=currentPersonaProfiles((s.dynamicPersona?.profiles??[]).filter(p=>!p.deleted),s.settings.dynamicPersonaMvuMode);
    const index=visible.findIndex(p=>p.id===idOrName||p.name===idOrName);if(index<0)return;
    profilePage=Math.floor(index/6);stamp='';paint(s);
    const card=[...panel.querySelectorAll('[data-persona-id]')].find(e=>e.dataset.personaId===visible[index].id);card?.scrollIntoView?.({block:'start'});
  }};
}
