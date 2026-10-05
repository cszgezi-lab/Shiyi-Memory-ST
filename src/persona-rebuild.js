import {clone,sha256} from './utils.js';
import {foldName,personaIdentity} from './persona-identity.js';

// Planning and identity-only projections for the existing staged manual worker.
// No second queue and no old generated prose in an identity seed.
export function personaRebuildPlan(next,data){
  const saved=data.batches.filter(b=>b.status==='saved').sort((a,b)=>a.startIndex-b.startIndex);
  const affected=saved.filter(b=>b.endIndex>=next.startIndex);
  const through=Math.max(-1,...saved.map(b=>b.endIndex),...data.profiles.filter(p=>!p.deleted).map(p=>p.through??-1));
  const clean=next.startIndex<=1||affected.length>0||through>=next.startIndex;
  if(!clean)return {...next,mode:'append',replaces:0,plannedRequests:next.items.length};
  const first=affected[0],full=next.startIndex<=1;
  if(!full&&!first?.versionId)throw new Error('起点前的人设快照缺失，未清空旧档案；请改为从第1楼干净重建');
  const replaceFrom=full?0:Math.min(next.startIndex,first.startIndex);
  const prefix=!full&&replaceFrom<next.startIndex?{startIndex:replaceFrom,endIndex:next.startIndex-1,status:'pending',kind:'prefix'}:null;
  const prefixItems=prefix?Array.from({length:Math.ceil((prefix.endIndex-prefix.startIndex+1)/next.batchSize)},(_,i)=>({...prefix,startIndex:prefix.startIndex+i*next.batchSize,endIndex:Math.min(prefix.endIndex,prefix.startIndex+(i+1)*next.batchSize-1)})):[];
  const discardedTail=through>next.endIndex?{startIndex:next.endIndex+1,endIndex:through}:null;
  const items=[...prefixItems,...next.items];
  if(items.length>5000)throw new Error('包含必要前缀后超过5000批，请调大每批楼数');
  return {...next,requestedEndIndex:next.endIndex,mode:'clean',tailPolicy:'discard',full,replaceFrom,baseVersionId:full?null:first.versionId,prefix,tail:null,discardedTail,extraRequests:prefixItems.length,tailRequests:0,items,replaces:affected.length,plannedRequests:items.length,prefixBatches:saved.filter(b=>b.endIndex<replaceFrom)};
}
export function personaRebuildIdentities(profiles,retained=[]){
  const removed=new Set(profiles.filter(p=>p.deleted).map(p=>p.id));
  const identities=new Map(retained.filter(p=>!removed.has(p.id)).map(p=>[p.id,p]));
  for(const p of profiles)if(!p.deleted)identities.set(p.id,Object.fromEntries(['id','name','characterId','aliases','aliasPolicy','stage'].filter(k=>p[k]!==undefined).map(k=>[k,clone(p[k])])));
  return [...identities.values()];
}
export function personaRebuildIdentity(profile,identities){
  const identity=personaIdentity({previous:identities}),person=identity.resolve(profile.name);
  const candidates=person?.profiles??[],kept=candidates.find(p=>p.stage===profile.stage)??candidates[0];
  if(!kept)return profile;
  return {...profile,name:kept.name,characterId:kept.characterId??profile.characterId,
    ...(kept.stage===profile.stage||!kept.stage?{id:kept.id}:{}),
    aliases:[...new Set(kept.aliasPolicy==='manual'?(kept.aliases??[]):[...(kept.aliases??[]),...(profile.aliases??[]),profile.name])].filter(name=>foldName(name)!==foldName(kept.name)),aliasPolicy:kept.aliasPolicy??profile.aliasPolicy};
}
export function personaRebuildSeed(profiles,plan,identities,merge){
  if(!Array.isArray(profiles)||profiles.some(p=>!p.deleted&&(!Number.isSafeInteger(p.through)||p.through>=plan.replaceFrom)))throw new Error('起点前快照含有更晚或无法确认楼层的档案，未使用旧当前档案；请从第1楼干净重建');
  const groups=new Map();
  for(const p of profiles.filter(p=>!p.deleted)){
    const key=personaRebuildIdentity(p,identities).id;
    if(!groups.has(key))groups.set(key,new Map());
    groups.get(key).set(p.id,clone(p));
  }
  // Combine only pre-range rows under their genuine old IDs, then project
  // the user's canonical identity. Do not invent an ID or merge current prose.
  return [...groups.values()].map(group=>{
    const rows=[...group.values()],row=rows.slice(1).reduce((a,b)=>merge(a,b),rows[0]);
    return {...personaRebuildIdentity(row,identities),manual:false,locked:false,protected:false};
  });
}
export function personaRebuildLiveHash(profiles){
  // Casting is deliberately independent and may be corrected during a replay.
  return sha256(profiles.map(({casting,versionId,...p})=>p));
}
