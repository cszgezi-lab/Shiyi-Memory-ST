import {sha256,clone} from './utils.js';
import {foldName,personaAliases} from './persona-identity.js';
import {characterKeepsakes,markDiaryHistory} from './character-journal.js';
import {sourceFloors} from './product-narrative.js';
import {qualitySourceSegments} from './source-evidence.js';
import {mergePersonaDevelopment,personaDevelopmentText,personaDevelopmentEvidenceParts} from './persona-development.js';
import {personaChangeCheck,personaReviewedThrough} from './persona-change-check.js';
import {markPersonaQuoteParts,mergePersonaNotes,personaNoteParts,personaEditEvidence,personaStyleGroups,personaProjectedSourceParts,safePersonaQuotedProse,personaSourcePartText} from './persona-edit-evidence.js';
import {personaSpeechPairs as speechPairs,personaSpeechSpanEnd as speechSpanEnd,hasPersonaSpeechEvidence,hasPersonaSpeechToEvidence,personaSpeechAudienceEvidence} from './persona-speech-evidence.js';
export {hasPersonaSpeechEvidence} from './persona-speech-evidence.js';

export const PERSONA_COMPOSITION_RULE=`当前使用原文保留模式。original.parts列出程序保留的原设定片段及当前有效文字；source=chat表示本聊天已保存的初建人物底稿，不是原世界书。ref仅定位本人物片段。不要重写整篇传记。
先依据source中的明确时间、日期、学段和倒叙/回忆切换，区分当前叙事时点、原卡默认时点与历史/未来设定。楼号是来源位置，不是故事日期；楼号增加也可能进入更早的倒叙学段，不能直接套用原卡默认的年龄、学校、班级、团体或已成立关系。原文自身有时间冲突时标明来源与待核实处，不把冲突句当定论。只在有明确证据时局部更新；不明确则标注原卡默认时点及适用范围，不把整段旧设定删掉。禁止按学段、日期差或常识自动猜测年龄或学校并替换，未发生的未来关系不可当作当前关系。
遵循局部更新合同输出updates/noteUpdates；首次建档或首次原书补充才用text。当前描述只写有据关系、心态与自由属性，写明对象和情境；未变B/N由程序保留，不重抄外貌背景或整份补充。updates只放本批确有依据改变的片段，使用本人物提供的ref；不变化返回[]，不删除其他细节。每个修改都提供本批依据楼号。片段中的其他未变信息保留原措辞。不允许空text删除片段。若旧片段仍断言已被剧情改变的关系或当前穿着，必须修改该片段，不能只在text追加矛盾说法。
按不同对象写清当前关系、态度与说话方式，并注明来源楼号及当时情境；区分家人面前、公开场合与两人独处时的表达，不能把对某人的说话方式推广给所有人。好感、动摇、羞涩或否认须保留原文证据与不确定性；单方心动不等于双方已确认交往，不虚造好感数值，也不只追加事件流水账。此前仍有效的对象关系与自由属性继续保留。
外貌、语言风格、价值观和稳定属性锚定原设定，不因临时心情漂移；剪发、染发、受伤等明确发生或用户确认时才更新。原卡服饰风格是习惯，某次穿着不是永久外貌；本场景衣着连续，明确换装才更新当前描述，跨日不强制一直同一套，也不每轮随机换装。新增属性不限预设字段。
examples选用少量能表现当前人物表达方式的真实原话，每条严格使用 {text:"逐字原话",floor:实际楼号,to:"明确对象或空串",context:"原文明示的情境"}，text不是概括，to不是推测；context中的日期/学段/场合只填来源明确提供的内容，缺失不编造，未知对象不猜。可保留previous.examples中仍合适的原话（原文和楼号不变），或选择本批明确说出的新原话。只引用实际出现的完整原话，GAL日文原话或配对中文译文均须逐字来自同一显式说话人，不自行翻译，不编示范，不把私密心声、旁白或他人台词当本人的公开台词。旧阶段语料仅供历史，不覆盖当前关系；重要旧原话仍在记忆与档案历史中。materials是已有记忆参考，private为私人心迹，inferred为推测而非事实，用户编写不冒充已验证原话；不赋予其他角色知情。reviewFocus是程序从完整正文摘出的变化线索，不是已确认结论；在完整语境中逐条确认，尤其明确换装、身体变化、关系确认和新增能力，不要因其只占一句就遗漏。记录当前服装时写明来源楼号、来源明确的时间和当场衣着，服饰习惯与当场衣着分开，不把旧场景服装当当前穿着，不永久固定。只在有实质变化时返回人物，无变化profiles:[]。`;

export const PERSONA_OUTPUT_CHECK_RULE='输出前核对：①development沿用旧key时target和scope必须逐字沿用旧值（旧scope缺失就是空串），本批更具体的情境写在after里；若确是不同对象或独立情境则另建项并省略key，不能用新scope覆盖旧key。②updates/noteUpdates的evidence.quote优先选本批原文明确写出本人物姓名、同时支持该修改的完整连续句；不要只引用匿名收尾结论，不得自行补姓名。角色自己实说的完整原话也可作依据。没有支持依据的修改不提出。③examples只用{text,floor,to,context}，说话人、否定、条件逐字核对；不编语料。④changed有本批development，unchanged不能同时改冲突片段；列出的conflictRefs均有对应updates。⑤只输出合法JSON；profiles是数组，每位人物是对象，以对象花括号闭合，不把字段说明写入内容。';

// Model formatting is not the utterance itself. Remove at most one complete
// outer quote/translation pair, never select a substring or one half of a
// bilingual candidate. The caller must still verify the exact source speaker.
function unwrappedPersonaQuote(value){
  const text=typeof value==='string'?value.trim():'';
  if(!['“','「','『','"','‘','〔'].includes(text[0])||speechSpanEnd(text,0)!==text.length-1)return text;
  return text.slice(1,-1).trim();
}

