import { readViewState } from '../src/product-view-scheduling.js';
import { esc,field } from '../src/product-settings-ui.js';
import { characterProfiles } from '../src/product-person-profiles.js';
import { sha256 } from '../src/utils.js';
import { sourceLabel } from '../src/product-narrative.js';

export function mountPersonEditor({panel,app,run}){
  let editor=null,subject=null,scope=null,rows=[];
  const close=()=>{editor?.remove();editor=null;subject=null;rows=[];};
  function render(){
    editor.innerHTML=`<h4>修改人物 · ${esc(subject)}</h4><p class="sy-help">属性名称可自定义；勾选移除后，保存时移入回收站。</p><div data-profile-rows>${rows.map((r,i)=>`<section class="sy-profile-edit-row" data-profile-row="${i}">${field('属性名称',`<input data-profile-field value="${esc(r.field)}">`)}${field('格式',`<select data-profile-format><option value="text" ${r.format==='text'?'selected':''}>文字</option><option value="json" ${r.format==='json'?'selected':''}>数值 / JSON</option></select>`)}${field('内容',`<textarea rows="3" data-profile-text>${esc(r.text)}</textarea>`)}<p class="sy-help">${esc(r.source)}</p><label class="sy-toggle"><span>移除这项内容</span><input type="checkbox" data-profile-remove ${r.remove?'checked':''}></label></section>`).join('')}</div><div class="sy-actions"><button type="button" data-profile-add>新增属性</button><button type="button" data-profile-save class="sy-primary">保存人物</button><button type="button" data-profile-cancel>取消</button></div>`;
  }
  function capture(){for(const el of editor.querySelectorAll('[data-profile-row]')){const r=rows[Number(el.dataset.profileRow)];r.field=el.querySelector('[data-profile-field]').value;r.text=el.querySelector('[data-profile-text]').value;r.format=el.querySelector('[data-profile-format]').value;r.remove=el.querySelector('[data-profile-remove]').checked;}}
  function reattach(){
    if(!editor)return;
    if(scope!==JSON.stringify(readViewState(app).core?.scope)||!readViewState(app).chatReady){close();return;}
    const card=[...panel.querySelectorAll('[data-profile]')].find(el=>el.dataset.profile===subject);
    if(card&&!card.contains(editor))card.append(editor);
  }
  function open(name){
    close();const profile=characterProfiles(readViewState(app).cards).find(p=>p.subject===name);if(!profile)return;
    subject=name;scope=JSON.stringify(readViewState(app).core?.scope);
    rows=profile.fields.flatMap(f=>f.versions.map(v=>({field:f.key,text:typeof v.value==='string'?v.value:JSON.stringify(v.value,null,2),format:typeof v.value==='string'?'text':'json',source:sourceLabel({sourceRefs:v.records.flatMap(r=>r.sourceRefs??[])}),records:v.records.map(r=>({id:r.id,expected:sha256(r)})),remove:false})));
    editor=panel.ownerDocument.createElement('div');editor.className='sy-profile-editor';editor.dataset.personEditor=name;render();
    editor.addEventListener('input',capture);editor.addEventListener('change',capture);
    editor.addEventListener('click',e=>{
      if(e.target.closest('[data-profile-cancel]'))close();
      else if(e.target.closest('[data-profile-add]')){capture();rows.push({field:'',text:'',format:'text',source:'用户新增',records:[],remove:false});render();editor.querySelector('[data-profile-row]:last-child input').focus();}
      else if(e.target.closest('[data-profile-save]')){capture();const node=editor,person=subject,payload=rows.flatMap(r=>r.records.length?r.records.map(rec=>({...r,...rec})):r.remove?[]:[r]);run(async()=>{await app.editPersonProfile(person,payload);if(editor===node)close();});}
    });reattach();editor.scrollIntoView({block:'nearest'});
  }
  return {open,reattach,close};
}
