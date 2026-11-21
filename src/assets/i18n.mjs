// Interface language for the gallery and the triage page: Traditional Chinese (zh-Hant) by default,
// English as the fallback. How it works and how to add a string: docs/development.md#interface-text.
//
// Messages are tables of { key: text }, one per language. A text is a string with {name} placeholders,
// or a function of the values, for wording that changes with a number. A text can also be a list of
// parts, such as ['Use ', { b: '+ Import' }, ' to add some.'], for text with bold, <kbd> or <code> in it
// (see parts()); t() joins it into plain text. A key missing in Chinese falls
// back to English, and a key missing in both shows the key itself, so a gap is easy to spot.
//
// Pages load this module before their scripts and put it on `window.i18n` (see src/index.html).
// Data values (titles, use cases, games, batches) are never translated: the team writes them.

export const LANGS = ['zh-Hant', 'en'];
export const DEFAULT_LANG = 'zh-Hant';
export const FALLBACK_LANG = 'en';
export const LANG_NAMES = { 'zh-Hant': '中文', en: 'EN' };
const STORE = 'jipandan:lang'; // the language picked with the switch, per browser

// ---------- pure helpers (no DOM; also used by the tests) ----------

// The language to show: the one saved in this browser if it is known, else zh-Hant for everyone.
export function pickLang(saved) {
  return LANGS.includes(saved) ? saved : DEFAULT_LANG;
}

// English plural: "1 clip", "2 clips".
export const plural = (n, word, many = word + 's') => `${n} ${n === 1 ? word : many}`;

// Look up a key in `tables` ({ lang: { key: text } }) for `lang`, falling back to English, then the key.
export function translate(tables, lang, key, vars = {}) {
  const pick = (l) => (tables[l] && Object.prototype.hasOwnProperty.call(tables[l], key) ? tables[l][key] : undefined);
  let text = pick(lang);
  if (text === undefined) text = pick(FALLBACK_LANG);
  if (text === undefined) return key;
  if (typeof text === 'function') text = text(vars);
  if (Array.isArray(text)) return text.map((p) => (p && typeof p === 'object' ? Object.values(p)[0] : p)).join('');
  return String(text).replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
}

// Merge message tables: later ones add keys to, or replace keys in, earlier ones.
export function mergeTables(...list) {
  const out = {};
  for (const tables of list) for (const [lang, table] of Object.entries(tables)) out[lang] = { ...out[lang], ...table };
  return out;
}

// ---------- the messages both pages share: the board, the filters and the gallery ----------

export const MESSAGES = {
  en: {
    'lang.label': 'Language',

    'page.title': 'Jipandan Voice Box',
    'search.label': 'Search',
    'search.placeholder': 'Search titles, games, use cases…',
    'search.fileName': 'file name',
    'filters.label': 'Filters',
    'view.label': 'View',
    'view.columns': 'Columns',
    'view.colour': 'Colour',
    'view.sort': 'Sort',
    'view.nothing': 'Nothing',
    'sort.title': 'Title A–Z',
    'sort.titleDesc': 'Title Z–A',
    'sort.file': 'File order',
    'value.none': '(none)',
    'sep.colon': ': ',
    'sep.list': ', ',

    // Built-in dimensions, by key. A dimension with no entry here shows the label from clips.json.
    'dim.use-case': 'Use case',
    'dim.source-game': 'Source game',
    'dim.recording': 'Recording',
    'dim.batch': 'Batch',

    'total.all': ({ n }) => [n, n === 1 ? ' clip' : ' clips'],
    'total.some': ({ n, all }) => [n, ` of ${all} clips`],
    'board.noMatch': 'No clips match these filters.',
    'board.noClips': 'There are no clips in data/clips.json yet.',
    'board.loadFailed': 'Could not load {url} ({error}). If you opened this file directly, serve the folder over HTTP instead.',
    'chip.play': 'Play {title}',
    'chip.missing': 'Audio missing: {title}',
    'chip.starred': 'starred',

    'filter.add': '+ Filter',
    'filter.clear': 'Clear all',
    'filter.remove': 'Remove filter',
    'filter.is': 'is',
    'filter.isNot': 'is not',
    'filter.empty': 'No values',
    'filter.done': 'Done',
    'filter.starred': '★ Starred',

    'clipbar.label': 'Selected clip',
    'clipbar.nameTitle': 'The clip’s unique name: its file name, never shared by two clips',
    'clipbar.star': '☆ Star',
    'clipbar.starred': '★ Starred',
    'clipbar.starTitle': 'Starred clips are kept in this browser only',
    'clipbar.copyName': 'Copy name',
    'clipbar.copyLink': 'Copy link',
    'clipbar.close': 'Close',
    'copied.name': 'Name copied',
    'copied.link': 'Link copied',
    'copy.byHand': 'Press ⌘C or Ctrl+C to copy',
    'link.gone': 'That clip is no longer in the gallery',
  },

  'zh-Hant': {
    'lang.label': '語言',

    'page.title': 'Jipandan 語音盒',
    'search.label': '搜尋',
    'search.placeholder': '搜尋標題、遊戲、用途…',
    'search.fileName': '檔名',
    'filters.label': '篩選',
    'view.label': '檢視',
    'view.columns': '分欄',
    'view.colour': '顏色',
    'view.sort': '排序',
    'view.nothing': '不分色',
    'sort.title': '標題 A–Z',
    'sort.titleDesc': '標題 Z–A',
    'sort.file': '檔案順序',
    'value.none': '（無）',
    'sep.colon': '：',
    'sep.list': '、',

    'dim.use-case': '用途',
    'dim.source-game': '來源遊戲',
    'dim.recording': '錄音',
    'dim.batch': '批次',

    'total.all': ({ n }) => ['共 ', n, ' 個片段'],
    'total.some': ({ n, all }) => [n, ` / ${all} 個片段`],
    'board.noMatch': '沒有符合這些篩選條件的片段。',
    'board.noClips': 'data/clips.json 裡還沒有片段。',
    'board.loadFailed': '無法載入 {url}（{error}）。如果你是直接開啟這個檔案，請改用 HTTP 伺服器開啟這個資料夾。',
    'chip.play': '播放「{title}」',
    'chip.missing': '找不到音檔：{title}',
    'chip.starred': '已加星號',

    'filter.add': '+ 篩選',
    'filter.clear': '全部清除',
    'filter.remove': '移除篩選',
    'filter.is': '是',
    'filter.isNot': '不是',
    'filter.empty': '沒有值',
    'filter.done': '完成',
    'filter.starred': '★ 已加星號',

    'clipbar.label': '選取的片段',
    'clipbar.nameTitle': '片段的唯一名稱：它的檔名，不會有兩個片段相同',
    'clipbar.star': '☆ 加星號',
    'clipbar.starred': '★ 已加星號',
    'clipbar.starTitle': '星號只存在這個瀏覽器裡',
    'clipbar.copyName': '複製名稱',
    'clipbar.copyLink': '複製連結',
    'clipbar.close': '關閉',
    'copied.name': '已複製名稱',
    'copied.link': '已複製連結',
    'copy.byHand': '按 ⌘C 或 Ctrl+C 複製',
    'link.gone': '這個片段已經不在語音盒裡了',
  },
};

