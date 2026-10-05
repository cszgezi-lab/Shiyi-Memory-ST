import {clone,sha256} from './utils.js';
import {personaIdentity,foldName} from './persona-identity.js';
import {personaEditEvidence} from './persona-edit-evidence.js';
import {hasPersonaSpeechEvidence,personaSpeechPairs,personaSpeechSpanEnd} from './persona-speech-evidence.js';

const unsafe=/\[\[SHIYI_PERSONA:|<%|%>|<\/?script\b|\{\{(?!\s*(?:user|char)\s*\}\})|@@/i;
const fail=message=>Object.assign(new Error(message),{code:'PERSONA_RESPONSE_INVALID'});
const floor=value=>Number.isSafeInteger(value)&&value>=0;
const text=value=>typeof value==='string'&&Boolean(value.trim())&&!unsafe.test(value);
const freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);for(const item of Object.values(value))freeze(item);}return value;};
const exampleKey=q=>floor(q?.floor)&&typeof q.text==='string'&&q.text.trim()?sha256([q.floor,q.text]):null;

// Request-local refs never become array-index writes. Archive annotations are
// authoritative; durable targets use an existing arc key or exact quote ID.
function targets(composition,through,{applying=false}={}){
 const c=composition??{},out=[];
 if(text(c.notes)&&(applying||floor(through)))out.push({ref:'N1.notes',kind:'notes',key:'notes',targetKey:'notes',field:'notes',text:c.notes,hash:sha256(c.notes),floor:through});
 const development=Array.isArray(c.development)?c.development:[],counts=new Map();
 for(const d of development)if(typeof d?.key==='string'&&d.key)counts.set(d.key,(counts.get(d.key)??0)+1);
 development.forEach((d,index)=>{
  if(!d||counts.get(d.key)!==1||!floor(d.floor))return;
  for(const field of ['after','cause'])if(text(d[field]))out.push({ref:`D${index+1}.${field}`,kind:'development',key:d.key,targetKey:`development:${d.key}`,field,
   text:d[field],hash:sha256({kind:'development',field,record:d}),floor:d.floor,developmentKey:d.key,target:d.target??'',scope:d.scope??''});
 });
 const groups=new Map();
 for(const [location,rows]of [['archive',c.exampleArchive],['current',c.examples]])for(const q of Array.isArray(rows)?rows:[]){
  const key=exampleKey(q);if(!key)continue;
  if(!groups.has(key))groups.set(key,{record:q,archive:[],current:[]});groups.get(key)[location].push(q);
 }
 [...groups.entries()].forEach(([key,g],index)=>{
  const q=g.record;if(!text(q.context))return;
  out.push({ref:`E${index+1}.context`,kind:'example',key,targetKey:`example:${key}`,field:'context',text:q.context,
   hash:sha256({kind:'example',archive:g.archive,current:g.current}),floor:q.floor,exampleFloor:q.floor,exampleText:q.text,to:q.to??''});
 });
 return out;
}

/** Copies only: callers may expose targets to a model, never writable records. */
export function personaDerivedTargets(profile){return freeze(clone(targets(profile?.composition,profile?.through)));}

function requestInput(request){
 if(request?.user&&typeof request.user==='object'&&!Array.isArray(request.user))return request.user;
 const users=request?.messages?.filter(m=>m.role==='user');
 if(users?.length!==1)throw fail('派生纠错缺少唯一的实际请求原文');
 try{return JSON.parse(users[0].content);}catch{throw fail('派生纠错请求原文不是有效JSON');}
}
function replacement(row,current){
 if(!text(row?.before)||!text(row?.after)||row.before.length>8000||row.after.length>8000||row.before===row.after||
  !text(row.reason)||row.reason.length>500)throw fail('派生纠错必须是非空、不同且无脚本的局部修改');
 const at=current.indexOf(row.before);
 if(at<0||current.indexOf(row.before,at+1)>=0)throw fail('派生纠错的before未唯一命中原字段');
 return {start:at,end:at+row.before.length};
}

