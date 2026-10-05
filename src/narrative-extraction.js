/**
 * Read-only narrative projections. Offsets are UTF-16 offsets into source.text.
 * Pass qualitySourceSegments(source) as argument 3 (or {baseSegments}) for chat
 * input. Omission uses that same safety filter.
 * An explicit empty/invalid safety list never expands back to the raw source.
 * Metadata, including parent segment IDs and source hashes, is copied unchanged;
 * projected slices are not a replacement evidence catalogue. No text is joined,
 * translated, normalised, or rewritten here. segments are also the preview API.
 */
import {qualitySourceSegments,safeSourceRanges} from './source-evidence.js';

// Hard limits are off by default for input-size guard rails (sourceChars,
// tags). The remaining caps catch genuinely dangerous or runaway inputs;
// they are not user-facing correctness checks.
export const NARRATIVE_EXTRACTION_LIMITS = Object.freeze({
  sourceChars: Number.POSITIVE_INFINITY, tags: Number.POSITIVE_INFINITY, tagChars: 8192,
  rules: 16, patternChars: 1024, regexAtoms: 512,
  regexWork: 4000000, matches: 65536, tagDepth: 64,
});

export const DEFAULT_NARRATIVE_EXTRACTION_CONFIG = Object.freeze({
  version: 1, enabled: true, preferChinese: false, rules: Object.freeze([]),
});

export function defaultNarrativeExtractionConfig() {
  return {version: 1, enabled: true, preferChinese: false, rules: []};
}

// New editors manage independent complete expressions. Legacy defaults and saved
// version-1 recipes remain unchanged, including already-frozen batch recipes.
export function defaultNarrativeRegexConfig() {
  return {version: 2, enabled: true, rules: []};
}

export const NARRATIVE_REGEX_LIMITS = Object.freeze({
  rules: 16, patternChars: 4096, atoms: 2048, work: 4000000, matches: 65536,
});

const REGEX_FAILURES = Object.freeze({
  schema: '正文提取设置格式不正确，请重新填写后预览。',
  syntax: '正则表达式写法不正确，请修改后预览。',
  flags: '正则标志只能使用不重复的 g、i、m、s、u，请修改后预览。',
  length: '正则表达式过长，请缩短后预览。',
  unsafe: '这条正则可能反复计算，请去掉嵌套重复、重复分支或反向引用后预览。',
  'work-limit': '这条正则处理本楼内容需要计算太久，请简化后预览。',
  'match-limit': '这条正则匹配到的片段太多，请缩小匹配范围后预览。',
});

function regexFailure(field, reason, rule) {
  return Object.assign(new Error(REGEX_FAILURES[reason]), {
    code: 'NARRATIVE_REGEX_INVALID', details: {field, reason,...(rule?{ruleIndex:rule.ruleIndex,ruleId:rule.id,kind:rule.kind}:{})},
  });
}

function parseRegexInput(value, field) {
  if (typeof value !== 'string') throw regexFailure(field, 'schema');
  if (value.length > NARRATIVE_REGEX_LIMITS.patternChars) throw regexFailure(field, 'length');
  if (!value.trim()) return null;
  let pattern = value, flags = '';
  const literal = value.trim();
  if (literal.startsWith('/')) {
    let escaped = false, inClass = false, close = -1;
    for (let i = 1; i < literal.length; i++) {
      const char = literal[i];
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === '[') inClass = true;
      else if (char === ']') inClass = false;
      else if (char === '/' && !inClass) close = i;
    }
    if (close < 1) throw regexFailure(field, 'syntax');
    pattern = literal.slice(1, close); flags = literal.slice(close + 1);
  }
  if (!/^[gimsu]*$/.test(flags) || new Set(flags).size !== flags.length) throw regexFailure(field, 'flags');
  const info = inspectRegexPattern(pattern, field, flags.includes('i'), flags.includes('s'));
  try {
    return {...info, field, regex: new RegExp(pattern, `${flags.replace(/g/g, '')}gd`)};
  } catch {
    throw regexFailure(field, 'syntax');
  }
}

// A conservative check before native compilation. It accepts common XML,
// alternatives, lookarounds and counted repetitions, while rejecting known
// backtracking hazards. It is not a wall-clock guarantee for arbitrary regexes.
function regexAtomDomain(key, ignoreCase, dotAll) {
  const join = ranges => {
    const result = [];
    for (const [a, b] of ranges.sort((x, y) => x[0] - y[0])) {
      const last = result.at(-1);
      if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
      else result.push([a, b]);
    }
    return result;
  };
  const inverse = ranges => {
    const result = []; let start = 0;
    for (const [a, b] of join(ranges)) { if (a > start) result.push([start, a - 1]); start = b + 1; }
    if (start <= 0x10ffff) result.push([start, 0x10ffff]);
    return result;
  };
  const aliases = {
    d: [[48, 57]], w: [[48, 57], [65, 90], [95, 95], [97, 122]],
    s: [[9, 13], [32, 32], [160, 160], [0x1680, 0x1680], [0x2000, 0x200a],
      [0x2028, 0x2029], [0x202f, 0x202f], [0x205f, 0x205f], [0x3000, 0x3000], [0xfeff, 0xfeff]],
  };
  const escaped = char => aliases[char] ?? (aliases[char.toLowerCase()] && char === char.toUpperCase()
    ? inverse(aliases[char.toLowerCase()]) : 'nrtfv'.includes(char)
      ? [[({n: 10, r: 13, t: 9, f: 12, v: 11})[char], ({n: 10, r: 13, t: 9, f: 12, v: 11})[char]]]
      : /^[\\.^$*+?()[\]{}|/\-]$/.test(char) ? [[char.codePointAt(0), char.codePointAt(0)]] : null);
  if (key === '.') return dotAll ? [[0, 0x10ffff]]
    : [[0, 9], [11, 12], [14, 0x2027], [0x202a, 0x10ffff]];
  let result, caseInvariant = false;
  if (key.startsWith('[')) {
    const negated = key[1] === '^', body = key.slice(negated ? 2 : 1, -1), items = [];
    for (let i = 0; i < body.length; i++) {
      if (body[i] === '\\') {
        const part = escaped(body[++i]); if (!part) return null; items.push({ranges: part});
      } else items.push({ranges: [[body.codePointAt(i), body.codePointAt(i)]], dash: body[i] === '-'});
    }
    result = [];
    for (let i = 0; i < items.length; i++) {
      if (i + 2 < items.length && items[i + 1].dash && items[i].ranges.length === 1 && items[i + 2].ranges.length === 1
        && items[i].ranges[0][0] === items[i].ranges[0][1] && items[i + 2].ranges[0][0] === items[i + 2].ranges[0][1]) {
        result.push([items[i].ranges[0][0], items[i + 2].ranges[0][0]]); i += 2;
      } else result.push(...items[i].ranges);
    }
    // Case-insensitive complements require full Unicode folding; keep the
    // estimate conservative instead of claiming two broad sets are disjoint.
    if (negated && ignoreCase) {
      caseInvariant = result.every(([a,b]) => b-a<=128 && Array.from({length:b-a+1},(_,index)=>a+index)
        .every(point => String.fromCodePoint(point).toLocaleLowerCase() === String.fromCodePoint(point)
          && String.fromCodePoint(point).toLocaleUpperCase() === String.fromCodePoint(point)));
      if (!caseInvariant) return null;
    }
    if (negated) result = inverse(result);
  } else if (key.startsWith('\\')) result = escaped(key[1]);
  else result = [[key.codePointAt(0), key.codePointAt(0)]];
  if (!result) return null;
  if (ignoreCase && !caseInvariant) {
    const additions = [];
    for (const [a, b] of result) {
      if (b - a > 128) return null;
      for (let point = a; point <= b; point++) for (const folded of [String.fromCodePoint(point).toLocaleLowerCase(), String.fromCodePoint(point).toLocaleUpperCase()]) {
        if ([...folded].length === 1) additions.push([folded.codePointAt(0), folded.codePointAt(0)]);
      }
    }
    result.push(...additions);
  }
  return join(result);
}

