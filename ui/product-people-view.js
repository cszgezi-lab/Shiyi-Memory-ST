import { foldName, personaIdentity } from '../src/persona-identity.js';
import { currentPersonaProfiles } from '../src/dynamic-persona.js';
import { recordImportance, recordDescription } from '../src/product-memory.js';
import { characterKeepsakes } from '../src/character-journal.js';
import { characterRecordSubjects, explicitSubjectNames, factKey } from '../src/product-person-profiles.js';
import { sourceLabel, recordTitle, epistemicLabel } from '../src/product-narrative.js';
import { esc } from '../src/product-settings-ui.js';
import {PERSONA_GENDERS,PERSONA_ROLES,personaCasting,personaCastingLabel,personaAttentionWeight,applyPersonaCasting} from '../src/persona-casting.js';
import {markMemoryStates} from '../src/memory-current-state.js';
import {sha256} from '../src/utils.js';

const PAGE_SIZE = 6;
const nameKey = name => foldName(name).trim();
const namesOf = value => explicitSubjectNames(value).filter(n => !/^(我|你|他|她|它|我们|你们|他们|她们|i|you|he|she|they)$/i.test(n));
const preview = (value, limit = 280) => {
  const text = String(value ?? '');
  return esc(text.length > limit ? `${text.slice(0, limit)}…` : text);
};
/** Newest first, using the same floor evidence the rest of the page reports. */
const newestFirst = rows => [...rows].sort((a, b) => floorOf(b) - floorOf(a));
const floorOf = record => Math.max(-1, ...(record?.sourceFloors ?? []).filter(Number.isInteger), Number.isInteger(record?.floorIndex) ? record.floorIndex : -1);

/** Relationship records are evidence-bearing stages, not nineteen simultaneous
 * current relationships. Group only for reading; every source row stays stored,
 * editable and recoverable inside the collapsed history. */
export function relationshipThreads(rows = [], resolve = nameKey) {
  const groups = new Map();
  for (const row of newestFirst(rows)) {
    const endpoints = [row.from ?? row.subject, row.to ?? row.object].filter(v => typeof v === 'string' && v.trim()).map(resolve).filter(Boolean).sort();
    const key = endpoints.length === 2 ? endpoints.join('\u0000') : `record:${row.id}`;
    if (!groups.has(key)) groups.set(key, { key, rows: [] });
    groups.get(key).rows.push(row);
  }
  return [...groups.values()].map(group => ({ ...group, latest: group.rows[0] }));
}