// Recover omitted attribution only for a UNIQUE exact substring of one whole
// top-level, verifiably spoken quotation in the SAME source unit. This narrow
// annotation path never repairs quotation bytes, speaker labels or narration.
function completeDerivedSpeechEvidence(value,{messages,identity,name}){
 if(!floor(value?.floor)||typeof value.quote!=='string'||value.quote.trim().length<4||value.quote.length>2400||unsafe.test(value.quote))return null;
 const m=messages.find(m=>m.index===value.floor),quote=value.quote;
 if(!m)return null;
 const at=m.text.indexOf(quote);
 if(at<0||m.text.indexOf(quote,at+1)>=0)return null;
 for(let i=0;i<m.text.length;i++)if(personaSpeechPairs.has(m.text[i])){
  const close=personaSpeechSpanEnd(m.text,i);if(close<0)return null;
  if(i<at&&at+quote.length<=close){
   if(!/[“「『"]/u.test(m.text[i]))return null;
   const whole=m.text.slice(i+1,close);
   // Nested quotations/asides may be hearsay or private narration; do not
   // recover a fragment from them as the outer person's own utterance.
   if([...whole].some(c=>personaSpeechPairs.has(c))||!hasPersonaSpeechEvidence(m.text,whole,name,identity))return null;
   const starts=[0];
   for(let j=Math.max(0,i-250);j<i;j++)if(/[。！？；，,;!?\r\n”」』"〕】）)]/u.test(m.text[j]))starts.push(j+1);
   const candidates=[...new Set(starts.map(start=>m.text.slice(start,close+1).trim()))].filter(full=>full.length<=2400&&hasPersonaSpeechEvidence(m.text,full,name,identity,{includeLead:true}));
   if(candidates.length!==1)return null;
   return {floor:value.floor,quote:candidates[0],originalQuote:quote};
  }
  i=close;
 }
 return null;
}

function derivedEvidence(value,context){
 const validate=next=>personaEditEvidence(next,{...context,speech:(body,quote,name,people)=>hasPersonaSpeechEvidence(body,quote,name,people)||hasPersonaSpeechEvidence(body,quote,name,people,{includeLead:true})});
 // A persisted normalization must be reproducible from the original bytes;
 // an untrusted originalQuote field must not invent a provenance shortcut.
 if(value?.originalQuote!==undefined){
  const complete=completeDerivedSpeechEvidence({floor:value.floor,quote:value.originalQuote},context);
  return complete?.quote===value.quote&&validate(complete)?complete:null;
 }
 const direct=validate(value);if(direct)return direct;
 const complete=completeDerivedSpeechEvidence(value,context);
 return complete&&validate(complete)?complete:null;
}

/** Byte/ownership validation is not semantic acceptance. The caller owns
 * chat/profile/source revision checks; every result remains a candidate. */
export function parsePersonaDerivedUpdates(raw,profile,request){
 if(raw===undefined)return [];
 if(!Array.isArray(raw)||raw.length>24)throw fail('派生纠错列表不正确');
 if(!raw.length)return [];
 const input=requestInput(request),range=input.reviewedRange;
 if(!Array.isArray(range)||range.length!==2||!range.every(floor)||range[0]>range[1]||!Array.isArray(input.source)||!input.source.length)throw fail('派生纠错实际核对范围无法确认');
 const seen=new Set(),messages=input.source.map(m=>{
  if(!floor(m?.floor)||typeof m.text!=='string'||m.floor<range[0]||m.floor>range[1]||seen.has(m.floor))throw fail('派生纠错来源楼号缺失、重复或超出实际窗口');
  seen.add(m.floor);return {index:m.floor,role:m.role,text:m.text};
 });
 if(Math.min(...seen)!==range[0]||Math.max(...seen)!==range[1])throw fail('派生纠错实际范围与已发送原文不一致');
 const identity=personaIdentity({previous:[profile]});
 if(identity.resolve(input.name)?.key!==foldName(profile?.name??''))throw fail('派生纠错请求不属于当前人物');
 const available=personaDerivedTargets(profile);
 return raw.map(row=>{
  const target=available.find(t=>t.ref===row?.ref);
  if(!target||target.floor>range[1])throw fail('派生纠错目标不存在或晚于实际核对窗口');
  replacement(row,target.text);
  const evidence=derivedEvidence(row.evidence,{messages,identity,name:profile.name});
  if(!evidence)throw fail('派生纠错依据缺失、非逐字原文或不属于本人物');
  return {ref:target.ref,kind:target.kind,targetKey:target.targetKey,field:target.field,targetHash:target.hash,
   before:row.before,after:row.after,reason:row.reason,evidence,reviewedRange:clone(range)};
 });
}

/** All patches resolve against one original snapshot, then apply together. */
export function applyPersonaDerivedUpdates(composition,patches){
 if(!Array.isArray(patches)||patches.length>2400)throw fail('已保存派生纠错列表不正确');
 if(!patches.length)return clone(composition);
 const available=targets(composition,undefined,{applying:true}),groups=new Map();
 for(const patch of patches){
  const target=available.find(t=>t.targetKey===patch?.targetKey&&t.field===patch.field);
  if(!target||target.hash!==patch.targetHash||target.kind!==patch.kind)throw fail('派生纠错字段或原记录已改变，候选未应用');
  const span=replacement(patch,target.text);
  if(!floor(patch.evidence?.floor)||!text(patch.evidence?.quote)||patch.evidence.quote.length>2400)throw fail('已保存派生纠错缺少有效依据');
  const key=JSON.stringify([target.targetKey,target.field]);
  if(!groups.has(key))groups.set(key,{target,edits:[]});
  const edits=groups.get(key).edits;
  if(edits.some(e=>e.start===span.start&&e.end===span.end&&e.after===patch.after))continue;
  if(edits.some(e=>span.start<e.end&&e.start<span.end))throw fail('派生纠错候选存在重叠冲突，请先核对');
  edits.push({...span,after:patch.after});
 }
 const result=clone(composition);
 for(const {target,edits}of groups.values()){
  let value=target.text;for(const edit of edits.sort((a,b)=>b.start-a.start))value=value.slice(0,edit.start)+edit.after+value.slice(edit.end);
  if(target.kind==='notes'){result.notes=value;continue;}
  if(target.kind==='development'){result.development.find(d=>d.key===target.key)[target.field]=value;continue;}
  // Annotations only; exact speech, audience, phase and other fields survive.
  for(const rows of [result.exampleArchive,result.examples])for(const q of Array.isArray(rows)?rows:[])if(exampleKey(q)===target.key)q.context=value;
 }
 return result;
}
