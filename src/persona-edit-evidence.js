import {clone,sha256} from './utils.js';
import {foldName} from './persona-identity.js';
import {personaSpeechPairs,personaSpeechSpanEnd} from './persona-speech-evidence.js';

const unsafe=/\[\[SHIYI_PERSONA:|<%|%>|<\/?script\b|\{\{(?!\s*(?:user|char)\s*\}\})|@@/i;
export const PERSONA_EDIT_RULE=`局部更新合同：原人物只做有据的最小演进，不重写人格。original.parts中editable=false的是原书引语/口吻范例，不是本聊天已说过的话，不改写或拼接成新台词；新实说只放examples。其它updates每项附before（该ref当前完整文字）、evidence:{floor,quote}（本人物本批连续原文依据），保留对象、否定、条件和未变细节。只提供楼号不是修改依据。
previous.noteParts按previous.text的空行段落顺序给出ref与paragraph（1起算），只读一次正文，不重复发送。已有补充时返回noteUpdates:[{ref:"N1",before:"该段当前原文",text:"仅修改必要部分后的完整段落",evidence:{floor,quote}}]；未列出的段落由程序保留。确有新的、此前没有的信息时ref="new"、before=""；不要逐批加事件日记，也不要重复现有段落。无变更返回noteUpdates:[]。不允许空文字删除段落；过时态度应在对应段落改为明确的当前适用范围。有noteParts或聊天B底稿时text必须为空，新补充也用ref="new"；首次无原书建档或尚无N段的原书首次补充才使用text。evidence须包含本人物的明确归属，优先选原文直接写出姓名的完整句，不截成仅“她/他/两人”的片段；没有可靠归属则保留未确认，不补写姓名伪造引文。语料不得编写、改字或移花接木。语义不确定的修改会留作候选，不会因为请求成功就自动作为当前人设；不要为了通过核对捏造弧光。`;

export function personaNoteParts(profile){
  // A legacy source-free dossier is already supplied as editable chat B-parts.
  if(profile&&!profile.composition&&!profile.bindings?.length)return [];
  let text=String(profile?.composition?.notes??(!profile?.composition?profile?.text:'')??'');
  const baseline=(profile?.composition?.parts??[]).filter(p=>p.source==='chat');
  const carried=baseline.length?baseline:profile?.composition?.sourceBaseline??[];
  if(carried.length){
    const exact=new Set(carried.flatMap(p=>[p.original,p.text]).filter(t=>typeof t==='string'&&t.trim().length>=4).map(t=>t.trim()));
    text=text.split(/\n\s*\n/u).map(block=>block.split(/(?<=[。！？])|\n/u).filter(t=>!exact.has(t.trim())).join('')).filter(t=>t.trim()).join('\n\n');
  }
  // Paragraph boundaries are atomic: don't split conditions or quoted speech.
  return text.split(/\n\s*\n/u).filter(s=>s.trim()).map((text,i)=>({ref:`N${i+1}`,text,key:sha256(text).slice(0,24)}));
}

// Recover a citation boundary, never write a new quotation or infer a cause.
// The v3 model sometimes quotes only the predicate after an explicit actor
// lead. Keep this opt-in and narrower than the ordinary full-quote validator.
function completeNamedEvidence(text,fragment,{identity,name,speech,reviewEvidence=[],floor}){
  if(fragment.trim().length<8)return null;
  const offset=text.indexOf(fragment);
  if(offset<0||text.indexOf(fragment,offset+1)!==-1)return null;
  const units=[];let start=0;
  for(let i=0;i<text.length;i++){
    if(personaSpeechPairs.has(text[i])){const end=personaSpeechSpanEnd(text,i);if(end<0)return null;i=end;continue;}
    if(/[。！？!?\r\n\uFFFC]/u.test(text[i])){units.push({start,end:i+1});start=i+1;}
  }
  if(start<text.length)units.push({start,end:text.length});
  const span=units.find(p=>offset>=p.start&&offset+fragment.length<=p.end);
  if(!span)return null;
  const sentence=text.slice(span.start,span.end).trim();
  if(!sentence||sentence.length>2400||unsafe.test(sentence)||sentence.includes('\uFFFC'))return null;
  const actor=identity.resolve(name),key=actor?.key??foldName(name);
  const labels=[name,...(actor?[actor.name,...actor.aliases]:[])].filter(label=>identity.resolve(label)?.key===key||label===name).sort((a,b)=>b.length-a.length);
  const label=labels.find(s=>sentence.startsWith(s));if(!label)return null;
  if(/[“”「」『』"‘’]/u.test(sentence)){
    const open=sentence.search(/[“「『"]/u),close=open<0?-1:personaSpeechSpanEnd(sentence,open);
    if(close<0||/[“”「」『』"‘’]/u.test(sentence.slice(open+1,close)))return null;
    return speech?.(text,sentence,name,identity,{includeLead:true})?sentence:null;
  }
  const tail=sentence.slice(label.length);
  // A model may cite only a restriction after a semicolon. Recover it only
  // when its own review selected this exact complete named decision. The
  // selected review is a candidate boundary, not proof of its interpretation.
  if(/^决定(?:今后|从今(?:起|后)|此后|以后)?(?:可(?:以)?(?:与|和)|不再|仍|只|仅)/u.test(tail)&&Array.isArray(reviewEvidence)&&reviewEvidence.some(e=>e?.floor===floor&&e.quote===sentence)){
    const clauses=tail.split(/[；;]/u).slice(1),selected=clauses.find(c=>c.trimStart().startsWith(fragment));
    const unsafeAttribution=/听见|听到|听说|转述|复述|读到|信中|据说|声称|假如|假设|如果|否认/u;
    const restriction=/^未(?:经|获(?:得)?|取得)[^，,；;。！？]{1,80}(?:材料|线索|资料|内容|部分|事项|操作|权限)(?:仍|也|都|一律|只|仅|不|禁|需|须|应)/u;
    const sameSubjectTail=/^(?:也|并|且|仍)(?:保留|不|不得|不能|只|仅|需|须|应)/u;
    const bounded=clauses.length&&clauses.every(c=>{
      const pieces=c.trim().split(/[，,]/u);
      return restriction.test(pieces[0])&&pieces.slice(1).every(p=>sameSubjectTail.test(p.trim()))&&
        !identity.mentions(c).some(p=>p.key!==key);
    });
    if(selected&&bounded&&!unsafeAttribution.test(sentence))return sentence;
  }
  // Only explicit causal / declarative leads. Hearing, quoting, possessives,
  // pronouns, multiple sentences and another actor's speech are not repaired.
  const lead=/^(?:因(?:为)?[^，。！？\r\n]*，|明确[，：:])/u.exec(tail);
  if(!lead)return null;
  const body=tail.slice(lead[0].length);
  if(!body.startsWith(fragment))return null;
  // A citation may start at the body itself, so inspecting only its prefix
  // would miss "现在另一人物…" and "仍听见另一人物…" subject switches.
  if(/听见|听到|听说|转述|复述|读到|信中|据说|声称|假如|假设|如果|否认/u.test(sentence))return null;
  const ownDecision=/^决定/u.test(body);
  const ownDeclaration=/^(?:这|该|上述|本次)(?:份|项|种|次|一)?(?:授权|许可|约定|边界)(?:只对|仅对|限于)/u.test(body);
  if(!ownDecision&&!ownDeclaration)return null;
  const laterClauses=body.split(/[；;]/u).slice(1);
  if(laterClauses.some(clause=>identity.mentions(clause).some(p=>p.key!==key)))return null;
  return sentence;
}

export function personaEditEvidence(value,{messages,identity,name,speech,updateContractVersion=1,reviewEvidence=[]}){
  if(!value||!Number.isSafeInteger(value.floor)||typeof value.quote!=='string'||!value.quote.trim()||value.quote.length>2400||unsafe.test(value.quote))return null;
  const m=messages.find(m=>m.index===value.floor);
  if(!m||!m.text.includes(value.quote))return null;
  if(!identity.mentions(value.quote).some(p=>p.key===foldName(name))&&!speech?.(m.text,value.quote,name,identity)){
    const full=updateContractVersion>=2?completeNamedEvidence(m.text,value.quote,{identity,name,speech,reviewEvidence,floor:value.floor}):null;
    return full?{floor:value.floor,quote:full,citedQuote:value.quote,recovered:'unique_actor_sentence'}:null;
  }
  return {floor:value.floor,quote:value.quote};
}

export function mergePersonaNotes(row,previous,context){
  const parts=personaNoteParts(previous),old=parts.map(p=>p.text).join('\n\n'),pending=[];
  if(row.noteUpdates===undefined){
    const text=String(row.text??'').trim();
    // A worldbook-only baseline has no N paragraph to replace yet. The first
    // supplement follows the same contract as first creation. Chat baselines
    // still require B deltas; existing notes still require N deltas.
    const firstSupplement=!parts.length&&previous?.bindings?.length&&
      !previous.composition?.parts?.some(p=>p.source==='chat')&&!previous.composition?.sourceBaseline?.length;
    if(text===old||!previous||firstSupplement)return {notes:text,changes:[],pending};
    // Keeping old paragraphs does not justify silently appending a conflicting
    // state. Changed snapshots use the same evidence-bearing delta contract.
    return {notes:old,changes:[],pending:[{kind:'notes',reason:'missing_note_updates',text,sourceFloors:clone(row.sourceFloors??[])}]};
  }
  if(!Array.isArray(row.noteUpdates)||row.noteUpdates.length>24)return {notes:old||(!previous?String(row.text??'').trim():''),changes:[],pending:[{kind:'notes',reason:'invalid_note_updates'}]};
  const next=parts.map(p=>({...p})),changes=[],seen=new Set(),duplicates=new Set();
  for(const edit of row.noteUpdates)if(edit?.ref!=='new'){if(seen.has(edit?.ref))duplicates.add(edit?.ref);seen.add(edit?.ref);}
  for(const edit of row.noteUpdates){
    const part=parts.find(p=>p.ref===edit?.ref),fresh=edit?.ref==='new';
    const evidence=personaEditEvidence(edit?.evidence,context);
    const reason=(!fresh&&!part)?'unknown_note_ref':duplicates.has(edit?.ref)?'duplicate_note_ref':typeof edit?.text!=='string'||!edit.text.trim()||unsafe.test(edit.text)?'invalid_note_text':edit.before!==(fresh?'':part.text)?'note_before_mismatch':!evidence?'missing_note_evidence':null;
    if(reason){pending.push({kind:'notes',reason,...(typeof edit?.ref==='string'?{ref:edit.ref}:{}),...(typeof edit?.text==='string'&&!unsafe.test(edit.text)?{text:edit.text}:{}),...(evidence?{evidence}:{})});continue;}
    const text=edit.text.trim();
    if(fresh){if(!next.some(p=>p.text.trim()===text))next.push({text});}
    else next.find(p=>p.ref===part.ref).text=text;
    changes.push({ref:edit.ref,before:part?.text??'',after:text,evidence});
  }
  return {notes:next.length?next.map(p=>p.text).join('\n\n'):old||(!previous?String(row.text??'').trim():''),changes,pending};
}

// Mark every piece of one source quotation as protected without renumbering
// legacy B-refs/keys. Source strings and saved revisions remain byte-preserved.
export function markPersonaQuoteParts(parts){
  const groups=new Map();
  for(const part of parts){const key=JSON.stringify([part.book,part.uid,part.spanId]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(part);}
  const protectedKeys=new Set();
  for(const group of groups.values()){
    const text=group.map(p=>p.original??p.text??'').join(''),ranges=[];
    const pairs=new Map([['“','”'],['「','」'],['『','』'],['"','"']]);let start=-1,stack=[];
    for(let i=0;i<text.length;i++){
      const c=text[i];if(stack.length&&c===stack.at(-1)){stack.pop();if(!stack.length){ranges.push([start,i+1]);start=-1;}}
      else if(pairs.has(c)){if(!stack.length)start=i;stack.push(pairs.get(c));}
    }
    if(start>=0)ranges.push([start,text.length]);
    let at=0;for(const p of group){const end=at+String(p.original??p.text??'').length;if(ranges.some(([a,b])=>at<b&&end>a))protectedKeys.add(p);at=end;}
  }
  return parts.map(p=>({...p,sourceQuote:protectedKeys.has(p)}));
}

// Only a self-contained quotation, with no surrounding stable prose, may
// leave the current style projection. Never rewrite the original utterance.
export function retirablePersonaStyle(part){
  if(!part?.sourceQuote||part.source==='chat')return false;
  const text=String(part.original??'').trim();
  return /^(?:[-*•]\s*)?(?:“[^“”]+”|「[^「」]+」|『[^『』]+』|"[^"]+")$/u.test(text);
}
// Legacy B references split some complete quotes (notably ASCII closers).
// Keep those refs/keys stable and identify bounded, wholly quoted units.
export function personaStyleGroups(parts){
  const result=[];
  for(let i=0;i<parts.length;i++){
    const first=parts[i];if(!first.sourceQuote||first.source==='chat')continue;
    let original='';const group=[];
    for(let j=i;j<Math.min(parts.length,i+16);j++){
      const p=parts[j];if(!p.sourceQuote||p.source==='chat'||p.book!==first.book||p.uid!==first.uid||p.spanId!==first.spanId)break;
      original+=p.original??'';group.push(p);
      if(original.length>4000)break;
      if(retirablePersonaStyle({...first,original})){result.push(group);i=j;break;}
    }
  }
  return result;
}
export function personaProjectedSourceParts(parts){
  const marked=markPersonaQuoteParts(parts),restore=new Set();
  for(const group of personaStyleGroups(marked))if(group.some(p=>p.status==='historical')&&!group.every(p=>p.status==='historical'))for(const p of group)restore.add(p.key);
  return marked.map(p=>restore.has(p.key)?{...p,status:'active',text:p.original}:p);
}
// Quoted names/concepts must not freeze all surrounding narration. Only
// complete, balanced quotes are eligible; fragments crossing old B-refs stay
// protected. No quote bytes, number or order may change in a prose patch.
export function personaProseQuotes(text){
  const pairs=new Map([['“','”'],['「','」'],['『','』'],['"','"']]),closes=new Set(pairs.values()),stack=[],quotes=[];
  let start=-1,outside='';
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(stack.length&&c===stack.at(-1)){stack.pop();if(!stack.length){quotes.push(text.slice(start,i+1));start=-1;}continue;}
    if(pairs.has(c)){if(!stack.length)start=i;stack.push(pairs.get(c));continue;}
    if(closes.has(c))return null;
    if(!stack.length)outside+=c;
  }
  return !stack.length&&quotes.length&&/\p{L}/u.test(outside)?quotes:null;
}
export function safePersonaQuotedProse(part,text){
  if(!part?.sourceQuote||part.source==='chat'||typeof text!=='string')return false;
  const original=personaProseQuotes(String(part.original??'')),next=personaProseQuotes(text);
  return Boolean(original&&next&&JSON.stringify(original)===JSON.stringify(next));
}
export function personaSourcePartText(part){
  return part.sourceQuote&&part.original!==undefined&&!(part.quoteSafeEdit&&safePersonaQuotedProse(part,part.text))?part.original:part.text;
}
export const PERSONA_QUOTED_PROSE_RULE='editable="surrounding_prose"表示段落含被保护的称谓/引语，只可修改引号外有本批依据的叙述；protectedQuotes中的完整引语必须逐字保留、顺序与个数不变。不要因为段里出现引号就放任过时的全局性格指令：将其适用对象/场合改到有据范围，稳定身份、爱好、其它对象的特点不动。不在引号内插入叙述，不移动拼接跨ref引语。';
export const PERSONA_STYLE_RETIRE_RULE='输出前逐个核对原书retirable:true口吻引语是否仍适用于当前对象。冲突时在updates用{ref,before,text:与before逐字相同,status:"historical",developmentIndex:本次development数组中对应项的位置从1起算,evidence:{floor,quote}}退出当前口吻，不改写引语，也无需重复填target/scope。retireTogether列出同一句被拆开的refs：必须对整组逐项提供完全相同的转变位置与依据，不能只退半句；各自before/text保留该ref原字。必须关联本批有依据的对象/情境转变及changed核对，将相关refs列入conflictRefs；原因叙述与相关人物原话可在本批不同楼，不为同楼伪造引文。稳定资料、非独立引语、没有冲突的范例不可退出。程序保留原文与历史，仅不再作为当前模仿素材。不能因为变亲近就撤掉自主、工作或对他人的边界。';