/** A disposable reading projection. No writes, identity merges or new records. */
export function peopleGroups(snapshot = {}) {
  const cards = (snapshot.cards ?? []).filter(c => !['retracted', 'superseded'].includes(c.lifecycleState));
  const profiles = (snapshot.dynamicPersona?.profiles ?? []).filter(p => !p.deleted);
  const dictionary = snapshot.dictionary ?? { entries: [] };
  const settings = snapshot.settings ?? {};
  const keepsakes = characterKeepsakes(cards.flatMap(c => c.mergedParts?.length ? c.mergedParts : [c]), { withExpected: false });
  const terms = [...(dictionary.entries ?? []), ...cards.flatMap(c => c.entities ?? [])];
  const nonPeople = new Set(terms.filter(t => ['地点', '组织', '物品'].includes(t?.kind)).map(t => nameKey(t.name)));
  const definitePeople = new Set([
    ...profiles.map(p => p.name),
    ...terms.filter(t => t?.kind === '人物').map(t => t.name),
    ...cards.filter(c => c.category !== 'entityFactChanges').flatMap(characterRecordSubjects),
    ...keepsakes.diaries.flatMap(r => namesOf(r.subject)),
    ...keepsakes.dialogues.flatMap(r => [...namesOf(r.subject), ...namesOf(r.target)]),
  ].map(nameKey));
  const person = name => !nonPeople.has(nameKey(name)) || definitePeople.has(nameKey(name));
  const recordNames = card => characterRecordSubjects(card).filter(person);
  /** A promise names its participants in one field, and that list is a display
   * grouping only: keeping it out of characterRecordSubjects leaves the recall
   * dossier budget and the open-plan schedule lane exactly as published. */
  const commitmentNames = card => card.category === 'commitmentChanges'
    ? namesOf(card.participants ?? card.subject).filter(person) : [];
  const seedDictionary = { ...dictionary, entries: (dictionary.entries ?? []).filter(t => person(t.name)) };
  const base = personaIdentity({ previous: profiles, dictionary: seedDictionary, aliases: settings.aliases ?? '' });
  // Do not promote a shared nickname to a new canonical identity during seeding.
  const claimed = new Set(base.people.flatMap(p => [p.name, ...p.aliases]).map(nameKey));
  const rawNames = [...new Set([
    ...cards.flatMap(recordNames),
    ...cards.flatMap(commitmentNames),
    ...keepsakes.diaries.flatMap(r => namesOf(r.subject)),
    ...keepsakes.dialogues.flatMap(r => [...namesOf(r.subject), ...namesOf(r.target)]),
  ])];
  const identity = personaIdentity({
    previous: [...profiles, ...rawNames.filter(n => !claimed.has(nameKey(n))).map(name => ({ name, aliases: [], aliasPolicy: 'manual' }))],
    dictionary: seedDictionary, aliases: settings.aliases ?? '',
  });
  const owners = new Map();
  for (const p of identity.people) for (const n of [p.name, ...p.aliases]) {
    const key = nameKey(n);
    if (!owners.has(key)) owners.set(key, new Set());
    owners.get(key).add(p.key);
  }
  const groups = new Map();
  const groupFor = name => {
    const resolved = identity.resolve(name), folded = nameKey(name);
    const ambiguous = !resolved && (owners.get(folded)?.size ?? 0) > 1;
    const key = resolved?.key ?? `unresolved:${folded}`;
    if (!groups.has(key)) groups.set(key, {
      key, name: resolved?.name ?? name, ambiguous,
      aliases: [...(resolved?.visibleAliases ?? [])].filter(a => identity.resolve(a)?.key === resolved.key),
      profiles: [], diaries: [], dialogues: [], facts: [], records: [],
      relationships: [], commitments: [], personaChanges: [],
    });
    return groups.get(key);
  };
  const attach = (names, field, row) => {
    for (const group of new Set(names.map(groupFor))) if (!group[field].includes(row)) group[field].push(row);
  };
  for (const p of profiles) attach(namesOf(p.name), 'profiles', p);
  for (const card of cards) {
    const names = [...new Set([...recordNames(card), ...commitmentNames(card)])];
    attach(names, 'records', card);
    if (card.customModuleId) continue;
    if (card.category === 'entityFactChanges') attach(names, 'facts', card);
    else if (card.category === 'relationshipChanges') attach(names, 'relationships', card);
    else if (card.category === 'commitmentChanges') attach(names, 'commitments', card);
    else if (card.category === 'personaChanges') attach(names, 'personaChanges', card);
  }
  for (const row of keepsakes.diaries) {
    const names = namesOf(row.subject); // An inner-life target does not own this private account.
    attach(names, 'diaries', row);
    attach(names, 'records', row.record);
  }
  for (const row of keepsakes.dialogues) {
    const names = [...namesOf(row.subject), ...namesOf(row.target)];
    attach(names, 'dialogues', row);
    attach(names, 'records', row.record);
  }
  return [...groups.values()].map(group => ({
    ...group,
    casting:applyPersonaCasting({name:group.name,casting:group.profiles[0]?.casting},snapshot.dynamicPersona?.castingOverrides).casting,
    indexWords:(dictionary.entries??[]).find(e=>nameKey(e.name)===nameKey(group.name))?.indexWords??[],
    profileSources: group.profiles,
    profiles: currentPersonaProfiles(group.profiles, settings.dynamicPersonaMvuMode),
    fieldCount: new Set(group.facts.map(factKey).filter(k => k != null)).size,
    relationships: newestFirst(group.relationships),
    relationshipThreads: relationshipThreads(group.relationships, name => identity.resolve(name)?.key ?? nameKey(name)),
    commitments: newestFirst(markMemoryStates(group.commitments,{dictionary})),
    personaChanges: newestFirst(group.personaChanges),
  })).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

export function peopleHTML() {
  return `<section data-view="people" hidden class="sy-people">
    <div class="sy-top"><h3>人物</h3><span data-people-count class="sy-help" role="status"></span></div>
    <div class="sy-people-wrap">
      <div class="sy-person-strip" data-people-strip role="tablist" aria-label="选择人物">
        <input type="search" data-people-search placeholder="搜角色" aria-label="查找人物" autocomplete="off">
      </div>
      <article data-people-detail class="sy-people-reading" aria-label="人物阅读区"></article>
    </div>
  </section>`;
}

/** A dossier route is only safe once the name belongs to exactly one person. */
const openButton = (group, kind, label, profileId = '') => {
  const disabled = Boolean(group?.ambiguous) && !profileId;
  return `<button type="button" data-people-open="${kind}" data-people-profile="${esc(profileId)}"${disabled ? ' disabled' : ''}>${label}</button>`;
};
const sourceText = record => record.sourceRefs?.length || record.sourceFloors?.length || Number.isInteger(record.floorIndex) || record.documentName
  ? sourceLabel(record) : '来源未注明';
const phase = row => row.data.disabled ? '不再注入' : row.record.innerLifeHistorical || row.data.status === 'historical'
  ? '过去阶段' : row.kind === 'dialogue' ? '仍重要' : '按记录情境适用';

const peopleMergeHTML = (profiles, pendingName = '') => {
  if (profiles.length < 2) return '';
  const ordered = [...profiles].sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name, 'zh-CN'));
  const source = ordered[0], target = [...ordered].sort((a, b) => b.name.length - a.name.length || a.name.localeCompare(b.name, 'zh-CN'))[0];
  const options = rows => rows.map(p => `<option value="${esc(p.id)}">${esc(p.name)}${p.bindings?.length ? ' · 已关联原书' : ''}</option>`).join('');
  return `<details class="sy-people-merge" data-people-merge>
    <summary>合并重复人物档案</summary>
    ${pendingName ? `<p class="sy-help">注意：“${esc(pendingName)}”目前是待确认称呼，不是独立档案，所以不会出现在下面的档案列表。请先在上方“确认归入此人物”；只有两份正式档案都存在时，才使用这里的合并。</p>` : ''}
    <p class="sy-help">合并只在需要时展开，平时不占位置。适合“濑名紫阳花／紫阳花”这类重复档案：选择要并入的档案和要保留正式姓名的档案；动态档案内容、属性、心迹、台词、来源与别称会合并，不调用模型，原档案可恢复。原始记录本身仍保留来源，不会被改写成一条混合文本。</p>
    <label>并入档案<select data-people-merge-source-select aria-label="要并入的人物档案">${options(ordered)}</select></label>
    <label>保留档案<select data-people-merge-target-select aria-label="要保留的人物档案">${options(ordered.filter(p => p.id !== source.id))}</select></label>
    <button type="button" data-people-merge-commit>确认合并档案</button>
  </details>`;
};

