import {foldName,nameMentionAt} from './name-fold.js';
import {explicitAliases,manualDictionary,validTerm} from './product-dictionary.js';
import {sha256} from './utils.js';

// Match copies only. Never normalize MVU paths, worldbook text or user prose.
export {foldName};
const personName=value=>validTerm(value)&&!/[\n，。！？；：:<>%=|]/.test(value)&&value.length>=1&&value.length<=32;
const aliasName=value=>personName(value)||validTerm(value)&&/^[\p{Script=Han}]$/u.test(value);
// Titles are metadata, not evidence that every noun names a person. Keep
// generic personal sections separate from public/world sections: a personal
// section can still be owned through an explicit name/key in the source index.
const categoryWords=/人物|角色|人设|人設|档案|檔案|外貌|性格|口吻|语料|語料|衣着|衣著|爱好|愛好|兴趣|興趣|基础|基礎|基本|资料|資料|设定|設定|背景|关系|關係|行为|行為|描写|描寫|身份|能力|属性|屬性|说明|說明|信息|資訊|简介|簡介|介绍|介紹|描述|性别|性別|年龄|年齡|阶段|階段|主卡|与|與|和|及|\s|[·・•:：/、_-]|profile|appearance|personality|dialogue|description/gi;
export const personaCategoryTitle=value=>!String(value??'').trim().replace(categoryWords,'');
const publicTitle=/规则|規則|系统|系統|世界观|世界觀|世界设定|世界設定|世界线|世界線|变量|變量|初始化|状态栏|狀態欄|提示词|提示詞|多人|全体|全體|家庭|家族|地图|地圖|剧情大纲|劇情大綱|all\s*characters|world\s*rules|family|map\b/i;
const publicHeading=/^(?:(?:当前|當前|原|新|旧|舊|世界|环境|環境|场景|場景|背景)[·:：\s]*)*(?:迷宫(?:地下城)?|迷宮(?:地下城)?|地下城|种族(?:多样性|概览|總覽|总览)|種族(?:多樣性|概覽|總覽)|语言(?:隔阂|障碍|概览|总览)|語言(?:隔閡|障礙|概覽|總覽)|世界(?:背景|历史|歷史|地理)|dungeon|racial\s+diversity|language\s+barriers?)(?:[·:：\s]*(?:设定|設定|说明|說明|介绍|介紹|规则|規則))?$/iu;
export const personaSharedTitle=value=>publicTitle.test(String(value??''))||publicHeading.test(String(value??'').trim());
const genericTitle=value=>personaCategoryTitle(value)||personaSharedTitle(value);
export function personaTitleNames(title){
  // Leading bracket groups are metadata only when a real title follows.
  // A standalone [Alice] remains a name; no card-specific prefix list.
  let value=String(title??'').trim();
  const prefix=/^(?:(?:\[[^\]\r\n]+\]|【[^】\r\n]+】)\s*)+/.exec(value);
  if(prefix&&value.slice(prefix[0].length).trim())value=value.slice(prefix[0].length);
  if(personaSharedTitle(value))return [];
  return value.split(/[|｜:：\[\]【】（）()/_—]+/u).map(s=>{
    s=s.trim();
    // Middle dots inside a transliterated full name are part of its identity.
    // Remove only a trailing known section, not the surname itself.
    let suffix;while((suffix=/[·・•]([^·・•]+)$/u.exec(s))&&personaCategoryTitle(suffix[1]))s=s.slice(0,suffix.index).trim();
    return s.replace(/(?:的)?(?:人物设定|人物設定|人物档案|人物檔案|基础资料|基礎資料|基础档案|基礎檔案|人设|人設|档案|檔案|性格|阶段|階段|语料|語料|口吻|外貌|profile|dialogue|appearance)$/iu,'').trim();
  }).filter(s=>personName(s)&&!genericTitle(s));
}
function shortNames(name){
  if(/^[\p{Script=Han}]{2,8}(?:[·・•][\p{Script=Han}]{2,8})+$/u.test(name))return [name.split(/[·・•]/u)[0]];
  if(!/^[\p{Script=Han}]{3,8}$/u.test(name))return [];
  const words=[];
  for(let i=1;i<name.length-1;i++)words.push(name.slice(i));
  for(let i=1;i<Math.min(4,name.length);i++)for(const suffix of ['同学','先生','小姐','老师','同學','老師','さん','ちゃん'])words.push(name.slice(0,i)+suffix);
  return words;
}

