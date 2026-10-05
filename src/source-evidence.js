import {sha256} from './utils.js';

// Local source slices, not a new memory database. IDs bind exact offsets and
// text; the model selects IDs instead of retyping prose. Keep time headers and
// narrative HTML. Never offer reasoning, executable styling or variable edits.
export function qualitySourceSegments(source,{includeStructural=false}={}){
  const text=String(source.text??''),excluded=[];
  // An inline-code example such as `<think>` is not a real opening marker.
  // Preserve offsets while ignoring examples during control-tag recognition;
  // otherwise an orphan closer would leave the preceding planning exposed.
  const controlText=text.replace(/`+[^`\r\n]*`+/g,m=>' '.repeat(m.length));
  const blocks=/<(think|thinking|analysis|konatan_planning~|UpdateVariable|JSONPatch|script|style)(?:\s[^>]*)?>[\s\S]*?<\/\1\s*>/gi;
  for(const m of controlText.matchAll(blocks))excluded.push([m.index,m.index+m[0].length]);
  // An unclosed planning block is not evidence; do not expose its tail.
  for(const m of controlText.matchAll(/<(think|thinking|analysis|konatan_planning~|UpdateVariable|JSONPatch|script|style)(?:\s[^>]*)?>/gi))if(!excluded.some(([a,b])=>m.index>=a&&m.index<b))excluded.push([m.index,text.length]);
  // Some hosts retain a closing reasoning marker but omit the opener. Keep
  // the same conservative prefix exclusion used by narrativeEvidence.
  for(const m of controlText.matchAll(/<\/(think|thinking|analysis|konatan_planning~|UpdateVariable|JSONPatch|script|style)\s*>/gi))if(!excluded.some(([a,b])=>m.index>=a&&m.index<b))excluded.push([0,m.index+m[0].length]);
  excluded.sort((a,b)=>a[0]-b[0]);const ranges=[];let cursor=0;
  for(const [a,b]of excluded){if(a>cursor)ranges.push([cursor,a]);cursor=Math.max(cursor,b);}if(cursor<text.length)ranges.push([cursor,text.length]);
  const prefix=sha256([source.id,text]).slice(0,8),segments=[];
  for(const [a,b]of ranges)for(const m of text.slice(a,b).matchAll(/[^\r\n]+(?:\r?\n|$)/g)){
    const value=m[0];if(!value.replace(/<[^>]*>/g,'').trim()&&!(includeStructural&&/^\s*(?:<\/?(?:sy_context|sy_private|time_format)\b[^>]*>\s*)+$/i.test(value)))continue;
    const start=a+m.index;
    // Keep ordinary paragraphs intact. Very long single-line narratives are
    // divided at sentence boundaries (or contiguous chunks), never truncated.
    const pieces=value.length<=1800?[value]:value.match(/[\s\S]{1,1400}(?:[。！？；]\s*|$)|[\s\S]{1,1400}/gu);
    let offset=start;
    for(const piece of pieces){segments.push({segmentId:`q${prefix}-${segments.length.toString(36)}`,sourceId:source.id,index:source.index,start:offset,end:offset+piece.length,text:piece});offset+=piece.length;}
  }
  return segments;
}
