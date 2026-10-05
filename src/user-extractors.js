// src/user-extractors.js
// 用户可编辑的提取规则模块（独立模块，不依赖 summary-engine）
//
// 设计要点：
//   - include 正则先抓（被命中的部分进入"候选"）
//   - exclude 正则把候选中的子串剥掉（你提到的"反向正则：不提取 <ja>..."）
//   - mode: drop=抓完丢弃（节省注意力）/ keep=保留带权重 / summary=压成摘要块
//   - weight: 权重倍数，最终拼入 prompt 时按权重高低排序
//   - summaryLanguage: 全局开关（'zh-CN' | 'ja'），决定 prompt 用什么语言
//
// 默认针对 SillyTavern v3.4.8 偏航东京预设输出结构

'use strict';

// ===== 默认规则集（v3.4.8 偏航东京专用） =====
// 用户可编辑；按需改 include/exclude/mode/weight/source 即可。

const DEFAULT_USER_EXTRACTORS = {
  // ① 用户输入：直接来自 chat history role=user 的消息，不需要正则
  userInput: {
    id: 'userInput',
    label: '用户输入（来自 chat history）',
    labelJa: 'ユーザー入力（チャット履歴から）',
    source: 'chat-history',          // 特殊：从 chat 数组取 role=user
    enabled: true,
    mode: 'keep',                   // keep = 整段保留进 prompt
    weight: 3.0,                    // ← 最高权重，用户输入优先
    note: 'SillyTavern chat 数组里 role=user 的 content',
    extract: null,                  // null 表示走 source 路径
  },

  // ② AI 回复中的正文 <content>...</content>
  content: {
    id: 'content',
    label: 'AI 正文',
    labelJa: 'AI本文',
    source: 'regex',
    enabled: true,
    mode: 'keep',
    weight: 1.0,
    include: /<content>([\s\S]*?)<\/content>/i,
    exclude: [
      /<ja>[\s\S]*?<\/ja>/g,        // 默认剥掉中日双语里的日文段
    ],
    includeFlags: 'i',
    postProcess: ['trim'],
    note: '默认剥掉 <ja>...</ja>，只留中文；如果要保留日文，关掉此 exclude',
  },

  // ③ 时间
  timeFormat: {
    id: 'timeFormat',
    label: '时间栏',
    labelJa: '時間欄',
    source: 'regex',
    enabled: true,
    mode: 'keep',
    weight: 0.8,
    include: /<time_format>([\s\S]*?)<\/time_format>/i,
    fallback: /时间[：:]\s*([^\n]+)/i,  // 摘要里的"时间："行
    note: '<time_format>...</time_format>，缺则从摘要里抓"时间："',
  },

  // ④ 摘要（详情折叠）
  summary: {
    id: 'summary',
    label: '模型自带摘要',
    labelJa: 'モデル自带要約',
    source: 'regex',
    enabled: true,
    mode: 'keep',
    weight: 0.5,                    // 已经总结过一次，权重低
    include: /<details>\s*<summary>\s*摘要\s*<\/summary>([\s\S]*?)<\/details>/i,
    postProcess: ['stripHtmlTags', 'trim'],
    note: 'v3.4.8 默认输出 <details><summary>摘要</summary>...</details>',
  },

  // ⑤ 思维链（建议默认丢弃）
  thinking: {
    id: 'thinking',
    label: '思维链',
    labelJa: '思考連鎖',
    source: 'regex',
    enabled: true,
    mode: 'drop',                   // ← 默认 drop，不注入
    weight: 0.0,
    include: /<konatan_planning~>([\s\S]*?)<\/konatan_planning~>/i,
    note: '默认丢弃；如需保留作为参考，改 mode 为 keep、weight 0.0',
  },

  // ⑥ UPDATE / 破甲 / 破甲尾部（建议默认丢弃）
  updateTail: {
    id: 'updateTail',
    label: 'UPDATE / 破甲尾部',
    labelJa: 'UPDATE / 破甲末尾',
    source: 'regex',
    enabled: true,
    mode: 'drop',
    weight: 0.0,
    include: [
      /<!--\s*UPDATE[^>]*?-->([\s\S]*?)(?=<!--\s*UPDATE|$)/gi,
      /<破甲[\s\S]*?<\/破甲>/gi,
    ],
    note: '回复尾部某些预设会追加 UPDATE 块；默认丢弃以省注意力',
  },

  // ⑦ <htmlcontent> 界面（保留为内容）
  htmlcontent: {
    id: 'htmlcontent',
    label: 'UI 面板（<htmlcontent>）',
    labelJa: 'UI パネル',
    source: 'regex',
    enabled: true,
    mode: 'keep',
    weight: 0.6,                    // 算内容但比正文低
    include: /<htmlcontent>([\s\S]*?)<\/htmlcontent>/i,
    note: 'v3.4.8 NyPigment 生成的 UI/界面；保留为内容参考',
  },

  // ⑧ <tucao> 吐槽（可选）
  tucao: {
    id: 'tucao',
    label: '吐槽',
    labelJa: 'ツッコミ',
    source: 'regex',
    enabled: false,                 // 默认关闭
    mode: 'keep',
    weight: 0.3,
    include: /<tucao>([\s\S]*?)<\/tucao>/i,
    note: '默认关闭；想保留时打开',
  },

  // ⑨ <options> 选项（可选）
  options: {
    id: 'options',
    label: '选项栏',
    labelJa: '選択肢',
    source: 'regex',
    enabled: false,
    mode: 'keep',
    weight: 0.3,
    include: /<options>([\s\S]*?)<\/options>/i,
    note: '默认关闭',
  },

  // ⑩ <current_event> + <progress> 事件追踪（可选）
  eventTracking: {
    id: 'eventTracking',
    label: '事件追踪（current_event/progress）',
    labelJa: 'イベント追跡',
    source: 'regex',
    enabled: false,
    mode: 'keep',
    weight: 0.4,
    include: [
      /<current_event>([\s\S]*?)<\/current_event>/i,
      /<progress>([\s\S]*?)<\/progress>/i,
    ],
    note: '默认关闭；要保留事件追踪时打开',
  },
};

