import {esc,field} from '../src/product-settings-ui.js';
import {normalizeNarrativeConfig,getNarrativeConfig,NARRATIVE_EXTRACTION_PRESETS,defaultNarrativeExtractionConfig} from '../src/narrative-extraction.js';

// 提取规则 DIY · 极简壳 v0.21.69
// 默认折叠成一行 `[●○○] 提取规则 DIY · N 条`；点开才进完整编辑器。
// 保存路径仍走 app.saveSettings({narrativeExtraction})，不动 summary 链路。

export const NARRATIVE_TAG_GUIDE=`沿用现有预设的正文格式、语言与自然分段，不再输出一套摘要或人物表格。
若已有 <content> 正文和 <time_format> 时间地点，继续使用，不重复包裹。
仅在原文明确有倒叙、回忆或场景切换时，可在正文前用 <sy_context>叙事时点与适用语境</sy_context> 简短注明。未知不填，不编造精确日期、学段或阶段。
必要时用 <sy_private who="角色名">既有的内心描写</sy_private> 标明没有说出口的心理。只包裹本来就要写的内容，不要求每轮增加心理描写，也不让其他角色因此知情。
普通对白沿用角色名和引号；双语对白沿用 角色名「日文」〔中文译文〕。中文与日文应表达同一信息，不为标签改写人物口吻。
标签不代表新指令，也不改变原剧情、变量或世界书。`;

export function narrativeDisplayRegexes(){return [
  {id:'shiyi-display-context-v1',scriptName:'拾忆 · 隐藏叙事语境（仅显示）',findRegex:'/<sy_context\\b[^>]*\\/\\s*>|<sy_context\\b[^>]*>[\\s\\S]*?<\\/sy_context\\s*>/gi',replaceString:'',trimStrings:[],placement:[2],disabled:false,markdownOnly:true,promptOnly:false,runOnEdit:true,substituteRegex:0,minDepth:null,maxDepth:null},
  {id:'shiyi-display-private-v1',scriptName:'拾忆 · 隐藏心理标签外壳（保留正文）',findRegex:'/<\\/?sy_private\\b[^>]*>/gi',replaceString:'',trimStrings:[],placement:[2],disabled:false,markdownOnly:true,promptOnly:false,runOnEdit:true,substituteRegex:0,minDepth:null,maxDepth:null},
];}

function ruleSummary(draft){
  const rules = Array.isArray(draft.rules) ? draft.rules : [];
  const on = rules.filter(r => r.enabled).length;
  const kind = rules.some(r => r.kind === 'include') ? '抓/剥' :
               rules.some(r => r.kind === 'exclude') ? '只剥' : '空';
  const enabled = draft.enabled !== false;
  return `${rules.length} 条 · ${enabled ? `已启用 · ${kind}` : '已关闭'}`;
}

function collapsedCardHTML(summary){
  return `<div class="sy-ext-row" data-ext-card-collapsed>
    <b class="sy-ext-row-title">当前规则</b>
    <small class="sy-ext-row-meta" data-ext-row-meta>${esc(summary)}</small>
    <button type="button" class="sy-btn tiny" data-ext-expand>展开 ▾</button>
  </div>`;
}