function regexTokenDomain(atom, ignoreCase, dotAll) {
  if (atom.kind === 'atom') return regexAtomDomain(atom.key, ignoreCase, dotAll);
  const simple = atom.body.replace(/(?:[+*?](?:\?)?|\{\d+(?:,\d*)?\})$/, '');
  if (simple === '.' || /^(?:\[[\s\S]*\]|\\.|[^\\[\]().*+?{}^$|])$/.test(simple)) return regexAtomDomain(simple, ignoreCase, dotAll);
  return /^[^\\[\]().*+?{}^$|]+$/.test(atom.body) ? regexAtomDomain(atom.body[0], ignoreCase, dotAll) : null;
}

function overlappingRegexAtoms(left, right, ignoreCase, dotAll) {
  const a = regexTokenDomain(left, ignoreCase, dotAll), b = regexTokenDomain(right, ignoreCase, dotAll);
  return !a || !b || a.some(([start, end]) => b.some(([otherStart, otherEnd]) => start <= otherEnd && otherStart <= end));
}

function inspectRegexPattern(pattern, field, ignoreCase, dotAll) {
  const stack = [{repeated: false, alternatives: false, last: null}];
  let last = null, count = 0;
  const unsafe = () => { throw regexFailure(field, 'unsafe'); };
  const checkNeighbors = value => {
    const separators = [];
    for (let previous = value.previous; previous; previous = previous.previous) {
      if (previous.risky && value.variable && previous.variable
        && overlappingRegexAtoms(value, previous, ignoreCase, dotAll)) {
        // A delimiter must consume a character outside at least one repeated
        // domain to separate its allocations. Literal a between two .* (or
        // [ab]*) is not such a boundary; XML's > separates [^>]* from its body.
        const separated = separators.some(separator => !separator.lookaround
          && (!separator.risky || separator.minimum > 0)
          && (!overlappingRegexAtoms(separator, value, ignoreCase, dotAll)
            || !overlappingRegexAtoms(separator, previous, ignoreCase, dotAll)));
        if (!separated) unsafe();
      }
      separators.push(previous);
    }
  };
  const atom = value => {
    last = {...value, previous: stack.at(-1).last};
    if (last.kind === 'group' && last.repeated) {
      last.risky = true; last.variable = true; last.minimum = 0;
      checkNeighbors(last);
    }
    stack.at(-1).last = last; count++;
  };
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i], frame = stack.at(-1);
    if (char === '\\') {
      const next = pattern[++i];
      if (!next) throw regexFailure(field, 'syntax');
      if (/[1-9k]/.test(next)) unsafe();
      let key = `\\${next}`;
      if (next === 'x' || next === 'u') {
        const escaped = next === 'u' && pattern[i + 1] === '{'
          ? /^\{([a-f\d]{1,6})\}/i.exec(pattern.slice(i + 1))
          : new RegExp(`^([a-f\\d]{${next === 'x' ? 2 : 4}})`, 'i').exec(pattern.slice(i + 1));
        if (!escaped) throw regexFailure(field, 'syntax');
        const point = parseInt(escaped[1], 16);
        if (point > 0x10ffff) throw regexFailure(field, 'syntax');
        key = String.fromCodePoint(point); i += escaped[0].length;
      } else if (next === 'p' || next === 'P') {
        const property = /^\{[^{}]+\}/.exec(pattern.slice(i + 1));
        if (!property) throw regexFailure(field, 'syntax');
        key += property[0]; i += property[0].length;
      } else if (next === 'c') {
        const control = pattern[++i];
        if (!control || !/[a-z]/i.test(control)) throw regexFailure(field, 'syntax');
        key = String.fromCharCode(control.toUpperCase().charCodeAt(0) % 32);
      }
      atom({kind: 'atom', key}); continue;
    }
    if (char === '[') {
      const start = i; let escaped = false, closed = false;
      for (i++; i < pattern.length; i++) {
        if (escaped) { escaped = false; continue; }
        if (pattern[i] === '\\') { escaped = true; continue; }
        if (pattern[i] === ']') { closed = true; break; }
      }
      if (!closed) throw regexFailure(field, 'syntax');
      atom({kind: 'atom', key: pattern.slice(start, i + 1)}); continue;
    }
    if (char === '(') {
      let capture = true, lookaround = false;
      if (pattern[i + 1] === '?') {
        const head = pattern.slice(i + 1, i + 4);
        if (head.startsWith('?:') || head.startsWith('?=') || head.startsWith('?!')) { lookaround=!head.startsWith('?:'); i += 2; capture = false; }
        else if (head === '?<=' || head === '?<!') { i += 3; capture = false; lookaround = true; }
        else if (head.startsWith('?<')) {
          const end = pattern.indexOf('>', i + 3);
          if (end < 0) throw regexFailure(field, 'syntax');
          i = end;
        } else throw regexFailure(field, 'syntax');
      }
      stack.push({repeated: false, alternatives: false, start: i + 1, capture, lookaround, last: null}); last = null; continue;
    }
    if (char === ')') {
      if (stack.length < 2) throw regexFailure(field, 'syntax');
      const group = stack.pop();
      atom({kind: 'group', repeated: group.repeated, alternatives: group.alternatives,
        body: pattern.slice(group.start, i), lookaround: group.lookaround});
      stack.at(-1).repeated ||= group.repeated;
      stack.at(-1).alternatives ||= group.alternatives;
      continue;
    }
    if (char === '|') { frame.alternatives = true; frame.last = null; last = null; continue; }
    if (char === '^' || char === '$') { frame.last = null; last = null; continue; }
    let repetition = false, minimum = 0, variable = true;
    if (char === '*' || char === '+' || char === '?') { repetition = true; minimum = char === '+' ? 1 : 0; }
    else if (char === '{') {
      const quantified = /^\{(\d+)(?:,(\d*))?\}/.exec(pattern.slice(i));
      if (quantified) {
        repetition = true; minimum = Number(quantified[1]);
        variable = quantified[2] !== undefined && (quantified[2] === '' || Number(quantified[2]) !== minimum);
        i += quantified[0].length - 1;
      }
    }
    if (repetition) {
      if (!last || last.quantified) throw regexFailure(field, 'syntax');
      if (last.kind === 'group' && last.repeated) unsafe();
      if (last.kind === 'group' && last.alternatives) {
        const branches = last.body.split('|');
        // Disjoint literal alternatives, such as (?:red|blue)+, are bounded.
        if (branches.some(branch => !branch || /[\\[\]().*+?{}^$]/.test(branch))
          || branches.some((branch, n) => branches.some((other, m) => n !== m
            && (branch.toLocaleLowerCase().startsWith(other.toLocaleLowerCase()) || other.toLocaleLowerCase().startsWith(branch.toLocaleLowerCase()))))) unsafe();
      }
      last.minimum = minimum; last.variable = variable; checkNeighbors(last);
      last.quantified = true; last.risky = true; frame.repeated = true;
      if (pattern[i + 1] === '?') i++;
      continue;
    }
    atom({kind: 'atom', key: char});
  }
  if (stack.length !== 1) throw regexFailure(field, 'syntax');
  if (count > NARRATIVE_REGEX_LIMITS.atoms) throw regexFailure(field, 'length');
  let prefix = '', anchored = pattern[0] === '^';
  for (let i = anchored ? 1 : 0; i < pattern.length; i++) {
    const char = pattern[i];
    if ('*+?{'.includes(char)) { prefix = prefix.slice(0, -1); break; }
    if ('[().|$'.includes(char)) break;
    if (char === '\\') {
      const next = pattern[++i];
      if (!next || !'^$\\.*+?()[]{}|/-'.includes(next)) break;
      prefix += next;
    } else prefix += char;
  }
  return {atoms: count, repeated: stack[0].repeated, prefix, anchored};
}