// ===== 总结提示词的语言（全局开关）=====
const DEFAULT_SUMMARY_LANGUAGE = 'zh-CN';  // 'zh-CN' | 'ja'

// 中/日语言模板
const PROMPT_LABELS = {
  'zh-CN': {
    header: '## 输入内容（按权重排序，权重高的先看）',
    weightMapHeader: '## 权重表（节选自 v3.4.8 输出结构）',
    weights: [
      { name: '用户输入（"引号内"台词）', weight: 3.0 },
      { name: '用户输入（引号外动作/旁白）', weight: 2.0 },
      { name: '用户输入（*内心独白*）', weight: 1.5 },
      { name: 'AI <content> 正文', weight: 1.0 },
      { name: 'AI <htmlcontent> UI', weight: 0.6 },
      { name: 'AI <summary> 摘要', weight: 0.5 },
      { name: 'AI <tucao>/<options>', weight: 0.3 },
      { name: 'AI <konatan_planning~> 思维链', weight: 0.0 },
      { name: 'UPDATE / 破甲尾部', weight: 0.0 },
    ],
    rules: [
      '- 思维链、UPDATE、破甲尾部已剥离，不要再为它们做总结',
      '- 用户（<user>）的直接台词、动作、内心独白是最高优先级的事实来源',
      '- 优先按"用户做了什么 / 说了什么 / 想了什么"组织总结',
      '- AI 复述 / 转述过的内容只作参考，不要当独立事实',
      '- 时间、地点从 time_format / 摘要里抓，没有则记"未指定"',
    ],
    dropLabel: '已丢弃',
  },
  ja: {
    header: '## 入力内容（重み順。重みが高いものを優先）',
    weightMapHeader: '## 重み表（v3.4.8 出力構造より抜粋）',
    weights: [
      { name: 'ユーザー入力（「」内セリフ）', weight: 3.0 },
      { name: 'ユーザー入力（」外アクション/ナレーション）', weight: 2.0 },
      { name: 'ユーザー入力（*心の独白*）', weight: 1.5 },
      { name: 'AI <content> 本文', weight: 1.0 },
      { name: 'AI <htmlcontent> UI', weight: 0.6 },
      { name: 'AI <summary> 要約', weight: 0.5 },
      { name: 'AI <tucao>/<options>', weight: 0.3 },
      { name: 'AI <konatan_planning~> 思考連鎖', weight: 0.0 },
      { name: 'UPDATE / 破甲末尾', weight: 0.0 },
    ],
    rules: [
      '- 思考連鎖、UPDATE、破甲末尾は除去済み。要約しない',
      '- ユーザー（<user>）の直接のセリフ・動作・内心は最優先の事実',
      '- 「ユーザーが何をした/言った/考えたか」を軸に要約',
      '- AI の言い換え・描写は参考のみ、独立事実としない',
      '- 時間・場所は time_format / 要約から取得。無ければ「未指定」',
    ],
    dropLabel: '破棄済',
  },
};

// ===== 核心：应用提取规则到一段 AI 回复 =====

/**
 * 把 chat 数组（user + assistant 交错）按 extractors 拆成"用户段"和"AI 段"
 * 输出：[{ source: 'userInput'|'content'|..., text: '...', weight: 1.0 }]
 */
