/**
 * Small, dependency-free helpers shared by the pure core.  The memory data is
 * hashed before it is pointed to by a manifest, so JSON key order must not
 * affect the digest.
 */
export function clone(value) {
  if (value === undefined) return undefined;
  return structuredClone(value);
}

export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (typeof value.toJSON === 'function') return stableStringify(value.toJSON());
  if (Array.isArray(value)) return `[${Array.from(value, item => stableStringify(item) ?? 'null').join(',')}]`;
  // Match JSON persistence: omit undefined object properties, retain array
  // positions as null. Host serialization must not change a committed hash.
  return `{${Object.keys(value).sort().flatMap(key => { const serialized=stableStringify(value[key]); return serialized === undefined ? [] : [`${JSON.stringify(key)}:${serialized}`]; }).join(',')}}`;
}

function* sha256Steps(value) {
  const input = typeof value === 'string' ? value : (stableStringify(value) ?? 'undefined');
  const bytes = new TextEncoder().encode(input);
  // A 400 × 4096-dimensional index is tens of MB. A growable JS number
  // array amplified that input many times on mobile and allocated a new
  // schedule for every 64 bytes. Keep the same SHA-256 bytes/digests with
  // one byte buffer and one reusable schedule; existing saves stay valid.
  const words = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  words.set(bytes);
  words[bytes.length] = 0x80;
  const bitLength = bytes.length * 8;
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  const lengthView = new DataView(words.buffer);
  lengthView.setUint32(words.length - 8, high);
  lengthView.setUint32(words.length - 4, low);
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const rotate = (x, n) => (x >>> n) | (x << (32 - n));
  const state = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Uint32Array(64);
  for (let offset = 0; offset < words.length; offset += 64) {
    if(offset&&offset%32768===0)yield;
    for (let i = 0; i < 16; i += 1) {
      const p = offset + i * 4;
      w[i] = ((words[p] << 24) | (words[p + 1] << 16) | (words[p + 2] << 8) | words[p + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotate(w[i - 15], 7) ^ rotate(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotate(w[i - 2], 17) ^ rotate(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + s1 + ch + k[i] + w[i]) >>> 0;
      const s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0; state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0; state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0; state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0; state[7] = (state[7] + h) >>> 0;
  }
  return state.map((word) => word.toString(16).padStart(8, '0')).join('');
}

export function sha256(value){const steps=sha256Steps(value);let next;do{next=steps.next();}while(!next.done);return next.value;}
export function yieldLocalWork(){
  if(globalThis.scheduler?.yield)return globalThis.scheduler.yield();
  if(typeof MessageChannel==='function')return new Promise(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=()=>{channel.port1.close();channel.port2.close();resolve();};channel.port2.postMessage(null);});
  return new Promise(resolve=>setTimeout(resolve,0));
}
/** Same digest as existing saves. Native hashing runs off the UI thread;
 * insecure/older webviews use the same algorithm in cooperative chunks. */
export async function sha256Async(value,{cryptoApi=globalThis.crypto,yieldTask=yieldLocalWork}={}){
  const input=typeof value==='string'?value:(stableStringify(value)??'undefined');
  if(cryptoApi?.subtle)try{const bytes=await cryptoApi.subtle.digest('SHA-256',new TextEncoder().encode(input));return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');}catch{/* Fall back without changing the file format. */}
  const steps=sha256Steps(input);let next;do{next=steps.next();if(!next.done)await yieldTask();}while(!next.done);return next.value;
}

export function normalizeText(value) {
  const raw = typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value) ?? String(value);
  return raw
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * The core intentionally does not pretend to know provider tokenization.
 * This bounded estimate is only for local packing and segmentation; a host or
 * provider may supply a stricter count before making a request.
 */
export function estimateUnits(value) {
  const text = normalizeText(value);
  let units = 0;
  for (const ch of text) {
    // CJK characters are useful lexical units by themselves.  Latin words are
    // grouped so an English paragraph does not get over-counted.
    units += /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(ch) ? 1 : 0.25;
  }
  return Math.max(1, Math.ceil(units));
}

/** Estimate model-visible text, not HTTP JSON quoting of that text. The JSON
 * inside a message is counted intact. This is NOT a provider tokenizer.
 * Unknown/multimodal envelopes retain the conservative serialized fallback. */
export function estimateModelInputUnits(payload) {
  if (!Array.isArray(payload?.messages) || !payload.messages.every(m => typeof m?.content === 'string')) return estimateUnits(JSON.stringify(payload));
  const messages = payload.messages.reduce((sum, {content, ...metadata}) => sum + estimateUnits(content) + estimateUnits(JSON.stringify(metadata)) + 32, 0);
  const schema = ['tools', 'functions', 'response_format'].reduce((sum, key) => sum + (payload[key] === undefined ? 0 : estimateUnits(JSON.stringify(payload[key]))), 0);
  return messages + schema + 128;
}

export function asString(value, field, errors) {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${field} must be a non-empty string`);
    return '';
  }
  return value;
}

export function asArray(value, field, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array`);
    return [];
  }
  return value;
}

export function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === 'string' && value))];
}

export function makeId(prefix = 'id') {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.randomUUID) throw new Error('secure randomUUID is unavailable');
  return `${prefix}_${cryptoApi.randomUUID()}`;
}

export function decodeUtf8Chunk(chunk) {
  if (typeof chunk === 'string') return chunk;
  if (chunk instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(chunk));
  if (ArrayBuffer.isView(chunk)) return new TextDecoder().decode(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
  return String(chunk ?? '');
}

export function toTimestamp(value = Date.now()) {
  const number = Number(value);
  return Number.isFinite(number) ? number : Date.now();
}

export function withTimeout(promise, timeoutMs, label = 'operation') {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${label} timed out`);
      error.code = 'TIMEOUT';
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function abortError(reason = 'operation canceled') {
  const error = new Error(reason);
  error.name = 'AbortError';
  error.code = 'CANCELED';
  return error;
}

export function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal.reason ? String(signal.reason) : undefined);
}
