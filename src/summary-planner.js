import { splitSummaryBatch } from './contracts.js';
import { ScopeConflictError } from './errors.js';
import { throwIfAborted } from './utils.js';

const locator = value => JSON.stringify([value.sourceId ?? value.id, value.fragmentId ?? null]);

/** Plan locally with the real request builder. Never calls a model or changes evidence.
 * The old small chunks remain a safe fallback, not a mandatory paid request count.
 * Persisted source locators keep restarts on precisely the same commit boundaries.
 */
export async function planSummaryRequests(batch, {maxSourceUnits, prepare, frozen, checkpointPlan, signal} = {}) {
  const make = groups => splitSummaryBatch(batch, {groups});
  const saved = frozen?.splitPlan ?? checkpointPlan;
  if (frozen && (frozen.version !== 1 || frozen.sourceRevision !== batch.sourceRevision)) {
    throw new ScopeConflictError('saved request plan differs from frozen source');
  }
  if (saved) {
    const seeds = splitSummaryBatch(batch, {maxInputUnits:maxSourceUnits});
    if(!Array.isArray(saved)||saved.some(part=>!Array.isArray(part?.sourceRefs)||part.sourceRefs.some(ref=>!ref||typeof ref.sourceId!=='string'))){
      throw new ScopeConflictError('saved request plan contains invalid source locators');
    }
    const sources = new Map([...batch.sourceMessages,...seeds.flatMap(c=>c.sourceMessages)].map(m=>[locator(m),m]));
    const seen = new Set();
    const groups = saved.map(part => (part.sourceRefs ?? []).map(ref => {
      const key = locator(ref), source = sources.get(key);
      if (!source || seen.has(key)) throw new ScopeConflictError('saved request plan has missing or duplicate source');
      seen.add(key);return source;
    }));
    if (!groups.length || groups.some(group=>!group.length)) throw new ScopeConflictError('saved request plan is empty');
    // Compare the actual ordered source text too, so no stale/corrupt plan can
    // silently omit a floor, reorder it, or substitute overlapping fragments.
    const rebuilt = groups.flat().reduce((rows,m)=>{
      const last=rows.at(-1);
      if(last?.id===m.id && m.fragmentId) last.text+=m.text;
      else rows.push({id:m.id,index:m.index,text:m.text});
      return rows;
    },[]);
    const expected=batch.sourceMessages.map(({id,index,text})=>({id,index,text}));
    if(JSON.stringify(rebuilt)!==JSON.stringify(expected))throw new ScopeConflictError('saved request plan does not cover the frozen source exactly');
    return make(groups);
  }
  const fits = async child => {
    throwIfAborted(signal);
    try { await prepare(child);return true; }
    catch(error) { if(error?.code==='INPUT_BUDGET_EXCEEDED')return false;throw error; }
  };
  const whole = make([batch.sourceMessages]);
  if(await fits(whole[0]))return whole;
  const seeds = splitSummaryBatch(batch, {maxInputUnits:maxSourceUnits});
  const groups=[];
  for(let start=0;start<seeds.length;) {
    let chosen=seeds[start].sourceMessages,next=start+1;
    for(let end=start+1;end<seeds.length;end++) {
      const candidate=[...chosen,...seeds[end].sourceMessages];
      // Separate fragments of an unusually long floor must not become two
      // independently summarized rows for the same floor in a single response.
      if(new Set(candidate.map(m=>m.id)).size!==candidate.length)break;
      const trial=make([...groups,candidate]).at(-1);
      if(!await fits(trial))break;
      chosen=candidate;next=end+1;
    }
    groups.push(chosen);start=next;
  }
  const packed=make(groups);
  // Final totalChildren/operation IDs are part of the serialized envelope.
  // Verify the final plan, not just its temporary prefix probes.
  for(const child of packed)if(!await fits(child)) {
    for(const seed of seeds){throwIfAborted(signal);await prepare(seed);}
    return seeds;
  }
  return packed;
}
