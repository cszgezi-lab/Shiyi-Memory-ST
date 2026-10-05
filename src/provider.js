import { ShiyiError, SummaryResponseError } from './errors.js';
import { clone, sha256 } from './utils.js';
import { diagnosticRequestId, errorDiagnostics, jsonFailure, contentType,upstreamErrorCode,upstreamErrorHint } from './diagnostics.js';
import {scheduleDeadline} from './request-deadline.js';
import {parseChatEventStream} from './provider-stream.js';
import {providerQueueScope} from './provider-scheduler.js';

// Scoped to this plugin's transport function, never a global fetch hook.
const observers=new WeakMap();
export function observeProviderRequests(fetchImpl,observer){observers.set(fetchImpl,observer);return()=>observers.delete(fetchImpl);}
const schedulers=new WeakMap();
export function scheduleProviderRequests(fetchImpl,scheduler){schedulers.set(fetchImpl,scheduler);return()=>{if(schedulers.get(fetchImpl)===scheduler)schedulers.delete(fetchImpl);scheduler.dispose();};}

export const PROVIDER_RESOURCES = Object.freeze({
  chat: '/chat/completions',
  embeddings: '/embeddings',
  models: '/models',
  rerank: '/rerank',
});

function trimSlashes(value) {
  return String(value ?? '').replace(/^\/+|\/+$/gu, '');
}

function normalizeMode(profile) {
  const mode = profile?.endpointMode ?? profile?.mode ?? 'base';
  if (mode !== 'base' && mode !== 'exact') throw new ShiyiError('endpoint mode must be base or exact', 'PROVIDER_PROFILE_INVALID');
  return mode;
}

function resourcePath(resource, profile = {}) {
  if (typeof resource === 'string' && resource.startsWith('/')) return resource;
  const name = resource === 'chatCompletions' ? 'chat' : resource;
  if (name === 'rerank') {
    const explicit = profile.rerankResource ?? profile.rerankPath;
    if (explicit) return String(explicit).startsWith('/') ? String(explicit) : `/${explicit}`;
  }
  if (!PROVIDER_RESOURCES[name]) throw new ShiyiError(`unknown provider resource: ${String(resource)}`, 'PROVIDER_RESOURCE_INVALID');
  return PROVIDER_RESOURCES[name];
}

function ensureUrl(value) {
  if (typeof value !== 'string' || !value.trim()) throw new ShiyiError('provider URL is required', 'PROVIDER_PROFILE_INVALID');
  try { return new URL(value.trim()); } catch (error) { throw new ShiyiError('provider URL is invalid', 'PROVIDER_PROFILE_INVALID', { cause: error.message }); }
}

/**
 * Resolve only the resource selected by the caller.  In particular, `/v1` is
 * never added implicitly and exact mode does not attempt model-list guessing.
 */
export function resolveProviderEndpoint(profile = {}, resource = 'chat') {
  const mode = normalizeMode(profile);
  const input = profile.endpoint ?? profile.url ?? profile.baseUrl;
  const url = ensureUrl(input);
  if (mode === 'exact') return String(input).trim();
  const path = resourcePath(resource, profile);
  const existing = url.pathname.replace(/\/$/u, '');
  if (existing === path || existing.endsWith(path)) return url.toString().replace(/\/$/u, '');
  url.pathname = `${existing}/${trimSlashes(path)}`;
  return url.toString().replace(/\/$/u, '');
}

export function normalizeProviderProfile(profile = {}) {
  const endpointMode = normalizeMode(profile);
  const url = profile.endpoint ?? profile.url ?? profile.baseUrl;
  ensureUrl(url);
  const authMode = profile.authMode ?? 'bearer';
  if (!['none', 'bearer', 'api-key', 'custom'].includes(authMode)) throw new ShiyiError('unsupported authMode', 'PROVIDER_PROFILE_INVALID');
  return {
    endpointMode,
    url: String(url).trim(),
    model: profile.model ? String(profile.model) : '',
    authMode,
    apiKey: profile.apiKey == null ? '' : String(profile.apiKey),
    apiKeyHeader: profile.apiKeyHeader ? String(profile.apiKeyHeader) : 'x-api-key',
    timeoutMs: Number.isFinite(profile.timeoutMs) ? profile.timeoutMs : 120000,
    rerankResource: profile.rerankResource,
  };
}

