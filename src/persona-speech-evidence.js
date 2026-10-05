import {foldName} from './persona-identity.js';
import {qualitySourceSegments} from './source-evidence.js';
import {withoutPrivateSpeech} from './memory-evidence.js';

const speechPairs=new Map([['“','”'],['「','」'],['『','』'],['"','"'],['〔','〕'],['【','】'],['（','）'],['(',')'],['‘','’']]);
// Read an outer span as a unit: quoted names/speech inside action, thought or
// narrator brackets must never establish a new speaker. Unclosed spans fail shut.
function speechSpanEnd(text,start){
  const stack=[speechPairs.get(text[start])];
  for(let i=start+1;i<text.length;i++){
    if(text[i]===stack.at(-1)){stack.pop();if(!stack.length)return i;}
    else if(speechPairs.has(text[i]))stack.push(speechPairs.get(text[i]));
  }
  return -1;
}

function personaSpeechLead(lead,speaker,identity){
  const folded=foldName(lead).trim();
  if(/心想|暗想|心里|心中|内心|心声|心の声|心の中|モノローグ|ナレーション|默念|默想|想道|思忖|腹诽|独白|旁白|画外音|未说|没说|没有说|并未|没有开口|沉默|如果|假如|假设|也许|可能会|打算|想要|准备|梦中|梦见/.test(folded))return false;
  // A bounded grammar rather than 'some name occurs in the preceding prose'.
  // Addressees are allowed only behind 对/向; shared aliases use identity.resolve.
  const header=/^(.*?)(?:\s*【[^】\r\n]*】)?\s*[：:]?\s*$/u.exec(folded)?.[1]?.trim();
  if(!header)return false;
  const owns=label=>{
    const person=identity?.resolve(label),target=identity?.resolve(speaker);
    if(person)return person.key===(target?.key??foldName(speaker));
    // A new unindexed character may use its exact full name. Never bypass an
    // ambiguous/disabled alias known to the identity index.
    const known=identity?.people.some(p=>[p.name,...p.aliases].some(a=>foldName(a)===label));
    return !known&&label===foldName(speaker).trim();
  };
  if(owns(header))return true;
  const target=identity?.resolve(speaker),labels=[speaker,...(target?[target.name,...target.aliases]:[])].map(foldName);
  const spoken=/^\s*(?:(?:对|向)[\p{L}\p{N}· ]{1,40})?\s*(?:(?:轻声|低声|小声|大声|柔声|笑着|认真地|温和地)\s*)?(?:说道|说|问道|问|回答|答道|回应|喊道|喊|答|道|补充(?:说|道)?)$/u;
  // An explicit audience modifier does not change the grammatical speaker.
  // Strip only this bounded form after a verified name; the complete remainder
  // must still be a speech clause (not hearing, quoting, imagining or thinking).
  const audience=/^\s*(?:(?:当[着著][\p{L}\p{N}· ]{1,24}的面|在[\p{L}\p{N}· ]{1,24}面前|当众|私下|公开|当面)\s*)/u;
  return labels.some(label=>header.startsWith(label)&&owns(label)&&spoken.test(header.slice(label.length).replace(audience,'')));
}

/** Local exact utterance attribution, reusable without a model call. Identity
 * folding applies only to speaker labels; source words are never normalized.
 * This checks explicit forms, not semantic truth, chronology or who heard them. */