function compileRegexRule(rule,ruleIndex){
  const field=rule.kind==='include'?'includeRegex':'excludeRegex';
  try{
    const compiled=parseRegexInput(rule.expression,field);
    if(!compiled)throw regexFailure(field,'syntax');
    return {...compiled,id:rule.id,kind:rule.kind,ruleIndex};
  }catch(error){
    throw regexFailure(error.details?.field??field,error.details?.reason??'schema',{...rule,ruleIndex});
  }
}

function validateNarrativeRegexConfig(value) {
  if(own(value,'rules')||(!own(value,'includeRegex')&&!own(value,'excludeRegex'))){
    const config={version:2,enabled:value.enabled===undefined?true:value.enabled,rules:value.rules===undefined?[]:value.rules,
      ...(own(value,'legacyConfig')?{legacyConfig:value.legacyConfig}:{})};
    try{
      if(Object.keys(value).some(key=>!['version','enabled','rules','legacyConfig'].includes(key))||typeof config.enabled!=='boolean'
        ||!Array.isArray(config.rules)||config.rules.length>NARRATIVE_REGEX_LIMITS.rules)throw regexFailure('config','schema');
      if(own(config,'legacyConfig')&&(!object(config.legacyConfig)||(config.legacyConfig.version??1)!==1
        ||!validateNarrativeExtractionConfig(config.legacyConfig).valid))throw regexFailure('config','schema');
      const legacyCount=config.legacyConfig?.rules?.length??0;
      if(config.rules.length+legacyCount>NARRATIVE_REGEX_LIMITS.rules)throw regexFailure('config','schema');
      const ids=new Set((config.legacyConfig?.rules??[]).map(rule=>rule.id));
      config.rules=config.rules.map((rule,ruleIndex)=>{
        ruleIndex+=legacyCount;
        if(!object(rule)||Object.keys(rule).some(key=>!['id','kind','expression'].includes(key))
          ||typeof rule.id!=='string'||!rule.id.trim()||rule.id.length>100||ids.has(rule.id)
          ||!['include','exclude'].includes(rule.kind))throw regexFailure('config','schema',{id:typeof rule?.id==='string'?rule.id:undefined,kind:rule?.kind,ruleIndex});
        ids.add(rule.id);compileRegexRule(rule,ruleIndex);
        return {id:rule.id,kind:rule.kind,expression:rule.expression};
      });
      return {valid:true,config,warnings:[]};
    }catch(error){return {valid:false,config,warnings:[error.message],errorDetails:error.details};}
  }
  // The earlier, unpublished two-field version is still readable; editing it
  // uses independent array entries without rewriting the saved string on open.
  const config = {
    version: 2, enabled: value.enabled === undefined ? true : value.enabled,
    includeRegex: value.includeRegex === undefined ? '' : value.includeRegex,
    excludeRegex: value.excludeRegex === undefined ? '' : value.excludeRegex,
  };
  try {
    if (Object.keys(value).some(key => !['version', 'enabled', 'includeRegex', 'excludeRegex'].includes(key))
      || typeof config.enabled !== 'boolean') throw regexFailure('config', 'schema');
    parseRegexInput(config.includeRegex, 'includeRegex');
    parseRegexInput(config.excludeRegex, 'excludeRegex');
    return {valid: true, config, warnings: []};
  } catch (error) {
    return {valid: false, config, warnings: [error.message], errorDetails: error.details};
  }
}

// These are opt-in configurations, not rules silently applied to all messages.
export const NARRATIVE_EXTRACTION_PRESETS = Object.freeze([
  Object.freeze({id: 'tagged-narrative', name: '标签正文（保留时间与上下文）',
    config: Object.freeze({...DEFAULT_NARRATIVE_EXTRACTION_CONFIG, rules: Object.freeze([
      Object.freeze({id: 'content', name: 'content 正文', enabled: true,
        kind: 'include', tag: 'content', capture: 0}),
    ])})}),
  Object.freeze({id: 'prefer-chinese', name: '完整双语配对优先中文',
    config: Object.freeze({...DEFAULT_NARRATIVE_EXTRACTION_CONFIG, preferChinese: true})}),
  Object.freeze({id: 'thinking-strip', name: '示例：抓 <content> 正文 / 剥 <thinking> 思维链',
    config: Object.freeze({...DEFAULT_NARRATIVE_EXTRACTION_CONFIG, rules: Object.freeze([
      Object.freeze({id: 'content', name: '抓正文 <content>', enabled: true,
        kind: 'include', tag: 'content', capture: 0}),
      Object.freeze({id: 'thinking', name: '剥 <thinking> 思维链', enabled: true,
        kind: 'exclude', tag: 'thinking', capture: 0}),
    ])})}),
]);
export const NARRATIVE_PRESETS = NARRATIVE_EXTRACTION_PRESETS;

const CONTEXT_TAGS = ['time_format', 'sy_context', 'sy_private'];
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const meaningful = value => Boolean(value.replace(/<[^<>]*>/g, '').trim());
const fail = message => { throw new Error(message); };

/** Fill defaults without mutating inputs or silently discarding invalid rules. */
function fillDefaults(value = {}) {
  if (!object(value)) return defaultNarrativeExtractionConfig();
  return {
    version: value.version === undefined ? 1 : value.version,
    enabled: value.enabled === undefined ? true : value.enabled,
    preferChinese: value.preferChinese === undefined ? false : value.preferChinese,
    rules: value.rules === undefined ? [] : Array.isArray(value.rules) ? value.rules.slice(0, NARRATIVE_EXTRACTION_LIMITS.rules + 1).map((rule, i) => {
      if (!object(rule)) return rule;
      const result = {
        id: rule.id === undefined ? `rule-${i + 1}` : rule.id,
        name: rule.name === undefined ? `规则 ${i + 1}` : rule.name,
        enabled: rule.enabled === undefined ? true : rule.enabled,
        kind: rule.kind === undefined ? 'include' : rule.kind,
        capture: rule.capture === undefined ? 0 : rule.capture,
      };
      if (own(rule, 'tag')) result.tag = rule.tag;
      if (own(rule, 'pattern')) result.pattern = rule.pattern;
      if (own(rule, 'pattern') || own(rule, 'flags')) result.flags = rule.flags === undefined ? 'u' : rule.flags;
      return result;
    }) : value.rules,
  };
}