export function buildProviderHeaders(profile = {}, extra = {}) {
  const normalized = normalizeProviderProfile(profile);
  const headers = { 'content-type': 'application/json', ...extra };
  const key = normalized.apiKey.trim();
  if (normalized.authMode === 'none' || !key) return headers;
  if (normalized.authMode === 'api-key') headers[normalized.apiKeyHeader] = key;
  else if (normalized.authMode === 'custom') headers[normalized.apiKeyHeader] = key;
  else headers.authorization = `Bearer ${key}`;
  return headers;
}

async function readBody(response,onBody=()=>{}) {
  if (response?.aborted || response?.bodyAborted || response?.truncated) throw new SummaryResponseError('provider response body was interrupted', { aborted: true,stage:'read_body',reason:'body_interrupted' });
  try {
    if (typeof response === 'string') {if(response.length)onBody(true);return response;}
    // Older mobile ReadableStreams support getReader but not async iteration.
    const stream=response?.body;
    if (stream && typeof stream !== 'string' && (stream[Symbol.asyncIterator]||typeof stream.getReader==='function')) {
      const chunks = [],decoder=new TextDecoder();let bytes=false;
      const consume=chunk=>{
        if(chunk?.length||chunk?.byteLength)onBody(false);
        if(typeof chunk==='string'){if(bytes)chunks.push(decoder.decode());bytes=false;chunks.push(chunk);}
        else{bytes=true;chunks.push(decoder.decode(chunk,{stream:true}));}
      };
      if(typeof stream.getReader==='function'){
        const reader=stream.getReader();
        try{while(true){const {done,value}=await reader.read();if(done)break;consume(value);}}
        finally{reader.releaseLock();}
      }else{
        for await (const chunk of stream)consume(chunk);
      }
      if(bytes)chunks.push(decoder.decode());
      return chunks.join('');
    }
    if (typeof response?.text === 'function') {const text=await response.text();if(text.length)onBody(true);return text;}
    if (typeof response?.body === 'string') {if(response.body.length)onBody(true);return response.body;}
    if (response?.body !== undefined) {onBody(true);return JSON.stringify(response.body);}
    return JSON.stringify(response);
  } catch (error) {
    throw new SummaryResponseError('provider response body could not be read', { causeError:error, aborted: true,stage:'read_body',reason:'body_interrupted' });
  }
}

export async function parseProviderJson(response, { requireStatus = true, onMetadata=()=>{},onBody=()=>{},allowStream=false } = {}) {
  const status = Number(response?.status ?? response?.statusCode ?? 200);
  const mime=response?.headers?.get?.('content-type')??'';
  const metadata={status,statusKnown:response?.status!==undefined||response?.statusCode!==undefined,responseType:/json/i.test(mime)?'json':/html/i.test(mime)?'html':/text/i.test(mime)?'text':mime?'other':'unknown'};
  onMetadata(metadata);
  if (requireStatus && (status < 200 || status >= 300)) {
    let bodyError;const body = await readBody(response,onBody).catch(error => {bodyError=error;return '';});
    let errorBody;try{errorBody=JSON.parse(body);}catch{errorBody={message:body.slice(0,4096)};}
    const upstreamCode=upstreamErrorCode(errorBody),upstreamHint=upstreamErrorHint(errorBody);
    const header=response?.headers?.get?.('retry-after'),seconds=header&&Number(header);
    const retryAfterMs=header?(Number.isFinite(seconds)?Math.max(0,seconds*1000):Math.max(0,Date.parse(header)-Date.now())):0;
    throw new ShiyiError(`provider returned HTTP ${status}`, 'PROVIDER_HTTP_ERROR', { ...metadata,stage:'request',reason:'http_error',bodyChars:body.length,upstreamDetailsProvided:Boolean(body.trim()),upstreamCode,upstreamHint,causeError:bodyError,...(Number.isFinite(retryAfterMs)&&retryAfterMs>0?{retryAfterMs}: {}) });
  }
  const text = await readBody(response,onBody);
  if(allowStream&&(/event-stream/i.test(mime)||/^\s*(?::|data:|event:)/.test(text)))return parseChatEventStream(text);
  try { return JSON.parse(text); } catch (error) {
    throw new SummaryResponseError('provider returned invalid JSON', jsonFailure(error,text,{...metadata,stage:'parse_envelope'}));
  }
}

