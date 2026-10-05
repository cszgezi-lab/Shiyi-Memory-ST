/** Original SillyTavern 1.19.0 worldbook reader. No mutation endpoints or cache
 * writes are exposed. Group books are source candidates, not an injection list:
 * the existing persona source picker still requires grounded person ownership
 * and current dialogue relevance, and shared/ambiguous entries stay shared. */
export function createSTWorldbookBridge({context,worldInfoModule={},fetchImpl=globalThis.fetch,getRequestHeaders,loadWorldInfo}={}){
  const current=()=>(typeof context==='function'?context():context)??{};
  const names=values=>[...new Set(values.filter(value=>typeof value==='string'&&value.trim().length))];
  const fail=(message,code='ST_WORLDBOOK_UNAVAILABLE')=>Object.assign(new Error(message),{code});
  const scope=ctx=>JSON.stringify([ctx.groupId??null,ctx.characterId??null,ctx.chatId??ctx.getCurrentChatId?.()??null,binding(ctx)]);
  const assertScope=before=>{if(scope(current())!==before)throw fail('读取世界书期间当前聊天或人物已变化','CHAT_CHANGED');};
  const avatarName=card=>typeof card?.avatar==='string'?card.avatar.replace(/\.[^/.]+$/,''):null;
  function binding(ctx){
    const info=worldInfoModule.world_info??worldInfoModule.getWorldInfoSettings?.().world_info??{};
    const global=names(worldInfoModule.selected_world_info??info.globalSelect??[]);
    const chat=ctx.chatMetadata?.[worldInfoModule.METADATA_KEY??'world_info'];
    const persona=ctx.powerUserSettings?.persona_description_lorebook;
    const cards=Array.isArray(ctx.characters)?ctx.characters:[];
    const selected=cards[ctx.characterId];
    const group=ctx.groupId==null?null:(ctx.groups??[]).find(row=>String(row.id)===String(ctx.groupId));
    const groupMembers=group?new Set(group.members??[]):null;
    const active=ctx.groupId!=null?(groupMembers?.has(selected?.avatar)?selected:null):selected;
    // A manually chosen disabled speaker still contributes its own binding.
    // Idle and generation both retain the other enabled members as readable
    // source candidates; they are never auto-selected as current personas.
    const groupCards=group?cards.filter(card=>groupMembers.has(card.avatar)&&!(group.disabled_members??[]).includes(card.avatar)):[];
    const characterCards=[...new Set([active,...groupCards].filter(Boolean))];
    const extraFor=card=>names(info.charLore?.find(row=>row.name===avatarName(card))?.extraBooks??[]);
    const primary=typeof active?.data?.extensions?.world==='string'?active.data.extensions.world:null;
    const character=names(characterCards.flatMap(card=>[card.data?.extensions?.world,...extraFor(card)]));
    const additional=names([...character,...global,persona]).filter(name=>name!==primary);
    return {primary,additional,character,global,chat:typeof chat==='string'&&chat?chat:null,persona:typeof persona==='string'&&persona?persona:null,group:group?.id??null};
  }
  function normalize(book,data){
    if(!data||typeof data!=='object'||!data.entries||typeof data.entries!=='object'||Array.isArray(data.entries))throw fail('世界书读取结果缺少原生条目结构','ST_WORLDBOOK_INVALID');
    const seen=new Set();
    return Object.values(data.entries).map(value=>{
      if(!value||typeof value!=='object'||!["number","string"].includes(typeof value.uid)||value.uid==='')throw fail('世界书条目缺少可核查的 UID','ST_WORLDBOOK_INVALID');
      const uid=String(value.uid);if(seen.has(uid))throw fail('世界书存在重复 UID，未猜测人物来源','ST_WORLDBOOK_INVALID');seen.add(uid);
      const row=structuredClone(value);
      // The queried book name, not row-provided metadata, owns the namespace.
      // Preserve native key/disable/order and all metadata, alongside the
      // small read contract used by createPersonaWorldbook.
      return {...row,book,world:book,name:row.comment??row.name??'',enabled:row.disable!==true&&row.enabled!==false,content:String(row.content??'')};
    });
  }
  async function getWorldbook(book){
    if(typeof book!=='string'||!book.trim())throw fail('请提供当前绑定的世界书名称','ST_WORLDBOOK_INVALID');
    const ctx=current(),before=scope(ctx);let data;
    if(typeof loadWorldInfo==='function')data=await loadWorldInfo(book);
    else if(typeof fetchImpl==='function'){
      const headers=typeof getRequestHeaders==='function'?getRequestHeaders():ctx.getRequestHeaders?.();
      if(!headers)throw fail('原版 ST 请求认证接口尚未就绪');
      const response=await fetchImpl('/api/worldinfo/get',{method:'POST',headers,credentials:'same-origin',cache:'no-cache',body:JSON.stringify({name:book})});
      if(!response?.ok)throw fail(`世界书读取失败（${response?.status??'未知状态'}）`);
      data=await response.json();
    }else if(typeof worldInfoModule.loadWorldInfo==='function')data=await worldInfoModule.loadWorldInfo(book);
    else throw fail('原版 ST 世界书读取接口尚未就绪');
    assertScope(before);return normalize(book,data);
  }
  return {
    capabilities:Object.freeze({readOnly:true,mirror:false}),
    getCharWorldbookNames:async(target='current')=>{
      if(target!=='current')throw fail('此桥接仅读取当前聊天绑定','ST_WORLDBOOK_INVALID');
      const result=binding(current());return {primary:result.primary,additional:[...result.additional]};
    },
    getChatWorldbookName:async(target='current')=>{
      if(target!=='current')throw fail('此桥接仅读取当前聊天绑定','ST_WORLDBOOK_INVALID');
      return binding(current()).chat;
    },
    getBoundWorldbookNames:()=>structuredClone(binding(current())),
    getWorldbook,
  };
}
