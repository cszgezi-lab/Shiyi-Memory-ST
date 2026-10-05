import {clone,sha256,stableStringify} from './utils.js';
import {mvuContext,readMvu} from './product-custom-modules.js';
import {personaSpans,replacePersonaSpans} from './dynamic-persona-stage.js';
import {personaCardSource,personaPromptSnapshot,personaPromptLayout} from './persona-card-source.js';
import {personaSourceIndex,personaSharedTitle} from './persona-source-index.js';
import {foldName} from './persona-identity.js';

export function createPersonaWorldbook({host=globalThis,check=()=>{},context=()=>null,stageMode=()=> 'narrative'}={}){
  const markers=new Map();let sequence=0,cardCapture=null,loadedOwnership=null;
  const attachedManagers=new WeakMap();
  const contextKey=()=>stableStringify(context());
  const markerPattern=()=>/\[\[SHIYI_PERSONA:([a-f0-9]+):([a-f0-9]+):([a-f0-9]+)\]\]/g;
  function foreignRequest(payload){
    const current=contextKey();
    return (payload?.messages??[]).some(m=>typeof m.content==='string'&&[...m.content.matchAll(markerPattern())].some(match=>markers.get(match[1])?.context!==current));
  }
  // The original-ST edition injects an authenticated, read-only bridge. A
  // separately installed helper must not replace that source contract or
  // re-enable worldbook writes through the optional mirror path.
  const api=()=>host.__SHIYI_EDITION__==='sillytavern'?host:host.TavernHelper??host;
  const renderText=text=>{const c=mvuContext(host)??{};return String(text).replace(/\{\{(user|char)\}\}/gi,(_m,key)=>key.toLowerCase()==='user'?(c.name1??'玩家'):(c.name2??'当前角色'));};
  async function stageData({foreground=false}={}){if(!host.Mvu?.getMvuData)return {};const result=await readMvu(host,check,foreground?{maxFloors:8,totalMs:80}:{});return result.data??{};}
  async function read(){
    check();const h=api(),context=mvuContext(host)??{},card=context.characters?.[context.characterId];
    const cardName=card?.name??context.name2??'当前角色卡';
    const cardSource=personaCardSource(context);
    if(typeof h.getCharWorldbookNames!=='function'||typeof h.getWorldbook!=='function')return {cardName,entries:cardSource.entries,spans:cardSource.spans,status:cardSource.entries.length?'ready':'unavailable'};
    const binding=await h.getCharWorldbookNames('current');check();
    const chat=await h.getChatWorldbookName?.('current');check();
    const names=[...new Set([binding?.primary,...(binding?.additional??[]),chat].filter(Boolean))];
    const entries=[];
    for(const book of names){const rows=await h.getWorldbook(book);check();for(const row of rows){if(row.extra?.shiyiDynamicPersona)continue;entries.push({book,uid:row.uid,name:row.name??row.comment??'',keys:Array.isArray(row.strategy?.keys)?row.strategy.keys:Array.isArray(row.key)?row.key:[],enabled:row.enabled!==false&&row.disable!==true,content:String(row.content??'')});}}
    const data=entries.some(e=>e.enabled&&e.content.includes('<%'))?await stageData():{};check();
    return {cardName,entries:[...entries,...cardSource.entries],spans:[...entries.filter(e=>e.enabled).flatMap(e=>personaSpans(e,data)),...cardSource.spans],status:'ready'};
  }
  function attachPromptManager(manager){
    if(!manager||typeof manager.setChatCompletion!=='function')return ()=>{};
    if(attachedManagers.has(manager))return attachedManagers.get(manager).dispose;
    const original=manager.setChatCompletion;let active=true;
    function wrapped(completion,...args){
      // Capture errors must never make a host generation fail. The original
      // function still owns its return value and exceptions, unchanged.
      if(!active)return original.call(this,completion,...args);
      let captured=null;cardCapture=null;
      try{captured={context:contextKey(),mode:stageMode(),card:personaCardSource(mvuContext(host)??{}),snapshot:personaPromptSnapshot(completion)};}catch{/* Optional source coverage only. */}
      const result=original.call(this,completion,...args);cardCapture=captured;return result;
    }
    const dispose=()=>{active=false;if(manager.setChatCompletion===wrapped)manager.setChatCompletion=original;attachedManagers.delete(manager);cardCapture=null;};
    try{manager.setChatCompletion=wrapped;}catch{return ()=>{};}
    attachedManagers.set(manager,{dispose});return dispose;
  }
  function applyCardPrompt(payload,profiles=[]){
    const captured=cardCapture;cardCapture=null;
    if(payload?.dryRun||!captured||!profiles.length||captured.context!==contextKey()||captured.mode!==stageMode())return {preparedFields:0};
    const ctx=mvuContext(host)??{},current=personaCardSource(ctx);
    if(!current.cardId||current.cardId!==captured.card.cardId)return {preparedFields:0,reason:'card_changed'};
    const layout=personaPromptLayout(captured.snapshot,payload.chat,{squash:Boolean(ctx.chatCompletionSettings?.squash_system_messages)});
    if(!layout)return {preparedFields:0,reason:'prompt_provenance_mismatch'};
    const token=sha256([captured.context,++sequence,Date.now()]).slice(0,24);
    const prepared={context:captured.context,mode:captured.mode,originals:new Map(),entries:new Map(),cardSources:new Map(),profiles:new Map(profiles.map(p=>[p.id,sha256(p)]))};
    let preparedFields=0;
    for(let i=0;i<layout.length;i++){
      const edits=[];
      for(const part of layout[i].parts){
        const spans=current.spans.filter(s=>s.identifier===part.identifier&&captured.card.spans.some(old=>old.id===s.id));
        for(const span of spans){
          if(typeof part.content!=='string')continue;
          const owners=profiles.filter(p=>p.bindings?.some(b=>b.sourceKind==='character_card'&&b.cardId===span.cardId&&b.field===span.field&&b.id===span.id&&b.hash===span.hash));
          if(owners.length!==1)continue;
          // The identifier proves which host field this segment represents.
          // Its one exact rendered field preserves any host format wrapper.
          const original=renderText(span.text),start=part.content.indexOf(original);
          if(!original||start<0||part.content.indexOf(original,start+original.length)!==-1)continue;
          const p=owners[0],key=`${p.id}:${span.id}`;
          prepared.originals.set(key,original);prepared.entries.set(key,stableStringify(['character_card',span.cardId,span.field]));prepared.cardSources.set(key,{cardId:span.cardId,field:span.field,hash:span.hash});
          edits.push({start:part.start+start,end:part.start+start+original.length,text:`[[SHIYI_PERSONA:${token}:${key}]]`});preparedFields++;
        }
      }
      for(const edit of edits.sort((a,b)=>b.start-a.start))payload.chat[i].content=payload.chat[i].content.slice(0,edit.start)+edit.text+payload.chat[i].content.slice(edit.end);
    }
    if(prepared.originals.size)markers.set(token,prepared);
    while(markers.size>128)markers.delete(markers.keys().next().value);
    return {preparedFields};
  }
  // A separate, disabled mirror is inspectable in the world's editor, but is
  // not bound globally or to the chat: the request hook is its only injector.
  async function mirror(scope,profiles,cardName){
    check();const h=api();if(!h.getWorldbookNames||!h.createWorldbook||!h.replaceWorldbook||!h.getWorldbook)return {status:'unavailable'};
    const owner=sha256(scope),name=`${cardName}＋角色模块·${owner.slice(0,10)}`;
    const names=await h.getWorldbookNames();check();
    if(names.includes(name)){const old=await h.getWorldbook(name);check();if(old.some(e=>e.extra?.shiyiDynamicPersona!==owner))throw new Error('同名世界书含用户条目，未覆盖');}
    else {await h.createWorldbook(name,[]);check();}
    const entries=profiles.filter(p=>!p.deleted).map((p,i)=>({uid:i,name:p.name,enabled:false,content:p.text,extra:{shiyiDynamicPersona:owner,profileId:p.id,through:p.through,stage:p.stage},strategy:{type:'constant',keys:[],keys_secondary:{logic:'and_any',keys:[]},scan_depth:'same_as_global'},position:{type:'before_character_definition',role:'system',depth:0,order:100},probability:100,recursion:{prevent_incoming:true,prevent_outgoing:true,delay_until:null},effect:{sticky:null,cooldown:null,delay:null}}));
    await h.replaceWorldbook(name,entries);check();const saved=await h.getWorldbook(name);check();
    if(saved.length!==entries.length||entries.some(e=>!saved.some(s=>s.extra?.profileId===e.extra.profileId&&s.content===e.content&&s.enabled===false)))throw new Error('动态世界书读回不一致；聊天档案仍保留');
    return {status:'saved',name};
  }
  async function applyLoaded(payload,profiles){
    loadedOwnership=null;
    if(!payload||typeof payload!=='object'||!profiles.length)return;
    // Native ST loads lore for both chat and text completion. Only the chat
    // completion path emits the final settings event that resolves markers;
    // preserve original text on every other path, including unknown APIs.
    if(host.__SHIYI_EDITION__==='sillytavern'&&mvuContext(host)?.mainApi!=='openai')return;
    const binding=contextKey(),mode=stageMode(),narrative=mode!=='strict';
    const dynamic=!narrative&&profiles.some(p=>p.bindings?.some(b=>b.stage!=='static'));
    let data={};if(dynamic){try{data=await stageData({foreground:true});}catch{return;}}check();if(binding!==contextKey()||mode!==stageMode())return;
    const token=sha256([binding,++sequence,Date.now()]).slice(0,24),prepared={context:binding,mode,originals:new Map(),entries:new Map(),profiles:new Map(profiles.map(p=>[p.id,sha256(p)])),ownershipRejected:new Set()};
    loadedOwnership=prepared;
    const owned=new Map();for(const p of profiles)for(const b of p.bindings??[]){if(b.sourceKind==='character_card')continue;const key=stableStringify([b.book,b.uid]);if(!owned.has(key))owned.set(key,[]);if(!owned.get(key).includes(p))owned.get(key).push(p);}
    for(const key of ['globalLore','characterLore','chatLore','personaLore']){
      if(!Array.isArray(payload[key]))continue;
      // Never mutate the host's cached entry objects.
      const entries=payload[key],updated=entries.map(entry=>{
        const book=entry.world??entry.book,uid=entry.uid;
        const candidates=owned.get(stableStringify([book,uid]));if(!candidates?.length)return entry;
        const name=entry.comment??entry.name??'';
        if(entry.enabled===false||entry.disable===true||personaSharedTitle(name)){for(const p of candidates)prepared.ownershipRejected.add(p.id);return entry;}
        const source={book,uid,name,content:entry.content,enabled:true,keys:Array.isArray(entry.strategy?.keys)?entry.strategy.keys:Array.isArray(entry.key)?entry.key:Array.isArray(entry.keys)?entry.keys:[]};
        const spans=personaSpans(source,data,{allBranches:narrative});
        // Old saved bindings are provenance, not permanent ownership. Recheck
        // the entry metadata already loaded by the host; this does not read a
        // worldbook, history or model at send time. A renamed/shared/mixed
        // source must remain original even when its text hash is unchanged.
        const indexed=personaSourceIndex({entries:[source],spans},{previous:profiles}),replacements={};
        // Ownership changes apply to the bound entry identity even when its
        // body also changed. Hashes decide safe text replacement below; they
        // cannot authorize a stale dossier to bypass a metadata rejection.
        for(const p of candidates)if(!indexed.spans.length||indexed.spans.some(s=>s.ownerKey!==foldName(p.name)))prepared.ownershipRejected.add(p.id);
        for(const span of indexed.spans){const matching=candidates.filter(p=>p.bindings?.some(b=>b.book===book&&b.uid===uid&&b.hash===span.hash&&(narrative||b.id===span.id&&b.stage===span.stage))),owners=matching.filter(p=>span.ownerKey===foldName(p.name));
          for(const p of matching)if(!owners.includes(p)||owners.length!==1)prepared.ownershipRejected.add(p.id);
          if(owners.length!==1)continue;const p=owners[0];
          const key=`${p.id}:${span.id}`;prepared.originals.set(key,span.text);prepared.entries.set(key,stableStringify([book,uid]));replacements[span.id]=`\n[[SHIYI_PERSONA:${token}:${key}]]\n`;
        }
        return Object.keys(replacements).length?{...clone(entry),content:replacePersonaSpans(entry.content,spans,replacements)}:entry;
      });
      // SillyTavern retains these array references after emitting the event.
      // Replace elements, not payload properties; entry objects remain cloned.
      for(let i=0;i<entries.length;i++)entries[i]=updated[i];
    }
    if(prepared.originals.size)markers.set(token,prepared);
    // Bound retained request contexts; never grow with the entire chat archive.
    while(markers.size>128)markers.delete(markers.keys().next().value);
  }
  async function finalize(payload,profiles){
    const ownership=loadedOwnership;loadedOwnership=null;
    if(!Array.isArray(payload?.messages))return;
    const currentCard=personaCardSource(mvuContext(host)??{}),rejectedSources=new Set(profiles.filter(p=>p.bindings?.some(b=>b.sourceKind==='character_card'&&!currentCard.spans.some(s=>s.cardId===b.cardId&&s.field===b.field&&s.id===b.id&&s.hash===b.hash))).map(p=>p.id));
    // An activated source with changed/ambiguous ownership cannot fall back to
    // injecting the same polluted dossier beside its now-preserved original.
    // Consume only this request's receipt; another chat or dossier revision
    // must not inherit the rejection.
    if(ownership?.context===contextKey()&&ownership.mode===stageMode())for(const p of profiles)if(ownership.ownershipRejected.has(p.id)&&ownership.profiles.get(p.id)===sha256(p))rejectedSources.add(p.id);
    const sourceKey=b=>stableStringify([b.cardId,b.field,b.hash]),covered=new Map(),profileById=new Map(profiles.map(p=>[p.id,p])),stalePreparedProfiles=new Set();
    // A card-bound dossier is atomic across its owned fields and worldbook
    // entries. Without complete request provenance, supplemental fallback
    // would reintroduce a current dossier alongside an untouched old card.
    // Count only this request's verified markers; never search old prose.
    for(const message of payload.messages)if(typeof message.content==='string')for(const match of message.content.matchAll(markerPattern())){
      const [,token,id,spanId]=match,prepared=markers.get(token),profile=profileById.get(id),key=`${id}:${spanId}`,source=prepared?.cardSources?.get(key);
      // Worldbook preparation can precede card preparation. A dossier may
      // change between them; one fresh card token cannot authorize combining
      // it with restored old worldbook text from the earlier revision.
      if(profile&&prepared?.originals.has(key)&&(prepared.context!==contextKey()||prepared.mode!==stageMode()||prepared.profiles.get(id)!==sha256(profile))){rejectedSources.add(id);stalePreparedProfiles.add(id);}
      if(!source||!profile||prepared.context!==contextKey()||prepared.mode!==stageMode()||prepared.profiles.get(id)!==sha256(profile))continue;
      if(!profile.bindings?.some(b=>b.sourceKind==='character_card'&&b.id===spanId&&sourceKey(b)===sourceKey(source)))continue;
      if(!currentCard.spans.some(s=>s.id===spanId&&sourceKey(s)===sourceKey(source)))continue;
      if(!covered.has(id))covered.set(id,new Set());covered.get(id).add(sourceKey(source));
    }
    const missingCardProfiles=new Set(profiles.filter(p=>p.bindings?.some(b=>b.sourceKind==='character_card'&&!covered.get(p.id)?.has(sourceKey(b)))).map(p=>p.id));
    for(const id of missingCardProfiles)rejectedSources.add(id);
    if(!payload.messages.some(m=>typeof m.content==='string'&&m.content.includes('[[SHIYI_PERSONA:')))return {injected:[],rejectedSources:[...rejectedSources],missingCardProfiles:missingCardProfiles.size,stalePreparedProfiles:stalePreparedProfiles.size};
    const mode=stageMode();let data={};if(mode==='strict'&&profiles.some(p=>p.bindings?.some(b=>b.stage!=='static')))try{data=await stageData({foreground:true});check();}catch{data=null;}
    const valid=profiles.filter(p=>!rejectedSources.has(p.id)&&p.bindings?.length&&(mode!=='strict'||p.bindings.every(b=>b.stage==='static'||data&&personaSpans({book:b.book,uid:b.uid,name:b.name,content:b.entryContent},data).some(s=>s.id===b.id)))),byId=new Map(valid.map(p=>[p.id,p])),used=new Set();
    let replacedFragments=0,restoredFragments=0,replacedCardFields=0;const replacedEntries=new Set();
    for(const m of payload.messages)if(typeof m.content==='string')m.content=m.content.replace(markerPattern(),(_all,token,id,spanId)=>{
      const prepared=markers.get(token),p=byId.get(id),frozen=prepared?.profiles.get(id),key=`${id}:${spanId}`;
      const source=prepared?.cardSources?.get(key),sourceValid=!source||currentCard.cardId===source.cardId&&currentCard.spans.some(s=>s.field===source.field&&s.hash===source.hash);
      if(prepared?.context!==contextKey()||prepared?.mode!==mode||!p||!frozen||sha256(p)!==frozen||!sourceValid){if(!sourceValid)rejectedSources.add(id);restoredFragments++;return prepared?.originals.get(key)??'';}
      replacedFragments++;replacedEntries.add(prepared.entries.get(key));
      if(source)replacedCardFields++;
      if(used.has(id))return '';used.add(id);return renderText(`【${p.name}·当前动态人设，依据至 #${p.through}；更新楼层后的正文优先${mode==='strict'?'':'；剧情主导，MVU仅作参考'}】\n${p.text}`);
    });
    return {injected:[...used],replacedEntries:replacedEntries.size,replacedFragments,restoredFragments,replacedCardFields,rejectedSources:[...rejectedSources],missingCardProfiles:missingCardProfiles.size,stalePreparedProfiles:stalePreparedProfiles.size};
  }
  return {read,mirror,applyLoaded,attachPromptManager,applyCardPrompt,stageData,finalize,foreignRequest,renderText};
}