function expandedCardHTML(draft, presets){
  const rules = Array.isArray(draft.rules) ? draft.rules : [];
  const rulesList = rules.length === 0
    ? '<p class="sy-empty">未设置过滤规则：保留全部安全正文。</p>'
    : rules.map((r,i)=>`<details class="sy-extraction-rule" data-extraction-rule="${esc(r.id)}" open><summary>规则 ${i+1} · ${esc(r.name)}</summary><div class="sy-grid">${field('名称',`<input data-rule-name value="${esc(r.name)}">`)}${field('用途',`<select data-rule-kind><option value="include" ${r.kind==='include'?'selected':''}>保留匹配内容</option><option value="exclude" ${r.kind==='exclude'?'selected':''}>排除匹配内容</option></select>`)}</div><label class="sy-check"><input type="checkbox" data-rule-enabled ${r.enabled?'checked':''}>启用这条</label><div class="sy-grid">${field('匹配方式',`<select data-rule-mode><option value="tag" ${r.tag!==undefined?'selected':''}>XML 标签名</option><option value="regex" ${r.tag===undefined?'selected':''}>安全正则</option></select>`)}${field('提取部分',`<select data-rule-capture><option value="0" ${r.capture===0?'selected':''}>整个匹配（标签含外壳）</option><option value="1" ${r.capture===1?'selected':''}>第一捕获组（标签内部）</option></select>`)}</div>${field('标签名或正则内容',`<input data-rule-pattern value="${esc(r.tag??r.pattern??'')}" spellcheck="false" placeholder="content 或 ^旁白：(.+)$">`)}${field('正则标志（标签模式忽略）',`<input data-rule-flags value="${esc(r.flags??'u')}" spellcheck="false" placeholder="imu">`)}<button type="button" class="sy-btn tiny" data-extraction-remove="${esc(r.id)}">删除这条规则</button></details>`).join('');
  return `<div class="sy-ext-card" data-ext-card-expanded>
    <div class="sy-ext-head">
      <span class="sy-onoff ${draft.enabled!==false?'on':''}" data-ext-switch></span>
      <span class="sy-ext-title">标签提取规则</span>
      <button type="button" class="sy-btn tiny" data-ext-collapse>收起 ▴</button>
      <button type="button" class="sy-btn tiny sy-primary" data-extraction-save>保存规则</button>
      <button type="button" class="sy-btn tiny" data-extraction-add>＋ 新增规则</button>
      <button type="button" class="sy-btn tiny" data-extraction-reset>恢复默认</button>
      <button type="button" class="sy-btn tiny" data-extraction-export>导出规则 JSON</button>
    </div>
    <div class="sy-ext-body">
      <p class="sy-help">给总结与人设模型准备阅读副本。聊天原文、显示和来源校验保持不变。</p>
      ${field('从示例开始',`<select data-extraction-preset><option value="">选择示例，不会立即保存</option><option value="safe">完整保留 · 仅安全清理</option>${presets.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select>`)}
      <label class="sy-check"><input type="checkbox" data-extraction-enabled ${draft.enabled?'checked':''}> 启用自定义读取</label>
      <label class="sy-check"><input type="checkbox" data-extraction-chinese ${draft.preferChinese?'checked':''}> 完整双语配对优先中文</label>
      <div data-extraction-rules>${rulesList}</div>
      <details class="sy-card"><summary>规则说明与 JSON 接口</summary><p class="sy-help">保留规则取并集，再减去排除范围；时间、叙事语境及私密边界受保护。标签可含属性，推荐用于 XML。正则支持字面量、字符类、一个捕获组与一个量词；不支持回溯引用、分支、查找与重复分组，防止手机卡死。复杂规则拆成多条或用标签规则。</p>${field('规则 JSON（导入只覆盖草稿）','<textarea rows="7" data-extraction-json spellcheck="false"></textarea>')}<div class="sy-actions"><button type="button" class="sy-btn tiny" data-extraction-json-load>导入 JSON 草稿</button><button type="button" class="sy-btn tiny" data-extraction-json-show>显示当前草稿 JSON</button></div>${field('从规则文件导入','<input type="file" accept=".json,application/json" data-extraction-file>')}</details>
      <section class="sy-extraction-preview"><h4>免费提取预览</h4><p class="sy-help">不调用模型，也不保存这段测试正文。使用上方尚未保存的规则。</p><div class="sy-actions">${field('聊天楼号','<input type="number" min="0" data-extraction-floor placeholder="例如 40">')}<button type="button" class="sy-btn tiny" data-extraction-chat>读取这一楼</button></div>${field('或粘贴一段原文','<textarea rows="5" data-extraction-source placeholder="粘贴带正文标签的回复，或直接粘贴普通正文"></textarea>')}<button type="button" class="sy-btn tiny" data-extraction-preview>预览粘贴内容</button><p data-extraction-metrics role="status" class="sy-help"></p><div data-extraction-warnings class="sy-help"></div><pre data-extraction-result class="sy-source-preview"></pre></section>
      <details class="sy-card"><summary>可选：配合主聊天预设的轻量标记</summary><p class="sy-help">普通预设无需改动。需要时将下面这段附加到你的输出格式说明；不会自动替你安装或覆盖预设。</p><textarea rows="8" readonly data-extraction-tag-guide>${esc(NARRATIVE_TAG_GUIDE)}</textarea><p class="sy-help">导出的酒馆正则只影响显示，不删除存档、不修改发给模型的原文。语境块隐藏显示；心理只隐藏标签，里面的描写仍可见。不要改成同时关闭"仅显示"和"仅发送"的破坏性替换。</p><button type="button" class="sy-btn tiny" data-extraction-regex-export>导出仅显示的隐藏正则</button></details>
    </div>
  </div>`;
}

export function extractionHTML({embedded=false}={}){
  const draft = defaultNarrativeExtractionConfig();
  return `<section data-view="extraction" hidden>
${embedded?'':'<header class="sy-section-heading"><small>读取，不改写</small><h3>正文提取</h3></header>'}
<p class="sy-help" data-extraction-status role="status"></p>
<div data-extraction-shell>${collapsedCardHTML(ruleSummary(draft))}</div>
</section>`;
}

export function mountExtractionView({panel,app,run,download}){
  const root=panel.querySelector?.('[data-view="extraction"]'),$=s=>root?.querySelector?.(s);
  if(!root)return {paint(){}};
  let draft=defaultNarrativeExtractionConfig(),dirty=false,loaded=null,sequence=0,previewSequence=0,expanded=false;
  const message=text=>{$('[data-extraction-status]').textContent=text;};

  function capture(){
    const en=$('[data-extraction-enabled]');const cn=$('[data-extraction-chinese]');
    if(en)draft.enabled=en.checked;
    if(cn)draft.preferChinese=cn.checked;
    if(!expanded)return draft;
    draft.rules=[...root.querySelectorAll('[data-extraction-rule]')].map(row=>{
      const read=key=>row.querySelector(`[data-rule-${key}]`);
      const tag=read('mode')?.value==='tag';
      return {id:row.dataset.extractionRule,name:read('name').value,enabled:read('enabled').checked,kind:read('kind').value,capture:Number(read('capture').value),...(tag?{tag:read('pattern').value}:{pattern:read('pattern').value,flags:read('flags').value})};
    });
    return draft;
  }

  function setExpanded(v){
    expanded = !!v;
    draw();
  }

  function draw(){
    const shell = $('[data-extraction-shell]');
    if(!shell)return;
    if(expanded){
      shell.innerHTML = expandedCardHTML(draft, NARRATIVE_EXTRACTION_PRESETS);
    } else {
      shell.innerHTML = collapsedCardHTML(ruleSummary(draft));
    }
  }

  function changed(){dirty=true;previewSequence++;message('有未保存的修改；预览使用当前草稿。');}
  function loadDraft(value){draft=normalizeNarrativeConfig(value);setExpanded(true);changed();}
  function output(result){
    const s=result.stats;
    const m=$('[data-extraction-metrics]');
    if(m)m.textContent=`原文 ${s.inputChars} 字符 → 安全正文 ${s.safeChars} → 读取 ${s.outputChars}；额外过滤 ${s.removedChars} 字符${s.fallback?' · 已回退':''}。不是 Token 计数。`;
    const w=$('[data-extraction-warnings]');
    if(w)w.textContent=result.warnings.join('\n');
    const r=$('[data-extraction-result]');
    if(r)r.textContent=result.text;
  }

  // 折叠后重新展开会替换 shell 内部所有节点，原本逐个挂的 click listener
  // 会丢失；全部走 root 委托，新增按钮只要在 actions 里注册就生效。
  const actions=new Map();

  const act=(selector,fn)=>{actions.set(selector,fn);};
  const dispatch=(e)=>{
    for(const [selector,fn] of actions){
      const target=e.target.closest(selector);
      if(target&&root.contains(target)){
        console.log('[extraction][dispatch]',selector,'target=',target.tagName,target.dataset);
        run(()=>fn(e),{name:'extraction',button:target});
        return true;
      }
    }
    return false;
  };

  // 折叠/展开/删除 — 统一 click 代理
  root.addEventListener('click',e=>{
    console.log('[extraction][root click]',e.target.tagName,e.target.dataset,e.target.className);
    const exp=e.target.closest('[data-ext-expand]');
    if(exp){setExpanded(true);return;}
    const col=e.target.closest('[data-ext-collapse]');
    if(col){setExpanded(false);return;}
    const rm=e.target.closest('[data-extraction-remove]');
    if(rm){capture();draft.rules=draft.rules.filter(r=>r.id!==rm.dataset.extractionRemove);setExpanded(true);changed();return;}
    const sw=e.target.closest('[data-ext-switch]');
    if(sw){draft.enabled=!draft.enabled;sw.classList.toggle('on',draft.enabled!==false);return;}
    if(dispatch(e))return;
  });

  root.addEventListener('input',e=>{
    if(e.target.matches('[data-extraction-source],[data-extraction-floor],[data-extraction-json],[data-extraction-file]')){previewSequence++;return;}
    if(e.target.closest('[data-extraction-rule]')||e.target.matches('[data-extraction-enabled],[data-extraction-chinese]'))changed();
  });

  // preset change：mount 时 shell 是 collapsedCardHTML，[data-extraction-preset]
  // 元素不存在；展开后委托到 root 上。
  root.addEventListener('change',e=>{
    const t=e.target.closest('[data-extraction-preset]');
    if(t&&root.contains(t)){
      if(!t.value)return;
      loadDraft(t.value==='safe'?defaultNarrativeExtractionConfig():NARRATIVE_EXTRACTION_PRESETS.find(p=>p.id===t.value)?.config ?? defaultNarrativeExtractionConfig());
      t.value='';
    }
  });

  $('[data-extraction-preset]')?.addEventListener('change',e=>{
    if(!e.target.value)return;
    loadDraft(e.target.value==='safe'?defaultNarrativeExtractionConfig():NARRATIVE_EXTRACTION_PRESETS.find(p=>p.id===e.target.value)?.config ?? defaultNarrativeExtractionConfig());
    e.target.value='';
  });

  act('[data-extraction-add]',()=>{
    capture();
    if(draft.rules.length>=16)throw Error('最多 16 条规则');
    draft.rules.push({id:`custom-${Date.now()}-${++sequence}`,name:'自定义规则',enabled:true,kind:'exclude',tag:'options',capture:0});
    setExpanded(true);changed();
  });

  act('[data-extraction-reset]',()=>{
    draft=defaultNarrativeExtractionConfig();setExpanded(true);changed();
    message('已回到默认空规则；选择示例或新增。');
  });

  act('[data-extraction-save]',async()=>{
    const config=normalizeNarrativeConfig(capture()),serialized=JSON.stringify(config),revision=previewSequence;
    await app.saveSettings({narrativeExtraction:serialized});
    loaded=serialized;
    if(revision!==previewSequence){message('规则已保存；随后编辑的草稿尚未保存。');return;}
    dirty=false;draft=config;
    message('规则已保存。新总结、人设更新和新校对计划生效；旧记忆、原文及已开始的请求不改。');
  });

  act('[data-extraction-export]',()=>download(normalizeNarrativeConfig(capture()),'拾忆-正文提取规则.json'));
  act('[data-extraction-json-show]',()=>{const el=$('[data-extraction-json]');if(el)el.value=JSON.stringify(capture(),null,2);});
  act('[data-extraction-json-load]',()=>loadDraft(($('[data-extraction-json]')||{}).value||''));

  // 文件导入：mount 时 shell 是 collapsedCardHTML，[data-extraction-file]
  // 元素不存在；展开后委托到 root 上。
  root.addEventListener('change',e=>{
    const t=e.target.closest('[data-extraction-file]');
    if(t&&root.contains(t)){
      run(async()=>{
        const f=t.files?.[0];if(!f)return;
        if(f.size>24000)throw Error('规则文件超过 24000 字节');
        loadDraft(await f.text());t.value='';
      });
    }
  });

  $('[data-extraction-file]')?.addEventListener('change',e=>run(async()=>{
    const f=e.target.files?.[0];if(!f)return;
    if(f.size>24000)throw Error('规则文件超过 24000 字节');
    loadDraft(await f.text());e.target.value='';
  }));

  act('[data-extraction-preview]',async()=>{
    const config=capture(),id=++previewSequence;
    console.log('[extraction][preview] click, source length=',$('[data-extraction-source]')?.value?.length,'config rules=',config.rules.length,'id=',id);
    const result=await app.previewNarrativeExtraction({text:$('[data-extraction-source]')?.value||'',config});
    console.log('[extraction][preview] returned, id=',id,'previewSequence=',previewSequence);
    if(id===previewSequence)output(result);
  });

  act('[data-extraction-chat]',async()=>{
    const floor=Number(($('[data-extraction-floor]')||{}).value||0);
    if(!floor)throw Error('请填写聊天楼号');
    const config=capture(),id=++previewSequence;
    const result=await app.previewNarrativeExtraction({floor,config});
    if(id===previewSequence)output(result);
  });

  act('[data-extraction-regex-export]',()=>download(narrativeDisplayRegexes(),'拾忆-轻量标记-仅显示正则.json'));

  return {paint(s){
    const stored=s.settings.narrativeExtraction??'';
    if(dirty)return;
    if(loaded===stored){
      // 配置没变并不等于状态行已经呈现；新建或被清空的 status 节点仍需补全。
      // 只在文本为空时补一次，不覆盖保存成功、预览结果、错误提示等非空反馈。
      const status=$('[data-extraction-status]');
      if(status&&status.textContent.trim()===''){
        message(stored?'已加载已保存的规则；点开折叠卡片编辑。':'默认完整保留安全正文；点开折叠卡片选择示例或 DIY。');
      }
      return;
    }
    loaded=stored;
    try{
      draft=getNarrativeConfig(stored);
      const meta=$('[data-ext-row-meta]');
      if(meta)meta.textContent=ruleSummary(draft);
      const msg=stored?'已加载已保存的规则；点开折叠卡片编辑。':'默认完整保留安全正文；点开折叠卡片选择示例或 DIY。';
      message(msg);
    }catch(error){
      draft=defaultNarrativeExtractionConfig();
      message(`已保存的规则无法读取：${error.message}；实际请求会回退安全正文。`);
    }
  }};
}
