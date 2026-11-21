// Tests for the pure parts of src/assets/filter-chips.mjs: matching, URL round trip and chip text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chipText, filterRows, fromParams, toParams, without } from '../src/assets/filter-chips.mjs';

const rows = [
  { title: 'a', use: ['Victory'], game: 'REPO' },
  { title: 'b', use: ['Defeat', 'Tutorial'], game: 'PEAK' },
  { title: 'c', use: ['Tutorial'], game: 'REPO' },
];
const valuesOf = (row, key) => [].concat(row[key] ?? []);
const titles = (filters) => rows.filter(filterRows(filters, valuesOf)).map((r) => r.title).join('');

test('no filters, or empty ones, keep every row', () => {
  assert.equal(titles({}), 'abc');
  assert.equal(titles({ use: { not: false, values: [] } }), 'abc');
});

test('"is" keeps rows with any of the values', () => {
  assert.equal(titles({ use: { not: false, values: ['Victory', 'Defeat'] } }), 'ab');
});

test('"is not" drops rows with any of the values, even one of several', () => {
  assert.equal(titles({ use: { not: true, values: ['Defeat'] } }), 'ac');
  assert.equal(titles({ game: { not: true, values: ['REPO'] } }), 'b');
});

test('fields combine with AND', () => {
  assert.equal(titles({ use: { not: false, values: ['Tutorial'] }, game: { not: true, values: ['PEAK'] } }), 'c');
});

test('without() drops one field and leaves the original alone', () => {
  const f = { use: { not: false, values: ['Victory'] }, game: { not: true, values: ['REPO'] } };
  assert.deepEqual(Object.keys(without(f, 'use')), ['game']);
  assert.deepEqual(Object.keys(f), ['use', 'game']);
});

test('filters survive a round trip through URL parameters, with any characters', () => {
  const f = { 'use-case': { not: false, values: ['教學/對話', 'a,b&c=d'] }, game: { not: true, values: ['REPO'] } };
  const p = new URLSearchParams(toParams(f).toString());
  assert.deepEqual(fromParams(p, ['use-case', 'game']), f);
});

test('fromParams reads old single-value links and ignores unknown fields', () => {
  const p = new URLSearchParams('cols=x&f.game=REPO&f.nope=1&f.use=');
  assert.deepEqual(fromParams(p, ['game', 'use']), { game: { not: false, values: ['REPO'] } });
});

test('chip text names up to two values, then a count', () => {
  assert.deepEqual(chipText('Use case', { not: false, values: ['Victory'] }), ['Use case: ', 'Victory']);
  assert.deepEqual(chipText('Use case', { not: false, values: ['A', 'B', 'C', 'D'] }), ['Use case: ', 'A, B +2']);
  assert.deepEqual(chipText('Game', { not: true, values: ['REPO'] }), ['Game is not ', 'REPO']);
  assert.deepEqual(chipText('Game', { not: false, values: [] }), ['Game: ', '…']);
});
