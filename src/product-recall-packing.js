import { stableStringify } from './utils.js';
import { sameFactForRecall, explicitSubjectNames } from './product-person-profiles.js';
import { tokenizeChinese } from './retrieval.js';
import { dictionaryQuery } from './product-dictionary.js';
import { foldName } from './persona-identity.js';
import { sceneClockFromMessages } from './temporal.js';

// Wall time includes time in background or with the process suspended. It is
// not CPU time. Older logs without this probe cannot recover that distinction.
export function injectionTiming(document,now=Date.now){
  const start=now(),stages={};let markAt=start,last=start,hiddenMs=0,transitions=0,done=null;
  const visibility=()=>['visible','hidden'].includes(document?.visibilityState)?document.visibilityState:'unknown';
  const initial=visibility();let current=initial;
  const sample=()=>{const at=now();if(current==='hidden')hiddenMs+=Math.max(0,at-last);last=at;const next=visibility();if(next!==current)transitions++;current=next;};
  document?.addEventListener?.('visibilitychange',sample);
  return {mark(name){const at=now();stages[name]=Math.max(0,at-markAt);markAt=at;},finish(){
    if(done)return done;sample();document?.removeEventListener?.('visibilitychange',sample);
    done={...stages,totalMs:Math.max(0,last-start),hiddenMs,visibilityStart:initial,visibilityEnd:current,visibilityChanges:transitions};return done;
  }};
}

const normalized = value => String(value ?? '').toLocaleLowerCase().replace(/\s+/gu, '').replace(/[。！？]+$/u,'');
const refs = record => [...new Set([record.eventRef, record.eventId, ...(record.eventRefs ?? []), ...(record.relatedEvents ?? []).map(e => e.id)].filter(Boolean))];
const sentences = value => String(value ?? '').match(/[^。！？\n]+[。！？]?/g) ?? [];

// TT can label its own variable-only prefill as quiet, omit the type, or expose
// an ordinary generation type. Match only the anchored control signature; do
// not guess from MVU mentions or skip unrelated quiet/ordinary story requests.
export function auxiliaryInjectionReason(payload){
  const latest=(Array.isArray(payload?.messages)?payload.messages:[]).filter(m=>m?.role==='user').at(-1);
  const text=typeof latest?.content==='string'?latest.content:Array.isArray(latest?.content)?latest.content.filter(p=>p?.type==='text').map(p=>p.text??'').join('\n'):'';
  return /^\s*---\s+NoThinking refers to a method that bypasses the explicit reasoning process\b/i.test(text)
    && /<think>\s*- According to the user's input, I'm only responsible for updating variables\./i.test(text)
    ?'variable_update':null;
}

