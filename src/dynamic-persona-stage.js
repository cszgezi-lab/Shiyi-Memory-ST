import { sha256 } from './utils.js';

// Intentionally not a JavaScript evaluator. Unknown EJS remains owned by the
// card; we never run scripts just to discover a stage or preview a persona.
function pathValue(data,path){
  const parts=path.replace(/^stat_data\./,'').split('.');let value=data;
  for(const p of parts){if(['__proto__','prototype','constructor'].includes(p)||!value||typeof value!=='object'||!Object.hasOwn(value,p))return undefined;value=value[p];}
  return Array.isArray(value)&&value.length===2?value[0]:value;
}
function condition(expression){
  const source=expression.trim().replace(/;$/,'');
  const m=source.match(/^getvar\(\s*(['"])([^'"]+)\1\s*\)\s*(===|!==|==|!=|>=|<=|>|<)\s*("(?:[^"\\]|\\.)*"|'[^']*'|-?\d+(?:\.\d+)?|true|false)\s*$/);
  if(!m||!m[2].startsWith('stat_data.'))return null;
  const raw=m[4];let right;
  if(raw.startsWith("'")&&raw.includes('\\'))return null;
  try{right=raw.startsWith("'")?raw.slice(1,-1):JSON.parse(raw);}catch{return null;}
  return {path:m[2],operator:m[3],right};
}
export function stageCondition(expression,data){
  const parsed=condition(expression);if(!parsed)return null;
  const {path,operator,right}=parsed,left=pathValue(data,path);if(left===undefined)return null;
  if(['==','!='].includes(operator)&&typeof left!==typeof right)return null;
  if(['>','<','>=','<='].includes(operator)&&(typeof left!=='number'||typeof right!=='number'))return null;
  return ({'===':()=>left===right,'==':()=>left===right,'!==':()=>left!==right,'!=':()=>left!==right,'>':()=>left>right,'<':()=>left<right,'>=':()=>left>=right,'<=':()=>left<=right})[operator]();
}
export function personaSpans(entry,data={}, {allBranches=false}={}){
  const content=String(entry.content??''),identity=`${entry.book}:${entry.uid}`,hash=sha256(content);
  // Display placeholders contain no logic. Keep raw offsets/hashes intact;
  // masking is exclusively for classification, never template execution.
  const syntax=content.replace(/(?<!\{)\{\{(?:user|char)\}\}(?!\})/gi,'');
  // Preserve code-bearing and malformed templates rather than classifying them
  // as plain prose. Only the fully recognized branch grammar is replaceable.
  if(/<\/?script\b/i.test(content)||/<%|%>/.test(content.replace(/<%[\s\S]*?%>/g,'')))return [];
  if(!/<%|\{\{|@@/.test(syntax))return [{id:sha256([identity,hash,0]).slice(0,24),book:entry.book,uid:entry.uid,name:entry.name,start:0,end:content.length,text:content,hash,stage:'static'}];
  if(/\{\{|@@/.test(syntax))return [];
  let cursor=0,valid=true;const stack=[],spans=[];
  // allBranches is for local request substitution only, never model input.
  // Replace prose in every recognized branch; the host still runs its original
  // conditions. This keeps narrative dossiers independent of the MVU stage.
  const test=expression=>allBranches?(condition(expression)?true:null):stageCondition(expression,data);
  const add=end=>{const text=content.slice(cursor,end);if(text.trim()&&(allBranches||stack.every(x=>x.active))){const stage=stack.length?sha256(stack.map(x=>[x.expression,x.branch])).slice(0,20):'static';spans.push({id:sha256([identity,hash,cursor]).slice(0,24),book:entry.book,uid:entry.uid,name:entry.name,start:cursor,end,text,hash,stage});}};
  for(const tag of content.matchAll(/<%([\s\S]*?)%>/g)){
    add(tag.index);const code=tag[1].trim();let m;
    if((m=code.match(/^if\s*\(([\s\S]*)\)\s*\{$/))){const active=test(m[1]);if(active===null){valid=false;break;}stack.push({expression:m[1],active,matched:active,branch:0});}
    else if((m=code.match(/^}\s*else\s+if\s*\(([\s\S]*)\)\s*\{$/))){const top=stack.at(-1),active=test(m[1]);if(!top||top.ended||active===null){valid=false;break;}top.active=!top.matched&&active;top.matched||=active;top.expression+=`|${m[1]}`;top.branch++;}
    else if(/^}\s*else\s*{$/.test(code)){const top=stack.at(-1);if(!top||top.ended){valid=false;break;}top.active=!top.matched;top.matched=true;top.ended=true;top.branch++;}
    else if(code==='}'){if(!stack.pop()){valid=false;break;}}
    else {valid=false;break;}
    cursor=tag.index+tag[0].length;
  }
  add(content.length);return valid&&!stack.length?spans.map(s=>({...s,entryContent:content})):[];
}
export function replacePersonaSpans(content,spans,replacements){
  const hash=sha256(content);let result=content;
  for(const span of [...spans].sort((a,b)=>b.start-a.start)){
    if(span.hash!==hash||content.slice(span.start,span.end)!==span.text)throw new Error('原人设已修改，本次替换未应用');
    if(Object.hasOwn(replacements,span.id))result=result.slice(0,span.start)+replacements[span.id]+result.slice(span.end);
  }
  return result;
}