const personaBindHTML = (group, profiles, people=[]) => {
  if (!group || !group.ambiguous && group.profiles.length) return '';
  const memoryPeople=people.filter(p=>!p.ambiguous&&!p.profiles.length&&p.key!==group.key);
  if(!profiles.length&&!memoryPeople.length)return '';
  const ordered = [...profiles]
    .sort((a, b) => b.name.length - a.name.length || a.name.localeCompare(b.name, 'zh-CN'))
  const foldedName = nameKey(group.name);
  const likely = ordered.filter(p => nameKey(p.name).includes(foldedName));
  const options = ordered
    .map(p => `<option value="${esc(p.id)}"${likely.length === 1 && likely[0].id === p.id ? ' selected' : ''}>${esc(p.name)}${p.bindings?.length ? ' · 已关联原书' : ''}</option>`)
    .join('')+memoryPeople.map(p=>`<option value="person:${esc(p.key)}">${esc(p.name)} · 记忆人物</option>`).join('');
  return `<details open class="sy-people-persona-bind" data-people-persona-bind>
    <summary>把“${esc(group.name)}”归入已有${memoryPeople.length?'人物':'动态人设'}</summary>
    <p class="sy-help">${group.ambiguous?'这个称呼目前对应多人，系统不会擅自猜测归属。':'这个名字来自记忆记录，尚未关联动态档案；若是已有角色的简称，可在这里确认归属。'}选择正确的人物后，若称呼已有正式档案会直接合并；否则保存为目标档案的手工别称。当前称呼下已有的心迹、台词、属性会随身份归属统一显示。不调用模型、不改原文、不改原世界书；合并仍保留可恢复版本。</p>
    <label>归入档案<select data-people-persona-bind-target aria-label="把称呼归入人物档案">${options}</select></label>
    <button type="button" data-people-persona-bind-commit>确认归入所选人物</button>
  </details>`;
};

const peopleStars = (record, category) => {
  if (!record) return '';
  const n = recordImportance({ ...record, category: record.category ?? category });
  return `<span class="sy-stars sy-lv${n}" aria-label="重要度 ${n}/5">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</span> `;
};
const keepField = (key, label, value = '', multi = false, placeholder = '') => `<label class="sy-field"><span>${esc(label)}</span>${multi
  ? `<textarea rows="4" data-keep-field="${key}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
  : `<input data-keep-field="${key}" value="${esc(value)}" placeholder="${esc(placeholder)}">`}</label>`;
/** Inline editors, one per record kind, so a person entry is edited where it is
 * read. Diary and dialogue text live inside innerLife/keyDialogues, so they go
 * through the keepsake writer instead of overwriting the whole record body. */
export function personEntryEditor(row, kind) {
  if (kind === 'diary') {
    const d = row.data;
    return `<section class="sy-card sy-person-entry-editor" data-person-editor="${esc(row.id)}" data-editor-kind="diary">
      ${keepField('stage', '阶段名称', d.stage ?? '', false, '例如：初识 / 争执后')}
      ${keepField('text', '角色心迹（角色视角）', d.text ?? '', true, '用角色的语气写这一阶段的内心，例如：我还是不敢直接问。')}
      ${keepField('cause', '变化缘由（可留空）', d.cause ?? '', true, '哪件事促成的，例如：他在雨里把外套给了我。')}
      <p class="sy-help">只改这一条心迹，不动事件和其它记录。</p>
      <div class="sy-actions"><button type="button" class="sy-primary" data-person-keep-save="${esc(row.id)}">保存心迹</button><button type="button" data-person-editor-close>取消</button></div>
    </section>`;
  }
  if (kind === 'dialogue') {
    const d = row.data;
    return `<section class="sy-card sy-person-entry-editor" data-person-editor="${esc(row.id)}" data-editor-kind="dialogue">
      ${keepField('speaker', '说话人', d.speaker ?? '', false, '例如：濑名紫阳花')}
      ${keepField('to', '对谁说（可留空）', d.to ?? '', false, '例如：甘织玲奈子')}
      ${keepField('text', '台词原话', d.text ?? '', true, '逐字照抄原文，不要改写。')}
      ${keepField('context', '当时语境与对方回应（可留空）', d.context ?? '', true, '什么时候、因为什么说的，对方怎么回。')}
      ${keepField('meaning', '重要之处（可留空）', d.meaning ?? '', true, '例如：第一次明确说出边界。')}
      <div class="sy-actions"><button type="button" class="sy-primary" data-person-keep-save="${esc(row.id)}">保存台词</button><button type="button" data-person-editor-close>取消</button></div>
    </section>`;
  }
  return '';
}
/** One field row: the whole line opens it, the content opens the editor. */
export function personFieldRow({ label, value, source, category, id, clamp = 1 }) {
  const text = String(value ?? '');
  return `<div class="sy-field-row" data-field-row data-clamp="${clamp}" data-field-category="${esc(category)}" data-field-id="${esc(id ?? '')}">
    <div class="sy-field-sum" data-people-edit="${esc(id ?? '')}"><span>${esc(label)}</span><span class="sy-field-value">${preview(text, 600)}</span><span class="sy-field-caret">›</span></div>
    <div class="sy-field-open" hidden>
      <div class="sy-field-body" role="button" tabindex="0"><div class="sy-field-full">${preview(text, 4000)}</div></div>
      <p class="sy-field-src">${esc(source || '来源未注明')}</p>
      <div class="sy-field-bar"><button type="button" data-field-edit>修改</button><button type="button" class="sy-row-remove" data-field-remove>删除</button></div>
    </div>
  </div>`;
}
const fieldGroup = (title, count, rows, empty, { category = '', add = '' } = {}) => `<section class="sy-field-group" data-people-module="${esc(category)}">
  <header><span>${esc(title)} <small>${count}</small></span>${add ? `<button type="button" data-people-add="${esc(add)}">新增</button>` : ''}</header>
  ${rows || `<p class="sy-help">${esc(empty)}</p>`}