export function sceneRecallQuery(messages=[],sceneMessages=[]) {
  const text=m=>typeof m?.content==='string'?m.content:Array.isArray(m?.content)?m.content.filter(p=>p?.type==='text').map(p=>p.text??'').join('\n'):'';
  // The host already sends previous assistant turns to the model. Reusing that
  // prose as a retrieval query expands old scene terms and every named person's
  // standing fields, even when the current turn asks for something else.
  const users=messages.filter(m=>m?.role==='user').map(text),fallback=users.at(-1)??'';
  // A host can append a long user-role instruction block after the actual
  // turn. Detect that message structurally: adjacent user roles, a much
  // longer trailing block, and multiple list rules. No preset wording or
  // story vocabulary is assumed.
  const last=messages.at(-1),previous=messages.at(-2),priorText=text(previous);
  const ruleLines=String(fallback).split(/\r?\n/u).filter(line=>/^\s*(?:[-*•]|\d+[.)、])\s*\S/u.test(line)).length;
  const supplemental=last?.role==='user'&&previous?.role==='user'&&priorText.trim()&&fallback.length>=800&&fallback.length>=priorText.length*2&&ruleLines>=4;
  const requestTurn=supplemental?priorText:'';
  const latest=sceneMessages.at(-1);
  const sourceUser=sceneMessages.filter(m=>m?.role==='user'&&typeof m.text==='string'&&m.text.trim()).at(-1);
  const raw=sourceUser?.text.trim()??'';
  // Only trust the chat source when that exact turn is also present in the
  // assembled request. It may have been wrapped in a long user-side preset.
  // Presets may add several user messages plus an assistant prefill. During
  // regeneration the source still contains the reply being replaced, while
  // the assembled request ends at the retained player turn. Look across the
  // request, and reject an old anchor if its following real reply is included.
  const rawAt=raw?messages.findLastIndex(m=>m?.role==='user'&&text(m).includes(raw)):-1;
  const followingReply=latest?.role==='assistant'&&typeof latest.text==='string'?latest.text.trim():'';
  const staleAnchor=rawAt>=0&&followingReply&&messages.slice(rawAt+1).some((m,i,tail)=>m?.role==='assistant'&&
    (text(m).includes(followingReply)||tail.slice(i+1).some(next=>next?.role==='user')));
  const trusted=rawAt>=0&&!staleAnchor&&!(followingReply&&requestTurn&&!requestTurn.includes(raw));
  const intent=trusted?raw:requestTurn||fallback;
  const source=trusted?'chat_source':requestTurn?'request_before_rules':'request_user';
  if(!trusted&&!requestTurn)return {intent,context:'',characterContext:'',source};
  const prior=(latest?.role==='assistant'&&!trusted?sceneMessages:sceneMessages.slice(0,-1)).filter(m=>m?.role==='assistant').at(-1);
  const summaries=[...String(prior?.text??'').matchAll(/<summary>([\s\S]*?)<\/summary>/giu)];
  const continuation=/昨天|前天|上次|刚才|之前|那(?:个|些|两)|这(?:个|些)|继续|接着|帮忙|委托|答应|约定/u.test(intent);
  const context=continuation?String(summaries.at(-1)?.[1]??'').replace(/<[^>]*>/gu,'').trim().slice(0,500):'';
  return {intent,context,characterContext:'',source};
}

// Only real retained chat turns can anchor the scene clock. Request presets,
// examples and assistant prefills are not evidence of the current story time.
export function sceneClockForRequest(messages=[],sceneMessages=[],query=sceneRecallQuery(messages,sceneMessages),{fallbackDate}={}) {
  const text=m=>typeof m?.content==='string'?m.content:Array.isArray(m?.content)?m.content.filter(p=>p?.type==='text').map(p=>p.text??'').join('\n'):'';
  let retained=[];
  if(query.source==='chat_source'){
    const at=sceneMessages.findLastIndex(m=>m?.role==='user'&&String(m.text??'').trim()===query.intent);
    // During regeneration the host may still contain the withdrawn answer.
    if(at>=0)retained=sceneMessages.slice(0,at+1);
  }else{
    retained=sceneMessages.filter(m=>typeof m?.text==='string'&&m.text.trim()&&messages.some(row=>row?.role===m.role&&text(row).includes(m.text.trim())));
  }
  if(retained.at(-1)?.role!=='user'||String(retained.at(-1)?.text??'').trim()!==query.intent)retained=[...retained,{role:'user',text:query.intent}];
  return sceneClockFromMessages(retained,{fallbackDate});
}

