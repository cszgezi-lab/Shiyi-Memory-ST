/** TT v2.2.0 public compatibility route. No host secret lookup or global fetch patch. */
export function createProductFetch(host, fetchImpl = globalThis.fetch) {
  const transport = async (url, init = {}) => {
    const target = new URL(url);
    if (!['http:', 'https:'].includes(target.protocol)) throw new Error('API 地址只支持 HTTP(S)');
    if (host?.__TAURITAVERN__?.api && target.pathname.endsWith('/models') && !target.search && !target.hash && init.method === 'GET') {
      // Same native route used by TT's model picker. The custom reverse-proxy
      // branch uses only this plugin's headers, never the user's main-chat key.
      return fetchImpl.call(host, '/api/backends/chat-completions/status', {
        method:'POST', signal:init.signal, headers:{'content-type':'application/json'},
        body:JSON.stringify({chat_completion_source:'custom',custom_api_format:'openai_compat',
          custom_url:'',reverse_proxy:target.href.slice(0,-'/models'.length),proxy_password:'',
          custom_include_headers:JSON.stringify(init.headers??{}),bypass_status_check:false}),
      });
    }
    if (host?.__TAURITAVERN__?.api && target.pathname.endsWith('/chat/completions') && !target.search && !target.hash && (init.method ?? 'POST') === 'POST') {
      const payload = JSON.parse(init.body ?? '{}');
      const base = target.href.slice(0, -'/chat/completions'.length);
      // Empty custom_url selects the reverse_proxy branch, whose only key is
      // proxy_password (empty here). Headers contain only this plugin's key.
      // This is local native transport, not a separate remote proxy service.
      return fetchImpl.call(host, '/api/backends/chat-completions/generate', {
        method: 'POST', signal: init.signal, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...payload, stream: payload.stream===true, type: 'quiet', chat_completion_source: 'custom', custom_api_format: 'openai_compat', custom_url: '', reverse_proxy: base, proxy_password: '', custom_include_headers: JSON.stringify(init.headers ?? {}), custom_include_body: JSON.stringify(payload) }),
      });
    }
    return fetchImpl.call(host, url, init);
  };
  return async (url,init={})=>{
    try{return await transport(url,init);}
    catch(error){
      const target=new URL(url),native=host?.__TAURITAVERN__?.api&&!target.search&&!target.hash&&((target.pathname.endsWith('/models')&&init.method==='GET')||(target.pathname.endsWith('/chat/completions')&&(init.method??'POST')==='POST'));
      // A rejected WebView fetch cannot distinguish CORS from DNS/TLS failures.
      // Record only the route, never raw URLs, request text or credentials.
      if(error&&typeof error==='object')error.details={...error.details,transport:error.details?.transport??(native?'tt_native':'browser_direct')};
      throw error;
    }
  };
}
