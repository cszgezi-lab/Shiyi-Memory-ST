// Transport preferences do not alter prompts, source coverage or reply limits.
// Direct SDK adapters without a product setting keep their historical mode.
export function summaryTransportOptions(profile={}){
  switch(profile.summaryRequestMode){
    case 'chat-stream': return {stream:true};
    case 'chat-buffered': return {stream:false};
    default: return {
      ...(profile.summaryStreaming?{stream:true,stream_options:{include_usage:true}}:{}),
      response_format:{type:'json_object'},
    };
  }
}
