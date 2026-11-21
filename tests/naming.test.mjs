// Tests for triage/naming.mjs, the file naming the triage server and page share.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freeName, safeName, urlPath, withSuffix } from '../triage/naming.mjs';

test('safeName swaps ?, # and % for full-width look-alikes', () => {
  assert.equal(safeName('a?b#c%d.mp3'), 'a？b＃c％d.mp3');
});

test('urlPath escapes %, # and ? and nothing else', () => {
  assert.equal(urlPath('clips/a %#?.mp3'), 'clips/a %25%23%3F.mp3');
});

test('withSuffix adds -n before the extension', () => {
  assert.equal(withSuffix('a.b.mp3', 2), 'a.b-2.mp3');
  assert.equal(withSuffix('noext', 3), 'noext-3');
});

test('freeName returns the name itself, or the first free -n', () => {
  assert.equal(freeName('a.mp3', () => false), 'a.mp3');
  const taken = new Set(['a.mp3', 'a-2.mp3']);
  assert.equal(freeName('a.mp3', (n) => taken.has(n)), 'a-3.mp3');
});