/**
 * Deliberately small native-regexp subset, checked BEFORE RegExp construction:
 * no alternation, assertions, backreferences, named groups, or repeated groups;
 * at most one quantified character/class in the entire expression. This rules
 * out exponential and multi-repeat polynomial backtracking. A conservative
 * work bound additionally covers unanchored quadratic search with one repeat.
 * Use tag rules for attribute-bearing/nested tags instead of complex regexes.
 */
function inspectPattern(pattern) {
  let i = 0, atoms = 0, captures = 0, repeats = 0, depth = 0;
  let quantifiable = false, groupEnded = false, prefix = '', prefixOpen = true;
  while (i < pattern.length) {
    const c = pattern[i++];
    if ('|{}'.includes(c)) fail('不支持分支或独立量词，请拆成多条规则。');
    if (c === '(') {
      if (pattern.slice(i, i + 2) === '?:') i += 2;
      else if (pattern[i] === '?') fail('不支持前后查找、命名分组或特殊分组。');
      else if (++captures > 1) fail('最多支持一个捕获组。');
      if (++depth > 8) fail('正则分组层数过多。');
      quantifiable = false; groupEnded = false;
      continue;
    }
    if (c === ')') {
      if (--depth < 0) fail('正则括号不完整。');
      quantifiable = false; groupEnded = true;
      continue;
    }
    if ('*+?'.includes(c)) {
      if (!quantifiable || groupEnded) fail('不支持重复分组、嵌套量词或连续量词。');
      if (++repeats > 1) fail('一条正则最多使用一个量词，请拆分规则或使用标签规则。');
      if (pattern[i] === '?') i++;
      // The quantified atom must not be included in a required literal prefix.
      prefix = prefixOpen ? prefix.slice(0, -1) : prefix;
      prefixOpen = false; quantifiable = false;
      continue;
    }
    if (c === '[') {
      let closed = false;
      while (i < pattern.length) {
        const next = pattern[i++];
        if (next === '\\') {
          if (i >= pattern.length) fail('字符类转义不完整。');
          i++;
        } else if (next === ']') { closed = true; break; }
      }
      if (!closed) fail('正则字符类不完整。');
      prefixOpen = false;
    } else if (c === '\\') {
      const next = pattern[i++];
      if (!next || /[0-9k]/.test(next)) fail('不支持反向引用或数字转义，请使用捕获组或直接写字符。');
      if ('pPuUxXc'.includes(next)) fail('请使用实际字符或简单字符类，暂不支持此转义。');
      if ('bB'.includes(next)) { prefixOpen = false; quantifiable = false; continue; }
      if ('dDsSwW'.includes(next)) prefixOpen = false;
      else if ('nrtfv'.includes(next)) {
        if (prefixOpen) prefix += ({n: '\n', r: '\r', t: '\t', f: '\f', v: '\v'})[next];
      } else {
        if (!'^$\\.*+?()[]{}|/-'.includes(next)) fail('不支持此转义，请直接填写字符。');
        if (prefixOpen) prefix += next;
      }
    } else if (c === '^' || c === '$') {
      prefixOpen = false; quantifiable = false; continue;
    } else if (c === '.') prefixOpen = false;
    else if (c === ']') fail('正则字符类括号不完整。');
    else if (prefixOpen) prefix += c;
    atoms++; quantifiable = true; groupEnded = false;
    if (pattern[i] === '{') fail('暂不支持花括号量词，请使用简单量词或标签规则。');
  }
  if (depth) fail('正则括号不完整。');
  if (!atoms || atoms > NARRATIVE_EXTRACTION_LIMITS.regexAtoms) fail('正则为空或过于复杂。');
  return {atoms, captures, repeats, prefix};
}

function compileRule(rule) {
  if (own(rule, 'tag') === own(rule, 'pattern')) fail('每条规则须且只能填写 tag 或 pattern。');
  if (own(rule, 'tag')) {
    if (typeof rule.tag !== 'string' || !/^[A-Za-z][A-Za-z0-9_:-]{0,47}$/.test(rule.tag)) fail('标签名不合法。');
    if (rule.flags !== undefined && rule.flags !== '') fail('标签规则不使用正则 flags。');
    return {tag: rule.tag.toLowerCase()};
  }
  if (typeof rule.pattern !== 'string' || !rule.pattern.length || rule.pattern.length > NARRATIVE_EXTRACTION_LIMITS.patternChars) fail('正则必须是 1～256 字符的字符串。');
  if (typeof rule.flags !== 'string' || !/^[gimsu]*$/.test(rule.flags) || new Set(rule.flags).size !== rule.flags.length) fail('正则 flags 仅支持不重复的 g、i、m、s、u。');
  const info = inspectPattern(rule.pattern);
  if (rule.capture === 1 && info.captures !== 1) fail('capture:1 需要一个捕获组。');
  try {
    // d is required: indexOf(capture) can point to a different identical word.
    const regex = new RegExp(rule.pattern, `${rule.flags.replace(/g/g, '')}gd`);
    return {...info, regex};
  } catch {
    fail('正则语法错误，或当前浏览器不支持精确捕获位置。');
  }
}

/** Returns {valid, config, warnings:string[]}; validation never executes rules. */
export function validateNarrativeExtractionConfig(value = {}) {
  if (typeof value === 'string') {
    if (value.length > 16384) return {valid: false, config: defaultNarrativeExtractionConfig(), warnings: ['提取配置 JSON 超过 16384 字符上限。']};
    try { value = value.trim() ? JSON.parse(value) : {}; }
    catch { return {valid: false, config: defaultNarrativeExtractionConfig(), warnings: ['提取配置不是有效的 JSON。']}; }
  }
  if (object(value) && value.version === 2) return validateNarrativeRegexConfig(value);
  const config = fillDefaults(value), warnings = [];
  if (!object(value)) warnings.push('提取配置必须是对象。');
  if (config.version !== 1) warnings.push('不支持此提取配置版本，目前仅支持 version:1。');
  if (typeof config.enabled !== 'boolean' || typeof config.preferChinese !== 'boolean') warnings.push('enabled 与 preferChinese 必须为布尔值。');
  if (!Array.isArray(config.rules) || config.rules.length > NARRATIVE_EXTRACTION_LIMITS.rules) warnings.push('rules 必须是数组，且不能超过 16 条规则。');
  else {
    const ids = new Set();
    for (const [i, rule] of config.rules.entries()) {
      const label = `规则 ${i + 1}`;
      if (!object(rule)) { warnings.push(`${label} 必须是对象。`); continue; }
      if (typeof rule.id !== 'string' || !rule.id.trim() || rule.id.length > 100 || ids.has(rule.id)) warnings.push(`${label} 的 id 必须唯一且为 1～100 字符。`);
      ids.add(rule.id);
      if (typeof rule.name !== 'string' || rule.name.length > 200) warnings.push(`${label} 的名称必须为不超过 200 字符的字符串。`);
      if (typeof rule.enabled !== 'boolean') warnings.push(`${label} 的 enabled 必须为布尔值。`);
      if (rule.kind !== 'include' && rule.kind !== 'exclude') warnings.push(`${label} 的 kind 仅支持 include 或 exclude。`);
      if (rule.capture !== 0 && rule.capture !== 1) warnings.push(`${label} 的 capture 仅支持 0 或 1。`);
      // Disabled drafts are retained, but cannot execute until they pass validation.
      if (rule.enabled === false) continue;
      try { compileRule(rule); } catch (error) { warnings.push(`${label}：${error.message}`); }
    }
  }
  return {valid: warnings.length === 0, config, warnings};
}

