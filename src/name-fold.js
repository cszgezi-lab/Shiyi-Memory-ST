import {nameFoldData} from './name-fold-data.js';
// Search keys only; source spelling, MVU paths and EJS are never rewritten.
export const foldName=value=>[...String(value??'').normalize('NFKC').toLowerCase()].map(c=>nameFoldData[c]??c).join('');

// Explicit one-character names need word/context boundaries; “源” in “来源”
// must not turn a technical sentence into a character appearance.
export function nameMentionAt(text,word,at){
  const before=text.slice(0,at),after=text.slice(at+word.length);
  if(/^[a-z\d_ -]+$/i.test(word))return !/[a-z\d_]/i.test(before.at(-1)??'')&&!/[a-z\d_]/i.test(after[0]??'');
  if([...word].length!==1)return true;
  return (!before||/[\s，。！？、：；“”‘’「」『』（）()《》【】,.:;!?"']$/u.test(before)||/(?:看向|对|叫|喊|问|给|向|和|与|跟|让|告诉|邀请|帮助|拜访|抱住)$/.test(before))&&(!after||/^[\s，。！？、：；“”‘’「」『』（）()《》【】,.:;!?"']/u.test(after)||/^(?:说|问|回答|笑|看|走|来|去|点头|摇头|想|将|接|拿|是|在|有|没有|没|不|也|又|正|仍|很|的|和|与|对|把|被|让|给|会|能|今天|现在|这时|刚|已经|以前|喜欢|讨厌|吃|喝|听|穿|坐|站|躺|回|抬|低|伸|拉|抱|哭|睡|醒)/.test(after));
}
