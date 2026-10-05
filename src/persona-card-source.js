import {sha256,stableStringify} from './utils.js';

const fields=Object.freeze({description:{identifier:'charDescription',label:'主卡描述'},personality:{identifier:'charPersonality',label:'主卡性格'}});
const names=text=>[...new Set([...text.matchAll(/^\s*(?:[-*#]+\s*)?(?:姓名|角色名|人物姓名|name)\s*[:：]\s*["']?([^\n"'，,。；;<>]{1,64})/gmi)].map(m=>m[1].trim()))];
const mixed=/^\s*(?:#+\s*|\[|【)?(?:世界规则|世界規則|系统规则|系統規則|世界观|世界觀|多人设定|多人設定|人物列表|角色列表|world\s*rules|characters)\s*(?:[:：\]】]|$)/im;
const unsafe=/<%|%>|<\/?script\b|@@|\{\{(?!\s*(?:user|char)\s*\}\})/i;
const person=name=>name&&name.length<=32&&!/[\n，。！？；：:<>%=|/&]/.test(name)&&!mixed.test(name)&&!/双人|雙人|多人|群像|世界观|世界觀|\b(?:and|world|scenario|characters)\b/i.test(name);

/** Explicit card-field provenance. book/uid are compatibility keys for the
 * existing source parts, never host worldbook identifiers. Original fields
 * are only read; executable templates and mixed ownership stay with the host. */
export function personaCardSource(context={}){
  const card=context.characters?.[context.characterId];
  if(!card||context.groupId||context.selected_group)return {entries:[],spans:[],status:'unavailable'};
  const cardId=sha256(['character_card',card.avatar??card.id??String(context.characterId),card.name??context.name2??'']).slice(0,24);
  const cardName=String(card.name??context.name2??'').trim();
  const rawFields=Object.fromEntries(Object.keys(fields).map(field=>[field,String(card[field]??card.data?.[field]??'').trim()]));
  const declared=[...new Set(Object.values(rawFields).flatMap(names))],owner=declared.length===1?declared[0]:declared.length?null:cardName;
  const entries=[],spans=[];
  for(const [field,{identifier,label}] of Object.entries(fields)){
    const content=rawFields[field];if(!content)continue;
    const entry={sourceKind:'character_card',cardId,field,identifier,book:`主角色卡:${cardId}`,uid:field,name:`${owner??cardName}·${label}`,keys:owner?[owner]:[],enabled:true,content};
    entries.push(entry);
    if(!person(owner)||declared.length>1||mixed.test(content)||unsafe.test(content)||(content.match(/<(?:character|profile|人物)\b/gi)?.length??0)>1)continue;
    const hash=sha256(content),id=sha256(['character_card',cardId,field,hash]).slice(0,24);
    spans.push({...entry,id,name:owner,originalName:entry.name,hash,stage:'static',start:0,end:content.length,text:content});
  }
  return {cardId,cardName,entries,spans,status:'ready'};
}

const serialize=message=>({role:message.role,content:message.content,...(message.name?{name:message.name}:{}),...(message.tool_calls?{tool_calls:message.tool_calls}:{}),...(message.role==='tool'?{tool_call_id:message.identifier}:{}),...(message.signature?{signature:message.signature}:{}),...(message.reasoning?{reasoning:message.reasoning}:{}),...(message.native?{native:message.native}:{}),...(message.reasoningContent?{reasoning_content:message.reasoningContent}:{})});
/** Snapshot at official PromptManager.setChatCompletion, before optional
 * squash mutates the temporary host messages. No model/preset/card writes. */
export function personaPromptSnapshot(completion){
  const root=completion?.getMessages?.();
  if(!Array.isArray(root?.collection))return null;
  const leaves=[];
  const walk=node=>{if(Array.isArray(node?.collection)){for(const item of node.collection)walk(item);}else if(node&&(node.content||node.tool_calls||node.role==='tool'))leaves.push({identifier:node.identifier,wire:serialize(node)});};
  walk(root);return structuredClone(leaves);
}

/** Reproduce TT 2.2's concat boundaries, then require the WHOLE wire to match.
 * Even repeated content is located by its original identifier and offset,
 * never by a search across arbitrary system/history messages. */
export function personaPromptLayout(snapshot,chat,{squash=false}={}){
  if(!snapshot||!Array.isArray(chat))return null;
  const excluded=new Set(['newMainChat','newChat','groupNudge','agentSystemPrompt']);
  const groups=[];let last=null;
  for(const item of snapshot){
    const wire=structuredClone(item.wire);
    if(squash&&wire.role==='system'&&!wire.content)continue;
    const eligible=wire.role==='system'&&!wire.name&&!excluded.has(item.identifier);
    if(squash&&eligible&&last?.eligible&&typeof wire.content==='string'&&typeof last.wire.content==='string'){
      const offset=last.wire.content.length+1;last.wire.content+='\n'+wire.content;
      last.parts.push({identifier:item.identifier,start:offset,end:offset+wire.content.length,content:wire.content});
    }else {last={wire,eligible,parts:[{identifier:item.identifier,start:0,end:typeof wire.content==='string'?wire.content.length:0,content:wire.content}]};groups.push(last);}
  }
  if(stableStringify(groups.map(g=>g.wire))!==stableStringify(chat))return null;
  return groups;
}

export const PERSONA_CARD_FIELDS=fields;