/** UI/settings entry point: blank means defaults; invalid nonempty JSON throws. */
export function normalizeNarrativeConfig(input = {}) {
  const result = validateNarrativeExtractionConfig(input);
  if (!result.valid) {
    if (result.config.version === 2) throw regexFailure(result.errorDetails?.field ?? 'config', result.errorDetails?.reason ?? 'schema',result.errorDetails?.ruleIndex!==undefined?{ruleIndex:result.errorDetails.ruleIndex,id:result.errorDetails.ruleId,kind:result.errorDetails.kind}:undefined);
    fail(result.warnings.join('\n'));
  }
  return result.config;
}

export function getNarrativeConfig(input = '') {
  return typeof input === 'string' && !input.trim() ? defaultNarrativeExtractionConfig() : normalizeNarrativeConfig(input);
}

// Descriptive aliases kept for callers that adopted the initial API notice.
export const normalizeNarrativeExtractionConfig = normalizeNarrativeConfig;

function union(ranges) {
  const result = [];
  for (const range of ranges.filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    const last = result.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else result.push([...range]);
  }
  return result;
}

function intersect(left, right) {
  const result = []; let i = 0, j = 0;
  while (i < left.length && j < right.length) {
    const a = Math.max(left[i][0], right[j][0]), b = Math.min(left[i][1], right[j][1]);
    if (a < b) result.push([a, b]);
    if (left[i][1] < right[j][1]) i++; else j++;
  }
  return result;
}

function subtract(ranges, exclusions) {
  const result = []; let j = 0;
  for (const [a, b] of ranges) {
    let cursor = a;
    while (j < exclusions.length && exclusions[j][1] <= a) j++;
    for (let k = j; k < exclusions.length && exclusions[k][0] < b; k++) {
      if (exclusions[k][0] > cursor) result.push([cursor, exclusions[k][0]]);
      cursor = Math.max(cursor, exclusions[k][1]);
    }
    if (cursor < b) result.push([cursor, b]);
  }
  return result;
}

function safetySegments(source, options, warnings) {
  const text = source.text;
  const supplied = options === undefined ? qualitySourceSegments(source) : Array.isArray(options) ? options : object(options) && own(options, 'baseSegments') ? options.baseSegments : null;
  if (!Array.isArray(supplied)) {
    warnings.push('安全片段参数无效，未恢复未经筛选的原文。');
    return [];
  }
  let invalid = false;
  const segments = [];
  for (const [baseIndex, segment] of supplied.entries()) {
    if (!object(segment) || !Number.isSafeInteger(segment.start) || !Number.isSafeInteger(segment.end)
      || segment.start < 0 || segment.end <= segment.start || segment.end > text.length
      || (own(segment, 'text') && segment.text !== text.slice(segment.start, segment.end))
      || (segment.sourceId !== undefined && source.id !== undefined && segment.sourceId !== source.id)) { invalid = true; continue; }
    segments.push({...segment, baseIndex, text: text.slice(segment.start, segment.end)});
  }
  segments.sort((a, b) => a.start - b.start || a.end - b.end);
  // Ambiguous overlapping evidence IDs must not be silently rebound or merged.
  if (segments.some((segment, i) => i && segment.start < segments[i - 1].end)) {
    warnings.push('安全片段互相重叠，无法确认原始证据边界，已停止读取。');
    return [];
  }
  if (invalid) warnings.push('已忽略越界、原文不一致或来源不一致的安全片段；未扩大读取范围。');
  return segments;
}

// Bounded linear markup scan. It reads delimiters in source.text so that tags
// split across safe paragraphs are still understood; only intersections with
// the supplied safety ranges can ever reach output.
function scanTags(text, names) {
  const blocks = [], tokens = [], stack = [], broken = new Set();
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf('<', cursor);
    if (start < 0) break;
    if (text.startsWith('<!--', start)) {
      const close = text.indexOf('-->', start + 4);
      cursor = close < 0 ? text.length : close + 3;
      tokens.push([start, cursor]);
      continue;
    }
    const head = /^<\s*(\/?)\s*([A-Za-z][A-Za-z0-9_:-]*)(?=[\s/>]|$)/.exec(text.slice(start, start + 80));
    if (!head) { cursor = start + 1; continue; }
    const name = head[2].toLowerCase();
    let end = start + head[0].length, quote = '';
    for (; end < text.length && end - start <= NARRATIVE_EXTRACTION_LIMITS.tagChars; end++) {
      const char = text[end];
      if (quote) { if (char === quote) quote = ''; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>' || char === '<') break;
    }
    if (text[end] !== '>' || end - start > NARRATIVE_EXTRACTION_LIMITS.tagChars) {
      if (names.has(name)) broken.add(name);
      cursor = Math.max(start + 1, end);
      continue;
    }
    end++; cursor = end;
    const selfClosing = /\/\s*>$/.test(text.slice(start, end));
    tokens.push([start, end, name, Boolean(head[1]), selfClosing]);
    if (!names.has(name)) continue;
    if (head[1]) {
      const open = stack.at(-1);
      if (!open || open.name !== name) { broken.add(name); continue; }
      stack.pop(); blocks.push({...open, end, bodyEnd: start});
    } else if (selfClosing) {
      blocks.push({name, start, end, bodyStart: end, bodyEnd: end});
    } else {
      stack.push({name, start, bodyStart: end});
      if (stack.length > NARRATIVE_EXTRACTION_LIMITS.tagDepth) fail('标签嵌套超过安全上限。');
    }
  }
  stack.forEach(open => broken.add(open.name));
  return {blocks: blocks.sort((a, b) => a.start - b.start), tokens, broken};
}

function spend(budget, amount) {
  budget.work += amount;
  if (budget.work > NARRATIVE_EXTRACTION_LIMITS.regexWork) fail('正则预计计算量超过手机安全上限，请缩小规则或使用标签提取。');
}

