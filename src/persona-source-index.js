import {personaIdentity,personaSharedTitle,personaCategoryTitle} from './persona-identity.js';
export {personaSharedTitle} from './persona-identity.js';

const personal=/人物|角色|人设|人設|档案|檔案|外貌|性格|口吻|语料|語料|衣着|衣著|爱好|愛好|属性|屬性|profile|appearance/i;
// Category-only headings do not name a person. In particular, two joined
// categories must not become a competing identity against an explicit key.
const categoryTitle=personaCategoryTitle;
const declaredNames=text=>[...new Set([...String(text??'').matchAll(/^\s*(?:[-*]\s*)?(?:姓名|角色名|人物姓名|name)\s*[:：]\s*["']?([^\n"'，,。；;<>]{1,64})/gmi)].map(m=>m[1].replace(/\s*[（(][^）)]*[）)]\s*$/u,'').trim()))];
const entryKey=e=>JSON.stringify([e.book,e.uid]);

// Only explicit metadata establishes ownership. A body merely mentioning a
// person is not permission to remove world rules or another person's prose.
export function personaSourceIndex(world,{previous=[],dictionary,aliases='',source=''}={}){
  const entries=world.entries??[],byEntry=new Map(entries.map(e=>[entryKey(e),e]));
  const named=(world.spans??[]).map(s=>{
    const names=declaredNames(s.text);
    const name=names.length===1&&!personaSharedTitle(s.name)?names[0]:s.name;
    return {...s,name,originalName:s.originalName??s.name,...(names.length>1?{mixed:true}:{})};
  });
  const seeds=named.filter(s=>!s.mixed&&!personaSharedTitle(s.originalName)&&!categoryTitle(s.name));
  // A generic profile title with one explicit name key is a supported format.
  for(const entry of entries){const keys=(entry.keys??[]).filter(k=>typeof k==='string'&&/^[\p{Script=Han}·・•]{2,32}$/u.test(k));
    if(!personaSharedTitle(entry.name)&&personal.test(entry.name??'')&&keys.length===1)seeds.push({name:keys[0]});
  }
  const identity=personaIdentity({spans:seeds,previous,dictionary,aliases,source});
  const ownership=e=>{
    if(personaSharedTitle(e.originalName??e.name)||e.mixed)return null;
    const namedOwner=categoryTitle(e.name)?null:identity.forTitle(e.name),keys=(byEntry.get(entryKey(e))?.keys??e.keys??[]),keyOwners=new Set(keys.map(k=>identity.resolve(k)).filter(Boolean));
    if(keyOwners.size>1)return null;
    if(namedOwner&&keyOwners.size===1&&!keyOwners.has(namedOwner))return null;
    return namedOwner??((personal.test(e.originalName??e.name??'')||!(e.name??'').trim())&&keyOwners.size===1?[...keyOwners][0]:null);
  };
  const spans=named.map(s=>{const owner=ownership(s);return {...s,name:owner?.name??s.name,ownerKey:owner?.key??null};});
  const audit=entries.map(e=>{
    const found=spans.filter(s=>entryKey(s)===entryKey(e)),owners=[...new Set(found.map(s=>s.ownerKey).filter(Boolean))];
    const status=e.enabled===false?'disabled':personaSharedTitle(e.name)?'shared':!found.length?'unsupported':owners.length===1?'owned':'unresolved';
    return {book:e.book,uid:e.uid,title:e.name||'未命名条目',status,owner:owners.length===1?identity.resolve(owners[0])?.name??owners[0]:null};
  });
  return {identity,spans,audit};
}

export const PERSONA_SOURCE_LABELS=Object.freeze({disabled:'原书已停用，未读取',shared:'公共规则，不作为人物替换',unsupported:'模板尚不能安全分离，原条目保留',owned:'已识别人物归属',unresolved:'人物归属未确认，原条目保留'});

/** Why no world-book entry is owned by anybody, in one readable sentence.
 * Without this the profile panel says "尚未关联可替换的原书内容" and the user
 * has no way to tell "the card binds no world book" from "the entry names
 * nobody" from "the host gave no reader at all". */
export const PERSONA_SOURCE_REASONS=Object.freeze({
  host_unavailable:'当前宿主没有提供世界书读取接口，只能使用聊天内的动态档案。',
  no_book:'当前角色卡与聊天都没有绑定世界书，因此没有原设定可以替换。',
  empty_book:'已读取世界书，但没有可用的启用条目。',
  no_named_entry:'已读取世界书，但没有任何条目能确认属于某个人物：条目名里需要包含人物名（如「濑名紫阳花·人设」），或在条目里写一行「姓名：濑名紫阳花」。',
  unparsed_entry:'世界书里有像人物设定的条目，但都是脚本/模板，暂时不能安全拆分，原条目保留不替换。',
  ready:'已识别到可替换的原书人物条目。',
});
export function personaSourceGuide(world){
  const entries=(world?.entries??[]).filter(e=>e.enabled!==false);
  if(world?.status==='unavailable')return {reason:'host_unavailable',books:[],entries:0,candidates:[]};
  const books=[...new Set(entries.map(e=>e.book).filter(Boolean))];
  if(!books.length)return {reason:'no_book',books,entries:0,candidates:[]};
  if(!entries.length)return {reason:'empty_book',books,entries:0,candidates:[]};
  const audit=world.audit??[];
  const owned=audit.filter(row=>row.status==='owned');
  if(owned.length)return {reason:'ready',books,entries:entries.length,candidates:owned.map(row=>`${row.book} · ${row.title}`)};
  const unresolved=audit.filter(row=>row.status==='unresolved').length;
  const candidates=entries.filter(e=>!(e.content??'').includes('<%')).slice(0,8).map(e=>`${e.book} · ${e.name||'未命名条目'}`);
  if(unresolved)return {reason:'no_named_entry',books,entries:entries.length,candidates};
  const unsupported=audit.filter(row=>row.status==='unsupported').length;
  if(unsupported)return {reason:'unparsed_entry',books,entries:entries.length,candidates};
  return {reason:'no_named_entry',books,entries:entries.length,candidates};
}
