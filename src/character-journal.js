import { clone, stableStringify, sha256, estimateUnits } from './utils.js';
import { sourceFloors, narrativeText,awarenessLabel,viaLabel } from './product-narrative.js';
import { dictionaryQuery } from './product-dictionary.js';
import { tokenizeChinese } from './retrieval.js';
import { hasStoryTime } from './temporal.js';
import { narrativeEvidence,evidenceWithoutPlanning } from './memory-evidence.js';

// These are views of sourced records, not additional memory tables. A diary is
// an interpretation aid, never proof that a physical diary exists in-world.
export const SUMMARY_FACTUAL_RULE = '主总结客观归档，动态人设另按原设定与正文分析演变。只记明确发生、说出或描写的事实、关系边界、约定、知情和属性；自述标character_claim。逐项核对所属人物：同事、同单位、同住或亲属不证明职业、能力、偏好相同。单次行为、当次选择及反应只记本次事件或当时状态，不能写成通常如此、习惯或喜欢某物；长期属性须有原文明示的稳定特征。不补原文未说的动作方向、归属、前因或隐藏动机，不推演心理阶段/永久性格。personaChanges只记明示的定向态度变化；performanceHints只记明示且仍适用的表达/行为习惯，无依据用[]，不能把本次动作写成将来演绎指南。原文明示的内心可记录，不另编心理分析或为填满模块重复解读。';
export const JOURNAL_RULE = '仅当原文明示内心独白、自述或内心变化时，可在对应personaChanges或performanceHints附innerLife:{stage:"原文支持的简短主题",text:"忠实记录原文明示内容",cause:"原文明示原因；未知留空",basis:"observed|character_claim",status:"current|historical"}，沿用该记录主体、对象、时间、eventRef及sourceRefs。没有明确内心内容则省略，不要求每个态度变化另写一份心理阶段，不从动作推演原因或替角色编写第一人称日记。私密心迹不是他人知情，也不表示角色实际写了日记。关键对话使用keyDialogues，保存双方各自原话及回应语境；台词status为active（仍重要）或historical（已变化），已撤回不能当作当前承诺。不要为这些视图增加模型调用或重复创建事件。';
const clean=(v,max=12000)=>typeof v==='string'&&v.trim().length<=max?v.trim():'';
export function normalizeInnerLife(value,{manual=false}={}){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const text=clean(value.text),stage=clean(value.stage,160);
  if(!text||!stage)return null;
  return {stage,text,cause:clean(value.cause,4000),basis:manual?'user_asserted':['observed','character_claim','inferred'].includes(value.basis)?value.basis:'inferred',status:value.status==='historical'?'historical':'current',private:true,representation:'role_reference',...(['source_monologue','stage_observation'].includes(value.origin)?{origin:value.origin}:{})};
}
// Recover only an explicitly named private monologue. Variable updates are
// valid private-role material, never spoken dialogue or another person's knowledge.
export function explicitMonologues(evidence,subject){
  const found=[];
  for(const patch of evidenceWithoutPlanning(evidence).matchAll(/<JSONPatch>\s*([\s\S]*?)\s*<\/JSONPatch>/gi)){
    let rows;try{rows=JSON.parse(patch[1]);}catch{continue;}
    if(!Array.isArray(rows))continue;
    for(const row of rows){
      if(!['insert','replace','add'].includes(row?.op)||typeof row.path!=='string')continue;
      const parts=row.path.split('/').slice(1).map(s=>s.replace(/~1/g,'/').replace(/~0/g,'~'));
      if(parts.length===3&&parts[0]==='角色'&&parts[1]===subject&&parts[2]==='内心独白'&&clean(row.value))found.push(clean(row.value));
      if(parts.length===2&&parts[0]==='角色'&&parts[1]===subject&&clean(row.value?.内心独白))found.push(clean(row.value.内心独白));
    }
  }
  const name=subject.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const pattern=new RegExp(`${name}[：:，,\\s]*(?:(?:在心里|默默地?|暗自|不由得|忍不住)[，,\\s]*)?(?:心想|心里想|暗想|内心独白)[：:，,\\s]*[“「]([^”」]{1,2000})[”」]`,'gu');
  for(const m of narrativeEvidence(evidence).matchAll(pattern))found.push(m[1]);
  return [...new Set(found)];
}
export function completeInnerLife(record,evidence,category){
  if(!['personaChanges','performanceHints'].includes(category)||record.innerLife!==undefined)return record;
  const subject=record.subject??record.person??record.entity;
  if(typeof subject!=='string'||!subject.trim()||!evidence.includes(subject)||!record.sourceRefs?.length)return record;
  const monologues=explicitMonologues(evidence,subject);
  const observation=category==='personaChanges'?clean(record.description):'';
  const text=monologues.length?monologues.join('\n'):observation;
  if(!text||text.length>12000)return record;
  const innerLife=normalizeInnerLife({stage:clean(record.aspect??record.field??record.key,160)||(monologues.length?'本阶段心声':'阶段观察'),text,
    cause:record.context??'',basis:monologues.length?'observed':(['observed','character_claim'].includes(record.epistemicStatus)?record.epistemicStatus:'inferred'),
    origin:monologues.length?'source_monologue':'stage_observation'});
  return {...record,innerLife};
}
export function innerLifeText(card){
  const d=card.innerLife;if(!d?.text||d.disabled)return '';
  const basis=(d.origin==='stage_observation'?'阶段观察，非角色逐字心声；':d.origin==='source_monologue'?'原文明确内心独白；':'')+({observed:'依据正文明确描写',character_claim:'依据角色自述',user_asserted:'用户编写',inferred:'可选演绎推测，不是事实'}[d.basis]??'来源性质未确认');
  return `[角色心迹 · ${d.stage} · ${d.status==='historical'?'过去阶段，非当前状态':'按本条时间与情境适用'} · ${basis}]\n人物：${card.subject??card.person??card.entity??'未注明'}${card.object?`；涉及对象：${card.object}`:''}${hasStoryTime(card.temporal)?`；时间：${narrativeText(card.temporal)}`:''}${sourceFloors(card).length?`；来源：第${sourceFloors(card).join('、')}楼`:''}\n${d.text}${d.cause?`\n变化缘由：${d.cause}`:''}\n仅供${card.subject??card.person??card.entity??'所属角色'}演绎参考，不代表实际写过日记；私密想法不赋予其他角色知情权。`;
}
export function markDiaryHistory(cards){
  const groups=new Map(),historical=new Set();
  for(const r of cards)if(r.innerLife&&!r.innerLife.disabled){
    const floors=sourceFloors(r);if(!floors.length)continue;
    const key=stableStringify([r.subject??r.person??r.entity,r.object??'',r.aspect??'心迹']);
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push({r,last:Math.max(...floors)});
  }
  for(const rows of groups.values()){
    rows.sort((a,b)=>b.last-a.last);const latest=rows[0];let past=false;
    for(const row of rows){
      if(row.last<latest.last&&(row.r.innerLife.stage!==latest.r.innerLife.stage||row.r.innerLife.status==='historical'))past=true;
      if(past||row.r.innerLife.status==='historical')historical.add(row.r.id);
    }
  }
  return cards.map(r=>r.innerLife?{...r,innerLifeHistorical:historical.has(r.id)}:r);
}
const refs=r=>(r.sourceRefs??[]).map(s=>stableStringify([s.sourceId,s.fragmentId??null,s.hash??null]));
const quoteKey=q=>stableStringify([q.speaker,q.to??'',q.text]);
const quoteAwareness=r=>(r.awareness??[]).length?`\n知情限制：${r.awareness.map(a=>`${a.person??a.subject??'未注明角色'}：${narrativeText(a.knowledge??a.fact??a.content)}〔${awarenessLabel(a.status??a.knowledgeStatus)}；${viaLabel(a.via)}${hasStoryTime(a.learnedAt)?`；获知时间：${narrativeText(a.learnedAt)}`:''}〕`).join('；')}`:'\n仅保留说话人与接收对象；未关联他人知情记录，不等于其他角色知道这段对话。';
export function characterKeepsakes(cards=[],{withExpected=true}={}){
  const dialogues=[],diaries=[];
  for(const r of cards){
    if(r.lifecycleState==='retracted'||r.lifecycleState==='superseded')continue;
    if(!r.keyDialogues?.length&&!r.innerLife?.text)continue;
    const expected=withExpected?sha256(r):null;
    for(const [index,q]of (r.keyDialogues??[]).entries()){
      if(!q?.speaker||!q.text)continue;
      const occurrence=q.sourceRefs?.length?{...r,sourceRefs:q.sourceRefs,sourceFloors:q.sourceFloors??r.sourceFloors}:r;
      const row={kind:'dialogue',id:`${r.id}:${index}`,recordId:r.id,index,expected,subject:q.speaker,target:q.to??'',data:clone(q),record:occurrence,refs:refs(occurrence),origins:[{recordId:r.id,index,expected}]};
      // Repetition is coalesced only with shared original evidence. Identical
      // words on different dates must remain separately editable occurrences.
      const previous=dialogues.find(p=>quoteKey(p.data)===quoteKey(q)&&p.refs.some(s=>row.refs.includes(s))&&p.data.status===q.status&&Boolean(p.data.disabled)===Boolean(q.disabled));
      if(previous){previous.origins.push(...row.origins);previous.refs=[...new Set([...previous.refs,...row.refs])];}
      else dialogues.push(row);
    }
    if(r.innerLife?.text)diaries.push({kind:'diary',id:r.id,recordId:r.id,index:null,expected,subject:r.subject??r.person??r.entity??'',target:r.object??'',data:clone(r.innerLife),record:r,origins:[{recordId:r.id,index:null,expected}]});
  }
  const last=r=>Math.max(-1,...sourceFloors(r.record));
  const phases=[],previous=new Map();
  for(const r of diaries.sort((a,b)=>last(a)-last(b))){
    const key=stableStringify([r.subject,r.target,r.record.aspect??'心迹']),p=previous.get(key);
    if(p&&last(r)>=0&&last(p)>=0&&['stage','basis','status','disabled'].every(k=>r.data[k]===p.data[k])){
      for(const k of ['text','cause'])p.data[k]=[...new Set([p.data[k],r.data[k]].filter(Boolean))].join('\n');
      p.origins.push(...r.origins);p.record={...r.record,sourceFloors:[...new Set([...sourceFloors(p.record),...sourceFloors(r.record)])]};
    }else {phases.push(r);previous.set(key,r);}
  }
  return {dialogues,diaries:phases.sort((a,b)=>last(b)-last(a))};
}
export function editKeepsakePatch(record,{kind,index,data,remove=false}){
  if(kind==='diary'){
    if(!['personaChanges','performanceHints'].includes(record.category))throw new Error('角色心迹应归入人设变化或演绎参考');
    if(remove)return {innerLife:null};
    const value=normalizeInnerLife(data,{manual:true});if(!value)throw new Error('请填写阶段名称和心迹正文');
    const same=['text','stage','cause'].every(k=>(record.innerLife?.[k]??'')===(value[k]??''));
    return {innerLife:{...value,...(same?{basis:record.innerLife.basis}:{}),disabled:data.disabled===true}};
  }
  if(kind!=='dialogue')throw new Error('未知记录类型');
  const list=clone(record.keyDialogues??[]);
  if(index!==null&&(!Number.isInteger(index)||index<0||index>=list.length))throw new Error('台词条目已变化，请重新打开');
  if(remove){if(index===null)throw new Error('尚未选择台词');list.splice(index,1);return {keyDialogues:list};}
  if(!clean(data?.speaker,160)||!clean(data?.text))throw new Error('请填写说话人和台词');
  const q={speaker:clean(data.speaker,160),to:clean(data.to,160),text:clean(data.text),context:clean(data.context,4000),meaning:clean(data.meaning,4000),status:data.status==='historical'?'historical':'active',disabled:data.disabled===true,provenance:'user_authored'};
    if(index!==null&&['speaker','to','text','context','meaning'].every(k=>(list[index][k]??'')===(q[k]??''))){if(list[index].provenance)q.provenance=list[index].provenance;else delete q.provenance;}
    if(index!==null&&['speaker','text'].every(k=>list[index][k]===q[k]))for(const k of ['sourceRefs','sourceFloors'])if(list[index][k])q[k]=clone(list[index][k]);
  if(index===null)list.push(q);else list[index]=q;
  return {keyDialogues:list};
}
export function importantDialoguePacket(cards,query,dictionary,alreadyText='',{topicQuery=query,maxRows=4,maxUnits=1200,includeRow=()=>true}={}){
  // This is an extra route for old speech, beyond quotes already present in
  // retrieved events and the current persona. The current user turn is the
  // sole source of topics and people; old assistant prose is already in the
  // host request and must not reopen every line from an earlier scene.
  const ask=String(topicQuery??'');
  const asksForSpeech=/(?:说|讲|提|回应|回答).{0,12}(?:什么|哪句|哪些|怎么|如何)|(?:什么|哪句|哪些|怎么|如何).{0,12}(?:说|讲|回应|回答)|(?:找|回忆|复述|引用).{0,12}(?:原话|台词)|(?:原话|台词).{0,12}(?:是什么|有哪些|哪句|什么)/u.test(ask);
  if(!ask.trim()||maxRows<=0||maxUnits<=0)return {text:'',rows:[]};
  const rows=characterKeepsakes(cards,{withExpected:false}).dialogues.filter(r=>r.data.status!=='historical'&&!r.data.disabled&&includeRow(r));
  const entries=[...(dictionary.entries??[])];
  for(const n of new Set(rows.flatMap(r=>[r.subject,r.target]).filter(Boolean)))if(!entries.some(e=>e.name===n||e.aliases?.includes(n)))entries.push({name:n,aliases:[],indexWords:[],ambiguous:[],kind:'人物'});
  const lexicon={...dictionary,entries};
  const matched=dictionaryQuery(ask,lexicon,{entityLimit:Infinity});
  const focused=matched.entities.filter(name=>entries.some(e=>e.name===name&&e.kind==='人物'));
  const names=new Set(focused);
  const matchedName=n=>names.has(n)||entries.some(e=>!e.disabled&&names.has(e.name)&&e.aliases?.includes(n)&&!e.ambiguous?.includes(n));
  const named=matched.terms.filter(term=>names.has(term.name)).flatMap(term=>term.matched);
  let rest=ask;for(const name of named)rest=rest.split(name).join(' ');
  const sceneTopics=[...new Set(tokenizeChinese(rest).filter(token=>token.length>1&&!/^(?:什么|哪句|哪些|怎么|如何|原话|台词|说过|说了|说话|回答|回应|时间|时候|角色|人物|剧情|场景|当前|现在)$/u.test(token)))];
  const places=matched.terms.filter(term=>entries.some(e=>e.name===term.name&&e.kind==='地点')).flatMap(term=>term.matched);
  let topical=rest;for(const place of places)topical=topical.split(place).join(' ');
  topical=topical.replace(/来到|走进|回到|进入|接着|继续|然后/gu,' ');
  const topics=[...new Set(tokenizeChinese(topical).filter(token=>token.length>1&&!/^(?:什么|哪句|哪些|怎么|如何|原话|台词|说过|说了|说话|回答|回应|时间|时候|角色|人物|剧情|场景|当前|现在|来到|走进|回到|进入|接着|继续|然后)$/u.test(token)))];
  // Tokenization yields overlapping Chinese n-grams. Count the longest
  // concrete overlaps so one place name cannot look like several topics.
  const maximal=terms=>terms.filter(term=>!terms.some(other=>other.length>term.length&&other.includes(term)));
  // A phrase shared by much of an old scene ("交接", for example) is not
  // enough to select a particular line in unrelated current narration.
  const frequency=new Map(topics.map(token=>[token,rows.filter(r=>[r.data.text,r.data.meaning].filter(Boolean).join('\n').includes(token)).length]));
  const distinctive=token=>(frequency.get(token)??0)<=Math.max(2,Math.ceil(rows.length*0.15));
  const candidates=rows.map((r,index)=>{
    if(![r.subject,r.target].some(matchedName))return false;
    if(alreadyText.includes(`关键台词：${r.subject}${r.target?` 对 ${r.target}`:''}：「${r.data.text}」${r.data.context?`〔${r.data.context}〕`:''}`))return false;
    const speech=[r.data.text,r.data.meaning].filter(Boolean).join('\n');
    const sceneText=[r.record?.location,r.record?.title,r.data.context].filter(v=>typeof v==='string').join('\n');
    const direct=maximal(topics.filter(token=>speech.includes(token)));
    const substantive=direct.filter(token=>!sceneText.includes(token));
    const specific=substantive.filter(distinctive);
    const scene=maximal(sceneTopics.filter(token=>sceneText.includes(token)));
    // Narrative use needs distinctive content beyond the old scene label.
    // Direct speech questions can fall back to that scene when no specific
    // quoted content is available.
    if(asksForSpeech?(!direct.length&&!scene.length&&topics.length>0):!specific.length)return false;
    const floor=Math.max(-1,...sourceFloors(r.record));
    return {r,index,specific,score:specific.reduce((n,t)=>n+t.length*8,0)+substantive.reduce((n,t)=>n+t.length*4,0)+direct.reduce((n,t)=>n+t.length*2,0)+(asksForSpeech?scene.reduce((n,t)=>n+t.length,0):0)+(focused.some(name=>name===r.subject)?6:0),floor};
  }).filter(Boolean);
  const selected=(asksForSpeech&&candidates.some(c=>c.specific.length)?candidates.filter(c=>c.specific.length):candidates)
    .sort((a,b)=>b.score-a.score||b.floor-a.floor||a.index-b.index);
  const header='[重要对话：历史原话及当时语境，不要求复读；说过不等于已经兑现，不改变未获知者的知识。]';
  const chosen=[],parts=[header];
  for(const {r} of selected){
    if(chosen.length>=Math.min(maxRows,asksForSpeech?4:2))break;
    const part=`${r.subject}${r.target?` 对 ${r.target}`:''}：「${r.data.text}」${r.data.provenance==='user_authored'?'〔用户编写，非程序核对的逐字原文〕':''}\n语境：${r.data.context||r.record.title||'见原事件'}${r.data.meaning?`；含义：${r.data.meaning}`:''}${r.record.temporal?`\n时间：${narrativeText(r.record.temporal)}`:''}\n${quoteAwareness(r.record)}\n来源：${sourceFloors(r.record).map(n=>`第${n}楼`).join('、')||'原记录'}`;
    if(estimateUnits([...parts,part].join('\n\n'))>maxUnits)continue;
    chosen.push(r);parts.push(part);
  }
  return {text:chosen.length?parts.join('\n\n'):'',rows:chosen};
}
