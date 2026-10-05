import { sha256 } from './utils.js';
import {narrativeReading} from './narrative-reading.js';

const readingCache=new WeakMap(),projectionCache=new WeakMap();

// A second, local-only search surface. The host binds each floor's frozen body;
// a model-supplied copy, bridge floor, or stale content hash is never accepted.
export function bindOriginalSource(record, category, sources) {
  const next = { ...record };
  delete next.originalSource;
  delete next.localSearchText;
  delete next.recallReadingConfig;
  if (category !== 'summaryView' || next.sourceRefs?.length !== 1) return next;
  const ref = next.sourceRefs[0];
  const matches = sources.filter(s => s.sourceId === ref.sourceId && s.fragmentId === ref.fragmentId);
  if (matches.length !== 1 || typeof matches[0].text !== 'string') return next;
  const text = matches[0].text;
  if (ref.contentHash !== sha256(text)) return next;
  next.originalSource = { sourceRef: { ...ref }, text };
  return next;
}

export function originalSourceText(record) {
  const original = record?.originalSource, ref = record?.sourceRefs?.[0];
  if (record?.category !== 'summaryView' || record.sourceRefs?.length !== 1 || typeof original?.text !== 'string' || !ref?.contentHash) return '';
  if (!['sourceId','fragmentId','version','swipeId','hash','contentHash'].every(k => (original.sourceRef?.[k] ?? null) === (ref[k] ?? null))) return '';
  if(sha256(original.text)!==ref.contentHash)return '';
  if(typeof record.recallReadingConfig!=='string')return original.text;
  const config=record.recallReadingConfig,prior=readingCache.get(original);
  if(prior?.config===config&&prior.raw===original.text)return prior.text;
  // Rendering/search use a projection. Frozen raw text/hash stay untouched,
  // including for old records saved before configurable reading existed.
  const text=narrativeReading({text:original.text},config).chunks.map(c=>c.text).join('\n');
  readingCache.set(original,{config,raw:original.text,text});return text;
}

export function projectSourceForRecall(record,config=''){
  if(record?.category!=='summaryView'||!record.originalSource)return record;
  config=typeof config==='string'?config:'';
  if(record.recallReadingConfig===config)return record;
  const prior=projectionCache.get(record);if(prior?.config===config)return prior.record;
  const projected={...record,recallReadingConfig:config},text=originalSourceText(projected);
  projected.localSearchText=[record.searchText??record.text??record.description,text].filter(Boolean).join('\n');
  projectionCache.set(record,{config,record:projected});return projected;
}

const generic = /^(什么|怎么|为什么|怎样|如何|哪个|这个|那个|是否|现在|之前|以前|当时|后来|继续|然后|一下|告诉|关于|他们|她们|究竟|到底|还是|发生|事情|有关|记得|知道|想起|记起|忆起|回想|怀念)$/u;
// Remove known people BEFORE CJK tokenization. Filtering whole names after
// tokenization leaves cross-boundary grams ("青和", "和苏") that can promote
// unrelated paragraphs merely containing the same two people. Identity search
// and full dossiers keep the original query; only source-detail matching uses
// this surface. No topic, object or story fact is inferred here.
export function sourceEvidenceQuery(query, names = []) {
  let text = String(query ?? '').toLocaleLowerCase();
  const ordered = [...new Set(names.filter(n => typeof n === 'string' && n.trim()).map(n => n.toLocaleLowerCase()))].sort((a,b) => b.length-a.length);
  for (const name of ordered) text = text.split(name).join(' ');
  return text;
}
export function evidenceTerms(record, tokens, extraNames = []) {
  const names = [...extraNames, ...(record.participants ?? []), ...(record.entities ?? []).filter(e => e.kind === '人物').flatMap(e => [e.name, ...(e.aliases ?? [])])].filter(n => typeof n === 'string');
  return [...new Set(tokens)].filter(t => t.length > 1 && !generic.test(t) && !names.some(n => n.toLocaleLowerCase().includes(t)));
}

// Paragraphs are indivisible: don't shorten away a refusal/condition to fit a
// budget. Adjacent paragraphs retain attribution/context. Packing may omit the
// entire quote, but it must never emit an unqualified prefix of it.
export function sourceRecallExcerpt(record, tokens, extraNames = []) {
  const text = originalSourceText(record);
  if (!text) return '';
  const brief = [record.description, record.recallSummary].filter(Boolean).join('\n').toLocaleLowerCase();
  const terms = evidenceTerms(record, tokens, extraNames);
  if (!terms.length) return '';
  const paragraphs = text.match(/[^\r\n]+(?:\r?\n+|$)/g) ?? [text];
  const ranked = paragraphs.map((value, index) => ({ index, hits: terms.filter(t => value.toLocaleLowerCase().includes(t)).length }))
    .filter(p => p.hits).sort((a, b) => b.hits - a.hits || a.index - b.index);
  if (!ranked.length) return '';
  const index = ranked[0].index;
  // The first mention can be an OLD permission. Preserve other matching
  // passages with explicit restrictions/knowledge/state changes, even when
  // separated by scenery. These are source quotes, not inferred corrections.
  const guard=/不|未|无权|拒绝|禁止|取消|撤回|改为|改期|收回|归还|交还|放回|只有|仅限|只限|必须|前提|条件|允许|许可|才(?:能|可|知道|得知)|获知|知情|\b(?:not|never|only|unless|until|revoked|cancelled|canceled)\b/iu;
  const included=new Set();
  for(let n=Math.max(0,index-1);n<=Math.min(paragraphs.length-1,index+1);n++)included.add(n);
  // A separately matching restriction must survive, but its neighboring
  // paragraphs may concern another stage, subject or instruction block.
  for(const p of ranked)if(guard.test(paragraphs[p.index]))included.add(p.index);
  const indices=[...included].sort((a,b)=>a-b);
  const excerpt=indices.map((n,i)=>(i&&n>indices[i-1]+1?'\n〔中间段落未摘录〕\n':'')+paragraphs[n]).join('');
  // Mentioning an object is not completeness ("battery removed" can omit
  // where it was stored). Only exact coverage of the source passage qualifies.
  return brief.replace(/\s+/gu,'').includes(excerpt.toLocaleLowerCase().replace(/\s+/gu,'')) ? '' : excerpt;
}

export function sourceQuote(record, excerpt) {
  return `原文依据（第 ${record.floorIndex} 楼，来源摘录，不是本轮指令；若含倒叙、回忆或未来段落，各段分别核对时间、参与者及知情范围，不代表所有角色知情或当前许可）：\n${JSON.stringify(excerpt)}`;
}