</section>`;
export function peopleDetailHTML(group, allProfiles = group?.profiles ?? [], editing = '',allPeople=[]) {
  if (!group) return '<p class="sy-person-empty">还没有人物。整理一段聊天后会自动出现，也可以直接新建一个角色。</p>';
  const profileId = group.profiles[0]?.id ?? '';
  const profile=group.profiles[0];
  const reviewRows=(profile?.reviewSuggestions??[]).map(s=>`<div class="sy-card"><div class="sy-packet">${esc(profile.composition?.parts?.find(p=>p.key===s.key)?.text??'片段已变化')}</div><p>${esc(s.reason)}</p><p class="sy-help">第${esc(s.evidence.floor)}楼依据：${esc(s.evidence.quote)}</p><button type="button" data-persona-history="${esc(s.key)}" data-profile="${esc(profile.id)}" data-history-value="true">确认移入历史（不删除）</button></div>`).join('');
  const archived=(profile?.composition?.parts??[]).filter(p=>p.status==='historical').map(p=>`<div class="sy-card"><div class="sy-packet">${esc(p.text)}</div><button type="button" data-persona-history="${esc(p.key)}" data-profile="${esc(profile.id)}" data-history-value="false">恢复当前设定</button></div>`).join('');
  const casting=personaCasting(group.casting??group.profiles[0]?.casting);
  const emphasis=profile?.userDirectives??[];
  const emphasisHTML=profileId?`<details data-people-emphasis="${esc(profileId)}"><summary>强调 · ${emphasis.length ? `${emphasis.length} 条` : '未设置'}</summary><p class="sy-help">单独保存，不会被自动总结改掉。每次发消息时放在人物档案开头和结尾，并在你的消息前再送一次。一行一句，删掉某一行就是删除这条。</p><label>强调内容<textarea rows="4" data-emphasis-lines>${esc(emphasis.join('\n'))}</textarea></label><label>或者用大白话告诉模型要记住、修改或删掉什么<textarea rows="3" data-emphasis-ask placeholder="例如：对某个人现在按你写的方式相处。已有的句子会保留，除非你说明要改或删。"></textarea></label><div class="sy-actions"><button type="button" data-emphasis-draft>让模型整理</button><button type="button" data-emphasis-save>保存强调</button></div><p class="sy-help">「让模型整理」会用人设接口调用一次模型，结果只填进上面的框，保存后才生效。</p></details>`:'';
  const options=(values,current)=>Object.entries(values).map(([value,label])=>`<option value="${value}"${value===current?' selected':''}>${label}</option>`).join('');
  const profileRows = group.profiles.slice(0, 2).map(p => personFieldRow({
    label: p.locked ? '整份档案 · 已锁定' : `整份档案 · ${Number.isInteger(p.through) ? `依据至 #${p.through}` : '已保存'}`,
    value: p.text, source: `${sourceText(p)}${[...new Map((p.bindings ?? []).map(b => [JSON.stringify([b.book, b.uid]), b])).values()].slice(0, 4).map(b => `${b.book} · ${b.originalName ?? b.name}（原书只读）`).join(' · ')}`, category: 'dynamic-persona', id: p.id, clamp: 3,
  })).join('') || `<p class="sy-help">还没有动态人设档案。${openButton(group, 'dynamic-persona', '补建档案', profileId)}</p>`;  const factRows = group.facts.map(record => personFieldRow({
    label: `${factKey(record) ?? '属性'}`, value: recordDescription(record).replace(/^[^：]*：/, ''),
    source: sourceText(record), category: 'entityFactChanges', id: record.id, clamp: 1,
  })).join('');
  const personRows = (rows, category) => rows.map(record => personFieldRow({
    label: recordTitle(record), value: recordDescription(record), source: sourceText(record), category, id: record.id, clamp: 3,
  })).join('');
  const relationThreads = group.relationshipThreads ?? relationshipThreads(group.relationships ?? []);
  const currentCommitments=(group.commitments??[]).filter(r=>!r.stateHistorical&&!['completed','canceled','declined'].includes(r.state));
  const closedCommitments=(group.commitments??[]).filter(r=>!r.stateHistorical&&['completed','canceled','declined'].includes(r.state));
  const commitmentRow=r=>`${personRows([r],'commitmentChanges')}${r.stateHistoryIds?.length?`<details class="sy-state-history"><summary>前序状态与重复依据 ${r.stateHistoryIds.length} 条</summary>${personRows(group.commitments.filter(p=>r.stateHistoryIds.includes(p.id)),'commitmentChanges')}</details>`:''}`;
  const commitmentRows=currentCommitments.map(commitmentRow).join('')+(closedCommitments.length?`<details class="sy-closed-commitments"><summary>已完成／取消／拒绝 ${closedCommitments.length} 项</summary>${closedCommitments.map(commitmentRow).join('')}</details>`:'');
  const relationshipRows = relationThreads.map(thread => {
    const current = [...thread.rows.slice(0,3)].reverse().map(r=>`<p class="sy-help">${esc(sourceText(r))}</p>${personRows([r], 'relationshipChanges')}`).join('');
    const older = thread.rows.slice(3);
    return `${current}${older.length ? `<details class="sy-relationship-history"><summary>过往 ${older.length} 条关系变化（保留来源，可逐条修改）</summary>${personRows(older, 'relationshipChanges')}</details>` : ''}`;
  }).join('');
  const diaryRows = group.diaries.slice(0, 3).map(r => `${personFieldRow({
    label: `${r.data.stage ?? '未注明阶段'} · ${r.record.innerLifeHistorical || r.data.status === 'historical' ? '过去阶段' : '按记录情境适用'}`,
    value: r.data.text,
    source: `${sourceText(r.record)} · ${epistemicLabel(r.data.basis) ?? '依据未注明'}${r.data.disabled ? ' · 不再注入' : ''}`, category: 'diary', id: r.id, clamp: 3,
  })}${editing === r.id ? personEntryEditor(r, 'diary') : ''}`).join('');
  const dialogueRows = group.dialogues.slice(0, 3).map(r => `${personFieldRow({
    label: `${r.subject}${r.target ? ` → ${r.target}` : ''} · ${phase(r)}`,
    value: r.data.text,
    source: `${sourceText(r.record)}${r.data.provenance === 'user_authored' ? ' · 用户编写，非核对原话' : ''}`, category: 'dialogue', id: r.id, clamp: 3,
  })}${editing === r.id ? personEntryEditor(r, 'dialogue') : ''}`).join('');
  const stats = `${group.fieldCount} 项属性 · 关系 ${relationThreads.length} 组${(group.relationships?.length ?? 0) > relationThreads.length ? `（${group.relationships.length} 条历程）` : ''} · 约定 ${currentCommitments.length} 项 · 人设变化 ${group.personaChanges?.length ?? 0} · 心迹 ${group.diaries.length} · 台词 ${group.dialogues.length}`;
  return `<div class="sy-person-head">
      <h4 data-people-title tabindex="-1">${esc(group.name)}</h4>
      ${!group.ambiguous?`<details data-people-casting="${esc(profileId||group.name)}"><summary><span class="sy-casting-badge sy-casting-${casting.role}">${esc(personaCastingLabel(casting))}</span> · 调整定位</summary><div class="sy-grid"><label>性别<select data-casting-gender>${options(PERSONA_GENDERS,casting.gender)}</select></label><label>剧情定位<select data-casting-role>${options(PERSONA_ROLES,casting.role)}</select></label></div><label><input type="checkbox" data-casting-player${casting.playerControlled?' checked':''}>由玩家扮演（降低补充材料份额）</label><p class="sy-help">当前记录关注权重 ${personaAttentionWeight(casting)}：主角4、重要配角3、配角2、客串1；玩家角色1。影响主更新检查顺序与补充材料份额，不漏掉低权重人物的重大变化；性别不影响权重。</p><button type="button" data-casting-save>保存定位</button></details>`:''}
      ${emphasisHTML}
      <p class="sy-help">${group.aliases.length ? `别称：${esc(group.aliases.join('、'))} · ` : ''}${esc(stats)}</p>
      <div class="sy-actions sy-person-bar"><button type="button" data-people-rename>改名</button><button type="button" data-people-merge-open>合并档案</button><button type="button" class="danger" data-people-remove>删除</button></div>
    </div>
    ${group.ambiguous ? '<p class="sy-help" role="status">此称呼对应多人，暂不归入任何人的档案。请从全部记录核对姓名或在召回字典中确认别称。</p>' : ''}
    ${personaBindHTML(group, allProfiles,allPeople)}
    ${reviewRows||archived?`<details class="sy-card"><summary>人设整理建议与历史</summary>${reviewRows}${archived?`<details><summary>已移入历史</summary>${archived}</details>`:''}</details>`:''}
    ${peopleMergeHTML(allProfiles, group.ambiguous ? group.name : '')}
    ${fieldGroup('人物属性', group.fieldCount, factRows, '还没有属性记录。', { category: 'entityFactChanges', add: 'attribute' })}
    <div class="sy-persona-block" data-people-persona-block>
      ${profile?.composition?.changeCheck?`<p class="sy-help" data-persona-change-check>${esc(['changed','unchanged'].includes(profile.composition.changeCheck.status)?'本批变化结构核对已完成（不代表模型语义已人工验收）':'本批变化仍待核对：'+(profile.composition.changeCheck.issues??[]).join('；'))}</p>`:''}
      ${fieldGroup('动态人设', group.profiles.length, profileRows, '还没有动态人设档案。', { category: 'dynamic-persona' })}
    </div>
    ${fieldGroup('关系', relationThreads.length, relationshipRows, '还没有关系记录。', { category: 'relationshipChanges', add: 'relationship' })}
    ${fieldGroup('约定', currentCommitments.length, commitmentRows, '还没有约定。', { category: 'commitmentChanges', add: 'commitment' })}
    ${fieldGroup('人设变化', group.personaChanges?.length ?? 0, personRows(group.personaChanges ?? [], 'personaChanges'), '还没有人设变化。', { category: 'personaChanges', add: 'persona' })}
    ${fieldGroup('角色心迹', group.diaries.length, diaryRows, '还没有心迹。', { category: 'diary' })}
    ${fieldGroup('关键台词', group.dialogues.length, dialogueRows, '还没有关键台词。', { category: 'dialogue' })}
    <div class="sy-actions"><button type="button" data-people-open="facts" data-people-profile="${esc(profileId)}"${group.ambiguous && !profileId ? ' disabled' : ''}>全部属性</button><button type="button" data-people-open="dynamic-persona" data-people-profile="${esc(profileId)}"${group.ambiguous && !profileId ? ' disabled' : ''}>全部档案</button><button type="button" data-people-open="diary" data-people-profile="${esc(profileId)}"${group.ambiguous && !profileId ? ' disabled' : ''}>全部心迹</button><button type="button" data-people-open="dialogue" data-people-profile="${esc(profileId)}"${group.ambiguous && !profileId ? ' disabled' : ''}>全部台词</button></div>`;
}

/** onSelect owns filtered navigation; an empty name clears that page's filter. */
export function mountPeopleView({ panel, app, run, host, setPage, onSelect }) {
  const root = panel.querySelector?.('[data-view="people"]');
  if (!root) return { paint(){}, focus(){}, select(){} };
  const $ = selector => root.querySelector?.(selector);
  let scope, stamp = '', rendered = '', renderedPerson='', groups = [], selected = '', editing = '', stripStamp = '', query = '', composing = false, sourceCards = [];
  const origins = row => (row.origins?.length ? row.origins : [row]).map(origin => {
    const record=sourceCards.flatMap(c=>c.mergedParts?.length?c.mergedParts:[c]).find(c=>c.id===origin.recordId);
    if(!record)throw new Error('来源记忆已变化，请刷新人物页');
    return {...origin,expected:sha256(record)};
  });
  const filter = () => {
    const needle = nameKey(query);
    return groups.filter(g => [g.name, ...g.aliases].some(n => nameKey(n).includes(needle)));
  };
  function draw(rebuildStrip = true) {
    if (composing) return;
    const visible = filter();
    if (!visible.some(g => g.key === selected)) selected = visible[0]?.key ?? '';
    const group = visible.find(g => g.key === selected);
    $('[data-people-count]').textContent = `${groups.length} 位人物`;
    const strip = $('[data-people-strip]');
    const searchMarkup = `<input type="search" data-people-search placeholder="搜角色" aria-label="查找人物" autocomplete="off" value="${esc(query)}">`;
    const tabsMarkup = visible.map(g => `<button type="button" role="tab" data-people-key="${esc(g.key)}" aria-pressed="${g.key === selected}" title="${esc(g.name)}">${esc(g.name)}</button>`).join('')
      + '<button type="button" data-people-add="person">新角色</button>'
      + (visible.length ? '' : '<small>没有匹配的角色</small>');
    const stripMarkup = searchMarkup + tabsMarkup;
    if (strip && rebuildStrip && stripStamp !== stripMarkup) {
      const left=strip.scrollLeft??0;
      stripStamp = stripMarkup;
      if (typeof strip.insertAdjacentHTML === 'function' && typeof strip.querySelectorAll === 'function') {
        // Keep the browser's input node, selection and IME session intact.
        const search = $('[data-people-search]');
        if (search) { if (search.value !== query) search.value = query; }
        else strip.insertAdjacentHTML('afterbegin', searchMarkup);
        for (const node of [...strip.querySelectorAll('button,small')]) node.remove();
        strip.insertAdjacentHTML('beforeend', tabsMarkup);
      } else strip.innerHTML = stripMarkup;
      strip.scrollLeft=left;
    }
    const allProfiles = groups.flatMap(g => g.profiles);
    const detail = !group && groups.length ? '<p class="sy-empty">没有匹配的人物，试试其他姓名或别称。</p>' : peopleDetailHTML(group, allProfiles, editing,groups);
    if (detail !== rendered) {
      const node=$('[data-people-detail]'),samePerson=renderedPerson===selected;
      const opened=samePerson?[...(node.querySelectorAll?.('details')??[])].map((d,i)=>d.open?i:-1).filter(i=>i>=0):[];
      const scroll=[];
      if(samePerson)for(let parent=node;parent;parent=parent.parentElement)scroll.push([parent,parent.scrollTop??0,parent.scrollLeft??0]);
      node.innerHTML = detail;
      for(const [i,d] of [...(node.querySelectorAll?.('details')??[])].entries())if(opened.includes(i))d.open=true;
      for(const [parent,top,left] of scroll){parent.scrollTop=top;parent.scrollLeft=left;}
      rendered = detail;renderedPerson=selected;
    }
  }
  /** 「新增」只跳到记忆页的同一个编辑器，不在这里再造第二份表单。 */
  function addFor(kind, button) {
    const group = groups.find(g => g.key === selected);
    if (!group) return;
    const category = { attribute: 'entityFactChanges', relationship: 'relationshipChanges', commitment: 'commitmentChanges', persona: 'personaChanges' }[kind] ?? 'entityFactChanges';
    setPage?.('memory');
    const editor = panel.querySelector('[data-note-category]');
    if (editor) {
      editor.value = category;
      editor.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const subject = panel.querySelector('[data-note-subject]');
    if (subject) subject.value = group.name;
    panel.querySelector('[data-note]')?.focus({ preventScroll: true });
    void button;
  }
  function paint(snapshot) {    if (root.hidden) return;
    const nextScope = JSON.stringify(snapshot.scope ?? snapshot.core?.scope ?? app?.core?.state?.scope ?? null);
    if (scope !== nextScope) {
      scope = nextScope; selected = ''; stamp = ''; rendered = ''; renderedPerson='';editing = ''; stripStamp = ''; query = ''; composing = false;
    }
    const revision = snapshot.peopleRevision;
    const nextStamp = revision != null ? `revision:${revision}`
      : `legacy:${JSON.stringify([snapshot.cardRevision ?? snapshot.cards, snapshot.dynamicPersona?.profiles, snapshot.dictionary, snapshot.settings?.aliases, snapshot.settings?.dynamicPersonaMvuMode])}`;
    if (stamp === nextStamp) return;
    sourceCards = snapshot.cards ?? []; groups = peopleGroups(snapshot); stamp = nextStamp; draw();
  }
  /** 第一次点这一行：展开全文。展开之后点这一行的文字：进编辑。 */
  function openFieldEditor(row) {
    const id = row?.dataset.fieldId ?? '';
    const category = row?.dataset.fieldCategory ?? '';
    if (!id) return;
    if (category === 'diary' || category === 'dialogue') { editing = id; rendered = ''; draw(); return; }
    setPage?.('memory');
    panel.dispatchEvent(new CustomEvent('shiyi-edit-memory', { detail: id, bubbles: false }));
  }
  root.addEventListener('click', event => {
    if (event.target.closest?.('button')) return;
    const summary = event.target.closest?.('.sy-field-sum');
    if (!summary) return;
    const row = summary.closest('[data-field-row]');
    const open = row?.querySelector('.sy-field-open');
    if (!row || !open) return;
    if (row.dataset.open !== '1') { row.dataset.open = '1'; open.hidden = false; return; }
    openFieldEditor(row);
  });
  root.addEventListener('compositionstart', event => {
    if (event.target.closest?.('[data-people-search]')) composing = true;
  });
  root.addEventListener('compositionend', event => {
    if (!event.target.closest?.('[data-people-search]')) return;
    composing = false;
    query = String(event.target.value ?? '');
    draw();
  });
  // Filter after IME commits; never replace or refocus the composing input.
  root.addEventListener('input', event => {
    if (!event.target.closest?.('[data-people-search]')) return;
    if (composing || event.isComposing) return;
    query = String(event.target.value ?? '');
    draw(true);
  });
  root.addEventListener('change', event => {
    const select = event.target.closest('[data-people-merge-source-select]');
    if (!select) return;
    const target = root.querySelector('[data-people-merge-target-select]');
    if (!target) return;
    const allProfiles = groups.flatMap(g => g.profiles);
    target.innerHTML = allProfiles.filter(p => p.id !== select.value).sort((a, b) => b.name.length - a.name.length || a.name.localeCompare(b.name, 'zh-CN')).map(p => `<option value="${esc(p.id)}">${esc(p.name)}${p.bindings?.length ? ' · 已关联原书' : ''}</option>`).join('');
  });
  root.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    if(button.hasAttribute('data-persona-history')){void run(()=>app.setDynamicPersonaPartHistorical(button.dataset.profile,button.dataset.personaHistory,button.dataset.historyValue==='true'),{name:'dynamic-persona',button});return;}
    if(button.hasAttribute('data-emphasis-save')||button.hasAttribute('data-emphasis-draft')){
      const box=button.closest('[data-people-emphasis]');if(!box)return;
      const id=box.dataset.peopleEmphasis,lines=box.querySelector('[data-emphasis-lines]');
      if(button.hasAttribute('data-emphasis-save'))void run(()=>app.editDynamicPersona(id,{userDirectives:lines.value.split(/\n/u)}),{name:'dynamic-persona',button});
      else void run(async()=>{const result=await app.draftDynamicPersonaDirectives(id,box.querySelector('[data-emphasis-ask]').value);lines.value=result.directives.join('\n');},{name:'dynamic-persona',button});
      return;
    }
    if(button.hasAttribute('data-casting-save')){
      const box=button.closest('[data-people-casting]');
      const group=groups.find(g=>g.key===selected);
      if(box&&group&&!group.ambiguous)void run(()=>app.setPersonCasting(group.name,{gender:box.querySelector('[data-casting-gender]').value,role:box.querySelector('[data-casting-role]').value,playerControlled:box.querySelector('[data-casting-player]').checked}),{name:'dynamic-persona',button});
      return;
    }
    if (button.hasAttribute('data-people-key')) {
      selected = button.dataset.peopleKey; draw();
      const title = $('[data-people-title]');
      title?.focus({ preventScroll: true });
      title?.scrollIntoView({ block: 'start', behavior: 'instant' });
      return;
    }
    // 字段行：第一次点整行展开，展开后点内容或「修改」才进编辑。
    if (button.dataset.peopleAdd) { addFor(button.dataset.peopleAdd, button); return; }
    if (button.hasAttribute('data-people-merge-open')) {
      const group=groups.find(g=>g.key===selected);
      const box = root.querySelector(!group?.profiles.length?'[data-people-persona-bind]':'[data-people-merge]');
      if (box) { box.open = !box.open; box.scrollIntoView({ block: 'nearest' }); }
      return;
    }
    if (button.hasAttribute('data-people-remove')) {
      const group = groups.find(g => g.key === selected);
      if (!group) return;
      void run(async () => {
        const ids = [...new Set([...group.facts, ...group.relationships, ...group.commitments, ...group.personaChanges].map(r=>r.id))];
        const keepsakes=[...group.diaries,...group.dialogues].flatMap(row=>origins(row).filter(o=>!ids.includes(o.recordId)).map(o=>({...o,kind:row.kind})));
        // Freeze the original indices and revisions BEFORE awaiting confirmation.
        // Repainting while the dialog is open must not bless old indices with new hashes.
        const deletion={scopeKey:scope,records:ids.map(id=>({id,expected:sha256(sourceCards.find(c=>c.id===id))})),keepsakes,
          profiles:(group.profileSources??group.profiles).map(p=>({id:p.id,expected:sha256(p)}))};
        if (await host.confirm?.(`删除“${group.name}”显示的关联记录与动态档案？记忆可从回收站恢复，动态档案保留旧版；心迹和台词仅移除对应字段，不删除整篇共享事件。聊天原文与原世界书不改。`) !== true) return {message:'已取消删除，人物记录保留。',level:'info'};
        const result=await app.deletePerson(deletion);
        stamp='';rendered='';
        return result;
      }, { name: 'deletePerson', button });
      return;
    }
    if (button.dataset.peopleEdit) {
      // Read from the cached projection: the reading view never rescans cards.
      const id = button.dataset.peopleEdit;
      const all = groups.flatMap(g => [...g.relationships, ...g.commitments, ...g.personaChanges, ...g.facts]);
      const record = all.find(r => r.id === id);
      const diary = groups.flatMap(g => g.diaries).find(r => r.id === id);
      const dialogue = groups.flatMap(g => g.dialogues).find(r => r.id === id);
      if (!record && !diary && !dialogue) return;
      // Diary and dialogue text lives in innerLife/keyDialogues, so those two
      // open an inline editor; everything else opens the one record editor.
      if (diary || dialogue) { editing = editing === id ? '' : id; rendered = ''; draw(); return; }
      setPage?.('memory');
      panel.dispatchEvent(new CustomEvent('shiyi-edit-memory', { detail: id, bubbles: false }));
      return;
    }
    // 一次点击展开，展开后点内容或「修改」进编辑；「删除」把这条移入回收站。
    if (button.hasAttribute('data-field-remove')) {
      const field = button.closest('[data-field-row]'),id=field?.dataset.fieldId??'',category=field?.dataset.fieldCategory;
      if(id)void run(async()=>{
        if(category==='dynamic-persona')return app.editDynamicPersona(id,{deleted:true});
        if(category==='diary'||category==='dialogue'){
          const row=groups.flatMap(g=>category==='diary'?g.diaries:g.dialogues).find(r=>r.id===id);
          if(!row)throw new Error('角色记录已变化，请刷新后重试');
          return app.saveCharacterKeepsake({kind:category,origins:origins(row),remove:true});
        }
        return app.deleteRecords([id]);
      }, { name: 'deleteRecord', button });
      return;
    }
    if (button.hasAttribute('data-field-edit')) {
      const row = button.closest('[data-field-row]');
      const id = row?.dataset.fieldId ?? '';
      const category = row?.dataset.fieldCategory ?? '';
      if (!id) return;
      if (category === 'diary' || category === 'dialogue') { editing = id; rendered = ''; draw(); return; }
      setPage?.('memory');
      panel.dispatchEvent(new CustomEvent('shiyi-edit-memory', { detail: id, bubbles: false }));
      return;
    }
    if (button.hasAttribute('data-person-editor-close')) { editing = ''; rendered = ''; draw(); return; }
    if (button.dataset.personKeepSave) {
      const id = button.dataset.personKeepSave;
      const diary = groups.flatMap(g => g.diaries).find(r => r.id === id);
      const dialogue = groups.flatMap(g => g.dialogues).find(r => r.id === id);
      const row = diary ?? dialogue;
      const box = root.querySelector(`[data-person-editor="${id}"]`);
      if (!row || !box) return;
      const data = { ...row.data };
      for (const field of box.querySelectorAll('[data-keep-field]')) data[field.dataset.keepField] = field.value;
      void run(() => app.saveCharacterKeepsake({ kind: diary ? 'diary' : 'dialogue', origins: origins(row), data }), { name: 'journal-write', button })
        .then(() => { editing = ''; rendered = ''; });
      return;
    }
    if (button.hasAttribute('data-people-rename')) {
      const group = groups.find(g => g.key === selected);
      if (!group || group.ambiguous) return;
      void run(async () => {
        const next = await host.prompt?.('改成什么名字？旧名会保留为别称，已有记录仍归到这个角色。', group.name);
        const name = String(next ?? '').trim();
        if (!name || name === group.name) return;
        const profile = group.profiles[0];
        if (profile?.id) await app.editDynamicPersona?.(profile.id, { name, aliases: [...new Set([...(profile.aliases ?? []), group.name])] });
        await app.saveDictionaryEntry?.({ name, aliases: [group.name], indexWords: [] });
        rendered = '';
      }, { name: 'save-dictionary-entry', button });
      return;
    }
    if (button.dataset.peoplePageLink) { setPage?.(button.dataset.peoplePageLink); return; }
    if (button.dataset.peopleAll) { onSelect?.({ name: '', profileId: null, kind: button.dataset.peopleAll }); return; }
    if (button.hasAttribute('data-people-persona-bind-commit')) {
      const group = groups.find(g => g.key === selected);
      const targetId = root.querySelector('[data-people-persona-bind-target]')?.value;
      const profiles = groups.flatMap(g => g.profiles);
      const memoryTarget=String(targetId??'').startsWith('person:')?groups.find(g=>g.key===targetId.slice(7)&&!g.ambiguous&&!g.profiles.length):null;
      const target = profiles.find(p => p.id === targetId)??memoryTarget;
      if (!group || !group.ambiguous && group.profiles.length || !group.name || !target) return;
      void run(async () => {
        if (await host.confirm?.(`将称呼“${group.name}”归入“${target.name}”？若已有同名正式档案会一并合并；原文、原世界书和来源记录不改。`) !== true) return;
        if(memoryTarget)return app.saveDictionaryEntry({name:target.name,aliases:[...new Set([...target.aliases,group.name,...group.aliases])],indexWords:target.indexWords});
        return app.bindDynamicPersona?.(group.name, target.id)
          ?? app.editDynamicPersona(target.id, { aliases: [...(target.aliases ?? []), group.name] });
      }, { name: 'dynamic-persona', button });
      return;
    }
    if (button.hasAttribute('data-people-merge-commit')) {
      const source = root.querySelector('[data-people-merge-source-select]')?.value;
      const target = root.querySelector('[data-people-merge-target-select]')?.value;
      const profiles = groups.flatMap(g => g.profiles), sourceProfile = profiles.find(p => p.id === source), targetProfile = profiles.find(p => p.id === target);
      if (!sourceProfile || !targetProfile || source === target) return;
      void run(async () => {
        if (await host.confirm?.(`将“${sourceProfile.name}”并入“${targetProfile.name}”？原档案会保留在可恢复版本中。`) !== true) return;
        selected = groups.find(g => g.profiles.some(p => p.id === target))?.key ?? selected;
        return app.mergeDynamicPersona(source, target);
      }, { name: 'dynamic-persona', button });
      return;
    }
    if (button.dataset.peopleOpen) {
      const group = groups.find(g => g.key === selected);
      // A profile-specific link is safe even when another unresolved record
      // shares its nickname; only broad record navigation stays disabled.
      if (group && (!group.ambiguous || button.dataset.peopleProfile)) onSelect?.({ name: group.name, profileId: button.dataset.peopleProfile || null, kind: button.dataset.peopleOpen });
    }
  });
  return { paint };
}