/** A local projection, not a mutation/merge of stored facts or dictionary. */
export function personaIdentity({spans=[],previous=[],dictionary={entries:[]},aliases='',source=''}={}){
  const people=new Map(),overrides=manualDictionary(aliases),terms=dictionary.entries??[];
  const add=(name,extra={})=>{
    if(!personName(name)||genericTitle(name))return null;
    const key=foldName(name).trim();let p=people.get(key);
    if(!p){p={key,name:name.trim(),characterId:extra.characterId??sha256(['persona-character',key]).slice(0,24),aliases:new Set(),titleNames:new Set(),profiles:[]};people.set(key,p);}
    if(extra.profile)p.profiles.push(extra.profile);
    for(const word of extra.aliases??[])if(aliasName(word))p.aliases.add(word.trim());
    if(name!==p.name)p.aliases.add(name.trim());return p;
  };
  // Stored canonical identity wins over a model's spelling in this batch.
  for(const p of previous)if(!p.deleted)add(p.name,{characterId:p.characterId,aliases:p.aliases,profile:p});
  for(const t of [...terms,...overrides])if(!t.disabled&&(t.kind==='人物'||t.manual||people.has(foldName(t.name)))){
    const termKey=foldName(t.name),canonical=people.get(termKey);
    // An automatically extracted nickname term must not remain a second
    // person after the user has explicitly bound that nickname to a saved
    // profile. A separately saved canonical profile still wins as a real
    // ambiguity and must be merged explicitly.
    const bound=[...people.values()].find(p=>p.key!==termKey&&p.profiles.some(row=>(row.aliasPolicy==='manual')&&(row.aliases??[]).some(alias=>foldName(alias)===termKey)));
    if(bound&&!t.manual&&t.kind==='人物'&&!canonical?.profiles.length)continue;
    add(t.name,{aliases:t.aliases});
  }
  const titleNames=spans.flatMap(s=>personaTitleNames(s.name));
  for(const name of titleNames.sort((a,b)=>b.length-a.length)){
    const known=[...people.values()].filter(p=>p.key===foldName(name)||[...p.aliases,...shortNames(p.name)].some(a=>foldName(a)===foldName(name)));
    if(known.length===1){known[0].titleNames.add(name);if(!known[0].profiles.some(row=>row.aliasPolicy==='manual'))known[0].aliases.add(name);continue;}
    add(name)?.titleNames.add(name);
  }
  for(const p of people.values()){
    const override=overrides.find(t=>foldName(t.name)===p.key)??terms.find(t=>t.manual&&foldName(t.name)===p.key);
    if(override){p.aliases=new Set(override.disabled?[]:override.aliases.filter(aliasName));p.aliasPolicy=override.disabled?'disabled':'manual';}
    else if(!p.profiles.some(row=>row.aliasPolicy==='manual')) {
      // Explicitly attributed naming statements only; not arbitrary model guesses.
      for(const word of explicitAliases(foldName(p.name),foldName(source)))if(aliasName(word))p.aliases.add(word);
    }
    p.visibleAliases=new Set([...p.aliases].filter(word=>word!==p.name));
    // Keep candidate shortenings internal until the source actually uses one.
    if(!override&&!p.profiles.some(row=>row.aliasPolicy==='manual'))for(const word of shortNames(p.name))p.aliases.add(word);
  }
  const owners=new Map();
  for(const p of people.values())for(const word of [p.name,...p.aliases]){const k=foldName(word);if(!owners.has(k))owners.set(k,new Set());owners.get(k).add(p);}
  const resolve=name=>{const matches=owners.get(foldName(name).trim());return matches?.size===1?[...matches][0]:null;};
  const mentions=text=>{
    text=foldName(text);const hits=[];
    for(const [word,ps] of owners){let at=text.indexOf(word);while(at>=0){
      const after=text.slice(at+word.length);
      if(nameMentionAt(text,word,at)&&!/^(?:的)?(?:母亲|父亲|妈妈|爸爸|姐姐|妹妹|哥哥|弟弟|家族)/.test(after))hits.push({at,end:at+word.length,ps,word});
      at=text.indexOf(word,at+Math.max(1,word.length));
    }}
    hits.sort((a,b)=>(b.end-b.at)-(a.end-a.at));const accepted=[];
    for(const h of hits)if(!accepted.some(x=>h.at>=x.at&&h.end<=x.end))accepted.push(h);
    for(const h of accepted)if(h.ps.size===1){const p=[...h.ps][0];if(h.word!==p.key)p.visibleAliases.add(h.word);}
    return [...new Set(accepted.filter(h=>h.ps.size===1).flatMap(h=>[...h.ps]))];
  };
  // Worldbook ownership is distinct from aliases a user enables for dialogue.
  const forTitle=title=>{const found=new Set();for(const token of personaTitleNames(title)){const direct=resolve(token);if(direct)found.add(direct);for(const p of people.values())if([...p.titleNames].some(n=>foldName(n)===foldName(token)))found.add(p);}return found.size===1?[...found][0]:null;};
  return {people:[...people.values()],resolve,mentions,forTitle};
}
export function personaAliases(value){
  const words=Array.isArray(value)?value:String(value??'').split(/[,，\n]/);
  if(words.length>32||words.some(w=>typeof w!=='string'||w.trim()&&!aliasName(w.trim())))throw new Error('别称最多32个，请填写实际姓名或称呼，不使用“他、她、老师”等泛称');
  return [...new Set(words.map(w=>w.trim()).filter(Boolean))];
}
