import { sha256,sha256Async,yieldLocalWork } from './utils.js';
import { PersistenceError } from './errors.js';

const KIND = 'shiyi-vector-document';
const COLLECTION = 'shiyi-vector-index';
// Bound native bridge copies by numeric payload, not just by number of cards.
export const VECTOR_PAGE_VALUES = 16384;
const readers = new WeakMap();
export const isVectorCollection = value => value?.kind === COLLECTION && value.version === 2 && value.entries && typeof value.entries === 'object';
const pageKeys = entries => new Set(Object.values(entries).flatMap(e => e.parts?.map(p => p.key) ?? []));
export function retainVectorPages(workspace, entries) {
  let held=readers.get(workspace);if(!held){held=new Map();readers.set(workspace,held);}
  const keys=entries?pageKeys(entries):new Set(['*']);for(const key of keys)held.set(key,(held.get(key)??0)+1);
  return ()=>{for(const key of keys){const n=(held.get(key)??0)-1;if(n>0)held.set(key,n);else held.delete(key);}};
}

/** Small indexes keep their existing format. Large indexes publish a tiny
 * manifest only after all new immutable pages passed exact readback. Failed
 * writes cannot replace the previous usable generation. No vector quantizing. */
export async function openVectorCollection(workspace,key,{check=()=>{},empty=false,persist=null}={}) {
  let root=empty?{}:await workspace.read(key,{});check();
  const write=persist??((name,value)=>workspace.write(name,value,{returnValue:false}));
  const entries=()=>isVectorCollection(root)?root.entries:root;
  async function commit(changes) {
    check();const paged=isVectorCollection(root),next=paged?{...root.entries}:{...root,...changes};
    if(!paged){
      let values=0;for(const e of Object.values(next)){values+=(e.segments??[e.vector]).reduce((n,v)=>n+(v?.length??0),0);if(values>VECTOR_PAGE_VALUES*2)break;}
      if(values<=VECTOR_PAGE_VALUES*2){await write(key,next);root=next;return;}
    }
    const metadata=paged?next:{};
    let page=[],values=0;
    async function flush(){
      if(!page.length)return;
      const payload={version:1,items:page},name=`${key}-page-${await sha256Async(JSON.stringify(payload))}`;
      await write(name,payload);check();
      page.forEach((item,slot)=>metadata[item.id].parts.push({key:name,slot}));
      page=[];values=0;await yieldLocalWork();check();
    }
    for(const [id,e]of Object.entries(paged?changes:next)){
      metadata[id]={hash:e.hash,dimension:e.vector.length,parts:[]};
      for(const [part,vector]of (e.segments??[e.vector]).entries()){
        if(page.length&&(values+vector.length>VECTOR_PAGE_VALUES||page.length>=16))await flush();
        page.push({id,hash:e.hash,part,vector});values+=vector.length;
      }
    }
    await flush();
    const live=pageKeys(metadata),retired=[...new Set([...(paged?root.retired??[]:[]),...(paged?[...pageKeys(root.entries)].filter(k=>!live.has(k)):[])])];
    const manifest={kind:COLLECTION,version:2,entries:metadata,retired};
    await write(key,manifest);root=manifest;
    // A cache may still be using the preceding snapshot. Its pages stay until
    // released; cleanup failure never invalidates a successfully saved index.
    const remaining=[];
    for(const name of retired){
      if(!name.startsWith(`${key}-page-`)||live.has(name)||readers.get(workspace)?.has('*')||readers.get(workspace)?.has(name)||!workspace.remove){remaining.push(name);continue;}
      try{await workspace.remove(name);}catch{remaining.push(name);}
      check();await yieldLocalWork();
    }
    if(remaining.length!==retired.length){root={...root,retired:remaining};try{await write(key,root);}catch{/* optional cleanup receipt; main generation is already verified */}check();}
  }
  return {get entries(){return entries();},get paged(){return isVectorCollection(root);},get document(){return root;},commit};
}

export async function readVectorPage(workspace,key){
  if(!/^vectors-[a-zA-Z0-9_-]+-page-[a-f0-9]{64}$/.test(key))throw new PersistenceError('索引分块地址无效',{storageStage:'decode',storageArtifact:'vector_index'});
  const page=await workspace.read(key,null);
  if(page?.version!==1||!Array.isArray(page.items))throw new PersistenceError('索引分块缺失或损坏',{storageStage:'decode',storageArtifact:'vector_index'});
  return page.items;
}
export function sameVectorDocument(a,b){
  return a?.kind===KIND&&b?.kind===KIND&&Object.keys(a).length===4&&Object.keys(b).length===4&&['kind','version','payload','checksum'].every(key=>a[key]===b[key]);
}
export async function encodeVectorDocumentAsync(name,value){
  if(!vectorStorageArtifact(name))return value;
  // Index documents are maps of independent records. Serialize one record at
  // a time, preserving ordinary JSON bytes, including full-precision doubles.
  let payload;
  if(value&&typeof value==='object'&&!Array.isArray(value)&&!value.toJSON){
    const parts=[];let chars=0;
    for(const key of Object.keys(value)){
      const text=JSON.stringify(value[key]);if(text!==undefined){parts.push(`${JSON.stringify(key)}:${text}`);chars+=text.length;}
      if(chars>=262144){chars=0;await yieldLocalWork();}
    }
    payload=`{${parts.join(',')}}`;
  }else payload=JSON.stringify(value);
  await yieldLocalWork();
  return {kind:KIND,version:1,payload,checksum:await sha256Async(payload)};
}
export async function decodeVectorDocumentAsync(name,value){
  if(!vectorStorageArtifact(name)||value?.kind!==KIND)return value;
  if(value.version!==1||typeof value.payload!=='string'||value.checksum!==await sha256Async(value.payload))throw new PersistenceError('向量存档完整性校验失败',{storageStage:'decode',storageArtifact:vectorStorageArtifact(name)});
  await yieldLocalWork();
  try{return JSON.parse(value.payload);}catch{throw new PersistenceError('向量存档内容无效',{storageStage:'decode',storageArtifact:vectorStorageArtifact(name)});}
}
export function vectorStorageArtifact(name) {
  if (!/^vectors-[a-zA-Z0-9_-]+$/.test(name)) return null;
  return name.endsWith('-jobs-v1') ? 'vector_jobs' : name.endsWith('-rebuild-v1') ? 'vector_staging' : 'vector_index';
}

// Keep floating-point values inside an opaque JSON string across the native
// JSON bridge. No quantization, approximate comparison or new storage backend.
// The existing workspace still performs an exact wire-document readback.
export function encodeVectorDocument(name, value) {
  if (!vectorStorageArtifact(name)) return value;
  const payload = JSON.stringify(value);
  return { kind: KIND, version: 1, payload, checksum: sha256(payload) };
}

export function decodeVectorDocument(name, value) {
  const storageArtifact = vectorStorageArtifact(name);
  // Existing plain numeric indexes and interrupted jobs remain readable.
  if (!storageArtifact || value?.kind !== KIND) return value;
  try {
    if (value.version !== 1 || typeof value.payload !== 'string' || value.checksum !== sha256(value.payload)) throw new Error();
    return JSON.parse(value.payload);
  } catch {
    throw new PersistenceError('向量存档完整性校验失败', { storageStage: 'decode', storageArtifact });
  }
}
