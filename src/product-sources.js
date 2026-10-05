import { normalizeHostMessage } from './product-host-adapters.js';

export const sourceKey = ref => JSON.stringify([ref?.sourceId, ref?.version ?? null, ref?.hash ?? null]);

/** Verify raw bodies, including UUID messages. Unread evidence is unknown, never valid. */
export async function verifyProductSources(history, records, check = () => {}, {includeMessages=false}={}) {
  const started=Date.now();let historyPages=0,fetchedMessages=0,normalizedMessages=0;
  const refs = [...new Map(Object.values(records ?? {}).filter(Array.isArray).flatMap(list => list.flatMap(r => r?.sourceRefs ?? [])).map(r => [sourceKey(r), r])).values()];
  const current = new Map(), byIndex = new Map();
  const pending = refs.filter(r => !String(r.sourceId).startsWith('user-note_'));
  const wantedIds=new Set(pending.map(r=>r.sourceId));
  const wantedIndices=new Set(pending.flatMap(r=>{const m=/^message:(\d+):/.exec(r.sourceId);return m?[Number(m[1])]:[];}));
  let complete = false, total = null;
  if (pending.length) {
    let page = await history.tail({ limit: 500 }); check();
    for (let n = 0; n < 10000; n++) {
      if (!page || !Array.isArray(page.messages) || !Number.isInteger(page.startIndex) || page.startIndex < 0) break;
      if (total === null) total = page.totalCount ?? page.startIndex + page.messages.length;
      if (page.totalCount !== undefined && page.totalCount !== total) throw new Error('历史在来源核对期间变化');
      historyPages++;fetchedMessages+=page.messages.length;
      page.messages.forEach((m, i) => {
        const index=page.startIndex+i,explicit=m?.id??m?.messageId??m?.uuid??m?.sourceId;
        if(!wantedIndices.has(index)&&!wantedIds.has(typeof explicit==='string'?explicit.trim():explicit))return;
        const value = normalizeHostMessage(m, index); normalizedMessages++;current.set(value.id, value); byIndex.set(value.index, value);
      });
      if (page.startIndex === 0) { complete = true; break; }
      const unresolved = pending.some(r => { const match = /^message:(\d+):/.exec(r.sourceId); return match ? Number(match[1]) < total && !byIndex.has(Number(match[1])) : !current.has(r.sourceId); });
      if (!unresolved || typeof history.before !== 'function') break;
      const older = await history.before(page, { limit: 500 }); check();
      if (!older || !Array.isArray(older.messages) || !Number.isInteger(older.startIndex) || older.startIndex >= page.startIndex || older.startIndex + older.messages.length !== page.startIndex) break;
      page = older;
    }
  }
  const validKeys = [], invalidKeys = [], unknownKeys = [];
  for (const ref of refs) {
    const key = sourceKey(ref);
    if (String(ref.sourceId).startsWith('user-note_')) { validKeys.push(key); continue; }
    const match = /^message:(\d+):/.exec(ref.sourceId), value = match ? byIndex.get(Number(match[1])) : current.get(ref.sourceId);
    if (!value) { (complete || (match && Number(match[1]) >= total) ? invalidKeys : unknownKeys).push(key); continue; }
    if (!ref.hash || ref.version == null) { unknownKeys.push(key); continue; }
    (value.id === ref.sourceId && value.hash === ref.hash && value.version === ref.version ? validKeys : invalidKeys).push(key);
  }
  const valid=new Set(validKeys);
  return { validKeys, invalidKeys, unknownKeys, totalCount:total,readStats:{historyPages,fetchedMessages,normalizedMessages,elapsedMs:Date.now()-started},invalidIds: refs.filter(r => invalidKeys.includes(sourceKey(r))).map(r => r.sourceId),...(includeMessages?{messages:[...new Map(refs.filter(r=>valid.has(sourceKey(r))&&!r.sourceId.startsWith('user-note_')).map(r=>{const m=/^message:(\d+):/.exec(r.sourceId),message=m?byIndex.get(Number(m[1])):current.get(r.sourceId);return [r.sourceId,message];})).values()]}:{}) };
}