function regexRanges(text, safeRanges, compiled, capture, budget) {
  const result = [];
  for (const [a, b] of safeRanges) {
    const input = text.slice(a, b), n = input.length, cost = compiled.atoms + 1;
    spend(budget, (n + 1) * cost);
    if (compiled.repeats) {
      if (compiled.prefix && !compiled.regex.ignoreCase) {
        let index = input.indexOf(compiled.prefix);
        while (index >= 0) {
          spend(budget, (n - index + 1) * cost);
          index = input.indexOf(compiled.prefix, index + 1);
        }
      } else spend(budget, (n + 1) * (n + 1) * cost);
    }
    compiled.regex.lastIndex = 0;
    let match;
    while ((match = compiled.regex.exec(input)) !== null) {
      if (++budget.matches > NARRATIVE_EXTRACTION_LIMITS.matches) fail('匹配数量超过安全上限。');
      const range = match.indices[capture];
      if (!match[0].length || !range || range[0] === range[1]) fail('规则命中了空片段，请检查匹配式与 capture。');
      result.push([a + range[0], a + range[1]]);
    }
  }
  return result;
}

function project(text, base, ranges) {
  const segments = []; let i = 0;
  for (const segment of base) {
    while (i < ranges.length && ranges[i][1] <= segment.start) i++;
    for (let j = i; j < ranges.length && ranges[j][0] < segment.end; j++) {
      const start = Math.max(segment.start, ranges[j][0]), end = Math.min(segment.end, ranges[j][1]);
      if (start < end) segments.push({...segment, start, end, text: text.slice(start, end)});
    }
  }
  return segments;
}

function covered(ranges, start, end) {
  return ranges.some(([a, b]) => a <= start && b >= end);
}

function regexInputRanges(text, compiled, captures, budget) {
  if (!compiled) return [];
  const cost = (text.length + 1) * (compiled.atoms + 1);
  budget.work += cost;
  if (compiled.repeated && !compiled.anchored) {
    if (!compiled.prefix) budget.work += (text.length + 1) ** 2 * (compiled.atoms + 1);
    else {
      const needle = compiled.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const starts = new RegExp(needle, compiled.regex.ignoreCase ? 'gi' : 'g');
      for (const match of text.matchAll(starts)) budget.work += (text.length - match.index + 1) * (compiled.atoms + 1);
    }
  }
  if (budget.work > NARRATIVE_REGEX_LIMITS.work) throw regexFailure(compiled.field, 'work-limit',compiled.ruleIndex===undefined?undefined:compiled);
  const ranges = [];
  compiled.matchCount = 0;
  compiled.regex.lastIndex = 0;
  let match;
  while ((match = compiled.regex.exec(text)) !== null) {
    compiled.matchCount++;
    if (++budget.matches > NARRATIVE_REGEX_LIMITS.matches) throw regexFailure(compiled.field, 'match-limit',compiled.ruleIndex===undefined?undefined:compiled);
    const selected = captures && match.indices.length > 1 ? match.indices.slice(1) : [match.indices[0]];
    for (const range of selected) if (range && range[1] > range[0]) ranges.push(range);
    if (!match[0].length) {
      const index = compiled.regex.lastIndex;
      // AdvanceStringIndex: zero-width patterns cannot trap the synchronous
      // reader, including at a surrogate pair when Unicode mode is enabled.
      const first = text.charCodeAt(index), second = text.charCodeAt(index + 1);
      compiled.regex.lastIndex += compiled.regex.unicode && first >= 0xd800 && first <= 0xdbff
        && second >= 0xdc00 && second <= 0xdfff ? 2 : 1;
    }
  }
  return union(ranges);
}

function readNarrativeRegex(source, base, safeRanges, structural, config, stats, warnings, options) {
  const text=source.text;
  const rules=config.rules??[
    ...(config.includeRegex?.trim()?[{id:'includeRegex',kind:'include',expression:config.includeRegex}]:[]),
    ...(config.excludeRegex?.trim()?[{id:'excludeRegex',kind:'exclude',expression:config.excludeRegex}]:[]),
  ];
  const legacy=config.legacyConfig,legacyCount=legacy?.rules?.length??0;
  if(legacy&&!rules.length)return readNarrative(source,config.enabled?legacy:{...legacy,enabled:false},
    options===undefined?qualitySourceSegments(source,{includeStructural:true}):options);
  const active=config.enabled?rules.map((rule,index)=>compileRegexRule(rule,index+legacyCount)):[];
  const budget = {work: 0, matches: 0};
  // Match the single immutable source, then constrain each original range to
  // the established evidence safety slices. No cleaned replacement string is
  // constructed, and exclusions always subtract the complete match.
  const includeRules=active.filter(rule=>rule.kind==='include'),includes=[],excludes=[];
  for(const rule of active)(rule.kind==='include'?includes:excludes).push(...regexInputRanges(text,rule,rule.kind==='include',budget));
  let included=includeRules.length?union(includes):safeRanges;
  const excluded=union(excludes);
  if(legacy&&config.enabled){
    const legacyPolicy=validateNarrativeExtractionConfig(legacy).config;
    const old=readNarrative(source,legacy,options===undefined?qualitySourceSegments(source,{includeStructural:true}):options);
    const oldRanges=union([...old.segments,...old.structuralContext].map(s=>[s.start,s.end]));
    const oldIncludes=legacyPolicy.rules.some(rule=>rule.enabled&&rule.kind==='include')&&legacyPolicy.enabled;
    const oldHit=!old.stats.fallback&&old.stats.ruleMatches.some(rule=>rule.kind==='include'&&rule.matches>0);
    included=includeRules.length||oldIncludes?union([...includes,...(oldIncludes&&oldHit?oldRanges:[])]):oldRanges;
    const filter=readNarrative(source,{...legacyPolicy,rules:legacyPolicy.rules.filter(rule=>rule.kind==='exclude')},
      safeRanges.map(([start,end])=>({start,end,text:text.slice(start,end)})));
    included=intersect(included,union([...filter.segments,...filter.structuralContext].map(s=>[s.start,s.end])));
    if(old.warnings.length||filter.warnings.length)warnings.push('部分旧规则未完成或未匹配；本次结果仍按新增规则的提取和排除范围处理，请查看预览。');
  }
  const selected = subtract(intersect(included, safeRanges), excluded);
  const segments = project(text, base, selected);
  const structuralContext = project(text, structural, selected);
  stats.ruleMatches=active.map(rule=>({id:rule.id,kind:rule.kind,matches:rule.matchCount}));
  stats.matchedRules = stats.ruleMatches.filter(rule => rule.matches > 0).length;
  stats.matchCount = budget.matches;
  stats.outputChars = [...segments, ...structuralContext].reduce((sum, segment) => sum + segment.text.length, 0);
  stats.removedChars = stats.safeChars - stats.outputChars;
  stats.outputSegments = segments.length + structuralContext.length;
  if (!segments.length && !structuralContext.length && stats.safeChars) warnings.push(includeRules.length && !included.length
    ? '提取表达式没有匹配到内容，本楼读取为空；请在预览中检查写法。'
    : '排除后没有剩余正文，本楼读取为空；请在预览中检查范围。');
  return {segments, structuralContext, stats, warnings, configVersion: 2};
}

function chinese(value) {
  return /[\u3400-\u9fff]/u.test(value) && !/[\u3040-\u30ff]/u.test(value);
}

function bracketTranslation(text, from, pairs) {
  let start = from;
  while (start - from < 16 && (text[start] === ' ' || text[start] === '\t')) start++;
  const close = pairs[text[start]];
  if (!close) return null;
  const end = text.indexOf(close, start + 1);
  if (end < 0 || end - start > 1024) return null;
  const body = text.slice(start + 1, end);
  if (!body.trim() || /[\r\n<>「」〔〕（）【】]/u.test(body) || !chinese(body)) return null;
  return {start, end: end + 1, body};
}

