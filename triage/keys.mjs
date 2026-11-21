// Keyboard shortcuts for the triage page, shared with its tests.
//
// Shortcuts match the physical key (`KeyboardEvent.code`), not the character it types (`key`).
// With an Asian IME selected, such as Zhuyin, Pinyin or Japanese kana, `key` is a local character
// (N gives ㄙ) or "Process", so matching on `key` stops the shortcuts until the user switches to
// English. `code` stays `KeyN`. On a non-QWERTY layout the shortcuts follow US-QWERTY positions.

// True while an IME owns the keystroke: picking or cancelling a candidate must not also run a
// shortcut, submit a field or clear it. Safari reports some of these only through keyCode 229.
export function imeBusy(e) {
  return Boolean(e.isComposing) || e.keyCode === 229;
}

// The action for a keydown on the page outside text fields, or null when the key is not a shortcut.
// Returns { type: 'use', slot } for 1–9 (slot 0–8), or { type } for the rest.
export function shortcut(e) {
  if (imeBusy(e) || e.metaKey || e.ctrlKey || e.altKey) return null;
  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(e.code || '');
  if (digit && !e.shiftKey) return digit[1] === '0' ? { type: 'clear' } : { type: 'use', slot: Number(digit[1]) - 1 };
  switch (e.code) {
    case 'KeyN': return { type: 'next-untagged' };
    case 'KeyD': return { type: 'drop' };
    case 'Slash': return e.shiftKey ? null : { type: 'filter' };
    case 'Escape': return { type: 'escape' };
    case 'ArrowRight': case 'ArrowDown': return { type: 'step', delta: 1 };
    case 'ArrowLeft': case 'ArrowUp': return { type: 'step', delta: -1 };
    case 'Space': return { type: 'play' };
    default: return null;
  }
}

// The action for a keydown in the use case filter field: 'enter', 'escape' or null.
// Enter and Escape that confirm or cancel an IME candidate belong to the IME.
export function filterKey(e) {
  if (imeBusy(e)) return null;
  if (e.code === 'Enter' || e.code === 'NumpadEnter') return 'enter';
  if (e.code === 'Escape') return 'escape';
  return null;
}
