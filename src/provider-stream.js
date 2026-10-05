import {SummaryResponseError,ShiyiError} from './errors.js';
import {upstreamErrorCode,upstreamErrorHint,nativeStreamErrorCode} from './diagnostics.js';
import {providerEnvelopeFailure} from './product-feedback.js';

const invalid=(reason='stream_invalid',details={})=>{throw new SummaryResponseError('chat stream was not complete or valid',{reason,stage:'read_body',...details});};
// A transport adapter may buffer SSE (TT native fetch) or expose bytes. Both
// use this same completed-envelope parser. Nothing is published per delta.
export function parseChatEventStream(text){
  const events=String(text).replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').split('\n\n');
  let done=false,finish=null,usage,model,chunks=0,refusal='';const content=[];
  for(const event of events){
    const data=event.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).replace(/^ /,'')).join('\n');
    if(!data.trim())continue;
    if(done)invalid('stream_invalid',{streamChunks:chunks});
    if(data.trim()==='[DONE]'){done=true;continue;}
    let value;try{value=JSON.parse(data);}catch{invalid('stream_invalid',{streamChunks:chunks});}
    chunks++;
    // TT 2.2 wraps a native failure as assistant text and then sends DONE.
    // Recognize only its reserved envelope ID, never arbitrary story content.
    if(/^tauritavern-error-chunk-\d+$/.test(value?.id??'')){
      const error=providerEnvelopeFailure({message:value?.choices?.[0]?.delta?.content});
      const nativeErrorCode=nativeStreamErrorCode(value?.choices?.[0]?.delta?.content);
      throw new ShiyiError('native chat stream returned an error','PROVIDER_STREAM_ERROR',{...error.details,...(nativeErrorCode?{nativeErrorCode}:{}),reason:'stream_error',stage:'read_body',streamChunks:chunks,upstreamDetailsProvided:true});
    }
    if(value?.error)throw new ShiyiError('chat stream returned an error','PROVIDER_STREAM_ERROR',{reason:'stream_error',stage:'read_body',streamChunks:chunks,upstreamCode:upstreamErrorCode(value),upstreamHint:upstreamErrorHint(value),upstreamDetailsProvided:true});
    if(!Array.isArray(value?.choices)||value.choices.length>1)invalid('stream_invalid',{streamChunks:chunks});
    if(value.usage)usage=value.usage;
    if(typeof value.model==='string')model=value.model;
    const choice=value.choices[0];if(!choice)continue;
    if(choice.index!==undefined&&choice.index!==0)invalid('stream_invalid',{streamChunks:chunks});
    const delta=choice.delta;
    if(!delta||typeof delta!=='object'||Array.isArray(delta)||delta.tool_calls?.length||delta.function_call)invalid('stream_invalid',{streamChunks:chunks});
    if(delta.content!==undefined&&delta.content!==null){
      if(typeof delta.content!=='string'||finish&&delta.content)invalid('stream_invalid',{streamChunks:chunks});
      content.push(delta.content);
    }
    // Never place provider reasoning/thoughts in stored story memory or logs.
    if(typeof delta.refusal==='string')refusal+=delta.refusal;
    if(choice.finish_reason!=null){if(finish)invalid('stream_invalid',{streamChunks:chunks});finish=choice.finish_reason;}
  }
  if(!done||typeof finish!=='string')invalid('stream_incomplete',{streamChunks:chunks});
  return {object:'chat.completion',...(model?{model}:{}),choices:[{index:0,message:{role:'assistant',content:content.join(''),...(refusal?{refusal}:{})},finish_reason:finish}],...(usage?{usage}:{}),_shiyiStream:{streaming:true,streamChunks:chunks}};
}