// ---------- the page ----------

let tables = MESSAGES;
let lang = DEFAULT_LANG;
try { lang = pickLang(localStorage.getItem(STORE)); } catch { /* storage blocked: zh-Hant, not remembered */ }

export const getLang = () => lang;

// Add a page's own messages, such as the triage page's (triage/messages.mjs).
export function add(more) {
  tables = mergeTables(tables, more);
}

export function t(key, vars) {
  return translate(tables, lang, key, vars);
}

// A message as a list of parts: strings, numbers and { b | kbd | code: text } objects, for a page to
// build with markup. A plain string message comes back as a one-item list.
export function parts(key, vars = {}) {
  return messageParts(tables, lang, key, vars);
}

export function messageParts(tables, lang, key, vars = {}) {
  const pick = (l) => (tables[l] && Object.prototype.hasOwnProperty.call(tables[l], key) ? tables[l][key] : undefined);
  let text = pick(lang);
  if (text === undefined) text = pick(FALLBACK_LANG);
  if (typeof text === 'function') text = text(vars);
  return Array.isArray(text) ? text : [translate(tables, lang, key, vars)];
}

// Parts as DOM nodes: { b: 'x' } becomes <b>x</b>, and so on.
export function nodes(key, vars) {
  return parts(key, vars).map((p) => {
    if (!p || typeof p !== 'object') return String(p);
    const [tag, text] = Object.entries(p)[0];
    const el = document.createElement(tag);
    el.textContent = text;
    return el;
  });
}

// A dimension's label: the built-in name in this language, or the label it was given in clips.json.
export function dimLabel(key, label) {
  const k = `dim.${key}`;
  return translate(tables, lang, k) !== k ? t(k) : label;
}

// Fill in an element and everything inside it from data attributes:
//   data-i18n="key"                     the text
//   data-i18n-html="key"                the HTML, for messages with markup such as <kbd> (our own text only)
//   data-i18n-attr="title:key;aria-label:key2"  attributes
export function apply(root = document) {
  const each = (attr, fn) => {
    if (root.matches && root.matches(`[${attr}]`)) fn(root);
    root.querySelectorAll(`[${attr}]`).forEach(fn);
  };
  each('data-i18n', (el) => { el.textContent = t(el.dataset.i18n); });
  each('data-i18n-html', (el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  each('data-i18n-attr', (el) => {
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const [name, key] = pair.split(':').map((s) => s.trim());
      if (name && key) el.setAttribute(name, t(key));
    }
  });
  if (root === document) {
    document.documentElement.lang = lang;
    const title = document.querySelector('title[data-i18n]');
    if (title) document.title = title.textContent;
  }
}

// Switch the language, remember it in this browser, and let the page redraw. Nothing reloads, so the
// view, the selected clip, playback and unpublished triage work all stay as they were.
export function setLang(next) {
  next = pickLang(next);
  if (next === lang) return;
  lang = next;
  try { localStorage.setItem(STORE, lang); } catch { /* not remembered; still switched for this visit */ }
  apply();
  document.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
}

// The language switch: one button per language, the current one pressed. Put it in any element.
export function mountSwitch(container) {
  const group = document.createElement('div');
  group.className = 'lang-switch';
  group.setAttribute('role', 'group');
  const draw = () => {
    group.setAttribute('aria-label', t('lang.label'));
    group.replaceChildren(...LANGS.map((l) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.lang = l;
      b.textContent = LANG_NAMES[l];
      b.setAttribute('aria-pressed', String(l === lang));
      b.onclick = () => setLang(l);
      return b;
    }));
  };
  draw();
  document.addEventListener('langchange', draw);
  container.replaceChildren(group);
}
