import { validateProductPatch } from './product-settings.js';
import { ProviderClient, resolveProviderEndpoint } from './provider.js';
import { modelListFailure } from './product-feedback.js';

export const API_KINDS = Object.freeze(['summary', 'supplement', 'assistant', 'embedding', 'rerank','dynamicPersona','personaReview','knowledge']);
export function productApiProfile(settings, kind, keys = {}, patch = {}) {
  if (!API_KINDS.includes(kind)) throw new Error('未知模型用途');
  const s = { ...settings, ...validateProductPatch(patch) };
  if(kind==='knowledge'&&s.knowledgeFollowAssistant)return productApiProfile(s,'assistant',keys);
  // A fresh installation can share the main connection. Any independent
  // persona field or key keeps that profile separate, including partial ones.
  const personaFollowsSummary = kind==='dynamicPersona'&&!s.dynamicPersonaEndpoint&&!s.dynamicPersonaModel&&!keys.dynamicPersona&&!keys.dynamicPersonaCredentialPresent;
  const effectiveKind = personaFollowsSummary || ['assistant','supplement'].includes(kind) && s[`${kind}FollowSummary`] ? 'summary' : kind;
  const prefix = effectiveKind === 'summary' ? 'provider' : effectiveKind;
  return { endpoint: s[`${prefix}Endpoint`], model: kind==='supplement'&&s.supplementFollowSummary?(s.supplementModel||s.providerModel):s[`${prefix}Model`],
    endpointMode: s[`${prefix}EndpointMode`], authMode: s[`${prefix}AuthMode`],
    apiKey: keys[effectiveKind] ?? '', timeoutMs: kind==='personaReview'?s.personaReviewDeadlineMs:kind==='dynamicPersona'?s.dynamicPersonaDeadlineMs:['summary','supplement'].includes(kind)?(s.summaryDeadlineMs??s.deadlineMs):s.deadlineMs };
}

// Model discovery is a separate GET, never a change to the saved inference URL.
export function modelListEndpoint(profile, explicit = '') {
  const input = explicit.trim() || profile.endpoint;
  if (!input) throw new Error('请先填写 API 地址');
  let url;
  try { url = new URL(input); } catch { throw new Error('API 地址格式不正确'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('模型列表地址必须是无内嵌凭据的 HTTP(S) 地址');
  if (explicit.trim()) return url.toString();
  const path = url.pathname.replace(/\/+$/, '');
  if (/\/(?:chat\/completions|embeddings|rerank|models)$/.test(path)) {
    url.pathname = path.replace(/\/(?:chat\/completions|embeddings|rerank|models)$/, '/models');
    return url.toString();
  }
  if (profile.endpointMode === 'exact') throw new Error('此完整端点无法推导模型列表，请展开地址选项填写列表地址，或直接输入模型名称');
  return resolveProviderEndpoint({ ...profile, endpoint: url.toString() }, 'models');
}

export function normalizeModelList(response) {
  if (response?.error) throw modelListFailure(response);
  const rows = Array.isArray(response) ? response : response?.data ?? response?.models;
  if (!Array.isArray(rows)) throw new Error('接口没有返回模型列表，请直接输入模型名称');
  return [...new Set(rows.map(row => typeof row === 'string' ? row : row?.id ?? row?.name)
    .filter(id => typeof id === 'string' && id.trim() && id.length <= 240))].sort((a,b) => a.localeCompare(b));
}

export async function fetchProductModels(profile, { fetchImpl, signal, modelsUrl = '',modelRole } = {}) {
  const endpoint=modelListEndpoint(profile,modelsUrl);
  // A separate model-list address must not forward a saved provider key to another origin.
  const apiKey=new URL(endpoint).origin===new URL(profile.endpoint).origin?profile.apiKey:'';
  const client = new ProviderClient({ ...profile, apiKey, endpoint, endpointMode: 'exact' }, { fetchImpl, recordRequests: false,modelRole });
  return normalizeModelList(await client.models({}, { signal }));
}