// Izumi-style narration: <ja>Japanese sentence.</ja>Chinese sentence, or its
// immediately following line. There is no language-equivalence check. This is
// intentionally narrower than "any Han text after ja": complete plain prose,
// no speaker/unknown markup, no blank line and no intervening source gap.
const PLAIN_WRAPPERS = new Set(['content', 'sy_context', 'sy_private']);

function plainJapaneseStarts(tokens) {
  const scopes = [], starts = new Set();
  for (const [start, , name, closing, selfClosing] of tokens) {
    if (!name) continue;
    if (name === 'ja' && !closing && scopes.every(scope => PLAIN_WRAPPERS.has(scope))) starts.add(start);
    if (selfClosing) continue;
    if (closing) {
      const index = scopes.lastIndexOf(name);
      if (index >= 0) scopes.length = index;
    } else scopes.push(name);
  }
  return starts;
}

function plainChineseTranslation(text, ja, allowedStarts) {
  if (!allowedStarts.has(ja.start)
    || !/^<ja\s*>$/i.test(text.slice(ja.start, ja.bodyStart))
    || !/^<\/ja\s*>$/i.test(text.slice(ja.bodyEnd, ja.end))) return null;
  const japanese = text.slice(ja.bodyStart, ja.bodyEnd).trim();
  if (!/[\u3040-\u30ff]/u.test(japanese) || !/[。！？…]$/u.test(japanese)
    || /[「」『』〔〕【】\[\]{}:：]/u.test(japanese)) return null;
  // A role/action prefix outside the ja tag is not narration-pair framing.
  const lineStart = Math.max(text.lastIndexOf('\n', ja.start - 1), text.lastIndexOf('\r', ja.start - 1)) + 1;
  const prefix = text.slice(lineStart, ja.start).replace(/<(?:content|sy_context|sy_private)\b[^<>]*>/gi, '');
  if (prefix.trim()) return null;
  let start = ja.end;
  while (start - ja.end < 16 && /[ \t]/.test(text[start] ?? '')) start++;
  if (text[start] === '\r' && text[start + 1] === '\n') start += 2;
  else if (text[start] === '\n') start++;
  const indentation = start;
  while (start - indentation < 16 && /[ \t]/.test(text[start] ?? '')) start++;
  let end = start;
  while (end < text.length && end - start <= 2048 && !/[\r\n<]/.test(text[end])) end++;
  if (end - start > 2048) return null;
  const body = text.slice(start, end).trim();
  if (!/^[\u3400-\u9fff]/u.test(body) || !/[。！？…]$/u.test(body)
    || !/^[\u3400-\u9fff0-9 \t，。！？；、…—·,.!?;%-]+$/u.test(body)) return null;
  if (text[end] === '<') {
    // Permit enclosing narrative closers on this line, never another role,
    // translation, unknown tag or additional mixed-language unit.
    let lineEnd = end;
    while (lineEnd < text.length && lineEnd - end <= 2048 && !/[\r\n]/.test(text[lineEnd])) lineEnd++;
    if (lineEnd - end > 2048 || text.slice(end, lineEnd).replace(/<\/(?:content|sy_context|sy_private)\s*>/gi, '').trim()) return null;
  }
  return {start, end, body};
}

function chineseCuts(text, ranges, markup, budget) {
  const cuts = [], translations = new Map(markup.blocks.filter(block => ['zh', 'cn'].includes(block.name)).map(block => [block.start, block]));
  const plainStarts = plainJapaneseStarts(markup.tokens);
  for (const ja of markup.blocks.filter(block => block.name === 'ja')) {
    const body = text.slice(ja.bodyStart, ja.bodyEnd);
    // A speaker or extra markup inside <ja> cannot safely be thrown away.
    if (!body.trim() || /[<>\r\n:：]/u.test(body)) continue;
    let next = ja.end;
    while (next - ja.end < 16 && /[ \t]/.test(text[next] ?? '')) next++;
    const tagged = translations.get(next);
    let end;
    if (tagged && !markup.broken.has(tagged.name)) {
      const translation = text.slice(tagged.bodyStart, tagged.bodyEnd);
      if (/[<>]/.test(translation) || !chinese(translation)) continue;
      end = tagged.end;
    } else end = bracketTranslation(text, ja.end, {'〔': '〕', '（': '）'})?.end
      ?? plainChineseTranslation(text, ja, plainStarts)?.end;
    if (end && !markup.broken.has('ja') && covered(ranges, ja.start, end)) cuts.push([ja.start, ja.end]);
  }
  // Full role-style 「Japanese」〔Chinese〕 pairs only. Prefix speaker, mental
  // state, attribution and negation remain untouched, as does the translation.
  const dialogue = /「([^「」\r\n]{1,1024})」/gu;
  let match;
  while ((match = dialogue.exec(text)) !== null) {
    if (!/[\u3040-\u30ff]/u.test(match[1]) || /[<>:：]/.test(match[1])) continue;
    const translation = bracketTranslation(text, match.index + match[0].length, {'〔': '〕'});
    if (!translation || !covered(ranges, match.index, translation.end)) continue;
    if (markup.tokens.some(([a, b]) => match.index >= a && match.index < b)) continue;
    cuts.push([match.index, match.index + match[0].length]);
  }
  const merged = union(cuts);
  budget.matches += merged.length;
  if (budget.matches > NARRATIVE_EXTRACTION_LIMITS.matches) fail('双语匹配数量超过安全上限。');
  return merged;
}

function structuralSlices(source, base, markup) {
  // Only standalone, textless context markers omitted by the base filter.
  // Require whitespace-only adjacency (possibly through other such markers)
  // to real safe prose. A reasoning/script delimiter or any hidden prose breaks
  // that connection, so context cannot be smuggled out of an unsafe block.
  const candidates = markup.blocks.filter(block => ['sy_context', 'sy_private'].includes(block.name)
    && !markup.broken.has(block.name) && !source.text.slice(block.bodyStart, block.bodyEnd).trim()
    && !base.some(segment => segment.start < block.end && segment.end > block.start)
    && !source.text.slice(source.text.lastIndexOf('\n', block.start - 1) + 1, block.start).trim()
    && !source.text.slice(block.end, source.text.indexOf('\n', block.end) < 0 ? source.text.length : source.text.indexOf('\n', block.end)).trim());
  const units = [...base.map(segment => ({start: segment.start, end: segment.end, safe: meaningful(segment.text)})), ...candidates.map(block => ({...block, context: true}))]
    .sort((a, b) => a.start - b.start);
  const result = []; let group = [], lastEnd = 0;
  const flush = () => {
    if (group.some(unit => unit.safe)) for (const block of group.filter(unit => unit.context)) {
      result.push({kind: 'structural-context', tag: block.name, evidence: false,
        sourceId: source.id, start: block.start, end: block.end,
        text: source.text.slice(block.start, block.end)});
    }
    group = [];
  };
  for (const unit of units) {
    if (group.length && source.text.slice(lastEnd, unit.start).trim()) flush();
    group.push(unit); lastEnd = unit.end;
  }
  flush();
  return result;
}

