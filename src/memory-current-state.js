import {stableStringify} from './utils.js';
import {foldName} from './name-fold.js';
import {sourceFloors} from './product-narrative.js';
import {explicitSubjectNames} from './product-person-profiles.js';
import {storyTimeRange} from './temporal.js';

export const memoryHistoryIntent=query=>/(?:当初|以前|过去|当时|曾经|最初|起初|先前|之前|历史|历程|哪一楼|第几楼)|(?:关系|态度|性格|口吻|人设|约定|承诺).{0,8}(?:发展|变化|改变|过程)|为什么.{0,12}(?:改变|变化|变成)/u.test(String(query??''));
const kinds=new Set(['relationshipChanges','commitmentChanges']);
const floor=r=>Math.max(-1,...sourceFloors(r));
const body=r=>r.description??r.content??r.text;
const scope=r=>[r.context,r.scope,r.aspect,r.field,r.condition,r.conditions,r.validUntil,r.expiresAt,r.publicScope];
const closed=new Set(['completed','canceled','declined']);

/** A reversible reading projection, never a rewrite of immutable evidence.
 * Only explicit same-matter links or exact guarded duplicates reduce the set.
 * Source order alone, same people, or fuzzy text is NOT a state transition. */
export function markMemoryStates(cards,{dictionary}={}){
  const entries=dictionary?.entries??cards.flatMap(c=>c.entities??[]);
  const aliases=new Map();
  for(const e of entries.filter(e=>e.kind==='人物'&&!e.disabled))for(const n of [e.name,...(e.aliases??[])]){
    const k=foldName(n);if(!aliases.has(k))aliases.set(k,new Set());aliases.get(k).add(foldName(e.name));
    if((e.ambiguous??[]).some(a=>foldName(a)===k))aliases.get(k).add('');
  }
  const name=n=>{const k=foldName(n),found=aliases.get(k);return found?.size===1?[...found][0]:found?.size>1?null:k;};
  const identity=r=>{
    const values=r.category==='commitmentChanges'?explicitSubjectNames(r.participants??r.subject):[r.from??r.subject,r.to??r.object].flatMap(explicitSubjectNames);
    const names=values.map(name);if(!names.length||names.some(n=>!n)||r.category==='relationshipChanges'&&names.length!==2)return null;
    return stableStringify(r.category==='commitmentChanges'?[...new Set(names)].sort():names);
  };
  const eligible=r=>kinds.has(r.category)&&floor(r)>=0&&!['retracted','superseded'].includes(r.lifecycleState)&&r.state!=='unknown'&&r.knowledgeReview?.status!=='pending';
  const rows=cards.filter(eligible),byId=new Map(rows.map(r=>[r.id,r])),next=new Map(),duplicate=new Map();
  const signature=r=>stableStringify([r.category,identity(r),body(r),r.state,r.temporal,r.epistemicStatus,r.evidenceKind,scope(r),r.expression,r.response,r.mutualConfirmation,r.keyDialogues,r.viewpoints]);
  for(const r of [...rows].sort((a,b)=>floor(a)-floor(b))){
    if(!identity(r)||typeof body(r)!=='string'||!body(r).trim())continue;
    const key=signature(r),prior=duplicate.get(key);
    if(prior&&floor(r)>floor(prior))next.set(prior.id,r.id);
    duplicate.set(key,r);
  }
  const links=new Map();
  for(const r of rows){
    const refs=[r.completionOf,r.correctionOf,r.supersedes].filter(x=>typeof x==='string');
    // Conflicting links are not permission to erase several independent facts.
    if(new Set(refs).size!==1)continue;
    const old=byId.get(refs[0]);if(!old||old.category!==r.category||!identity(old)||identity(old)!==identity(r)||floor(r)<=floor(old))continue;
    // An explicit ending link identifies the same promise; its context is the
    // occurrence of completion/cancellation, not necessarily the original scene.
    // Persistent conditions/scope remain guarded and conflicting dates fail shut.
    const ending=r.category==='commitmentChanges'&&closed.has(r.state)&&refs[0]===old.id;
    if(stableStringify(ending?scope(old).slice(1):scope(old))!==stableStringify(ending?scope(r).slice(1):scope(r)))continue;
    if(old.epistemicStatus==='user_asserted'&&r.epistemicStatus!=='user_asserted')continue;
    if(r.epistemicStatus==='unknown'||['character_claim','inferred','uncertain','rumor'].includes(r.epistemicStatus)&&r.epistemicStatus!==old.epistemicStatus)continue;
    if(r.category==='commitmentChanges'){
      if(!['proposed','accepted',...closed].includes(r.state))continue;
      if(closed.has(old.state)&&!(r.correctionOf===old.id&&r.state===old.state))continue;
      if(old.state==='accepted'&&r.state==='proposed')continue;
      if(!(ending&&r.temporal?.plannedFor==null)&&stableStringify(old.temporal?.plannedFor??null)!==stableStringify(r.temporal?.plannedFor??null))continue;
    }
    // A later passage can be a flashback. Never reverse explicit story dates.
    const at=x=>storyTimeRange(x.temporal?.actualAt??x.temporal?.occurredAt??x.temporal?.assertedAt??x.temporal);
    const before=at(old),after=at(r),zoned=before?.offset!=null&&after?.offset!=null;
    if(before&&after&&after.end-(zoned?after.offset:0)<=before.start-(zoned?before.offset:0))continue;
    if(!links.has(old.id))links.set(old.id,[]);links.get(old.id).push(r.id);
  }
  for(const [id,targets] of links)if(new Set(targets).size===1)next.set(id,targets[0]);else next.delete(id);
  const roots=new Map();
  const root=id=>{const seen=new Set();while(next.has(id)&&!seen.has(id)&&!roots.has(id)){seen.add(id);id=next.get(id);}id=roots.get(id)??id;for(const prior of seen)roots.set(prior,id);return id;};
  const histories=new Map();
  for(const r of rows)if(next.has(r.id)){const id=root(r.id);if(!histories.has(id))histories.set(id,[]);histories.get(id).push(r.id);}
  return cards.map(card=>{
    // Offscreen event prose may be lazy. Do not clone or read unrelated bodies.
    if(!kinds.has(card.category)||!next.has(card.id)&&!histories.has(card.id)&&!card.stateHistorical&&!card.stateHistoryIds)return card;
    const {stateHistorical,stateCurrentId,stateHistoryIds,...r}=card;
    return next.has(r.id)?{...r,stateHistorical:true,stateCurrentId:root(r.id)}:histories.has(r.id)?{...r,stateHistoryIds:histories.get(r.id)}:r;
  });
}
