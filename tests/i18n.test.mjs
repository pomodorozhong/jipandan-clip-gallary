import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_LANG, MESSAGES, messageParts, mergeTables, pickLang, translate } from '../src/assets/i18n.mjs';
import { MESSAGES as TRIAGE } from '../triage/messages.mjs';
import { chipText } from '../src/assets/filter-chips.mjs';

const ALL = mergeTables(MESSAGES, TRIAGE);

test('zh-Hant is the default for everyone; a saved pick wins', () => {
  assert.equal(DEFAULT_LANG, 'zh-Hant');
  assert.equal(pickLang(null), 'zh-Hant');
  assert.equal(pickLang('fr'), 'zh-Hant');
  assert.equal(pickLang('en'), 'en');
  assert.equal(pickLang('zh-Hant'), 'zh-Hant');
});

test('both languages have the same keys, so nothing shows in the other language by accident', () => {
  for (const tables of [MESSAGES, TRIAGE]) {
    const en = Object.keys(tables.en).sort();
    const zh = Object.keys(tables['zh-Hant']).sort();
    assert.deepEqual(zh.filter((k) => !en.includes(k)), [], 'keys only in zh-Hant');
    assert.deepEqual(en.filter((k) => !zh.includes(k)), [], 'keys only in en');
  }
});

test('page and triage keys do not clash', () => {
  const clash = Object.keys(TRIAGE.en).filter((k) => k in MESSAGES.en);
  assert.deepEqual(clash, []);
});

test('a translation uses the same {placeholders} as the English', () => {
  const names = (text) => (typeof text === 'string' ? [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort() : null);
  for (const [key, en] of Object.entries(ALL.en)) {
    const zh = ALL['zh-Hant'][key];
    if (typeof en !== 'string' || typeof zh !== 'string') continue;
    // A translation may leave a value out, but never ask for one the English does not have.
    assert.deepEqual(names(zh).filter((n) => !names(en).includes(n)), [], key);
  }
});

test('translate fills placeholders, falls back to English, then to the key', () => {
  const tables = { en: { hi: 'Hi {name}', only: 'English only' }, 'zh-Hant': { hi: '你好 {name}' } };
  assert.equal(translate(tables, 'zh-Hant', 'hi', { name: 'Miku' }), '你好 Miku');
  assert.equal(translate(tables, 'en', 'hi', { name: 'Miku' }), 'Hi Miku');
  assert.equal(translate(tables, 'zh-Hant', 'only'), 'English only');
  assert.equal(translate(tables, 'zh-Hant', 'missing'), 'missing');
  assert.equal(translate(tables, 'en', 'hi'), 'Hi {name}');
});

test('English plurals and Chinese counts', () => {
  assert.equal(translate(ALL, 'en', 'import.importN', { n: 1 }), 'Import 1 clip');
  assert.equal(translate(ALL, 'en', 'import.importN', { n: 3 }), 'Import 3 clips');
  assert.equal(translate(ALL, 'en', 'games.left', { n: 1 }), '1 folder still needs a game');
  assert.equal(translate(ALL, 'en', 'games.left', { n: 2 }), '2 folders still need a game');
  assert.equal(translate(ALL, 'zh-Hant', 'import.importN', { n: 3 }), '匯入 3 個片段');
});

test('messages with markup come as parts, and as plain text from translate', () => {
  assert.deepEqual(messageParts(ALL, 'en', 'progress.none'), ['No new clips waiting. Use ', { b: '+ Import' }, ' to add some.']);
  assert.equal(translate(ALL, 'zh-Hant', 'progress.none'), '沒有等待整理的新片段。用 + 匯入 加入一些。');
  assert.deepEqual(messageParts(ALL, 'en', 'filter.done'), ['Done']);
  assert.deepEqual(messageParts(MESSAGES, 'zh-Hant', 'total.some', { n: 3, all: 10 }), [3, ' / 10 個片段']);
});

test('publish notices read in both languages', () => {
  const notice = { added: 2, removed: 0, commit: 'abc1234', branch: 'main' };
  const summary = (lang) => translate(ALL, lang, 'publish.summary', notice);
  assert.equal(summary('en'), '2 new clips');
  assert.equal(summary('zh-Hant'), '2 個新片段');
  assert.equal(translate(ALL, 'en', 'publish.summary', { added: 0, removed: 0 }), 'clip tags');
  assert.equal(translate(ALL, 'zh-Hant', 'publish.done.live', { ...notice, summary: summary('zh-Hant') }), '已發布2 個新片段（abc1234）。團隊的頁面大約一分鐘後更新。');
});

test('filter chips take their words and value text from the page', () => {
  const zh = { isNot: '不是', colon: '：', list: '、' };
  assert.deepEqual(chipText('用途', { not: false, values: ['受傷', '贏啦'] }, zh), ['用途：', '受傷、贏啦']);
  assert.deepEqual(chipText('遊戲', { not: true, values: ['REPO'] }, zh), ['遊戲 不是 ', 'REPO']);
  const show = (v) => (v === '(none)' ? '（無）' : v);
  assert.deepEqual(chipText('用途', { not: false, values: ['(none)'] }, zh, show), ['用途：', '（無）']);
});
