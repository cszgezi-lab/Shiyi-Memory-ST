import {esc,field} from '../src/product-settings-ui.js';
import {normalizeNarrativeConfig,getNarrativeConfig,defaultNarrativeRegexConfig} from '../src/narrative-extraction.js';
import {failureText} from '../src/product-feedback.js';

export const NARRATIVE_REGEX_EXAMPLES=Object.freeze({
  includeRegex:'/<content\\b[^>]*>([\\s\\S]*?)<\\/content\\s*>/gi',
  excludeRegex:'/<xml\\b[^>]*>[\\s\\S]*?<\\/xml\\s*>/gi',
});

export function extractionHTML({embedded=false}={}){
  return `<section data-view="extraction" hidden>
${embedded?'':'<header class="sy-section-heading"><h3>标签管理</h3></header>'}
<p class="sy-help">用正则决定提取或排除哪些正文；聊天原文与已有档案保留。</p>
<div data-extraction-rules></div>
<button type="button" data-extraction-add>新增标签</button>
<p data-extraction-legacy class="sy-help" hidden></p>
<section class="sy-extraction-editor" data-extraction-editor hidden>
  <h4 data-extraction-editor-title>新增标签</h4><p class="sy-help">保存后按这些正则读取。</p>
  ${field('用途','<select data-extraction-kind><option value="exclude" selected>排除</option><option value="include">提取</option></select>')}
  ${field('正则表达式','<textarea rows="3" data-extraction-expression spellcheck="false" autocapitalize="off" autocomplete="off" aria-describedby="sy-extraction-example" placeholder="填写一条完整正则，可写 /表达式/标志"></textarea>')}
  <p id="sy-extraction-example" class="sy-regex-example">示例：<code data-extraction-example></code><small data-extraction-example-help></small></p>
  <p data-extraction-replace-note class="sy-help" hidden>填写新正则替换这条旧规则，其他规则保留。</p>
  <div class="sy-actions"><button type="button" class="sy-primary" data-extraction-save>保存</button><button type="button" data-extraction-cancel>取消</button></div>
</section>
<p data-extraction-status role="status" class="sy-help"></p>
<p id="sy-extraction-error" data-extraction-error role="alert" class="sy-help" hidden></p>
<details class="sy-extraction-preview" data-extraction-preview-panel>
  <summary>预览</summary>
  <p class="sy-help">免费，不调用模型或保存测试正文；编辑中的正则可先预览，再保存。</p>
  ${field('粘贴原文','<textarea rows="5" data-extraction-source placeholder="粘贴一段聊天原文"></textarea>')}
  <button type="button" data-extraction-preview>预览粘贴内容</button>
  <div class="sy-actions">${field('或读取聊天楼号','<input type="number" min="1" inputmode="numeric" data-extraction-floor placeholder="例如 40">')}<button type="button" data-extraction-chat>读取并预览</button></div>
  <p data-extraction-metrics role="status" class="sy-help"></p>
  <p data-extraction-warnings class="sy-help"></p>
  <p data-extraction-empty class="sy-help" hidden>没有需要读取的正文；请检查表达式和测试原文。</p>
  <pre data-extraction-result class="sy-source-preview"></pre>
</details>
</section>`;
}

const copy=value=>JSON.parse(JSON.stringify(value));
function regularRules(config){
  if(config.version!==2)return [];
  if(Array.isArray(config.rules))return config.rules.map(rule=>({...rule}));
  return ['includeRegex','excludeRegex'].filter(key=>config[key]?.trim()).map(key=>({id:key,kind:key==='includeRegex'?'include':'exclude',expression:config[key]}));
}
function legacyOf(config){return config.version===1?config:config.legacyConfig??null;}
function entriesOf(config){
  const legacy=legacyOf(config);
  return [...(legacy?.rules??[]).map(rule=>({key:`legacy:${rule.id}`,id:rule.id,kind:rule.kind,legacy:true,rule,
    expression:rule.tag!==undefined?`<${rule.tag}>…</${rule.tag}>`:`/${rule.pattern}/${rule.flags??'u'}`})),
    ...regularRules(config).map(rule=>({key:`regex:${rule.id}`,...rule,legacy:false}))];
}
// Only explicit CRUD creates the new container. Retained legacy rules and
// global options remain their complete original objects, never guessed regexes.
function updatedConfig(base,entry,newRule){
  if(base.version===1&&!newRule)return {...copy(base),rules:copy(base.rules.filter(rule=>rule.id!==entry.id))};
  const next={version:2,enabled:newRule?true:base.enabled!==false,rules:regularRules(base)};
  const legacy=legacyOf(base);
  if(legacy){
    const retained=copy(legacy);
    if(entry?.legacy)retained.rules=retained.rules.filter(rule=>rule.id!==entry.id);
    if(retained.rules.length)next.legacyConfig=retained;
  }
  if(entry&&!entry.legacy)next.rules=newRule?next.rules.map(rule=>rule.id===entry.id?newRule:rule):next.rules.filter(rule=>rule.id!==entry.id);
  if(newRule&&(!entry||entry.legacy))next.rules.push(newRule);
  return next;
}

