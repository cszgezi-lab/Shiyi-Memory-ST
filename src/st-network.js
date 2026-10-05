import { ShiyiError } from './errors.js';
import { providerEnvelopeFailure } from './product-feedback.js';

const STATUS_TEXT = new Map([
  ['bad request', 400], ['unauthorized', 401], ['forbidden', 403],
  ['not found', 404], ['request timeout', 408], ['too many requests', 429],
  ['internal server error', 500], ['bad gateway', 502],
  ['service unavailable', 503], ['gateway timeout', 504],
]);

function requestHeaders(host) {
  const contextGetter = host?.SillyTavern?.getContext ?? host?.getContext;
  const context = typeof contextGetter === 'function'
    ? contextGetter.call(host?.SillyTavern ?? host) : null;
  const getter = context?.getRequestHeaders ?? host?.getRequestHeaders;
  if (typeof getter !== 'function') {
    // Non-host core fixtures and direct browser consumers remain usable. An
    // actual ST context must supply its public authenticated headers accessor.
    if (typeof contextGetter !== 'function') return null;
    throw new ShiyiError('酒馆未提供本地请求认证，请刷新页面后重试', 'ST_CSRF_UNAVAILABLE');
  }
  const headers = new Headers(getter.call(context ?? host));
  headers.set('Content-Type', 'application/json');
  return headers;
}

function upstreamHeaders(init) {
  const headers = new Headers(init.headers ?? {});
  const values = Object.fromEntries(headers.entries());
  // ST's CUSTOM route reads its saved secret before merging custom headers.
  // Always override the exact Authorization property, including unauthenticated
  // requests. An absent plugin key must never fall through to the host's key.
  values.Authorization = headers.get('authorization') ?? '';
  delete values.authorization;
  return values;
}

async function checkNativeEnvelope(response) {
  if (!response?.ok || typeof response.clone !== 'function') return response;
  let value;
  try { value = await response.clone().json(); } catch { return response; }
  if (!value?.error) return response;
  // ST 1.17.0 reports non-stream failures and failed model discovery as HTTP
  // 200 envelopes. Only recognized status text can recover a discarded status;
  // no Retry-After header is invented when the server did not forward it.
  const message = value?.error?.message;
  const recoveredStatus = typeof message === 'string'
    ? STATUS_TEXT.get(message.trim().toLowerCase()) : undefined;
  const normalized = { ...value, ...(recoveredStatus ? { status: recoveredStatus } : {}) };
  if (value.quota_error === true) normalized.error = { ...value.error, code: 'insufficient_quota' };
  const error = providerEnvelopeFailure(normalized);
  error.details = { ...error.details, stage: 'request', reason: 'http_error', transport: 'st_native', upstreamDetailsProvided: Boolean(message) };
  throw error;
}

/** Original SillyTavern 1.17/1.19 public routes; no host connection or secret writes. */
export function createSTProductFetch(host, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new ShiyiError('fetch implementation is required', 'PROVIDER_FETCH_UNAVAILABLE');
  return async (url, init = {}) => {
    let transport = 'browser_direct';
    try {
      const target = new URL(url);
      if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password)
        throw new ShiyiError('API 地址必须是不含内嵌凭据的 HTTP(S) 地址', 'PROVIDER_PROFILE_INVALID');
      const method = (init.method ?? 'POST').toUpperCase();
      const resource = !target.search && !target.hash && (
        method === 'GET' && target.pathname.endsWith('/models') ? 'models' :
        method === 'POST' && target.pathname.endsWith('/chat/completions') ? 'chat' : null);
      if (!resource) {
        // ST's vector routes use its saved API secrets, and have no independent
        // rerank route. Keep plugin-owned embeddings/rerank/exact custom paths
        // direct: those servers must allow browser CORS. Do not enable or depend
        // on ST's optional, disabled-by-default generic /proxy route.
        return await fetchImpl.call(host, url, init);
      }
      transport = 'st_native';
      const headers = requestHeaders(host);
      if (!headers) {
        transport = 'browser_direct';
        return await fetchImpl.call(host, url, init);
      }
      const suffix = resource === 'models' ? '/models' : '/chat/completions';
      const base = target.href.slice(0, -suffix.length);
      const payload = resource === 'chat' ? JSON.parse(init.body ?? '{}') : {};
      const upstream = upstreamHeaders(init);
      const body = {
        ...payload,
        chat_completion_source: 'custom', custom_url: base,
        custom_include_headers: JSON.stringify(upstream),
        ...(resource === 'chat' ? {
          custom_include_body: JSON.stringify(payload),
          custom_exclude_body: '', custom_prompt_post_processing: '',
          stream: payload.stream === true,
        } : {}),
      };
      const response = await fetchImpl.call(host, `/api/backends/chat-completions/${resource === 'models' ? 'status' : 'generate'}`, {
        method: 'POST', headers, credentials: 'same-origin', signal: init.signal,
        body: JSON.stringify(body),
      });
      // Stream failures retain the server's HTTP status and original body.
      return resource === 'chat' && payload.stream === true ? response : await checkNativeEnvelope(response);
    } catch (error) {
      if (error && typeof error === 'object') error.details = { ...error.details, transport };
      throw error;
    }
  };
}