// Person scope applies to every retrieval lane and linked-floor promotion.
// An actor shared by most events is not sufficient to connect two otherwise
// separate companions' experiences. Frequency only narrows retrieval here;
// it never assigns a character's identity, importance or knowledge.
export function recallRelationshipScope(records,dictionary,query){
  const people=(dictionary.entries??[]).filter(e=>!e.disabled&&e.kind==='人物');
  const named=new Set(people.flatMap(p=>[p.name,...(p.aliases??[])]).map(foldName));
  for(const record of records.filter(r=>r.category==='relationshipChanges'))for(const name of [record.from??record.subject,record.to??record.object].flatMap(explicitSubjectNames)){
    if(!name||/^(我|你|他|她|它|我们|你们|他们|她们)$/u.test(name)||named.has(foldName(name)))continue;
    const blocked=(dictionary.entries??[]).some(e=>e.disabled&&[e.name,...(e.aliases??[])].some(n=>foldName(n)===foldName(name)));
    if(!blocked){people.push({name,kind:'人物',aliases:[],ambiguous:[]});named.add(foldName(name));}
  }
  const owners=new Map();
  for(const person of people)for(const name of [person.name,...(person.aliases??[])]){
    const key=foldName(name);if((person.ambiguous??[]).some(a=>foldName(a)===key))continue;
    const set=owners.get(key)??new Set();set.add(foldName(person.name));owners.set(key,set);
  }
  const canonical=name=>{const key=foldName(name),set=owners.get(key);return set?.size===1?[...set][0]:null;};
  const mentioned=new Set(dictionaryQuery(query,{...dictionary,entries:people},{expandTopics:false,entityLimit:Infinity}).entities.map(canonical).filter(Boolean));
  const endpoints=record=>[...new Set([record.from??record.subject,record.to??record.object].flatMap(explicitSubjectNames).map(canonical).filter(Boolean))];
  return {
    matches(record){
      if(record.category!=='relationshipChanges'||!mentioned.size)return true;
      const names=endpoints(record);if(!names.length)return true;
      return mentioned.size>=2&&names.length>=2?names.every(name=>mentioned.has(name)):names.some(name=>mentioned.has(name));
    },
    explicitPair(record){const names=endpoints(record);return mentioned.size>=2&&names.length>=2&&names.every(name=>mentioned.has(name));},
  };
}

export function recallActorFilter(records,dictionary,query){
  const relationships=recallRelationshipScope(records,dictionary,query);
  const people=(dictionary.entries??[]).filter(e=>!e.disabled&&e.kind==='人物');
  for(const name of new Set(records.filter(r=>r.category==='events').flatMap(r=>r.participants??[])))
    if(typeof name==='string'&&name.length>1&&![...(dictionary.entries??[]),...people].some(e=>e.name===name||(e.aliases??[]).includes(name)))people.push({name,kind:'人物',aliases:[]});
  const owners=new Map();
  for(const p of people)for(const n of [p.name,...(p.aliases??[])]){const key=foldName(n),set=owners.get(key)??new Set();if(!(p.ambiguous??[]).some(a=>foldName(a)===key))set.add(foldName(p.name));owners.set(key,set);}
  const canonical=name=>{const key=foldName(name),set=owners.get(key);return set?.size===1?[...set][0]:key;};
  const mentioned=new Set(dictionaryQuery(query,{...dictionary,entries:people},{expandTopics:false,entityLimit:Infinity}).entities.map(canonical));
  const events=records.filter(r=>r.category==='events'),counts=new Map();
  for(const e of events)for(const n of new Set((e.participants??[]).map(canonical)))counts.set(n,(counts.get(n)??0)+1);
  const specific=[...mentioned].filter(n=>events.length<8||(counts.get(n)??0)<events.length*.6);
  const focus=new Set(specific.length?specific:mentioned);
  const text=String(query??'');
  let topic=text;
  for(const name of people.flatMap(p=>[p.name,...(p.aliases??[])]).sort((a,b)=>b.length-a.length))topic=topic.split(name).join(' ');
  const terms=[...new Set(tokenizeChinese(topic).filter(t=>t.length>=2))];
  const rare=terms.filter(t=>events.filter(e=>String(e.title??'').includes(t)).length===1);
  const evaluate=record=>{
    if(record.category==='relationshipChanges')return relationships.matches(record);
    if(!focus.size||!['events','summaryView'].includes(record.category))return true;
    const actors=(record.participants??[]).map(canonical).filter(Boolean);
    if(!actors.length||actors.some(n=>focus.has(n)))return true;
    // An explicitly requested scene can legitimately involve other actors.
    if(String(record.title??'').length>=4&&text.includes(record.title))return true;
    const place=typeof record.location==='string'?record.location:'';
    if(place.length>=2&&text.includes(place)&&/谈|提|回忆|想起|那件|旧事/u.test(topic))return true;
    const hits=rare.filter(t=>String(record.title??'').includes(t));
    const distinct=hits.filter(t=>!hits.some(other=>other.length>t.length&&other.includes(t)));
    return distinct.length>=2&&distinct.reduce((n,t)=>n+t.length,0)>=4;
  };
  const cache=new WeakMap();return record=>{if(!cache.has(record))cache.set(record,evaluate(record));return cache.get(record);};
}

