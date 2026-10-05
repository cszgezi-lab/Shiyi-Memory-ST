import { sha256, throwIfAborted, abortError, yieldLocalWork } from './utils.js';
import { isVectorCollection,retainVectorPages,readVectorPage } from './product-vector-storage.js';

export function vectorNorm(vector) {
  if (!Array.isArray(vector) || !vector.length || vector.some(value => !Number.isFinite(value))) return 0;
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return Number.isFinite(norm) ? norm : 0;
}

export function validVectorEntry(entry) {
  if(!vectorNorm(entry?.vector))return false;
  return entry.segments===undefined || Array.isArray(entry.segments)&&entry.segments.length>0&&entry.segments.every(v=>Array.isArray(v)&&v.length===entry.vector.length&&vectorNorm(v));
}

export function vectorIndexCoverage(cards, entries, hash) {
  let indexed=0,stale=0,missing=0;
  const dimensions=new Set();
  for(const card of cards){const entry=entries.get(card.id);if(entry?.hash===hash(card)&&entry.norm){indexed++;dimensions.add(entry.dimension??entry.vector.length);}else if(entry)stale++;else missing++;}
  // A mixed embedding space is not a complete usable index.
  return {total:cards.length,indexed,pending:cards.length-indexed,stale,missing,dimensions:[...dimensions],mixed:dimensions.size>1};
}

/** Derived, per-chat memory only. No credentials, query text or vectors are
 * exported to settings, reports or other application instances.
 */