// Only an attributed self-naming utterance establishes a new spoken alias.
// A narrator mentioning two names or someone saying "call her X" does not.
export function personaSpokenAliases(messages,name,identity){
  const aliases=[];
  for(const m of messages)for(const match of m.text.matchAll(/[“「『"]([^“”「」『』"\n]+)[”」』"]/gu)){
    const quote=match[1],alias=/(?:叫我|称我为|稱我為|我的昵称是|我的暱稱是)([\p{L}·・]{1,20}?)(?:就好|即可|吧|[，。！]|$)/u.exec(quote)?.[1];
    if(!alias||!hasPersonaSpeechEvidence(m.text,quote,name,identity))continue;
    try{personaAliases([alias]);}catch{continue;}
    const other=identity.resolve(alias);if(other&&other.key!==foldName(name))continue;
    aliases.push(alias);
  }
  return [...new Set(aliases)];
}

// A small exact-source index, not another summary or extra model request.
// Full source remains available; truncating this optional index loses no input.
export function personaReviewFocus(messages,identity){
  const change=/换上|換上|换成|換成|脱下|脫下|剪短|染成|受伤|受傷|新增|学会|學會|不再|成为|成為|确认|確認|告白|分手|承诺|承諾|搬家|改行|决定|決定|约定|約定/;
  const perPerson=new Map();
  for(const m of messages)for(const sentence of m.text.match(/[^。！？\n]+[。！？]?/gu)??[]){
    if(!change.test(sentence)||sentence.length>600)continue;
    const people=identity.mentions(sentence);for(const person of people){const list=perPerson.get(person.key)??[];list.push({floor:m.index,name:person.name,excerpt:sentence});if(list.length>8)list.shift();perPerson.set(person.key,list);}
  }
  return [...perPerson.values()].flat();
}

// Carry an exact, dated scene reference even when the model omits a brief
// wardrobe/body change. It is NOT promoted into an everlasting character fact.
// Only uniquely named subjects qualify; pronouns and multi-person sentences
// are left to the model instead of guessed by this local fallback.
export function personaSceneEvidence(messages,identity,name,previous=[]){
  const evidence=new Map(previous.map(e=>[e.kind,e]));
  const change=/换上|換上|换成|換成|脱下|脫下|穿着|穿著|剪短|染成|受伤|受傷|伤愈|傷癒/;
  const narrative=text=>{
    const pieces=[];let start=0;
    for(let i=0;i<text.length;i++)if(speechPairs.has(text[i])){
      pieces.push(text.slice(start,i));const end=speechSpanEnd(text,i);if(end<0)return pieces;
      i=end;start=end+1;
    }
    pieces.push(text.slice(start));return pieces;
  };
  // Do not mistake quoted wishes for actual wardrobe changes; also keep an
  // actual action immediately after a closing dialogue quote discoverable.
  for(const m of messages)for(const piece of narrative(m.text))for(const raw of piece.match(/[^。！？\n]+[。！？]?/gu)??[]){
    const sentence=raw.trim();
    if(!change.test(sentence)||sentence.length>600||/<%|%>|<\/?script\b|\{\{(?!\s*(?:user|char)\s*\}\})|@@|\[\[SHIYI_PERSONA:/i.test(sentence))continue;
    const people=identity.mentions(sentence);if(people.length!==1||people[0].key!==foldName(name))continue;
    const lead=foldName(sentence.trim()).split(change)[0],person=people[0];
    const alias=[person.name,...person.aliases].map(foldName).sort((a,b)=>b.length-a.length).find(n=>lead.startsWith(n));
    if(!alias||/^(与|和|同|跟|向|对)/.test(lead.slice(alias.length))||/希望|想要|想|打算|计划|讨论|谈论|回忆|假设|如果|是否|没有|还没|未曾/.test(lead))continue;
    const kind=/换上|換上|换成|換成|脱下|脫下|穿着|穿著/.test(sentence)?'wardrobe':'appearance';
    if(!evidence.has(kind)||evidence.get(kind).floor<=m.index)evidence.set(kind,{kind,floor:m.index,text:sentence});
  }
  return [...evidence.values()];
}

export function compactPersonaParts(parts){
  const seen=new Map(),out=[];
  for(const part of parts){
    const key=String(part.text??'').trim();
    if(part.source!=='chat'||key.length<8){out.push(part);continue;}
    const i=seen.get(key);
    if(i===undefined){seen.set(key,out.length);out.push(part);}
    else out[i]={...out[i],sourceFloors:[...new Set([...(out[i].sourceFloors??[]),...(part.sourceFloors??[])])]};
  }
  return out;
}
export function personaParts(spans,previous,{includeNotes=true}={}){
  if(!spans.length){
    const saved=previous?.composition?.parts?.filter(p=>p.source==='chat');
    if(saved?.length){
      // notes is a replaceable CURRENT snapshot, not a new immutable baseline
      // every round. Prior notes are already preserved by version checkpoints.
      const carried=clone(compactPersonaParts(saved));
      return carried.map((p,i)=>({...p,ref:`B${i+1}`}));
    }
    if(previous?.composition?.sourceBaseline?.length)return clone(previous.composition.sourceBaseline).map((p,i)=>({...p,ref:`B${i+1}`}));
    if(previous?.name&&!previous.bindings?.length&&(previous.composition?.notes??previous.text)?.trim())return sourcePersonaBaseline(previous.composition?.notes??previous.text,previous.name,previous.sourceFloors??[]);
  }
  const old=new Map((previous?.composition?.parts??[]).map(p=>[p.key,p]));let sequence=0;
  const sourced=spans.flatMap(s=>{
    // Preserve every byte, including spacing. Sentence-size changes avoid
    // asking the model to regenerate unrelated paragraphs of a long profile.
    const chunks=s.text.match(/[^\n。！？]+(?:[。！？]+[”’」』]?|\n|$)|\n/gu)??[s.text];
    const pieces=chunks.join('')===s.text?chunks:[s.text];
    return pieces.map((original,i)=>{const key=sha256([s.book,s.uid,s.id,i,original]).slice(0,24),prior=old.get(key);
      return {...prior,key,ref:`B${++sequence}`,book:s.book,uid:s.uid,...(s.sourceKind?{sourceKind:s.sourceKind,cardId:s.cardId,field:s.field}:{}),title:s.originalName??s.name,spanId:s.id,original,text:prior?.text??original,sourceFloors:prior?.sourceFloors??[]};
    });
  });
  // Late source discovery must not discard a chat-authored baseline.
  return markPersonaQuoteParts([...sourced,...clone(previous?.composition?.parts?.filter(p=>p.source==='chat')??[]).map(p=>({...p,ref:`B${++sequence}`}))]);
}

// Source-only dossiers expose an editable baseline for explicit B-ref patches.
// Complete snapshot updates instead carry still-valid fields in their text.
function sourcePersonaBaseline(text,name,floors){
  const chunks=text.match(/[^\n。！？]+(?:[。！？]+[”’」』]?|\n|$)|\n/gu)??[text];
  return (chunks.join('')===text?chunks:[text]).map((original,i)=>({source:'chat',key:sha256([name,i,original]).slice(0,24),ref:`B${i+1}`,book:'当前聊天',uid:name,title:'初建人物档案',spanId:'chat-baseline',original,text:original,sourceFloors:[...floors]}));
}

export function personaMaterials(records,identity,mentioned,endFloor){
  const rows=Array.isArray(records)?records:Object.values(records??{}).flat();
  const eligible=rows.filter(r=>r&&!['retracted','superseded'].includes(r.lifecycleState)&&sourceFloors(r).length&&sourceFloors(r).every(f=>f<=endFloor)&&!(r.awareness??[]).some(a=>a.pending));
  const keepsakes=characterKeepsakes(markDiaryHistory(eligible).filter(r=>!r.innerLifeHistorical),{withExpected:false}),latest=new Map();
  for(const r of [...keepsakes.diaries,...keepsakes.dialogues]){
    const p=identity.resolve(r.subject);if(!p||!mentioned.has(p.key)||r.data.disabled||r.data.status==='historical')continue;
    const key=JSON.stringify([p.key,r.kind,r.target,r.data.stage??r.data.context??r.record.id]);
    const value={name:p.name,kind:r.kind,to:r.target,text:r.data.text,context:r.data.context??r.data.stage,basis:r.data.basis,provenance:r.data.provenance,private:r.kind==='diary',floors:sourceFloors(r.record)};
    const old=latest.get(key);if(!old||Math.max(...old.floors)<=Math.max(...value.floors))latest.set(key,value);
  }
  return [...latest.values()];
}

// Keep source quotes in storage; select a small diverse reading projection.
// Only an explicitly linked arc can retire its old expression automatically.
export function currentPersonaExamples(examples,development=[],limit=6){
  if(limit<=0)return [];
  const arcs=new Map(development.map(d=>[d.key,d])),seen=new Set(),groups=new Map(),pool=[];
  for(const q of [...examples].sort((a,b)=>b.floor-a.floor)){
    const arc=arcs.get(q.developmentKey);
    if(q.status==='historical'||q.status==='audience_unverified'||arc&&q.floor<arc.floor&&q.reaffirmedAt!==arc.floor||seen.has(q.text))continue;
    seen.add(q.text);pool.push(q);
  }
  const selected=[],rest=[],retainedArcs=new Set(),reserved=Math.max(1,Math.floor(limit/2));
  // Validation has already established that these old words were explicitly
  // reselected for the current arc. Keep a bounded, per-arc slot; otherwise a
  // newest-floor cutoff accepts the choice and then silently discards it.
  for(const q of pool){
    const arc=arcs.get(q.developmentKey);
    if(!arc||q.floor>=arc.floor||q.reaffirmedAt!==arc.floor||retainedArcs.has(arc.key))continue;
    selected.push(q);retainedArcs.add(arc.key);groups.set(JSON.stringify([foldName(q.to??''),q.context??'']),1);
    if(selected.length>=reserved)break;
  }
  for(const q of pool){
    if(selected.includes(q))continue;
    const group=JSON.stringify([foldName(q.to??''),q.context??'']),count=groups.get(group)??0;
    if(count>=2){rest.push(q);continue;}
    groups.set(group,count+1);selected.push(q);
  }
  return [...selected,...rest].slice(0,limit);
}

export function composePersona(row,{spans,previous,messages,developmentMessages,identity,name,fail,updateContractVersion=1}){
  // Source-only snapshots must not become immutable original-book material.
  // Explicit local-ref edits and legacy player prose retain their editable
  // parts; that mode survives later snapshots so arbitrary fields are not lost.
  const localPatches=!spans.length&&Boolean(row.updates?.length||previous?.composition?.sourceBaseline?.length||previous?.composition?.localMode==='patches'||previous?.composition?.changes?.length||previous&&!previous.composition);
  const parts=spans.length||localPatches?markPersonaQuoteParts(personaParts(spans,previous,{includeNotes:Boolean(row.updates?.length)})):[],byRef=new Map(parts.map(p=>[p.ref,p])),touched=new Set(),changes=[],pendingEdits=[];
  const originalParts=clone(parts),evidenceMessages=developmentMessages??messages.map(m=>({...m,text:qualitySourceSegments(m).map(s=>s.text).join('\n\uFFFC\n')}));
  const styleGroups=personaStyleGroups(parts),retirableKeys=new Set(styleGroups.flatMap(g=>g.map(p=>p.key)));
  const editContext={messages:evidenceMessages,identity,name,speech:hasPersonaSpeechEvidence,updateContractVersion,reviewEvidence:row.changeCheck?.evidence};
  const development=mergePersonaDevelopment(row.development,{previous:previous?.composition?.development??[],messages:evidenceMessages,identity,name,updateContractVersion,changeCheck:row.changeCheck});
  if(!parts.length&&!row.text.trim()&&!previous?.text&&!row.noteUpdates?.length)throw fail('text','正文新角色须有可独立阅读的档案，不能只返回局部修改','persona_fields',{personaIssue:'empty_profile'});
  const validFloors=floors=>Array.isArray(floors)&&floors.length&&floors.every(f=>messages.some(m=>m.index===f));
  if(row.updates!==undefined&&!Array.isArray(row.updates))throw fail('text','局部修改应为列表','persona_fields',{personaIssue:'invalid_updates'});
  // A first source-only dossier has no mutable parts yet. Redundant edits must
  // not masquerade as original-book edits or block its complete initial text.
  const ignoredUpdates=parts.length?0:(row.updates??[]).length;
  for(const [editIndex,edit] of (parts.length?(row.updates??[]):[]).entries()){
    const exact=parts.filter(p=>p.source==='chat'&&p.text.trim()===String(edit?.ref??'').trim());
    const part=byRef.get(String(edit?.ref??''))??(exact.length===1?exact[0]:null);
    const evidence=personaEditEvidence(edit?.evidence,editContext);
    // This list duplicates the verified exact quote's floor. Recover only an
    // omitted list; never replace an explicit invalid/out-of-range list.
    const quotedFloor=evidenceMessages.find(m=>m.index===edit?.evidence?.floor&&typeof edit.evidence.quote==='string'&&edit.evidence.quote.trim()&&m.text.includes(edit.evidence.quote))?.index;
    const editFloors=edit?.sourceFloors===undefined&&quotedFloor!==undefined?[quotedFloor]:edit?.sourceFloors;
    const issue=!part?'unknown_ref':touched.has(part.key)?'duplicate_ref':typeof edit?.text!=='string'||!edit.text.trim()?'empty_edit':!validFloors(editFloors)?'invalid_edit_floors':/<%|%>|<\/?script\b|\{\{(?!\s*(?:user|char)\s*\}\})|@@|\[\[SHIYI_PERSONA:/i.test(edit.text)?'unsafe_edit':null;
    if(issue)throw fail('text','局部修改没有唯一对应本人物原文或本批依据，原档案保留','persona_fields',{personaIssue:issue,editIndex});
    touched.add(part.key);
    if(edit.status==='historical'){
      const canonical=value=>identity.resolve(String(value??''))?.key??foldName(String(value??''));
      const explicitIndex=Object.hasOwn(edit,'developmentIndex');
      const link=Number.isInteger(edit.developmentIndex)&&edit.developmentIndex>0?row.development?.[edit.developmentIndex-1]:null;
      const currentArcs=development.items.filter(d=>d.target&&personaDevelopmentEvidenceParts(d,evidenceMessages,{identity,name}).length);
      const actorOnlyReview=d=>{
        if(!explicitIndex||!evidence||!row.changeCheck?.evidence?.some(e=>e.floor===evidence.floor&&e.quote===evidence.quote))return false;
        const people=identity.mentions(evidence.quote),floor=evidenceMessages.find(m=>m.index===evidence.floor);
        // An explicit link plus one current target/scope avoids guessing "you"
        // in multi-person changes. Conflicting labels/participants stay pending.
        return new Set(currentArcs.map(a=>JSON.stringify([canonical(a.target),a.scope??'']))).size===1&&
          people.length>0&&people.every(p=>p.key===canonical(name))&&
          identity.mentions(floor?.text??'').every(p=>[canonical(name),canonical(d.target)].includes(p.key))&&
          hasPersonaSpeechEvidence(floor?.text??'',evidence.quote,name,identity,{includeLead:true})&&
          (!Object.hasOwn(edit,'target')||canonical(edit.target)===canonical(d.target))&&
          (!Object.hasOwn(edit,'scope')||(edit.scope??'')===(d.scope??''));
      };
      const arc=development.items.find(d=>d.target&&personaDevelopmentEvidenceParts(d,evidenceMessages,{identity,name}).length&&
        (explicitIndex?link&&link.floor===(d.evidenceReceipt?.declaredFloor??d.floor)&&link.evidence===d.evidence&&canonical(link.target)===canonical(d.target)&&(link.scope??'')===(d.scope??''):
          canonical(d.target)===canonical(edit.target)&&(d.scope??'')===(edit.scope??''))&&
        (d.floor===evidence?.floor||identity.mentions(evidence?.quote??'').some(p=>p.key===canonical(d.target))||actorOnlyReview(d)));
      const reason=!retirableKeys.has(part.key)?'not_independent_source_style':edit.before!==part.original||edit.text!==part.original?'source_style_bytes_changed':!evidence||!editFloors.includes(evidence.floor)?'missing_edit_evidence':!arc||row.changeCheck?.status!=='changed'?'missing_scoped_style_transition':null;
      if(reason){pendingEdits.push({kind:'source',reason,ref:part.ref,key:part.key,text:edit.text,sourceFloors:clone(editFloors)});continue;}
      part.status='historical';part.text=part.original;part.sourceFloors=[...new Set(editFloors)];part.editEvidence=evidence;
      part.retirement={kind:'source_style',target:arc.target,scope:arc.scope??'',developmentKey:arc.key,evidence};
      changes.push({key:part.key,title:part.title,before:part.original,after:part.original,status:'historical',sourceFloors:part.sourceFloors});
      continue;
    }
    const quoteSafeEdit=safePersonaQuotedProse(part,edit.text);
    const semanticIssue=part.sourceQuote&&!quoteSafeEdit?'protected_source_quote':edit.before!==personaSourcePartText(part)?'before_mismatch':!evidence||!editFloors.includes(evidence.floor)?'missing_edit_evidence':null;
    if(semanticIssue){pendingEdits.push({kind:'source',reason:semanticIssue,ref:part.ref,key:part.key,text:edit.text,sourceFloors:clone(editFloors),...(evidence?{evidence}:{})});continue;}
    const before=part.text;part.text=edit.text+(/\n$/.test(part.original)&&!edit.text.endsWith('\n')?'\n':'');part.sourceFloors=[...new Set(editFloors)];part.editEvidence=evidence;
    if(quoteSafeEdit)part.quoteSafeEdit=true;
    if(before!==part.text)changes.push({key:part.key,title:part.title,before,after:part.text,sourceFloors:part.sourceFloors});
  }
  for(const group of styleGroups.filter(g=>g.length>1)){
    if(!group.some(p=>touched.has(p.key)&&p.status==='historical'))continue;
    const first=group[0],same=group.every(p=>touched.has(p.key)&&p.status==='historical'&&p.retirement?.developmentKey===first.retirement?.developmentKey&&JSON.stringify(p.editEvidence)===JSON.stringify(first.editEvidence));
    if(!same){const keys=new Set(group.map(p=>p.key));for(const p of group){const old=originalParts.find(o=>o.key===p.key);for(const key of Object.keys(p))delete p[key];Object.assign(p,clone(old));}for(let i=changes.length-1;i>=0;i--)if(keys.has(changes[i].key))changes.splice(i,1);pendingEdits.push({kind:'source',reason:'incomplete_style_group',refs:group.map(p=>p.ref)});}
  }
  const examples=[];let rejectedExamples=0;
  // Normalize transport synonyms only when unambiguous; the original text,
  // floor and speaker still pass the same source validation below.
  const normalized=(Array.isArray(row.examples)?row.examples:[]).map(q=>{
    if(!q||typeof q!=='object')return q;
    const conflict=(Object.hasOwn(q,'text')&&Object.hasOwn(q,'quote')&&q.text!==q.quote)||(Object.hasOwn(q,'to')&&Object.hasOwn(q,'target')&&foldName(String(q.to))!==foldName(String(q.target)));
    return conflict?null:{...q,text:Object.hasOwn(q,'text')?q.text:q.quote,to:Object.hasOwn(q,'to')?q.to:q.target};
  });
  // The archive is authoritative for duplicates (including retirement), but a
  // legacy capped archive may have dropped a still-selected current example.
  const priorKeys=new Set();
  const priorExamples=[...previous?.composition?.exampleArchive??[],...previous?.composition?.examples??[]].filter(q=>{
    const key=JSON.stringify([q?.floor,q?.text]);if(priorKeys.has(key))return false;priorKeys.add(key);return true;
  });
  const candidates=[...priorExamples,...normalized];
  for(const q of candidates){
    const m=messages.find(m=>m.index===q?.floor),raw=typeof q?.text==='string'?q.text.trim():'';
    const text=m&&hasPersonaSpeechEvidence(m.text,raw,name,identity)?raw:unwrappedPersonaQuote(raw);
    const prior=priorExamples.find(p=>p.kind==='source_quote'&&p.text===text&&p.floor===q?.floor);
    // Previously verified history can be outside this batch. If its floor is
    // supplied again, recheck the actual source instead of trusting an old tag.
    if(prior&&!m){if(!examples.some(p=>p.text===prior.text&&p.floor===prior.floor))examples.push(clone(prior));continue;}
    if(!m||!hasPersonaSpeechEvidence(m.text,text,name,identity)||/<%|%>|<\/?script\b|\{\{(?!\s*(?:user|char)\s*\}\})|@@|\[\[SHIYI_PERSONA:/i.test([text,q?.to,q?.context].join('\n'))){rejectedExamples++;continue;}
    const verified=prior?clone(prior):{text,floor:q.floor,to:typeof q.to==='string'?q.to:'',context:typeof q.context==='string'?q.context:'',kind:'source_quote'};
    if(updateContractVersion>=2&&(verified.to||verified.developmentKey||Object.hasOwn(q??{},'developmentKey'))){
      const audience=personaSpeechAudienceEvidence(m.text,text,name,identity),to=identity.resolve(verified.to)?.key??foldName(verified.to);
      if(audience.status==='ambiguous'||audience.status==='explicit'&&verified.to&&audience.targets[0]!==to){rejectedExamples++;continue;}
      if(audience.status!=='explicit'){
        verified.to='';delete verified.developmentKey;delete verified.reaffirmedAt;
        if(verified.status!=='historical')verified.status='audience_unverified';
      }
    }
    if(!examples.some(e=>e.text===text&&e.floor===q.floor))examples.push(verified);
  }
  const sceneEvidence=personaSceneEvidence(messages,identity,name,previous?.composition?.sceneEvidence);
  const currentArcEvidence=arc=>personaDevelopmentEvidenceParts(arc,evidenceMessages,{identity,name});
  const canonicalAudience=value=>identity.resolve(String(value??''))?.key??foldName(String(value??''));
  const uniqueSpeechArc=(q,arc)=>{
    const sameTarget=development.items.filter(d=>d.phase!=='historical'&&canonicalAudience(d.target)===canonicalAudience(q.to));
    const source=messages.find(m=>m.index===q.floor);
    return q.to&&sameTarget.length===1&&sameTarget[0].key===arc.key&&source&&
      hasPersonaSpeechToEvidence(source.text,q.text,name,q.to,identity);
  };
  for(const q of examples){
    const supplied=normalized.find(e=>e?.floor===q.floor&&unwrappedPersonaQuote(e.text)===q.text);
    const arc=development.items.find(d=>d.key===supplied?.developmentKey&&(updateContractVersion>=2?
      canonicalAudience(d.target)===canonicalAudience(q.to)&&currentArcEvidence(d).some(p=>p.floor===q.floor&&p.quote.includes(q.text))&&
      hasPersonaSpeechToEvidence(messages.find(m=>m.index===q.floor)?.text,q.text,name,d.target,identity):d.floor===q.floor&&d.evidence.includes(q.text)));
    if(arc)q.developmentKey=arc.key;
  }
  // A model can identify a change yet forget examples. Recover only complete,
  // explicitly attributed utterances INSIDE that accepted change's evidence;
  // never choose another nearby speaker, a private thought, or invent speech.
  for(const arc of development.items){
    const old=previous?.composition?.development?.find(d=>d.key===arc.key);
    if(old?.floor===arc.floor||!messages.some(m=>m.index===arc.floor))continue;
    const proof=updateContractVersion>=2?currentArcEvidence(arc):[{floor:arc.floor,quote:arc.evidence}];
    const quotes=proof.flatMap(p=>[...p.quote.matchAll(/[“「『"]([^“”「」『』"\n]+)[”」』"]/gu)].map(m=>({text:m[1],floor:p.floor,evidence:p.quote})));
    for(const {text,floor} of quotes.filter(q=>hasPersonaSpeechEvidence(q.evidence,q.text,name,identity)).slice(-2)){
      const existing=examples.find(q=>q.floor===floor&&q.text===text);
      if(updateContractVersion>=2){
        const supplied=normalized.find(q=>q?.floor===floor&&unwrappedPersonaQuote(q.text)===text);
        // An explicit selection may reject this association. Otherwise use the
        // same audience/uniqueness boundary as cross-floor implicit linking.
        if(supplied&&Object.hasOwn(supplied,'developmentKey')&&supplied.developmentKey!==arc.key)continue;
        if(!uniqueSpeechArc(existing??{text,floor,to:arc.target},arc))continue;
      }
      if(existing){existing.developmentKey=arc.key;continue;}
      examples.push({text,floor,to:arc.target,context:arc.scope??'',kind:'source_quote',developmentKey:arc.key});
    }
  }
  const noteResult=mergePersonaNotes(row,previous?.composition?.pendingOnly?undefined:previous,editContext),notes=noteResult.notes;
  const composition={version:2,retiredParts:clone(previous?.composition?.retiredParts??[]),parts,notes,examples:currentPersonaExamples(examples,development.items),exampleArchive:examples.sort((a,b)=>b.floor-a.floor).slice(0,48),sceneEvidence,changes,noteChanges:noteResult.changes,pendingEdits:[...pendingEdits,...noteResult.pending],rejectedExamples,ignoredUpdates,development:development.items,rejectedDevelopment:development.rejected,...(!spans.length?{localMode:localPatches&&parts.length?'patches':'snapshot'}:{}),...(!parts.length?{sourceBaseline:sourcePersonaBaseline(notes,name,row.sourceFloors)}:{})};
  const unresolvedConflicts=updateContractVersion>=2?unpatchedCurrentInstructions({parts,notes,development:development.items,previousDevelopment:previous?.composition?.development??[],messages:evidenceMessages,identity,name}):[];
  const unverifiedAudienceSpeech=examples.filter(q=>q.status==='audience_unverified');
  composition.changeCheck=personaChangeCheck(row,{parts,changes,noteParts:personaNoteParts(previous?.composition?.pendingOnly?undefined:previous),noteChanges:noteResult.changes,development:development.items,previousDevelopment:previous?.composition?.development??[],examples:composition.examples,unverifiedAudienceSpeech,rejectedExamples,messages,evidenceMessages,identity,name,initial:!previous,updateContractVersion,unresolvedConflicts});
  if(composition.changeCheck.status==='pending'){
    // A request can complete while its proposed interpretation remains pending.
    // Keep independently verified speech, not unverified current-state claims.
    composition.pendingRevision={notes,updates:clone(row.updates??[]),noteUpdates:clone(row.noteUpdates??[]),development:clone(row.development??[]),sourceFloors:clone(row.sourceFloors??[]),issues:clone(composition.changeCheck.issues),...(unresolvedConflicts.length?{unresolvedConflicts}: {})};
    if(updateContractVersion>=2){
      const priorFor=q=>priorExamples.find(p=>p.kind==='source_quote'&&p.floor===q.floor&&p.text===q.text);
      composition.pendingRevision.examples=clone(examples.filter(q=>!priorFor(q)));
      // Keep only revalidated prior survivors, with their accepted annotations.
      // A pending quote must not enter the archive and become accepted next time.
      examples.splice(0,examples.length,...examples.map(priorFor).filter(Boolean).map(clone));
    }
    composition.parts=originalParts;composition.notes=previous?.composition?.notes??(previous&&!previous.composition?previous.text:'')??'';
    composition.development=clone(previous?.composition?.development??[]);composition.changes=[];composition.noteChanges=[];
    composition.examples=currentPersonaExamples(examples,composition.development);
    if(!parts.length)composition.sourceBaseline=sourcePersonaBaseline(composition.notes,name,previous?.sourceFloors??[]);
    composition.pendingOnly=!spans.length&&(!previous||Boolean(previous.composition?.pendingOnly));
  }
  const acceptedChangeReview=composition.changeCheck.status==='changed';
  if(composition.pendingEdits.length)composition.changeCheck={...composition.changeCheck,status:'pending',issues:[...composition.changeCheck.issues??[],`${composition.pendingEdits.length}项局部修改尚未应用，未变内容保留`]};
  // Reusing an explicitly selected, previously verified utterance is not
  // reviving every old phase. Bind that selection to this accepted revision
  // of the SAME arc and audience; a later reversal must review it again.
  if(composition.changeCheck.status==='changed'||updateContractVersion>=2&&acceptedChangeReview){
    const canonical=value=>identity.resolve(String(value??''))?.key??foldName(String(value??''));
    if(updateContractVersion>=2&&composition.changeCheck.expressionCoverage?.status==='covered'){
      for(const q of examples){
        if(priorExamples.some(p=>p.floor===q.floor&&p.text===q.text))continue;
        const supplied=normalized.find(e=>e?.floor===q.floor&&unwrappedPersonaQuote(e.text)===q.text);
        if(!supplied||!q.to)continue;
        const source=messages.find(m=>m.index===q.floor);
        if(!source||!hasPersonaSpeechToEvidence(source.text,q.text,name,q.to,identity))continue;
        // Include carried-forward scopes: uniqueness among just this batch's
        // changed arcs would misbind speech when another same-target arc exists.
        const sameTarget=composition.development.filter(d=>d.phase!=='historical'&&canonical(d.target)===canonical(q.to));
        if(sameTarget.length!==1)continue;
        const arc=sameTarget[0],proof=currentArcEvidence(arc);
        // A correct explicit key may use the same verified cross-floor path;
        // a wrong key must never be silently reassigned to a convenient arc.
        if(Object.hasOwn(supplied,'developmentKey')&&supplied.developmentKey!==arc.key)continue;
        if(!proof.length||!composition.changeCheck.evidence.some(e=>{
          const people=identity.mentions(e.quote);
          return proof.some(p=>p.floor===e.floor)||people.some(p=>p.key===canonical(arc.target))||people.length>0&&people.every(p=>p.key===canonical(name));
        }))continue;
        if(arc.scope&&q.context!==arc.scope&&!proof.some(p=>p.floor===q.floor&&p.quote.includes(q.text)))continue;
        q.developmentKey=arc.key;
        if(q.floor<arc.floor)q.reaffirmedAt=arc.floor;
      }
    }
    for(const q of examples){
      const prior=priorExamples.find(p=>p.kind==='source_quote'&&p.floor===q.floor&&p.text===q.text);
      const supplied=normalized.find(e=>e?.floor===q.floor&&unwrappedPersonaQuote(e.text)===q.text&&(!Object.hasOwn(e,'developmentKey')||e.developmentKey===prior?.developmentKey)&&canonical(e.to)===canonical(prior?.to));
      const arc=prior?.developmentKey&&composition.development.find(d=>d.key===prior.developmentKey&&d.floor>q.floor&&(updateContractVersion>=2?currentArcEvidence(d).length:evidenceMessages.some(m=>m.index===d.floor&&m.text.includes(d.evidence))));
      if(supplied&&arc&&canonical(arc.target)===canonical(q.to))q.reaffirmedAt=arc.floor;
    }
    composition.examples=currentPersonaExamples(examples,composition.development);
  }
  // Keep the bounded CURRENT selection recoverable on the next update. This
  // is storage priority only: historical/reversed speech remains ineligible.
  const archived=new Set();
  composition.exampleArchive=[...composition.examples,...examples.sort((a,b)=>b.floor-a.floor)].filter(q=>{
    const key=JSON.stringify([q.floor,q.text]);if(archived.has(key))return false;archived.add(key);return true;
  }).slice(0,48);
  const reviewedThrough=['changed','unchanged'].includes(composition.changeCheck.status)?Math.max(...messages.map(m=>m.index)):personaReviewedThrough(previous);
  if(Number.isInteger(reviewedThrough)&&reviewedThrough>=0)composition.reviewedThrough=reviewedThrough;
  if(updateContractVersion<2&&composition.changeCheck.status==='changed')retireExactSupersededInstructions(composition,identity);
  if(!composition.parts.length&&!composition.notes&&!composition.pendingRevision)throw fail('text','新人物尚无可独立阅读的有效概况','persona_fields',{personaIssue:'empty_profile'});
  return {text:personaCompositionText(composition,{hasSources:spans.length>0}),composition:clone(composition)};
}

// An arc's "before" describes its old state; it is not permission to discard a
// whole B sentence/N paragraph (which may also hold unchanged facts). Check
// only a genuinely changed, evidenced current-batch arc and exact whole text.
// This is a traceable missing-patch guard, not a semantic contradiction test.
function unpatchedCurrentInstructions({parts,notes,development,previousDevelopment,messages,identity,name}){
  const conflicts=[],seen=new Set(),canonical=value=>identity.resolve?.(String(value??''))?.key??foldName(String(value??''));
  const paragraphs=String(notes??'').split(/\n\s*\n/u).filter(p=>p.trim());
  const add=(ref,arc)=>{const key=JSON.stringify([ref,arc.key]);if(!seen.has(key)){seen.add(key);conflicts.push({ref,developmentKey:arc.key,before:arc.before,target:arc.target,scope:arc.scope??'',floor:arc.floor});}};
  for(const arc of development){
    const old=previousDevelopment.find(p=>p.key===arc.key),before=String(arc.before??'').trim(),target=canonical(arc.target);
    if(arc.phase==='historical'||before.length<8||!target||!String(arc.after??'').trim()||!String(arc.evidence??'').trim())continue;
    if(old&&!['topic','target','scope','after','cause'].some(k=>(old[k]??'')!==(arc[k]??'')))continue;
    if(!personaDevelopmentEvidenceParts(arc,messages,{identity,name}).length)continue;
    if(!identity.mentions?.(before)?.some(p=>p.key===target)&&!foldName(before).includes(foldName(String(arc.target??''))))continue;
    for(const part of parts)if(part.status!=='historical'&&!part.sourceQuote&&String(part.text??'').trim()===before)add(part.ref,arc);
    paragraphs.forEach((paragraph,index)=>{if(paragraph.trim()===before)add(`N${index+1}`,arc);});
  }
  return conflicts;
}

/** An accepted arc can name the exact old instruction and still forget the
 * part edit. Drop only that whole fragment from the current injection. Do not
 * rewrite it, guess a shorter phrase, or touch quotes and other people. */
function retireExactSupersededInstructions(composition,identity){
  const canonical=value=>identity.resolve?.(String(value??''))?.key??foldName(String(value??''));
  for(const arc of composition.development??[]){
    const before=String(arc.before??'').trim(),target=canonical(arc.target);
    if(before.length<8||!target||!String(arc.after??'').trim()||!String(arc.evidence??'').trim())continue;
    const named=identity.mentions?.(before)?.some(p=>p.key===target)||foldName(before).includes(foldName(String(arc.target??'')));
    if(!named)continue;
    for(const part of composition.parts??[]){
      if(part.status==='historical'||part.sourceQuote||String(part.text??'').trim()!==before)continue;
      part.status='historical';
      part.retirement={kind:'superseded_instruction',target:arc.target,scope:arc.scope??'',developmentKey:arc.key};
      composition.changes=[...composition.changes??[],{key:part.key,title:part.title,before:part.text,after:part.text,status:'historical',sourceFloors:part.sourceFloors??[]}];
    }
    const paragraphs=String(composition.notes??'').split(/\n\s*\n/u),kept=paragraphs.filter(p=>p.trim()!==before);
    if(kept.length!==paragraphs.length)composition.notes=kept.map(p=>p.trim()).filter(Boolean).join('\n\n');
  }
}

export function personaCompositionText(composition,{hasSources=false}={}){
  const {parts=[],notes='',sceneEvidence=[],development=[]}=composition;
  const examples=currentPersonaExamples(composition.examples??[],development);
  const blocks=[];let last;
  const focus=(composition.reviewFocus??[]).filter(q=>!examples.some(e=>e.floor===q.floor&&e.text===q.quote));
  for(const part of personaProjectedSourceParts(parts)){if(part.status==='historical')continue;const speech=/语料|語料|台词|臺詞|dialogue|speech|quotes?/iu.test(part.title??'');const key=JSON.stringify([part.book,part.uid,part.spanId]);if(last?.key!==key){last={key,title:part.title,speech,source:part.source,allQuoted:true,text:''};blocks.push(last);}if(String(part.original??part.text).trim())last.allQuoted&&=part.sourceQuote;last.text+=personaSourcePartText(part);}
  const exampleText=examples.map(q=>`第${q.floor}楼${q.to?' 对'+q.to:''}：${q.text}${q.context?'〔'+q.context+'〕':''}`).join('\n');
  // A failed refresh preserves evidence, not a claim that the old notes are
  // the latest state. In particular B patches can apply while an N patch is
  // pending; those retained notes must not outrank the confirmed current arc.
  const notesPending=Boolean(composition.pendingRevision)||(composition.pendingEdits??[]).some(e=>e.kind==='notes');
  const retainedNotes=notes&&notesPending?`【保留旧补充 · 更新尚待核对，不作为当前态度指令】\n${notes}\n此区保留未变资料与旧来源；有冲突的态度、权限和口吻不覆盖上方已确认的同对象、同情境变化，待核对候选不作已确认。`:'';
  // Put the replaceable current snapshot before retained stable/history prose.
  // Long chats otherwise make an early relationship phase visually dominate a
  // much shorter latest change even though checkpoints already preserve history.
  const targets=[...new Set(development.filter(e=>e.phase!=='historical'&&e.target).map(e=>e.target))];
  const scopedStyle=targets.length?`；对${targets.join('、')}按顶部当前态度，不照这里的口吻`:'';
  const text=[personaDevelopmentText(development),notes&&!notesPending?`【当前剧情变化 · 最新状态优先】\n${notes}`:'',focus.length?`【当前演绎核对依据 · 按原话对象与条件理解，不外推为永久规则】\n${focus.map(q=>`第${q.floor}楼：${q.quote}`).join('\n')}`:'',examples.length?`【表达语料 · 原话仅供模仿表达，不要求复读；按来源情境理解，旧话不覆盖当前关系】\n${exampleText}`:'',...blocks.map(b=>`【${(b.speech||b.allQuoted)?(b.source==='chat'?'聊天档案保留引语 · 实说归属以已核对语料为准':`原书口吻范例 · 非聊天实说，不据此建立当前关系或事件${scopedStyle}`):`保留设定 · 仅未被当前剧情改变的部分有效${scopedStyle}`} · ${b.title}】\n${b.text}`),retainedNotes,sceneEvidence.length?`【最近外观情境 · 逐字原文，按当时场景理解，不是永久外貌或当前穿着指令】\n${sceneEvidence.map(e=>`第${e.floor}楼：${e.text}`).join('\n')}`:'',hasSources?'【适用边界】稳定外貌与习惯以保留设定为底稿；当前叙事时点可能处于倒叙，原卡默认时点的年龄、学段、关系不自动适用于当前场景，无明确依据不猜年龄或学校。来源楼号不是故事日期，原话及衣着按来源当时的时间、对象与场景理解；旧阶段语料不证明当前关系。服装描述服从当前场景与最新明确换装，不把旧场景穿着当永久外貌。当前关系以已发生剧情为准；若较早关系、口吻或演绎方式与本档案顶部的最新状态或最新正文冲突，不回退到旧阶段。对某人的表达与好感不推广给所有对象，私密心迹不赋予他人知情。':''].filter(Boolean).join('\n\n');
  // Supplemental characters need the same audience/privacy/scene boundaries
  // as original-book characters, rather than losing them when parts is empty.
  const boundary=hasSources?'':'【适用边界】本人物依据当前聊天正文建立，不代表有原世界书设定。保留仍有效的个性与自由属性；关系、口吻和成长仅适用于所述对象与情境。若较早关系、口吻或演绎方式与本档案顶部的最新状态或最新正文冲突，不回退到旧阶段。私密心迹不赋予其他人知情；衣着服从当前场景，旧台词不要求复读，倒叙经历不自动推翻当前状态。';
  return [text,boundary].filter(Boolean).join('\n\n');
}