// Only verified event links or identical evidence qualify. Similar wording,
// shared names, categories and dates alone never establish event identity.
export function sameRecallEvent(a, b) {
  if (a.category === 'knowledge' || b.category === 'knowledge') return false;
  const left = a.category === 'events' ? [a.id] : refs(a);
  const right = b.category === 'events' ? [b.id] : refs(b);
  if (left.length === 1 && right.length === 1 && left[0] === right[0]) return true;
  return a.category === b.category && a.sourceRefs?.length > 0 &&
    normalized(a.description) === normalized(b.description) &&
    stableStringify(a.sourceRefs) === stableStringify(b.sourceRefs);
}

export function recallGuardSignature(record) {
  // Ignoring display IDs here is safe, ignoring facts/knowledge/time is not.
  const rows = value => (value ?? []).map(({ id, sourceRefs, ...rest }) => rest);
  return stableStringify({ temporal: record.temporal??null, participants: record.participants??[], location: record.location??null,
    awareness: rows(record.awareness), state: record.state??null, epistemicStatus: record.epistemicStatus??null,validFrom:record.validFrom??null,
    followUps: rows(record.followUps), context: record.context??null, validUntil: record.validUntil??null,
    expiresAt:record.expiresAt??null,term:record.term??null,duration:record.duration??null,perspective:record.perspective??null,
    subject:record.subject??record.person??record.entity??null,object:record.object??record.objectRef??null,aspect:record.aspect??record.field??record.key??null,
    viewpoints: record.viewpoints??[], keyDialogues: record.keyDialogues??[], customModuleId: record.customModuleId??null,fieldId:record.fieldId??null,scope:record.scope??null });
}

export function coveredRecallRecord(record, body, chosen) {
  for (const previous of chosen) {
    // Facts with a shared event/source can still have different validity or
    // distinct DIY field IDs. They must pass the stronger fact comparison.
    if(record.category==='entityFactChanges'||previous.record.category==='entityFactChanges'){
      if(!sameFactForRecall(record,previous.record))continue;
    }else if (!sameRecallEvent(record, previous.record)) continue;
    // For a floor, only compare when its projected event metadata is exactly
    // the same; a later disclosure must never replace an earlier perspective.
    let comparable = record;
    if (record.category === 'summaryView' && previous.record.category === 'events' && record.relatedEvents?.length === 1) {
      const event = record.relatedEvents[0];
      comparable = { ...record, temporal: record.temporal ?? event.temporal,
        location: record.location ?? event.location,
        participants: record.participants?.length ? record.participants : event.participants,
        awareness: record.awareness?.length ? record.awareness : event.awareness,
        state: record.state??previous.record.state, epistemicStatus: record.epistemicStatus??previous.record.epistemicStatus,
        viewpoints:record.viewpoints??previous.record.viewpoints,keyDialogues:record.keyDialogues??previous.record.keyDialogues };
    }
    if (recallGuardSignature(comparable) !== recallGuardSignature(previous.record)) continue;
    const text = normalized(previous.body), parts = sentences(body).map(normalized).filter(Boolean);
    if (parts.length && parts.every(part => text.includes(part))) return previous.record.id;
  }
  return null;
}

export function recallSelectionReason(candidate) {
  const names = { entity_identity: '人物身份匹配', bm25: '关键词匹配', local: '关键词匹配',
    tag_local: '标签匹配', category_local: '分类检索', vector_optional: '语义匹配', entity_exact: '人物精确匹配' };
  const channels = [...new Set((candidate.channels ?? []).map(c => names[c] ?? (/bm25/i.test(c) ? '关键词匹配' : '相关候选')))];
  return channels.join('、') || '相关候选';
}