export class ProductVectorCache {
  constructor({ maxNumericValues = 4 * 1024 * 1024 } = {}) {
    // Exact Float64 storage: bounded independently of history length, with no
    // quantization or persisted format change. Options are for host/test use.
    this.maxNumericValues = Math.max(0, Math.min(8 * 1024 * 1024, Math.floor(Number(maxNumericValues) || 0)));
    this.generation = 0; this.clear();
  }
  clear() {
    this.releasePages?.();this.releasePages=null;this.pages=new Map();
    this.compiledPages=new Map();this.numericValues=0;this.workspaceIds=new WeakMap();this.nextWorkspaceId=0;
    this.generation++;
    this.workspace = null; this.key = null; this.entries = null; this.pending = null;
    this.queries = new Map(); this.hashes = new WeakMap();
  }
  hash(card) {
    const previous = this.hashes.get(card);
    if (previous?.text === card.text) return previous.hash;
    const hash = sha256(card.text);
    this.hashes.set(card, { text: card.text, hash });
    return hash;
  }
  async load(workspace, key, signal) {
    throwIfAborted(signal);
    if (this.workspace !== workspace || this.key !== key) {
      this.clear(); this.workspace = workspace; this.key = key;
    }
    if (this.entries) return this.entries;
    if (this.pending && !this.pending.signal?.aborted) return this.pending.promise;
    const generation = this.generation;
    const pending = {};
    const promise = Promise.resolve().then(async () => {
      const releaseRead=retainVectorPages(workspace,null);
      try{
      const raw = await workspace.read(key, {});
      throwIfAborted(signal);
      if (generation !== this.generation || this.pending !== pending) throw abortError('vector scope changed');
      const entries = new Map();
      if(isVectorCollection(raw)){
        this.releasePages=retainVectorPages(workspace,raw.entries);
        for(const [id,entry]of Object.entries(raw.entries))if(typeof entry.hash==='string'&&Number.isInteger(entry.dimension)&&entry.dimension>0&&Array.isArray(entry.parts)&&entry.parts.length){
          entries.set(id,{...entry,norm:1,workspace});
        }
        this.entries=entries;return entries;
      }
      let processed = 0;
      for (const [id, entry] of Object.entries(raw ?? {})) {
        const norm = validVectorEntry(entry)?vectorNorm(entry.vector):0;
        if (norm && typeof entry.hash === 'string') entries.set(id, { ...entry, norm,segmentNorms:entry.segments?.map(vectorNorm) });
        if (++processed % 128 === 0) {
          await yieldLocalWork();
          throwIfAborted(signal);
          if (generation !== this.generation || this.pending !== pending) throw abortError('vector scope changed');
        }
      }
      this.entries = entries;
      return entries;
      }finally{releaseRead();}
    });
    Object.assign(pending, { promise, signal }); this.pending = pending;
    try { return await promise; }
    finally { if (this.pending === pending) this.pending = null; }
  }
  async query(query, request, signal) {
    throwIfAborted(signal);
    if (this.queries.has(query)) {
      const value = this.queries.get(query);
      this.queries.delete(query); this.queries.set(query, value);
      return value;
    }
    const generation = this.generation;
    const vector = await request();
    throwIfAborted(signal);
    if (generation !== this.generation) throw abortError('vector configuration changed');
    const norm = vectorNorm(vector);
    if (!norm) throw new Error('查询向量无效');
    const value = { vector: [...vector], norm };
    this.queries.set(query, value);
    while (this.queries.size > 16) this.queries.delete(this.queries.keys().next().value);
    return value;
  }
  async search(entries, cards, query, { limit, fingerprint, signal, tagLanes=[],categoryLanes=[] } = {}) {
    const generation = this.generation;
    const check = () => { throwIfAborted(signal); if (generation !== this.generation) throw abortError('vector snapshot changed'); };
    check();
    const matches = [];
    const paged=new Map(),pagedScores=new Map(),byId=new Map(cards.map(c=>[c.id,c]));
    let processed = 0;
    for (const card of cards) {
      const entry = entries.get(card.id);
      if(entry?.hash===this.hash(card)&&entry.parts&&entry.dimension===query.vector.length){
        if(!this.workspaceIds.has(entry.workspace))this.workspaceIds.set(entry.workspace,++this.nextWorkspaceId);
        const workspaceId=this.workspaceIds.get(entry.workspace);
        for(const [part,ref]of entry.parts.entries()){
          const address=`${workspaceId}:${ref.key}`;
          if(!paged.has(address))paged.set(address,{key:ref.key,workspace:entry.workspace,items:[]});
          paged.get(address).items.push({id:card.id,hash:entry.hash,part,slot:ref.slot});
        }
      }else if (entry?.hash === this.hash(card) && entry.vector?.length === query.vector.length) {
        let score=-Infinity;
        const vectors=entry.segments??[entry.vector];
        for(let part=0;part<vectors.length;part++){
          const vector=vectors[part];
          let dot = 0;
          for (let i = 0; i < vector.length; i++) dot += vector[i] * query.vector[i];
          score=Math.max(score,dot / ((entry.segmentNorms?.[part]??(vector===entry.vector?entry.norm:vectorNorm(vector))) * query.norm));
        }
        if (Number.isFinite(score)) matches.push({ id: card.id, score, embeddingSpace: fingerprint, tags:card.tags??[],category:card.category });
      }
      if (++processed % 128 === 0) {
        await yieldLocalWork();
        check();
      }
    }
    // A four-raw-page cache repeatedly rereads the whole index on every scan.
    // Keep validated doubles and norms under a numeric budget instead. During
    // an oversized scan, retain the already warm subset: ordinary LRU would
    // evict every page just before the following scan needs it again.
    const wantedPages=new Set(paged.keys());
    const readPage=async(address,group)=>{
      check();const cached=this.compiledPages.get(address);
      if(cached&&cached.workspace===group.workspace){this.compiledPages.delete(address);this.compiledPages.set(address,cached);return cached.items;}
      let page=this.pages.get(address);
      if(!page){page=await readVectorPage(group.workspace,group.key);check();this.pages.set(address,page);while(this.pages.size>4)this.pages.delete(this.pages.keys().next().value);}
      // Another preview may have finished the same read while this one waited.
      // Reuse its compiled page without charging the memory budget twice.
      const completed=this.compiledPages.get(address);
      if(completed&&completed.workspace===group.workspace)return completed.items;
      let values=0;
      const items=page.map(item=>{
        const norm=vectorNorm(item?.vector);
        if(!norm)return {id:item?.id,hash:item?.hash,part:item?.part,vector:null,norm:0};
        values+=item.vector.length;
        return {id:item.id,hash:item.hash,part:item.part,vector:new Float64Array(item.vector),norm};
      });
      if(values<=this.maxNumericValues){
        for(const [key,entry]of this.compiledPages){
          if(this.numericValues+values<=this.maxNumericValues)break;
          if(!wantedPages.has(key)){this.compiledPages.delete(key);this.numericValues-=entry.values;}
        }
        if(this.numericValues+values<=this.maxNumericValues){this.compiledPages.set(address,{items,values,workspace:group.workspace});this.numericValues+=values;}
      }
      return items;
    };
    const groups=[...paged];
    // At most four bridge reads/decoded pages are in flight. Score in original
    // order, preserving ties, floating-point accumulation and fail-closed use.
    for(let start=0;start<groups.length;start+=4){
      const batch=groups.slice(start,start+4),pages=await Promise.all(batch.map(([address,group])=>readPage(address,group)));check();
      for(let p=0;p<batch.length;p++)for(const ref of batch[p][1].items){
        const item=pages[p][ref.slot],v=item?.vector;
        if(item?.id!==ref.id||item.hash!==ref.hash||item.part!==ref.part||v?.length!==query.vector.length||!item.norm)throw new Error('索引分块与记忆不一致');
        let dot=0;for(let i=0;i<v.length;i++)dot+=v[i]*query.vector[i];
        const score=dot/(item.norm*query.norm);pagedScores.set(ref.id,Math.max(pagedScores.get(ref.id)??-Infinity,score));
      }
      await yieldLocalWork();check();
    }
    for(const [id,score]of pagedScores){const card=byId.get(id);if(Number.isFinite(score))matches.push({id,score,embeddingSpace:fingerprint,tags:card.tags??[],category:card.category});}
    check();
    const ranked=matches.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
    const result=new Map(ranked.slice(0,limit).map(item=>[item.id,item]));
    // Reuse one query embedding and one cosine pass for the global and tag
    // lanes. Filtered candidates can enter even below the global top-k.
    for(const lane of tagLanes.slice(0,4))for(const item of ranked.filter(x=>x.tags.includes(lane.tag)).slice(0,Math.min(lane.limit,20)))result.set(item.id,item);
    for(const lane of categoryLanes.slice(0,12))for(const item of ranked.filter(x=>x.category===lane.category).slice(0,Math.min(lane.limit,20)))result.set(item.id,item);
    return [...result.values()].sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).map(({tags,category,...item})=>item);
  }
}