/**
 * readNarrative(source, config?, baseSegments | {baseSegments}?)
 * Version 2 matches the immutable source globally, intersects safety ranges,
 * then subtracts complete exclusions. Empty results remain empty; invalid or
 * over-budget recipes throw before model dispatch. No context is reinserted.
 * The following compatibility behavior applies only to saved version 1:
 * include rules form a union, then exclude rules subtract. Context tags are
 * protected during rule selection. Chinese preference is a final opt-in pass.
 * Missing tags, invalid/unsafe regexes, empty results and budget overruns roll
 * back the entire projection to the ORIGINAL safe slices, with Chinese warnings.
 * warnings:string[]; stats lengths/counts refer to original UTF-16 characters.
 */
export function readNarrative(source, value = {}, options) {
  const warnings = [];
  if (!object(source) || typeof source.text !== 'string') {
    return {segments: [], structuralContext: [], stats: {inputChars: 0, safeChars: 0, outputChars: 0, removedChars: 0, baseSegments: 0, outputSegments: 0, matchedRules: 0, matchCount: 0, bilingualPairs: 0, fallback: true, ruleMatches: []}, warnings: ['source.text 必须为字符串，未读取任何正文。']};
  }
  const checked = validateNarrativeExtractionConfig(typeof value === 'string' && !value.trim() ? {} : value);
  if (checked.config.version === 2 && !checked.valid) throw regexFailure(checked.errorDetails?.field ?? 'config', checked.errorDetails?.reason ?? 'schema',checked.errorDetails?.ruleIndex!==undefined?{ruleIndex:checked.errorDetails.ruleIndex,id:checked.errorDetails.ruleId,kind:checked.errorDetails.kind}:undefined);
  const text = source.text, base = safetySegments(source, options, warnings);
  let structuralContext = [];
  const evidenceRanges = union(base.map(segment => [segment.start, segment.end]));
  const safeRanges = checked.config.version === 2
    ? options === undefined ? safeSourceRanges(source) : intersect(evidenceRanges, safeSourceRanges(source))
    : evidenceRanges;
  const structural = checked.config.version === 2 && options === undefined
    ? subtract(safeRanges, evidenceRanges).map(([start, end]) => ({kind: 'structural-context', evidence: false,
      sourceId: source.id, start, end, text: text.slice(start, end)})) : [];
  const safeChars = safeRanges.reduce((sum, [a, b]) => sum + b - a, 0);
  const stats = {inputChars: text.length, safeChars, outputChars: safeChars, removedChars: 0,
    baseSegments: base.length, outputSegments: base.length, matchedRules: 0,
    matchCount: 0, bilingualPairs: 0, fallback: warnings.length > 0, ruleMatches: []};
  const fallback = message => {
    stats.fallback = true; stats.bilingualPairs = 0;
    warnings.push(`${message}已保留原安全片段。`);
    return {segments: base, stats, warnings, structuralContext};
  };
  if (checked.config.version === 2) {
    return readNarrativeRegex(source, base, safeRanges, structural, checked.config, stats, warnings, options);
  }
  if (!checked.valid) { warnings.push(...checked.warnings); return fallback('提取配置无效；'); }
  const config = checked.config;
  if (!safeChars) return {segments: base, stats, warnings, structuralContext};
  const active = config.rules.filter(rule => rule.enabled);
  const budget = {work: 0, matches: 0};
  try {
    const names = new Set([...CONTEXT_TAGS, ...active.filter(rule => rule.tag).map(rule => rule.tag.toLowerCase()), ...(config.preferChinese ? ['ja', 'zh', 'cn'] : [])]);
    const markup = scanTags(text, names);
    structuralContext = structuralSlices(source, base, markup);
    if (!config.enabled || (!active.length && !config.preferChinese)) return {segments: base, stats, warnings, structuralContext};
    const relevantBroken = [...markup.broken].filter(name => CONTEXT_TAGS.includes(name) || active.some(rule => rule.tag?.toLowerCase() === name));
    if (relevantBroken.length) warnings.push(`标签 ${relevantBroken.join('、')} 不完整；将按现有片段输出。`);
    const includes = [], excludes = [];
    for (const rule of active) {
      const compiled = compileRule(rule);
      let ranges;
      if (compiled.tag) {
        const blocks = markup.blocks.filter(block => block.name === compiled.tag);
        ranges = intersect(union(blocks.map(block => rule.capture === 1 ? [block.bodyStart, block.bodyEnd] : [block.start, block.end])), safeRanges);
        budget.matches += blocks.length;
        if (budget.matches > NARRATIVE_EXTRACTION_LIMITS.matches) fail('匹配数量超过安全上限。');
        // A rule with no matches simply contributes nothing; the caller may
        // still have other rules or fall through to the safe default below.
      } else ranges = regexRanges(text, safeRanges, compiled, rule.capture, budget);
      stats.ruleMatches.push({id: rule.id, kind: rule.kind, matches: ranges.length});
      if (ranges.length) stats.matchedRules++;
      (rule.kind === 'include' ? includes : excludes).push(...ranges);
    }
    stats.matchCount = budget.matches;
    const includeRules = active.filter(rule => rule.kind === 'include');
    const includeHit = includeRules.some(rule => {
      const found = stats.ruleMatches.find(m => m.id === rule.id && m.kind === 'include');
      return found && found.matches > 0;
    });
    if (includeRules.length && !includeHit) {
      warnings.push(`所配的提取规则没有命中：${includeRules.map(rule => rule.id).join('、')}；已保留原文供检查。`);
    }
    // If at least one include rule actually matched, narrow the result down
    // to those matches. Otherwise keep the full safe text — refusing the
    // user's "I want this anyway" request by stripping it down would be worse.
    let selected = includeHit ? union(includes) : safeRanges;
    const protectedRanges = [];
    for (const block of markup.blocks.filter(block => CONTEXT_TAGS.includes(block.name))) {
      protectedRanges.push([block.start, block.end]);
      if (!meaningful(text.slice(block.bodyStart, block.bodyEnd))) {
        // Attribute-only metadata is kept alongside its already-safe paragraph;
        // attributes are never converted into statements about who knows what.
        for (const segment of base) if (segment.start < block.end && segment.end > block.start && meaningful(segment.text)) protectedRanges.push([segment.start, segment.end]);
      }
    }
    selected = intersect(union([...subtract(selected, union(excludes)), ...protectedRanges]), safeRanges);
    if (config.preferChinese) {
      const cuts = chineseCuts(text, selected, markup, budget);
      selected = subtract(selected, cuts);
      stats.bilingualPairs = cuts.length;
      if (cuts.length) warnings.push('已按完整双语配对保留中译，未验证日文与中文语义是否一致；可关闭“优先中文”查看两种原文。');
    }
    const segments = project(text, base, selected);
    if (!segments.some(segment => meaningful(segment.text))) return fallback('提取后正文为空；');
    stats.outputChars = segments.reduce((sum, segment) => sum + segment.text.length, 0);
    stats.removedChars = safeChars - stats.outputChars;
    stats.outputSegments = segments.length; stats.matchCount = budget.matches;
    return {segments, stats, warnings, structuralContext};
  } catch (error) {
    stats.matchCount = budget.matches;
    return fallback(`${error.message}；`);
  }
}
