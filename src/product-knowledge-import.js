// Text-only import. Never evaluate scripts or JSON expressions from attachments.
export function knowledgeImportPlan({name,text,purpose='knowledge',options={}}){
  if(!['knowledge','rules'].includes(purpose))throw new Error('请选择资料或配置规则');
  if(!/\.(txt|md|json)$/i.test(name??''))throw new Error('支持 TXT、MD、JSON');
  if(typeof text!=='string'||!text.trim())throw new Error('文件没有可读取的文字');
  if(new TextEncoder().encode(text).length>20*1024*1024)throw new Error('单个文件上限 20 MB');
  let content=text.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n'),format='普通文本';
  if(/\.json$/i.test(name)){
    let data;try{data=JSON.parse(content);}catch{throw new Error('JSON 格式无效；原有资料未改变');}
    const entries=data?.entries??data?.data?.character_book?.entries??data?.character_book?.entries;
    if(purpose==='knowledge'&&entries&&typeof entries==='object'){
      content=Object.values(entries).filter(e=>e&&typeof e.content==='string'&&e.disable!==true&&e.enabled!==false).map(e=>[e.comment??e.name??'',Array.isArray(e.key??e.keys)?(e.key??e.keys).join('、'):'',e.content].filter(Boolean).join('\n')).join('\n\n');format='世界书 JSON（已启用条目）';
    }else format='JSON 文本';
  }
  if(!content.trim())throw new Error('没有可导入的启用条目');
  const chunkSize=purpose==='rules'?6000:Number(options.chunkSize??600),delimiter=String(options.delimiter??'');
  if(!Number.isSafeInteger(chunkSize)||chunkSize<200||chunkSize>6000||delimiter.length>100)throw new Error('切片长度为 200–6000 字；分隔符最多 100 字');
  const config={chunkSize,delimiter,keywordEnabled:options.keywordEnabled!==false,vectorEligible:options.vectorEligible!==false,autoAnalyze:options.autoAnalyze!==false,enabled:options.enabled!==false,worldMode:options.worldMode==='fanfiction'?'fanfiction':'original'};
  if(purpose==='knowledge'&&!config.keywordEnabled&&!config.vectorEligible)throw new Error('关键词与向量至少选择一种');
  const chunks=[];let offset=0;
  for(const section of delimiter?content.split(delimiter):[content]){
    for(let start=0;start<section.length;){let end=Math.min(section.length,start+chunkSize);if(end<section.length&&/[\uD800-\uDBFF]/.test(section[end-1]))end--;const value=section.slice(start,end);if(value.trim())chunks.push({start:offset+start,end:offset+end,text:value});start=end;}
    offset+=section.length+delimiter.length;
  }
  if(!chunks.length)throw new Error('切片为空，请检查分隔符');
  return {name,purpose,options:config,format,chars:content.length,chunks,content};
}
