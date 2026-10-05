import {sha256,clone} from './utils.js';
import {topicalTokens} from './memory-evidence.js';
import {enrichRetrievalMetadata} from './product-dictionary.js';

import {qualitySourceSegments} from './source-evidence.js';
import {narrativeReading} from './narrative-reading.js';
export {qualitySourceSegments} from './source-evidence.js';

export function qualityEvidenceCatalog(sources,records,readingConfig=''){
  const catalog=[];
  for(const source of sources){
    const paragraphs=readingConfig||/<\/?sy_(?:context|private)\b/i.test(source.text??'')?narrativeReading(source,readingConfig).segments.map(s=>({...s,segmentId:`${s.segmentId}-r${s.start.toString(36)}-${s.end.toString(36)}`})):qualitySourceSegments(source),related=records.filter(r=>r.sourceRefs?.some(ref=>ref.sourceId===source.id));
    const people=related.flatMap(r=>[r.person,r.actorId,...(r.participants??[]),...(r.entities??[]).filter(e=>e.kind==='人物').flatMap(e=>[e.name,...(e.aliases??[])])]).filter(n=>typeof n==='string');
    const terms=topicalTokens(related.map(r=>[r.knowledge,r.description,r.text,r.content,r.to,r.title].filter(Boolean).join(' ')).join(' '),people);
    const selected=new Set();
    // Short floors are cheap and preserve all local attribution. Long floors
    // select every topical hit, not only the highest-scoring first occurrence.
    // This retains later corrections/negations; adjacent paragraphs are whole.
    if(paragraphs.reduce((n,p)=>n+p.text.length,0)<=2400||!terms.length)paragraphs.forEach((_,i)=>selected.add(i));
    else{
      let topicalHits=0;
      paragraphs.forEach((p,i)=>{const hit=terms.some(t=>p.text.toLocaleLowerCase().includes(t));if(hit)topicalHits++;if(hit||/time_format|sy_private|sy_context|\d{4}[年/\-]\d{1,2}[月/\-]\d{1,2}/u.test(p.text))for(let n=Math.max(0,i-1);n<=Math.min(paragraphs.length-1,i+1);n++)selected.add(n);});
      if(!topicalHits)paragraphs.forEach((_,i)=>selected.add(i));
    }
    catalog.push(...paragraphs.filter((_,i)=>selected.has(i)));
  }
  return catalog;
}

export function qualityEvidenceText(catalog,sources){
  const map=new Map(sources.map(s=>[s.id,s])),groups=new Map();
  for(const s of catalog){if(!groups.has(s.sourceId))groups.set(s.sourceId,[]);groups.get(s.sourceId).push(s);}
  return [...groups].map(([id,spans])=>{let end=null,body='';for(const s of spans.sort((a,b)=>a.start-b.start)){const gap=end===null?'':map.get(id).text.slice(end,s.start);body+=(gap.trim()?'\n〔中间未提供片段〕\n':gap)+s.text;end=s.end;}return body;}).join('\n');
}

function evidenceError(){return Object.assign(new Error('记忆校对未通过：证据片段不存在或已变化；原记忆保留'),{code:'QUALITY_RESPONSE_INVALID',details:{qualityReason:'证据片段不存在或已变化'}});}

// Called inside per-row validation. Unknown IDs fail that row only. Model
// supplied text/offsets cannot override the locally prepared, verified slice.
export function resolveQualityProposal(proposal,catalog,sources,record={},records={}){
  if(!catalog)return proposal;
  const value=clone(proposal),byId=new Map(catalog.map(s=>[s.segmentId,s])),sourceMap=new Map(sources.map(s=>[s.id,s]));
  const resolve=id=>{const s=byId.get(id),original=s&&sourceMap.get(s.sourceId);if(!s||!original||original.text.slice(s.start,s.end)!==s.text||!s.text.replace(/<[^>]*>/g,'').trim())throw evidenceError();return s;};
  if(Array.isArray(value.evidence))value.evidence=value.evidence.map(e=>{
    if(typeof e?.segmentId!=='string')return e;
    const s=resolve(e.segmentId);return {sourceId:s.sourceId,quote:s.text};
  });
  const proof=value.fields?.acquisitionEvidence;
  if(proof?.segmentIds!==undefined){
    if(!Array.isArray(proof.segmentIds)||!proof.segmentIds.length||proof.segmentIds.length>12)throw evidenceError();
    const spans=[...new Map(proof.segmentIds.map(resolve).map(s=>[s.segmentId,s])).values()];
    value.evidence=[...(value.evidence??[]),...spans.map(s=>({sourceId:s.sourceId,quote:s.text}))];
    // Several consecutive slices may jointly establish who "she" is. Use the
    // exact original range, but never cross an excluded/non-offered paragraph.
    const groups=new Map();for(const s of spans){if(!groups.has(s.sourceId))groups.set(s.sourceId,[]);groups.get(s.sourceId).push(s);}
    const quotes=[];
    for(const [id,rows]of groups){rows.sort((a,b)=>a.start-b.start);let from=rows[0].start,to=rows[0].end;
      for(const r of rows.slice(1)){const gap=sourceMap.get(id).text.slice(to,r.start);if(!gap.trim())to=Math.max(to,r.end);else{quotes.push({sourceId:id,quote:sourceMap.get(id).text.slice(from,to)});from=r.start;to=r.end;}}
      quotes.push({sourceId:id,quote:sourceMap.get(id).text.slice(from,to)});
    }
    value.evidence.push(...quotes);
    // The existing binder chooses a supported quote from evidence; no model
    // quote or holder claim bypasses it.
    delete value.fields.acquisitionEvidence;
    const names=qualityActorNames(record,records,spans.map(s=>s.text).join('\n'));
    value.fields.acquisitionEvidence={quote:quotes.find(e=>names.some(n=>e.quote.includes(n)))?.quote??quotes[0]?.quote};
  }
  if(Array.isArray(value.evidence))value.evidence=[...new Map(value.evidence.map(e=>[JSON.stringify(e),e])).values()];
  return value;
}

// A shortened name must be an actual source spelling, a suffix of one and
// only one known formal person, >=2 characters. Shared names remain ambiguous.
// This is identity mapping, not proof that a person learnt every nearby fact.
export function qualityActorNames(record,records,sourceText){
  const person=record.person??record.actorId??record.personId;
  if(typeof person!=='string'||!person)return [];
  const names=new Set([person]);for(const rows of Object.values(records))if(Array.isArray(rows))for(const r of rows){for(const n of [r.person,r.actorId,r.entity,...(r.participants??[]),...(r.entities??[]).filter(e=>e.kind==='人物').map(e=>e.name)])if(typeof n==='string'&&n)names.add(n);}
  const mapped=enrichRetrievalMetadata({entities:[{name:person,kind:'人物'}]},sourceText,[...names]);
  const candidates=mapped.entities[0]?.aliases??[];
  const otherAliases=new Set([...names].filter(n=>n!==person&&!person.endsWith(n)).flatMap(n=>enrichRetrievalMetadata({entities:[{name:n,kind:'人物'}]},sourceText,[...names]).entities[0]?.aliases??[]));
  const aliases=candidates.filter(short=>!otherAliases.has(short)&&![...names].some(n=>n!==person&&n.endsWith(short)&&!person.endsWith(n)));
  return [person,...aliases];
}