/** Shared transport for connection tests and real summary/vector/rerank work. */
export class ProviderClient {
  constructor(profile, { fetchImpl = globalThis.fetch, recordRequests = true,modelRole } = {}) {
    this.profile = normalizeProviderProfile(profile);
    if (typeof fetchImpl !== 'function') throw new ShiyiError('fetch implementation is required', 'PROVIDER_FETCH_UNAVAILABLE');
    this.fetch = fetchImpl;
    this.requestLog = [];
    this.recordRequests = recordRequests;
    this.modelRole=modelRole;
  }

  async request(resource, payload, { signal, timeoutMs, headers = {}, method = 'POST', requestId=diagnosticRequestId(), purpose, onDiagnostic, rpmLimit=0, minIntervalMs=0 } = {}) {
    const started=Date.now(),observer=onDiagnostic??observers.get(this.fetch);let finished=false;
    const emit=(phase,details={},level='info')=>{if(finished)return;try{observer?.({phase,level,details:{requestId,purpose:purpose??resource,modelRole:this.modelRole,elapsedMs:Date.now()-started,...details}});}catch{/* diagnostics never fail a request */}};
    const serialized=JSON.stringify(payload??{});
    const requestMeta={...(resource==='chat'?{streaming:payload?.stream===true,jsonMode:Boolean(payload?.response_format),messageCount:payload?.messages?.length??0}:{}),providerFingerprint:sha256({url:resolveProviderEndpoint(this.profile,resource),model:payload?.model??this.profile.model}),requestChars:serialized.length,requestBytes:new TextEncoder().encode(serialized).length};
    let lease,networkStarted;
    try {
      const scheduler=resource==='chat'?schedulers.get(this.fetch):null;
      if(scheduler){
        const limits=[Number(rpmLimit),...(this.modelRole==='personaReview'?[5]:[])].filter(value=>Number.isFinite(value)&&value>0);
        lease=await scheduler.acquire(providerQueueScope(resolveProviderEndpoint(this.profile,resource),buildProviderHeaders(this.profile,headers)),{signal,onWait:details=>emit('queued',details),rpmLimit:limits.length?Math.min(...limits):0,minIntervalMs,...(this.modelRole==='personaReview'?{priority:-1}:{})});
      }
      networkStarted=Date.now();
      emit('request',{stage:'request',...requestMeta,queueWaitMs:lease?.queueWaitMs??0,maxTokens:payload?.max_tokens??0,timeoutMs:timeoutMs??this.profile.timeoutMs});
      return await this.performRequest(resource,payload,{signal,timeoutMs,headers,method,emit});
    }
    catch(thrown){const error=thrown instanceof Error?thrown:new ShiyiError('provider threw a non-Error value','PROVIDER_REQUEST_FAILED');error.details={stage:'prepare',...requestMeta,...error.details,...lease?.finish(error),queueWaitMs:lease?.queueWaitMs??(networkStarted===undefined?Math.max(0,Date.now()-started):0),requestElapsedMs:networkStarted===undefined?0:Math.max(0,Date.now()-networkStarted),requestId,purpose:purpose??resource};emit(error.code==='CANCELED'?'canceled':'failed',errorDiagnostics(error),error.code==='CANCELED'?'warning':'error');throw error;}
    finally{lease?.finish();finished=true;}
  }

