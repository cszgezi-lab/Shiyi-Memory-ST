// JSON.parse silently lets a later duplicate key overwrite earlier data.
// A model sometimes appends the empty module skeleton after its complete
// answer. Preserve the sole non-empty array, but never join rival answers.
const modules=new Set(['events','awarenessChanges','entityFactChanges','relationshipChanges','personaChanges','commitmentChanges','performanceHints','summaryView','conflicts']);
export function parseSummaryJson(text){
  JSON.parse(text); // Native syntax validation; no permissive JSON repairs.
  let i=0,duplicateEmptyModules=0;
  const space=()=>{while(/\s/.test(text[i]??'')&&i<text.length)i++;};
  function string(){const start=i++;while(i<text.length){if(text[i]==='\\'){i+=2;continue;}if(text[i++]==='"')break;}return JSON.parse(text.slice(start,i));}
  function value(depth=0){
    if(depth>200)throw new SyntaxError('Summary JSON nesting exceeds safety limit');
    space();
    if(text[i]==='"')return string();
    if(text[i]==='['){i++;const out=[];space();while(text[i]!==']'){out.push(value(depth+1));space();if(text[i]===','){i++;space();}else break;}i++;return out;}
    if(text[i]==='{'){
      i++;const out={};space();
      while(text[i]!=='}'){
        const key=string();space();i++;const next=value(depth+1);space();
        if(Object.hasOwn(out,key)){
          const prior=out[key];
          if(depth!==0||!modules.has(key)||!Array.isArray(prior)||!Array.isArray(next)||prior.length&&next.length)
            throw new SyntaxError('Conflicting duplicate JSON keys in model output');
          duplicateEmptyModules++;if(next.length)Object.defineProperty(out,key,{value:next,enumerable:true,writable:true,configurable:true});
        }else Object.defineProperty(out,key,{value:next,enumerable:true,writable:true,configurable:true});
        if(text[i]===','){i++;space();}else break;
      }i++;return out;
    }
    const start=i;while(i<text.length&&!/[\s,\]}]/.test(text[i]))i++;return JSON.parse(text.slice(start,i));
  }
  const parsed=value();space();
  if(duplicateEmptyModules&&parsed?.format!=='shiyi-module-records-v1')throw new SyntaxError('Duplicate module normalization requires the explicit module format');
  return {value:parsed,duplicateEmptyModules};
}