// When semantic reranking is unavailable, independent questions must not
// compete as one bag of words. Reuse the existing local index and candidate
// pool, promoting at most one hit per question; no API calls or larger packet.
export function coverLocalQuestionParts(candidates,query,index,{filter,dictionary,limit=8,reranked=false}={}){
  if(reranked||!index?.search||limit<2)return candidates;
  // A comma often joins a claim and its correction ("why cancelled, was it
  // stage fright?"). Splitting there can promote the disproved claim.
  const parts=[...new Set(String(query??'').split(/[；;？?\n]+/u).map(s=>s.trim()).filter(s=>s.length>=4&&/谁|什么|怎么|哪里|哪儿|何时|是否|吗|多久|几个|多少|如何|为何|为什么/u.test(s)))].slice(0,3);
  if(parts.length<2)return candidates;
  const byId=new Map(candidates.map(c=>[String(c.id),c])),selected=[],seen=new Set();
  for(const part of parts){
    const expanded=dictionary?dictionaryQuery(part,dictionary,{expandTopics:false}).query:part;
    const hit=index.search(expanded,{limit:candidates.length,filter:r=>r.keywordEnabled!==false&&(!filter||filter(r))}).find(c=>byId.has(String(c.id))&&!seen.has(String(c.id)));
    if(hit&&selected.length<Math.min(3,limit)){seen.add(String(hit.id));selected.push({...byId.get(String(hit.id)),queryPartCoverage:true});}
  }
  return selected.length>1?[...selected,...candidates.filter(c=>!seen.has(String(c.id)))]:candidates;
}

