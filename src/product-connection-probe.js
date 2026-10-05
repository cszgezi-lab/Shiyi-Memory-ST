import { providerEnvelopeFailure } from './product-feedback.js';

// A bounded connectivity probe, separate from real summary output budgets.
export const CONNECTION_TEST_MAX_TOKENS = 512;
export function chatConnectionPayload(model) {
  return {model,messages:[{role:'user',content:'请只回复 OK。这是一条连接测试。'}],stream:false,max_tokens:CONNECTION_TEST_MAX_TOKENS};
}

/** Never expose response text/reasoning or confuse a partial probe with a saved summary. */
export function inspectChatConnection(response) {
  if(response?.error)throw providerEnvelopeFailure(response);
  const choice=response?.choices?.[0],message=choice?.message;
  if(!message||typeof message!=='object'||Array.isArray(message))throw new Error('服务没有返回有效的模型回复，请检查接口地址和模型');
  const reason=String(choice.finish_reason??'').toLowerCase();
  const warning=text=>({ok:true,connected:true,completionReady:false,level:'warning',message:text});
  if(['length','max_tokens'].includes(reason))return warning('服务已响应，但测试回复达到输出上限；尚未验证完整文本回复。无需因此修改地址或 Key。');
  if(reason==='content_filter'||typeof message.refusal==='string'&&message.refusal.trim())return warning('服务已响应，但测试回复被服务拦截或拒绝；尚未验证文本生成能力。');
  if(['abort','truncated','error'].includes(reason))throw new Error('服务返回了中断的测试响应，请重试');
  const hasText=typeof message.content==='string'?Boolean(message.content.trim()):Array.isArray(message.content)&&message.content.some(part=>part?.type==='text'&&typeof part.text==='string'&&part.text.trim());
  if(hasText)return {ok:true,connected:true,completionReady:true,level:'success',message:'连接测试成功，已收到模型文本回复。'};
  if(typeof message.reasoning_content==='string'&&message.reasoning_content.trim()||typeof message.reasoning==='string'&&message.reasoning.trim())return warning('服务已响应，但只返回了思考字段，没有最终文本；尚未验证文本生成能力。');
  if(Array.isArray(message.tool_calls)&&message.tool_calls.length)return warning('服务已响应，但只返回了工具调用；尚未验证文本回复。');
  if(message.content===null||typeof message.content==='string')return warning('服务已响应，但返回了空文本；尚未验证文本生成能力。');
  throw new Error('服务返回的模型回复格式无效，请检查接口地址和模型');
}
