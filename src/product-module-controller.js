import { validateModule,validateModules,readMvu,mvuContext,messageFingerprint,mvuSnapshots,mvuCards,moduleField,checkValue,customMemoryCards } from './product-custom-modules.js';
import { clone,makeId,stableStringify } from './utils.js';

export function createModuleController({host,core,state,load,getGlobal,getChat,check,notify,refresh,changed}) {
  let syncing=null;
  const clear = () => {state.moduleSnapshots=[];state.moduleCurrent=[];state.mvuStatus='no_chat';state.mvuPaths=[];};
  async function loadDefinitions() {state.modules=validateModules(await getGlobal().read('custom-modules',[]));}
  async function save(definition,{expected}={}) {
    await load();const valid=validateModule(definition);
    if(core.state.status==='running')throw new Error('请等当前总结结束后修改区块');
    const result=await getGlobal().update('custom-modules',list=>{
      list=validateModules(list);const before=list.find(m=>m.id===valid.id)??null;
      if(expected!==undefined&&stableStringify(before)!==stableStringify(expected))throw new Error('区块后来被修改，请重新生成方案');
      if(before&&before.mode!==valid.mode)throw new Error('已有区块不能更换数据来源，请新建区块');
      return validateModules([...list.filter(m=>m.id!==valid.id),valid]);
    },[]);
    state.modules=result;changed();notify();
    if(getChat()?.isCurrent()&&!state.stale)await refresh();
    return valid;
  }
  async function archive(id,archived=true) {await load();const m=state.modules.find(m=>m.id===id);if(!m)throw new Error('区块不存在');return save({...m,archived},{expected:m});}
  async function propose({action='upsert',module:definition,id,explanation=''}) {
    await load();let next,before;
    if(action==='archive') {before=state.modules.find(m=>m.id===id);if(!before)throw new Error('区块不存在');next={...before,archived:true};}
    else if(action==='upsert') {next=validateModule({...definition,id:definition?.id||makeId('module')});before=state.modules.find(m=>m.id===next.id)??null;}
    else throw new Error('区块操作无效');
    if(next.mode==='mvu'&&!next.archived){
      const oldPaths=before?.fields.map(f=>JSON.stringify(f.path))??[];
      for(const f of next.fields)if(!oldPaths.includes(JSON.stringify(f.path))&&!state.mvuPaths.some(p=>JSON.stringify(p.path)===JSON.stringify(f.path)))throw new Error('先读取当前聊天的 MVU 变量并选择真实路径，不可猜测');
    }
    state.proposal={id:makeId('plan'),scope:'global',kind:'module',patch:{},before:clone(before),module:next,explanation};
    await getGlobal().write('proposal',state.proposal);notify();return {status:'proposal_ready',module:next};
  }
  async function apply(p) {await save(p.module,{expected:p.before});}
  async function undo(p) {
    const current=state.modules.find(m=>m.id===p.module.id)??null;
    if(stableStringify(current)!==stableStringify(p.module))throw new Error('区块后来被修改，不能直接覆盖');
    await save(p.before??{...p.module,archived:true},{expected:p.module});
  }
  async function inspect() {
    check();if(state.stale)throw new Error('请先加载当前聊天再读取变量');
    const bound=getChat(),guard=()=>{check();if(bound!==getChat())throw new Error('聊天已切换');};
    const result=await readMvu(host,guard);guard();
    state.mvuStatus=result.status;state.mvuPaths=result.paths??[];notify();
    // Only candidate paths/types leave this method. No unrelated values or
    // credentials are exposed to the assistant's discovery tool.
    return {status:result.status,floor:result.floor,paths:result.paths??[]};
  }
  async function sync() {
    const bound=getChat();if(!state.modules.some(m=>m.mode==='mvu'&&m.enabled&&!m.archived)){state.moduleCurrent=[];return;}if(!bound?.isCurrent()||state.stale){clear();return;}
    if(syncing?.bound===bound)return syncing.promise;
    const promise=(async()=>{
      const guard=()=>{check();if(bound!==getChat()||state.stale)throw new Error('聊天已变化');};
      const read=await readMvu(host,guard);guard();
      state.mvuStatus=read.status;state.mvuPaths=read.paths??[];
      const all=await bound.read('custom-mvu-snapshots',[]);guard();
      const chat=mvuContext(host)?.chat??[];
      const valid=all.filter(r=>chat[r.floor]&&messageFingerprint(chat[r.floor])===r.fingerprint);
      const rows=mvuSnapshots(state.modules,read,valid);
      if(rows.length && rows.some(r=>stableStringify(all.find(old=>r.moduleId===old.moduleId&&r.floor===old.floor))!==stableStringify(r))) await bound.update('custom-mvu-snapshots',list=>{
        guard();return [...list.filter(old=>!rows.some(r=>r.moduleId===old.moduleId&&r.floor===old.floor)),...rows].sort((a,b)=>a.floor-b.floor);
      },[]);
      guard();const previousCurrent=stableStringify(state.moduleCurrent);state.moduleSnapshots=[...valid.filter(old=>!rows.some(r=>r.moduleId===old.moduleId&&r.floor===old.floor)),...rows].sort((a,b)=>a.floor-b.floor);
      // A missing/failed current read must never advertise an old value as current.
      state.moduleCurrent=rows;const different=previousCurrent!==stableStringify(rows);if(different){changed();notify();}return different;
    })();
    syncing={bound,promise};try{return await promise;}catch(e){if(bound===getChat()){state.moduleCurrent=[];state.mvuPaths=[];state.mvuStatus='error';changed();notify();}throw e;}finally{if(syncing?.promise===promise)syncing=null;}
  }
  function cards(normal) {return [...customMemoryCards(normal,state.modules),...mvuCards(state.modules,state.moduleCurrent)];}
  async function remember(id,fieldId,value,subject='') {
    await load();check();const m=state.modules.find(m=>m.id===id&&!m.archived),f=m?.fields.find(f=>f.id===fieldId);
    if(!m||!f)throw new Error('区块或字段不存在');if(m.mode==='mvu')throw new Error('MVU 区块只读，请在角色卡变量系统修改');
    checkValue(value,f.type);
    await core.remember(String(value),{category:'entityFactChanges',subject:subject.trim()||m.subject||m.name,field:moduleField(id,fieldId),typedValue:value});
    await refresh();
  }
  async function editRecord(id,value){
    check();const card=state.cards.find(c=>c.id===id),m=state.modules.find(m=>m.id===card?.customModuleId&&!m.archived),f=m?.fields.find(f=>f.id===card?.fieldId);
    if(!f||m.mode==='mvu')throw new Error('MVU 只读或记录已不存在');
    checkValue(value,f.type);await core.updateMemoryControls({edits:{[id]:{to:value,description:String(value)}}});await refresh();
  }
  async function importDefinitions(document) {
    if(document?.kind!=='shiyi-modules'||document.version!==1)throw new Error('请选择拾忆区块定义 JSON');
    const list=validateModules(document.modules);await load();
    // Imports add definitions only; differing existing IDs are not overwritten.
    state.modules=await getGlobal().update('custom-modules',old=>{
      for(const m of list){const found=old.find(x=>x.id===m.id);if(found&&stableStringify(found)!==stableStringify(m))throw new Error('导入区块 ID 与已有定义冲突，未覆盖');}
      return validateModules([...old,...list.filter(m=>!old.some(x=>x.id===m.id))]);
    },[]);changed();if(getChat()?.isCurrent()&&!state.stale)await refresh();notify();
  }
  return {loadDefinitions,save,editRecord,archive,propose,apply,undo,inspect,sync,cards,clear,remember,importDefinitions,
    exportDefinitions:()=>({kind:'shiyi-modules',version:1,modules:clone(state.modules)})};
}