export function mountExtractionView({panel,app,run}){
  const root=panel.querySelector?.('[data-view="extraction"]'),$=s=>root?.querySelector?.(s);
  if(!root)return {paint(){}};
  let loaded=null,config=defaultNarrativeRegexConfig(),editing=null,dirty=false,previewSequence=0,sequence=0;
  const message=text=>{$('[data-extraction-status]').textContent=text;};
  const expression=()=> $('[data-extraction-expression]');
  function clearError(){
    expression().removeAttribute('aria-invalid');expression().setAttribute('aria-describedby','sy-extraction-example');
    const note=$('[data-extraction-error]');note.textContent='';note.hidden=true;
  }
  function showError(error){
    const note=$('[data-extraction-error]');note.textContent=failureText(error);note.hidden=false;
    if(editing){expression().setAttribute('aria-invalid','true');expression().setAttribute('aria-describedby','sy-extraction-example sy-extraction-error');expression().focus();}
  }
  function validated(value){
    clearError();
    try{return normalizeNarrativeConfig(value);}catch(error){showError(error);throw error;}
  }
  function drawList(){
    const entries=entriesOf(config);
    $('[data-extraction-rules]').innerHTML=entries.length?entries.map(entry=>{
      const type=`${entry.legacy?'旧':''}${entry.kind==='include'?'提取':'排除'}${entry.rule?.enabled===false?' · 未启用':''}`;
      const shortened=entry.expression.length>100?`${entry.expression.slice(0,100)}…`:entry.expression;
      return `<div class="sy-extraction-item" data-extraction-rule="${esc(entry.key)}"><div class="sy-extraction-rule-copy"><strong>${esc(type)}</strong><span title="${esc(entry.expression)}" data-extraction-rule-expression>${esc(shortened)}</span></div><div class="sy-actions"><button type="button" data-extraction-edit="${esc(entry.key)}">编辑</button><button type="button" data-extraction-delete="${esc(entry.key)}">删除</button></div></div>`;
    }).join(''):'<p class="sy-help" data-extraction-no-rules>还没有标签；默认读取全部安全正文。</p>';
    const legacy=legacyOf(config),note=$('[data-extraction-legacy]');note.hidden=!legacy;
    note.textContent=legacy?'旧规则完整保留，未自动转换；编辑只替换选中的一条。':'';
  }
  function showExample(){
    const include=$('[data-extraction-kind]').value==='include';
    $('[data-extraction-example]').textContent=NARRATIVE_REGEX_EXAMPLES[include?'includeRegex':'excludeRegex'];
    $('[data-extraction-example-help]').textContent=include?'提取 content 里的正文；有捕获组就取组内内容，没有就取整个匹配。':'整个 xml 块一起排除，包含标签和其中的正文。';
  }
  function changed(){
    dirty=true;previewSequence++;clearError();
    message('有未保存的修改；预览使用编辑草稿。'+($('[data-extraction-metrics]').textContent?'下方为上次预览，请重新预览。':''));
  }
  function openEditor(entry=null){
    editing=entry?{...entry,...(entry.legacy?{replacementId:`rule-${Date.now()}-${++sequence}`}:{})}: {key:null,id:`rule-${Date.now()}-${++sequence}`,kind:'exclude',legacy:false};
    dirty=false;previewSequence++;clearError();
    $('[data-extraction-kind]').value=editing.kind;expression().value=entry&&!entry.legacy?entry.expression:'';
    $('[data-extraction-editor-title]').textContent=entry?'编辑标签':'新增标签';
    $('[data-extraction-replace-note]').hidden=!entry?.legacy;
    $('[data-extraction-editor]').hidden=false;showExample();expression().focus();
    message(entry?.legacy?'旧规则还未改变；填写新正则后保存才替换这一条。':'填写正则后保存；取消不会改动已保存的标签。');
  }
  function closeEditor(){
    editing=null;dirty=false;previewSequence++;clearError();$('[data-extraction-editor]').hidden=true;
  }
  function draftRule(){
    return {id:editing.replacementId??editing.id,kind:$('[data-extraction-kind]').value,expression:expression().value};
  }
  function candidateConfig(){
    return validated(editing&&dirty?updatedConfig(config,editing.key?editing:null,draftRule()):config);
  }
  function output(result){
    const s=result.stats;
    $('[data-extraction-metrics]').textContent=`原文 ${s.inputChars} 字符 → 读取 ${s.outputChars} 字符；额外过滤 ${s.removedChars} 字符。不是 Token 计数。`;
    $('[data-extraction-warnings]').textContent=result.warnings.join('\n');
    $('[data-extraction-result]').textContent=result.text;$('[data-extraction-empty]').hidden=Boolean(result.text);
    message(dirty?'预览已更新；编辑草稿尚未保存。':config.enabled===false?'预览已更新；已保存的规则未启用，因此未额外过滤。':'预览已更新；使用当前保存的标签。');
  }
  async function saveConfig(next,revision){
    const normalized=validated(next),serialized=JSON.stringify(normalized);
    await app.saveSettings({narrativeExtraction:serialized});
    loaded=serialized;config=normalized;drawList();
    if(revision!==previewSequence){message('已保存；随后编辑的草稿尚未保存。');return false;}
    return true;
  }
  root.addEventListener('input',e=>{
    if(e.target.matches('[data-extraction-source],[data-extraction-floor]')){previewSequence++;if($('[data-extraction-metrics]').textContent)message('测试原文或楼号已修改；下方为上次预览，请重新预览。');return;}
    if(e.target.matches('[data-extraction-expression]'))changed();
  });
  root.addEventListener('change',e=>{if(e.target.matches('[data-extraction-kind]')){showExample();changed();}});
  const actions=new Map();
  actions.set('[data-extraction-add]',()=>openEditor());
  actions.set('[data-extraction-edit]',target=>{const entry=entriesOf(config).find(entry=>entry.key===target.dataset.extractionEdit);if(entry)openEditor(entry);});
  actions.set('[data-extraction-cancel]',()=>{closeEditor();message('已取消编辑；保存的标签保留。'+($('[data-extraction-metrics]').textContent?'下方为上次预览，可重新预览已保存的标签。':''));});
  actions.set('[data-extraction-save]',async()=>{
    if(!editing)return;
    const revision=previewSequence,next=updatedConfig(config,editing.key?editing:null,draftRule());
    if(await saveConfig(next,revision)){closeEditor();message('已保存；后续读取使用新规则。聊天原文和已有结果保留。');}
  });
  actions.set('[data-extraction-delete]',async target=>{
    const entry=entriesOf(config).find(entry=>entry.key===target.dataset.extractionDelete);if(!entry)return;
    const revision=++previewSequence;
    if(await saveConfig(updatedConfig(config,entry,null),revision)){
      if(editing?.key===entry.key)closeEditor();
      message('已删除这条标签；其他规则、聊天原文和已有结果保留。'+($('[data-extraction-metrics]').textContent?'下方为上次预览，请重新预览。':''));
    }
  });
  actions.set('[data-extraction-preview]',async()=>{
    const next=candidateConfig(),id=++previewSequence;
    try{const result=await app.previewNarrativeExtraction({text:$('[data-extraction-source]').value,config:next});if(id===previewSequence)output(result);}catch(error){showError(error);throw error;}
  });
  actions.set('[data-extraction-chat]',async()=>{
    const floor=Number($('[data-extraction-floor]').value);
    if(!Number.isSafeInteger(floor)||floor<1)throw Error('请填写聊天楼号');
    const next=candidateConfig(),id=++previewSequence;
    try{const result=await app.previewNarrativeExtraction({floor,config:next});if(id===previewSequence)output(result);}catch(error){showError(error);throw error;}
  });
  root.addEventListener('click',e=>{
    for(const [selector,fn] of actions){const target=e.target.closest(selector);if(target&&root.contains(target)){run(()=>fn(target),{name:'extraction',button:target});return;}}
  });
  return {paint(s){
    const stored=s.settings.narrativeExtraction??'';
    if(loaded===stored)return;
    loaded=stored;
    try{
      config=stored?getNarrativeConfig(stored):defaultNarrativeRegexConfig();drawList();
      if(editing){message('保存的标签列表已更新；编辑草稿保留。');return;}
      clearError();message(legacyOf(config)?'已保留旧规则；可直接预览，或选择一条编辑。':config.enabled===false?'已保存的规则未启用；预览沿用该状态。':stored?'已加载保存的标签。':'还没有标签；可新增一条正则。');
    }catch{message('保存的规则暂时无法读取；原设置未改，请检查后重试。');}
  }};
}