  async performRequest(resource, payload, { signal, timeoutMs, headers, method, emit }) {
    const receivingStarted=Date.now(),receiveMeta={};
    const onBody=buffered=>{
      if(receiveMeta.firstBodyMs!==undefined)return;
      receiveMeta.firstBodyMs=Date.now()-receivingStarted;receiveMeta.bufferedBody=buffered;
      emit('body_start',{stage:'read_body',...receiveMeta});
    };
    const url = resolveProviderEndpoint(this.profile, resource);
    const requestHeaders = buildProviderHeaders(this.profile, headers);
    const body=method !== 'GET' && method !== 'HEAD'?JSON.stringify(payload??{}):undefined;
    const controller = new AbortController();
    const relayAbort = () => controller.abort(signal?.reason);
    if (signal?.aborted) relayAbort();
    else signal?.addEventListener('abort', relayAbort, { once: true });
    const effectiveTimeout = timeoutMs ?? this.profile.timeoutMs;
    let timer = null;
    let timedOut = false;
    let timerLagMs = 0,backgroundSeen=false;
    if (Number.isFinite(effectiveTimeout) && effectiveTimeout > 0) {
      timer = scheduleDeadline(effectiveTimeout, timing => { timedOut = true; timerLagMs=Math.round(timing.timerLagMs); backgroundSeen=timing.backgroundSeen===true;controller.abort('provider request timeout'); });
    }
    const init = {
      method,
      headers: requestHeaders,
      signal: controller.signal,
    };
    if (body!==undefined) init.body = body;
    if (this.recordRequests) this.requestLog.push({ resource, url, payload: clone(payload), headers: clone(requestHeaders) });
    let onAbort;
    const canceled = new Promise((_, reject) => {
      // A caller's bounded recall lane timing out is not a user pressing Stop.
      // Only propagate our typed timeout; never log arbitrary signal reasons.
      onAbort = () => reject(signal?.reason instanceof ShiyiError && signal.reason.code==='TIMEOUT' && signal.reason.details?.reason==='timeout'
        ? signal.reason : new ShiyiError('request canceled', 'CANCELED'));
      if (controller.signal.aborted) onAbort(); else controller.signal.addEventListener('abort', onAbort, { once:true });
    });
    try {
      const result=await Promise.race([(async () => { if(controller.signal.aborted)throw new ShiyiError('request canceled','CANCELED'); return parseProviderJson(await this.fetch(url, init),{allowStream:resource==='chat'&&payload?.stream===true,onBody,onMetadata:details=>{receiveMeta.responseHeadersMs=Date.now()-receivingStarted;emit('response',{...details,...receiveMeta,stage:'read_body'});}}); })(), canceled]);
      const message=result?.choices?.[0]?.message;
      emit('complete',{stage:'parse_envelope',...receiveMeta,...result?._shiyiStream,contentType:contentType(message?.content??result),responseChars:typeof message?.content==='string'?message.content.length:undefined,choicesCount:Array.isArray(result?.choices)?result.choices.length:undefined,toolCallsCount:message?.tool_calls?.length,finishReason:result?.choices?.[0]?.finish_reason,promptTokens:result?.usage?.prompt_tokens,completionTokens:result?.usage?.completion_tokens,totalTokens:result?.usage?.total_tokens},'success');
      return result;
    } catch (error) {
      if(error&&typeof error==='object')error.details={...receiveMeta,...error.details};
      if (timedOut) {
        const timeoutError = new ShiyiError(`${resource} request timed out`, 'TIMEOUT', { ...receiveMeta,timeoutMs: effectiveTimeout,timerLagMs,backgroundSeen,stage:'request',reason:'timeout',causeError:error });
        throw timeoutError;
      }
      if(error?.code||error?.name==='AbortError'){if(error?.code==='CANCELED'||error?.name==='AbortError')error.details={...error.details,stage:'request',reason:'canceled'};throw error;}
      throw new ShiyiError('provider network request failed', 'network.request_failed', {...error?.details,stage:'request',reason:'network_unclassified',upstreamDetailsProvided:false,causeError:error});
    } finally {
      timer?.();
      controller.signal.removeEventListener('abort', onAbort);
      signal?.removeEventListener('abort', relayAbort);
    }
  }

  async chatCompletions(payload, options = {}) { return this.request('chat', payload, options); }
  async embeddings(payload, options = {}) { return this.request('embeddings', payload, options); }
  async rerank(payload, options = {}) { return this.request('rerank', payload, options); }
  async models(payload = {}, options = {}) { return this.request('models', payload, { ...options, method: options.method ?? 'GET' }); }

  /** Uses the exact same task adapter as the eventual operation. */
  async testConnection({ task = 'chat', payload = {}, ...options } = {}) {
    const method = task === 'embedding' || task === 'embeddings'
      ? this.embeddings.bind(this)
      : task === 'rerank'
        ? this.rerank.bind(this)
        : task === 'models'
          ? this.models.bind(this)
          : this.chatCompletions.bind(this);
    const result = await method(payload, options);
    return { ok: true, task, result };
  }
}

export function createProviderClient(profile, options = {}) {
  return new ProviderClient(profile, options);
}