function applyExtractors(chat, extractors) {
  const rules = { ...DEFAULT_USER_EXTRACTORS, ...(extractors || {}) };
  const out = [];

  for (const msg of chat) {
    if (msg.role === 'user') {
      // ① 用户输入：直接从 chat 数组取
      const r = rules.userInput;
      if (r && r.enabled) {
        out.push({
          source: 'userInput',
          text: String(msg.content || ''),
          weight: r.weight || 1.0,
          mode: r.mode || 'keep',
          floor: msg.floor || null,
        });
      }
    } else if (msg.role === 'assistant') {
      const text = String(msg.content || '');
      // ②–⑩ 对每条 enabled 的 regex 规则应用
      for (const [rid, r] of Object.entries(rules)) {
        if (rid === 'userInput') continue;
        if (!r.enabled) continue;
        if (r.source !== 'regex') continue;
        const includes = Array.isArray(r.include) ? r.include : [r.include];
        for (const re of includes) {
          if (!re) continue;
          const flags = (r.includeFlags || '') + 'g';
          const regex = new RegExp(re.source, flags);
          let m;
          while ((m = regex.exec(text)) !== null) {
            let chunk = m[1] !== undefined ? m[1] : m[0];
            // exclude 阶段
            for (const ex of (r.exclude || [])) {
              chunk = chunk.replace(ex, '');
            }
            // postProcess
            for (const pp of (r.postProcess || [])) {
              chunk = runPostProcess(pp, chunk);
            }
            chunk = chunk.trim();
            if (!chunk) continue;
            out.push({
              source: rid,
              text: chunk,
              weight: r.weight || 1.0,
              mode: r.mode || 'keep',
              floor: msg.floor || null,
            });
          }
        }
      }
    }
  }
  return out;
}

function runPostProcess(name, text) {
  switch (name) {
    case 'trim': return text.trim();
    case 'stripHtmlTags': return text.replace(/<[^>]+>/g, '');
    case 'stripJaTags': return text.replace(/<ja>[\s\S]*?<\/ja>/g, '');
    default: return text;
  }
}

// ===== 核心：按权重拼成最终注入 prompt =====

function buildPromptFromExtracted(extracted, opts = {}) {
  const lang = opts.language || DEFAULT_SUMMARY_LANGUAGE;
  const labels = PROMPT_LABELS[lang] || PROMPT_LABELS['zh-CN'];

  // 1) 拆 dropped / kept
  const kept = extracted.filter(e => e.mode !== 'drop');
  const dropped = extracted.filter(e => e.mode === 'drop');

  // 2) 按 weight 降序
  kept.sort((a, b) => (b.weight || 0) - (a.weight || 0));

  // 3) 按 source 分组（保持权重内有序）
  const bySource = {};
  for (const e of kept) {
    (bySource[e.source] = bySource[e.source] || []).push(e);
  }

  // 4) 拼 header + 权重表
  const lines = [];
  lines.push(labels.header);
  lines.push('');
  lines.push(labels.weightMapHeader);
  for (const w of labels.weights) {
    lines.push(`- ${w.name} = ×${w.weight.toFixed(1)}`);
  }
  lines.push('');

  // 5) 拼接各源
  const sourceOrder = ['userInput', 'content', 'timeFormat', 'summary',
                      'htmlcontent', 'tucao', 'options', 'eventTracking'];
  for (const sid of sourceOrder) {
    const arr = bySource[sid];
    if (!arr || arr.length === 0) continue;
    const ruleLabel = (DEFAULT_USER_EXTRACTORS[sid] || {}).label || sid;
    lines.push(`### [${ruleLabel}] ×${arr[0].weight.toFixed(1)}`);
    lines.push('');
    for (const e of arr) {
      lines.push(e.text);
      lines.push('');
    }
  }

  // 6) 丢弃提示
  if (dropped.length > 0) {
    lines.push('---');
    lines.push(`(${labels.dropLabel}: ${dropped.length} 段 — 思维链 / UPDATE / 破甲尾部)`);
  }

  // 7) 拼接规则
  lines.push('');
  lines.push('## 总结规则');
  for (const r of labels.rules) lines.push(r);

  return lines.join('\n');
}

// ===== 单条 AI 回复的应用（更轻量版，用于单独 inject）=====

function extractSingleAssistantReply(text, extractors) {
  const rules = { ...DEFAULT_USER_EXTRACTORS, ...(extractors || {}) };
  const out = [];
  for (const [rid, r] of Object.entries(rules)) {
    if (rid === 'userInput') continue;
    if (!r.enabled) continue;
    if (r.source !== 'regex') continue;
    const includes = Array.isArray(r.include) ? r.include : [r.include];
    for (const re of includes) {
      if (!re) continue;
      const flags = (r.includeFlags || '') + 'g';
      const regex = new RegExp(re.source, flags);
      let m;
      while ((m = regex.exec(text)) !== null) {
        let chunk = m[1] !== undefined ? m[1] : m[0];
        for (const ex of (r.exclude || [])) chunk = chunk.replace(ex, '');
        for (const pp of (r.postProcess || [])) chunk = runPostProcess(pp, chunk);
        chunk = chunk.trim();
        if (!chunk) continue;
        out.push({ source: rid, text: chunk, weight: r.weight || 1.0, mode: r.mode || 'keep' });
      }
    }
  }
  return out;
}

// ===== 导出 =====

export {
  DEFAULT_USER_EXTRACTORS,
  DEFAULT_SUMMARY_LANGUAGE,
  PROMPT_LABELS,
  applyExtractors,
  buildPromptFromExtracted,
  extractSingleAssistantReply,
};
