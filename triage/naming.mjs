// How audio files are named, shared by the triage server (scripts/triage.mjs) and the triage page
// (triage/triage.js gets it as window.clipNaming), so both agree on which names are free.

// A file path as a URL path: %, # and ? would otherwise be read as an escape, a fragment or a query.
export const urlPath = (s) => s.replace(/%/g, '%25').replace(/#/g, '%23').replace(/\?/g, '%3F');

// Some browsers fail to play a file whose name has ?, # or % even when escaped, so stored names use
// the full-width look-alikes instead. A clip's title keeps the original characters.
export const safeName = (s) => s.replace(/\?/g, '？').replace(/#/g, '＃').replace(/%/g, '％');

// name with "-n" added before the extension: a.mp3 -> a-2.mp3.
export function withSuffix(name, n) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)}-${n}${name.slice(dot)}` : `${name}-${n}`;
}

// The first of name, name-2, name-3… that isTaken(name) says is free.
export function freeName(name, isTaken) {
  let out = name;
  for (let n = 2; isTaken(out); n++) out = withSuffix(name, n);
  return out;
}
