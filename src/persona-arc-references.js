import {foldName} from './name-fold.js';
import {estimateUnits,sha256} from './utils.js';
import {PERSONA_ARC_REFERENCES as cards,PERSONA_ARC_REFERENCE_VERSION as corpusVersion} from './persona-arc-corpus.js';
const hash=value=>sha256(value);
const TASK='本次整理是有据的人设编辑，不是事件清单。逐个发生变化的人物核对：对谁、什么场合、过去怎样、现在哪里不同、正文明确的原因是什么。先分清：本人表达/希望/要求、对方接受、实际行为、持续变化；只证实前一项不能写成后一项。引语中的夸张与威胁保留为当场表达，不在after改成已执行惩罚或无条件管束。缺少上下文不猜事件、起因或此前从未发生。当前状态与原书B/已有N逐段比较，尤其总是/从不/一律等全局命令：新表达不等于整个人格逆转，但已证实的对象例外必须写进对应B的适用范围，不能只追加优先说明。editable=surrounding_prose保留引号内容、改引号外的过时叙述；没有冲突不强改。保留稳定身份、兴趣、能力和其它对象边界。旧条目已有的隐秘面首次显露时，不必编造人格改变；可记录这一对象已显露的具体表现。用仍能解释当前阶段的本人真实原话作examples，不让最新杂务挤掉所有转折语料，不编预期会说的话。只使用已有格式；无证据不制造变化。';
const header='以下是可选的通用分析参照，不是人物事实、剧情证据或必走路线。是否发生及如何编辑仍只由source/原书/旧档证明；无匹配也必须完整分析正文。不可照搬经历或虚构台词：';
export function compileLibrary(rows=cards){
 const unique=[],seen=new Set(),terms=new Map();
 for(const row of rows){
  const key=hash([row.theme,row.title,row.triggers,row.guide,row.caution]);if(seen.has(key))continue;seen.add(key);
  const normalized=row.triggers.map(g=>[...new Set(g.map(foldName))]);
  const index=unique.length;unique.push({...row,normalized});
  normalized.forEach((group,gi)=>group.forEach(term=>{if(!term||term.length>16)throw Error('Invalid seed term');if(!terms.has(term))terms.set(term,[]);terms.get(term).push([index,gi]);}));
 }
 return {rows:unique,terms,lengths:[...new Set([...terms.keys()].map(t=>t.length))].sort((a,b)=>a-b),hash:hash(rows)};
}
export const library=compileLibrary();
export function retrieve(text,compiled=library,{limit=4}={}){
 if(limit<=0)return [];
 const query=foldName(text),matches=new Map(),seenTerms=new Set();
 for(let at=0;at<query.length;at++)for(const length of compiled.lengths){
  const term=query.slice(at,at+length);if(seenTerms.has(term))continue;
  const postings=compiled.terms.get(term);if(!postings)continue;seenTerms.add(term);
  const weight=term.length/Math.sqrt(postings.length);
  for(const [index,group]of postings){if(!matches.has(index))matches.set(index,{groups:new Map(),hits:0});const m=matches.get(index);m.groups.set(group,Math.max(m.groups.get(group)??0,weight));m.hits++;}
 }
 for(const m of matches.values())m.score=[...m.groups.values()].reduce((a,b)=>a+b,0)+Math.min(m.hits,6)*.01;
 const ranked=[...matches].filter(([index,m])=>m.groups.size===compiled.rows[index].normalized.length).sort((a,b)=>b[1].score-a[1].score||compiled.rows[a[0]].id.localeCompare(compiled.rows[b[0]].id));
 const result=[],themes=new Set();for(const [index,m]of ranked){const row=compiled.rows[index];if(themes.has(row.theme))continue;themes.add(row.theme);result.push({row,score:m.score});if(result.length>=Math.max(0,Math.min(4,limit)))break;}
 return result;
}
export function applyPersonaArcReferences(messages,{variant='arc-reference',inputLimit=12000,compiled=library}={}){
 const output=structuredClone(messages),before=estimateUnits(JSON.stringify(messages));
 const meta={variant,libraryVersion:corpusVersion,libraryHash:compiled.hash,baseUnits:before,selected:[],referenceUnits:0};
 if(!['arc-task','arc-reference'].includes(variant))return {messages:output,meta};
 // No source/prior JSON is edited, shortened, or supplemented with expected answers.
 output[0].content+='\n'+TASK;
 const taskUnits=estimateUnits(JSON.stringify(output));meta.taskUnits=taskUnits;
 if(taskUnits>inputLimit)return {messages:structuredClone(messages),meta:{...meta,skipped:'no-budget',finalUnits:before}};
 if(variant==='arc-reference'){
  const data=JSON.parse(output[1].content),text=(data.source??[]).map(m=>m.text).join('\n');
  const cap=Math.max(0,Math.min(800,Math.floor(inputLimit*.05),inputLimit-taskUnits));
  const selected=[];for(const {row,score}of retrieve(text,compiled)){
   const ref={type:row.title,guide:row.guide,caution:row.caution};
   const packageText='\n'+header+'\n'+JSON.stringify([...selected.map(s=>s.ref),ref]);
   const candidate=structuredClone(output);candidate[0].content+=packageText;
   const cost=estimateUnits(JSON.stringify(candidate))-taskUnits;
   if(cost<=cap){selected.push({id:row.id,score,ref});meta.referenceUnits=cost;}
  }
  if(selected.length){output[0].content+='\n'+header+'\n'+JSON.stringify(selected.map(s=>s.ref));meta.selected=selected.map(({id,score})=>({id,score}));}
  meta.referenceCap=cap;
 }
 meta.finalUnits=estimateUnits(JSON.stringify(output));return {messages:output,meta};
}