// A person's presence is not evidence that every past scene with that person
// matters to a concrete question. This only rejects topic-unrelated local matches
// when another candidate supplies actual topic evidence. Broad continuation,
// semantic hits, reranked rows and explicit event dependencies are untouched.
export function nameOnlyRecallCandidates(candidates,query,dictionary,rerankedIds=[],allRecords=[],currentQuery=query){
  const original=String(query??'').toLocaleLowerCase();
  const names=[...new Set((dictionary.entries??[]).filter(e=>!e.disabled&&e.kind==='人物')
    .flatMap(e=>[e.name,...(e.aliases??[])].filter(n=>!(e.ambiguous??[]).includes(n))))]
    .map(n=>n.toLocaleLowerCase()).sort((a,b)=>b.length-a.length);
  const mentioned=names.filter(n=>original.includes(n));
  let rest=original;for(const name of mentioned)rest=rest.split(name).join(' ');
  const generic=/^(的|在|是|了|吗|呢|啊|吧|我|你|他|她|它|和|与|及|什么|怎么|为什么|怎样|如何|哪个|这个|那个|是否|现在|之前|以前|当时|后来|继续|然后|一下|告诉|关于|他们|她们|究竟|到底|还是)$/;
  // Keep exact object/place aliases useful after removing person names. The
  // BM25 query already expands these aliases; judging the original alias only
  // here would discard the correct canonical match as "name only". Related
  // index words stay off, and ambiguous/disabled aliases still do not expand.
  const matched=dictionaryQuery(rest,dictionary,{expandTopics:false});
  const exactEntities=matched.entities;
  const places=matched.terms.filter(term=>(dictionary.entries??[]).some(e=>e.name===term.name&&e.kind==='地点')).flatMap(term=>term.matched);
  let withoutPlaces=rest;for(const place of places)withoutPlaces=withoutPlaces.split(place.toLocaleLowerCase()).join(' ');
  const hasOtherTopic=tokenizeChinese(withoutPlaces).some(t=>t.length>1&&!generic.test(t));
  const topicalQuery=[hasOtherTopic?withoutPlaces:rest,...exactEntities.filter(name=>(dictionary.entries??[]).some(e=>e.name===name&&e.kind!=='人物'&&(!hasOtherTopic||e.kind!=='地点')))].join(' ');
  const topics=[...new Set(tokenizeChinese(topicalQuery).filter(t=>t.length>1&&!generic.test(t)))];
  if(!topics.length)return new Set();
  // A generic three-character phrase elsewhere in the request must not erase
  // a rarer two-character scene cue in an event involving the named person.
  // Check rarity against the searchable event corpus, not just the top hits.
  const mentionedPeople=new Set(dictionaryQuery(String(currentQuery??'').toLocaleLowerCase(),dictionary,{expandTopics:false}).entities
    .filter(name=>(dictionary.entries??[]).some(e=>e.kind==='人物'&&e.name===name)).map(name=>name.toLocaleLowerCase()));
  const eventCorpus=allRecords.filter(record=>record.category==='events');
  const exactTitleIds=new Set(eventCorpus.filter(record=>String(record.title??'').toLocaleLowerCase().trim()===String(currentQuery??'').toLocaleLowerCase().trim()).map(record=>record.id));
  const shortTopics=topics.filter(term=>[...term].length===2);
  const ownEventText=record=>[record.description,record.recallSummary,record.title].filter(v=>typeof v==='string').join('\n').toLocaleLowerCase();
  const ownTexts=eventCorpus.map(ownEventText),floorTexts=eventCorpus.map(record=>String(record.linkedFloorText??'').toLocaleLowerCase());
  const frequency=new Map();
  const termFrequency=(term,kind)=>{const key=`${kind}:${term}`;if(!frequency.has(key))frequency.set(key,(kind==='own'?ownTexts:floorTexts).filter(text=>text.includes(term)).length);return frequency.get(key);};
  const rareLimit=Math.max(1,Math.floor(eventCorpus.length*0.03));
  const pairTermLimit=Math.max(2,Math.floor(eventCorpus.length*0.15));
  // Don't qualify an unrelated event via attached knowledge, expanded tags
  // or the participants of an associated event. A quote owned by this event
  // can prove its own topic, but its broad scene/context cannot. If a concrete
  // longer match exists, a stray two-character verb cannot qualify old scenes.
  const topicStrength=c=>{
    const blob=[c.record.description,c.record.recallSummary,c.record.title,c.record.content,c.record.knowledge,c.record.field,c.record.to,
      ...(c.record.keyDialogues??[]).flatMap(q=>[q.text,q.meaning])].filter(v=>typeof v==='string').join('\n').toLocaleLowerCase();
    return Math.max(0,...topics.filter(t=>blob.includes(t)).map(t=>t.length));
  };
  const strengths=new Map(candidates.map(c=>[c.id,topicStrength(c)]));
  const strongest=Math.max(0,...strengths.values());
  const rareOwnEventCue=c=>{
    if(c.record.category!=='events'||(exactTitleIds.size&&!exactTitleIds.has(c.id))||!mentionedPeople.size||
      !(c.record.participants??[]).some(name=>mentionedPeople.has(String(name).toLocaleLowerCase())))return false;
    const own=ownEventText(c.record),floor=String(c.record.linkedFloorText??'').toLocaleLowerCase();
    const ownMatches=shortTopics.filter(term=>own.includes(term)),floorMatches=shortTopics.filter(term=>floor.includes(term));
    if(ownMatches.some(term=>termFrequency(term,'own')<=rareLimit)||
      floorMatches.some(term=>termFrequency(term,'floor')<=rareLimit))return true;
    const bounded=ownMatches.filter(term=>termFrequency(term,'own')<=pairTermLimit);
    return bounded.some((a,i)=>bounded.slice(i+1).some(b=>
      ![...a].some(ch=>b.includes(ch))&&ownTexts.filter(text=>text.includes(a)&&text.includes(b)).length<=rareLimit));
  };
  const hasTopic=c=>(strengths.get(c.id)??0)>=(strongest>=3&&['events','summaryView'].includes(c.record.category)?3:2)||rareOwnEventCue(c);
  const topical=candidates.filter(hasTopic);if(!topical.length)return new Set();
  const linked=new Set(topical.flatMap(c=>c.record.category==='events'?[c.id]:refs(c.record)));
  const ranked=new Set(rerankedIds.map(String));
  return new Set(candidates.filter(c=>!hasTopic(c)&&!ranked.has(String(c.id))&&
    !(c.channels??[]).includes('vector_optional')&&!refs(c.record).some(id=>linked.has(id)))
    .map(c=>c.id));
}
