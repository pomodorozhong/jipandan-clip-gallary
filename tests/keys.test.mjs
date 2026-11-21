// Tests for triage/keys.mjs: triage shortcuts follow physical keys, so an Asian IME does not stop them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterKey, imeBusy, shortcut } from '../triage/keys.mjs';

const key = (code, key, more = {}) => ({ code, key, keyCode: 0, isComposing: false, ...more });

test('shortcuts work on an English layout', () => {
  assert.deepEqual(shortcut(key('Digit1', '1')), { type: 'use', slot: 0 });
  assert.deepEqual(shortcut(key('Digit9', '9')), { type: 'use', slot: 8 });
  assert.deepEqual(shortcut(key('Digit0', '0')), { type: 'clear' });
  assert.deepEqual(shortcut(key('KeyN', 'n')), { type: 'next-untagged' });
  assert.deepEqual(shortcut(key('KeyN', 'N', { shiftKey: true })), { type: 'next-untagged' });
  assert.deepEqual(shortcut(key('KeyD', 'd')), { type: 'drop' });
  assert.deepEqual(shortcut(key('Slash', '/')), { type: 'filter' });
  assert.deepEqual(shortcut(key('Escape', 'Escape')), { type: 'escape' });
  assert.deepEqual(shortcut(key('ArrowDown', 'ArrowDown')), { type: 'step', delta: 1 });
  assert.deepEqual(shortcut(key('ArrowLeft', 'ArrowLeft')), { type: 'step', delta: -1 });
  assert.deepEqual(shortcut(key('Space', ' ')), { type: 'play' });
});

test('shortcuts follow the physical key when an IME changes the typed character', () => {
  assert.deepEqual(shortcut(key('KeyN', 'ㄙ')), { type: 'next-untagged' });  // Zhuyin
  assert.deepEqual(shortcut(key('KeyD', 'し')), { type: 'drop' });          // Japanese kana
  assert.deepEqual(shortcut(key('Digit1', 'ㄅ')), { type: 'use', slot: 0 });
  assert.deepEqual(shortcut(key('Numpad3', '3')), { type: 'use', slot: 2 });
  assert.deepEqual(shortcut(key('Slash', 'ㄥ')), { type: 'filter' });
  assert.deepEqual(shortcut(key('KeyN', 'Process')), { type: 'next-untagged' });
});

test('keys that are not shortcuts, or have modifiers, are left alone', () => {
  assert.equal(shortcut(key('KeyQ', 'q')), null);
  assert.equal(shortcut(key('KeyN', 'n', { metaKey: true })), null);
  assert.equal(shortcut(key('KeyD', 'd', { ctrlKey: true })), null);
  assert.equal(shortcut(key('Digit1', '!', { shiftKey: true })), null);
  assert.equal(shortcut(key('Slash', '?', { shiftKey: true })), null);
});

test('keys an IME is composing with never run a shortcut', () => {
  assert.ok(imeBusy({ isComposing: true }));
  assert.ok(imeBusy({ keyCode: 229 }));
  assert.ok(!imeBusy({ keyCode: 78 }));
  assert.equal(shortcut(key('KeyN', 'Process', { isComposing: true })), null);
  assert.equal(shortcut(key('Digit1', 'Process', { keyCode: 229 })), null);
});

test('the use case filter leaves Enter and Escape to the IME while it composes', () => {
  assert.equal(filterKey(key('Enter', 'Enter')), 'enter');
  assert.equal(filterKey(key('NumpadEnter', 'Enter')), 'enter');
  assert.equal(filterKey(key('Escape', 'Escape')), 'escape');
  assert.equal(filterKey(key('Enter', 'Enter', { isComposing: true })), null);
  assert.equal(filterKey(key('Enter', 'Enter', { keyCode: 229 })), null);
  assert.equal(filterKey(key('Escape', 'Escape', { isComposing: true })), null);
  assert.equal(filterKey(key('KeyA', 'a')), null);
});