function scanPersonaSpeech(evidence,quote,speaker,identity,{includeLead=false,availabilityOnly=false,audienceOnly=false}={}){
  if(typeof speaker!=='string'||!speaker.trim()||!availabilityOnly&&(typeof quote!=='string'||!quote.trim()||!String(evidence??'').includes(quote)))return false;
  // Reuse the source filter, retaining boundaries across removed planning,
  // variable or script blocks so removal cannot manufacture an attribution.
  const raw=withoutPrivateSpeech(evidence);
  // Keep the explicit content-body boundary used by hasSpeechEvidence, while
  // filtering against original offsets (never concatenate through hidden text).
  const body=/^\s*<content>\s*\r?\n([\s\S]*?)<\/content>/mi.exec(raw);
  const from=body?body.index+body[0].indexOf('>')+1:0,to=body?body.index+body[0].lastIndexOf('</content>'):raw.length;
  let end=from;
  const source=qualitySourceSegments({id:'persona-speech',text:raw}).filter(s=>s.end>from&&s.start<to).map(s=>{
    const a=Math.max(from,s.start),b=Math.min(to,s.end),chunk=(a===end?'':'\n\uFFFC\n')+raw.slice(a,b);end=b;return chunk;
  }).join('');
  const audiences=[],attributed=lead=>personaSpeechLead(lead,speaker,identity);
  let start=0;
  for(let i=0;i<source.length;i++){
    // Only examine top-level lines. A second global line scan would expose
    // unquoted dialogue nested in multiline narrator/inner-thought brackets.
    if(i===0||source[i-1]==='\n'){
      const last=source.indexOf('\n',i),line=source.slice(i,last<0?source.length:last).trim();
      const m=/^([^：:\r\n]+)[：:]\s*([^“”「」『』"〔〕【】（）()‘’]+)$/u.exec(line);
      if(m&&(availabilityOnly?Boolean(m[2].trim()):m[2].trim()===quote)&&attributed(m[1])){
        if(!audienceOnly)return true;audiences.push(personaSpeechRecipient(m[1],speaker,identity));
      }
    }
    const c=source[i];
    if(speechPairs.has(c)){
      const close=speechSpanEnd(source,i);if(close<0)break;
      if(/[“「『"]/u.test(c)){
        const ownsSpeech=attributed(source.slice(start,i));
        if(ownsSpeech&&(availabilityOnly?Boolean(source.slice(i+1,close).trim()):source.slice(i+1,close).trim()===quote||includeLead&&source.slice(start,close+1).trim()===quote.trim())){
          if(!audienceOnly)return true;audiences.push(personaSpeechRecipient(source.slice(start,i),speaker,identity));
        }
        // Keep the Japanese opener's subject through its matching closer and
        // adjacent translation. An intervening narrator/speaker breaks the pair.
        const translated=c==='「'?/^\s*〔/u.exec(source.slice(close+1)):null;
        if(translated){
          const at=close+translated[0].length,last=speechSpanEnd(source,at);
          if(last<0)break;
          if(ownsSpeech&&(availabilityOnly?Boolean(source.slice(at+1,last).trim()):source.slice(at+1,last).trim()===quote)){
            if(!audienceOnly)return true;audiences.push(personaSpeechRecipient(source.slice(start,i),speaker,identity));
          }
          i=last;start=i+1;continue;
        }
        start=close+1;
      }else if(c!=='【')start=close+1;
      i=close;
    }else if(/[。！？；，,;!?\r\n]/u.test(c)){
      // GAL often puts an explicit speaker header on one line and the quoted
      // utterance on the very next. Retain only a verified header across this
      // one line break; never bridge narration, blank lines or removed text.
      const breakLength=c==='\r'&&source[i+1]==='\n'?2:1;
      if((c==='\n'||c==='\r')&&personaSpeechLead(source.slice(start,i),speaker,identity)&&/^[ \t]*[“「『"]/.test(source.slice(i+breakLength))){i+=breakLength-1;continue;}
      start=i+1;
    }
  }
  return audienceOnly?audiences:false;
}

// Association with a relationship arc needs an explicit grammatical audience,
// not a model annotation or the only other name present in a scene. Keep the
// existing speaker-only scanner unchanged unless this additional check is used.
function personaSpeechRecipient(lead,speaker,identity){
  const actor=identity?.resolve(speaker);
  const header=foldName(lead).replace(/[：:]\s*$/u,'').replace(/\s*【[^】\r\n]*】\s*$/u,'').trim();
  const labels=actor?[actor.name,...actor.aliases].map(foldName).filter(label=>identity.resolve(label)?.key===actor.key):[foldName(speaker)];
  const audience=/^\s*(?:(?:当[着著][\p{L}\p{N}· ]{1,24}的面|在[\p{L}\p{N}· ]{1,24}面前|当众|私下|公开|当面)\s*)/u;
  const spoken=/^(?:对|向)([\p{L}\p{N}· ]{1,40}?)(?:\s*(?:轻声|低声|小声|大声|柔声|笑着|认真地|温和地))?\s*(?:说道|说|问道|问|回答|答道|回应|喊道|喊|答|道|补充(?:说|道)?)$/u;
  for(const label of labels){
    if(!header.startsWith(label))continue;
    const rest=header.slice(label.length).replace(audience,'').trim();
    const to=spoken.exec(rest)?.[1]?.trim();if(to)return to;
  }
  return '';
}

function explicitAudienceKey(value,identity){
  const name=String(value??'').trim(),key=foldName(name),known=identity?.resolve(name);
  if(known)return known.key;
  if(!/^[\p{L}][\p{L}\p{M}·・ -]{1,31}$/u.test(name)||/^(?:我|你|您|他|她|它|我们|你们|他们|她们|它们|大家|众人|有人|路人|老师|先生|小姐|店员|玩家|用户|助手|旁白|角色|人物|user|assistant|system)$/iu.test(name))return null;
  if(identity?.people.some(p=>[p.name,...p.aliases,...(p.profiles??[]).flatMap(row=>row.aliases??[])].some(a=>foldName(a)===key)))return null;
  return key;
}

export {speechPairs as personaSpeechPairs,speechSpanEnd as personaSpeechSpanEnd};
export function hasPersonaSpeechEvidence(evidence,quote,speaker,identity,{includeLead=false}={}){
  return scanPersonaSpeech(evidence,quote,speaker,identity,{includeLead});
}
export function hasPersonaSpeechToEvidence(evidence,quote,speaker,target,identity){
  const audience=personaSpeechAudienceEvidence(evidence,quote,speaker,identity),targetKey=explicitAudienceKey(target,identity);
  return targetKey!==null&&targetKey!==(identity?.resolve(speaker)?.key??foldName(speaker))&&audience.status==='explicit'&&audience.targets[0]===targetKey;
}
export function personaSpeechAudienceEvidence(evidence,quote,speaker,identity){
  const leads=scanPersonaSpeech(evidence,quote,speaker,identity,{audienceOnly:true});
  const keys=Array.isArray(leads)?leads.map(label=>label?explicitAudienceKey(label,identity):null):[];
  const targets=[...new Set(keys.filter(key=>key!==null))];
  return {status:targets.length>1?'ambiguous':keys.length&&keys.every(key=>key!==null)&&targets.length===1?'explicit':'unknown',targets};
}
/** Availability uses the identical attribution/filtering grammar. False means
 * no verifiable utterance was detected, not a claim that the actor was silent. */
export function hasPersonaSourceSpeech(evidence,speaker,identity){
  return scanPersonaSpeech(evidence,null,speaker,identity,{availabilityOnly:true});
}
