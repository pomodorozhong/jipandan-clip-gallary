// Triage page: import exported clips, give each source folder a game and each clip a use case, then publish.
//
// The board itself is the viewer's src/assets/app.js. This script loads before it, sets
// `window.clipBoardHooks`, and redraws the board through `window.clipBoard` after each change.
// Clips that are not published yet live in inbox/ (see scripts/triage.mjs) and never reach GitHub
// until they have both a game and a use case and you press Publish.
(() => {
  'use strict';

  const GAME = 'source-game';
  const USE = 'use-case';
  const REC = 'recording';
  const WAVE = 'wave';        // the publish a clip came in with; set by the server, renamable here
  let dropLabel = 'Dropped';      // the board column for dropped clips; see boardClips()
  const FROM = 'import-folder'; // the export folder a clip came from; kept in the inbox only, dropped on publish
  // jipandan-clip export names: <recording>_<4+ digit clip id, maybe "-N">_<title>, maybe " (N)".
  const EXPORT_NAME = /^(.+)_(\d{4,}(?:-\d+)?)_(.+?)(?: \(\d+\))?$/;
  const AUDIO = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)$/i;
  const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5v17l15-8.5z"/></svg>';
  const ICON_STOP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v14H5z"/></svg>';
  const ICON_BRANCH = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7v10M18 10c0 4-6 3-12 7"/></svg>';

  const $ = (id) => document.getElementById(id);
  const board = () => window.clipBoard;

  let server = null;     // last /api/state response
  let dims = [];         // published dimensions, plus any the triage adds
  let pub = [];          // published clips, edited in place until Publish
  let original = new Map(); // audio -> JSON of the published clip as loaded
  let removed = new Set();  // published clips to drop (missing audio)
  let inbox = [];        // imported clips not published yet
  let selected = null;   // audio of the selected chip
  let selectedCol = null; // column of the selected chip: a clip with several use cases has a chip in each

  // ---------- model ----------

  // Lookups by audio path, rebuilt only when the lists change: the board asks for every chip on each redraw.
  let index = null;
  function lookup() {
    if (!index || index.inbox !== inbox || index.pub !== pub || index.n !== inbox.length) {
      const byAudio = new Map(pub.map((c) => [c.audio, c]));
      inbox.forEach((c) => byAudio.set(c.audio, c)); // an inbox clip wins over a published one with the same path
      index = { inbox, pub, n: inbox.length, byAudio, inboxSet: new Set(inbox.map((c) => c.audio)) };
    }
    return index;
  }
  const isInbox = (audio) => lookup().inboxSet.has(audio);
  const clipOf = (audio) => lookup().byAudio.get(audio);
  const live = () => pub.filter((c) => !removed.has(c.audio));
  const allClips = () => live().concat(inbox);
  const first = (v) => (Array.isArray(v) ? v[0] : v) || '';
  const has = (c, key) => [].concat(c[key] ?? []).some((v) => String(v).trim());
  const ready = (c) => has(c, GAME) && has(c, USE);
  // Key order does not count, and one use case stored as a string or as a one-item list is the same:
  // removing a use case and adding it back leaves the clip unedited.
  const one = (v) => (Array.isArray(v) && v.length === 1 ? v[0] : v);
  const canon = (c) => JSON.stringify(Object.keys(c).sort().map((k) => [k, k === USE ? one(c[k]) : c[k]]));
  const edited = (c) => original.get(c.audio) !== canon(c);

  // A dropped clip stays on the board in a Dropped column. In the inbox it is kept but never published;
  // a dropped published clip is removed from the gallery, with its audio, on the next Publish.
  const isDropped = (c) => Boolean(c && c.dropped);

  function pending() {
    return {
      add: inbox.filter((c) => ready(c) && !isDropped(c)),
      edit: live().filter((c) => !isDropped(c) && edited(c)),
      missing: pub.filter((c) => removed.has(c.audio)),
      dropped: live().filter(isDropped),
    };
  }
  const pendingCount = (p) => p.add.length + p.edit.length + p.missing.length + p.dropped.length;

  // Use cases some clip has, in the published order first. One that is only in the order (such as a
  // sample use case after the sample clips are gone) gets no pill or key.
  function useCases() {
    const dim = dims.find((d) => d.key === USE);
    const used = new Set(allClips().flatMap(usesOf));
    const order = ((dim && dim.order) || []).map(String).filter((u) => used.has(u));
    return [...new Set([...order, ...used])];
  }

  function games() {
    const seen = new Set();
    allClips().forEach((c) => has(c, GAME) && seen.add(first(c[GAME])));
    return [...seen].sort((a, b) => a.localeCompare(b));
  }

  // Use case first so the board opens with use-case columns, then game, then the rest.
  function boardDims() {
    const out = [...dims];
    const ensure = (key, label) => { if (!out.some((d) => d.key === key)) out.push({ key, label }); };
    ensure(USE, 'Use case');
    ensure(GAME, 'Source game');
    if (allClips().some((c) => has(c, REC))) ensure(REC, 'Recording');
    const rank = (d) => (d.key === USE ? 0 : d.key === GAME ? 1 : 2);
    return out.sort((a, b) => rank(a) - rank(b));
  }

  // Published dimensions keep their order; new keys are added at the end.
  function publishDims(clips) {
    const out = dims.map((d) => ({ ...d }));
    for (const [key, label] of [[USE, 'Use case'], [GAME, 'Source game'], [REC, 'Recording']]) {
      if (!out.some((d) => d.key === key) && clips.some((c) => has(c, key))) out.push({ key, label });
    }
    return out;
  }

  function load(state) {
    server = state;
    dims = (state.published.dimensions || []).filter((d) => d && d.key);
    pub = (state.published.clips || []).map((c) => ({ ...c }));
    original = new Map(pub.map((c) => [c.audio, canon(c)]));
    removed = new Set();
    inbox = (state.inbox.clips || []).map((c) => ({ ...c })); // the server renamed any ?, # or % file names at start-up
  }

  // ---------- saving ----------

  async function api(method, url, body, raw) {
    const res = await fetch(url, {
      method,
      headers: raw ? {} : { 'Content-Type': 'application/json' },
      body: raw ? body : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  // Inbox changes are saved right away, one request at a time, so a later save never lands before an
  // earlier one and closing the page right after a change loses nothing. Resolves to false if a save failed.
  let saving = null;   // the running save, or null
  let unsaved = false; // the inbox changed since the last save started (or a save failed)
  function saveInbox() {
    unsaved = true;
    if (!saving) {
      saving = (async () => {
        try {
          while (unsaved) {
            unsaved = false;
            await api('POST', '/api/inbox', { clips: inbox });
          }
          return true;
        } catch (err) {
          unsaved = true;
          toast(`Could not save the inbox: ${err.message}`, true);
          return false;
        } finally {
          saving = null;
        }
      })();
    }
    return saving;
  }

  // ---------- board hooks ----------

  window.clipBoardHooks = {
    async load() {
      const res = await fetch('/api/state', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      load(await res.json());
      setTimeout(afterStart);
      return { dimensions: boardDims(), clips: boardClips() };
    },
    decorateChip(btn, clip) {
      btn.classList.toggle('dropped', isDropped(clipOf(clip.audio)));
      btn.classList.toggle('selected', clip.audio === selected);
      btn.classList.toggle('changed', isInbox(clip.audio) || edited(clipOf(clip.audio) || clip));
      if (server && server.missing.includes(clip.audio)) btn.classList.add('broken');
    },
    onChipClick(clip, btn) {
      selected = clip.audio;
      selectedCol = btn.closest('.column')?.dataset.value ?? null;
      showSelected();
    },
    orderColumns(values, key) {
      const none = board().NONE;
      let out = values.filter((v) => v !== dropLabel);
      if ((key === USE || key === GAME) && out.includes(none)) out = [none, ...out.filter((v) => v !== none)];
      return values.includes(dropLabel) ? [...out, dropLabel] : out;
    },
    decorateColumn(section, value, key) {
      if (value === dropLabel) { section.classList.add('dropped-col'); return; }
      if (value !== board().NONE || (key !== USE && key !== GAME)) return;
      section.classList.add('untagged');
      section.querySelector('h2').firstChild.textContent = (key === USE ? 'Untagged' : 'No game yet') + ' ';
    },
  };

  // What the board shows: a dropped clip has "Dropped" for every dimension, so it lands in the
  // Dropped column whatever the columns are split by. Its real tags stay on the clip. If a real tag is
  // already called "Dropped", the column gets a name no clip uses, so live clips never land in it.
  function boardClips() {
    const keys = boardDims().map((d) => d.key);
    const used = new Set(allClips().filter((c) => !isDropped(c)).flatMap((c) => keys.flatMap((k) => [].concat(c[k] ?? []).map(String))));
    dropLabel = 'Dropped';
    for (let n = 2; used.has(dropLabel); n++) dropLabel = `Dropped (${n})`;
    return allClips().map((c) => (isDropped(c) ? { ...c, ...Object.fromEntries(keys.map((k) => [k, dropLabel])) } : c));
  }

  // ---------- drawing ----------

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  // Redraw the board. A chip that changed column flies there; everything else slides into place.
  // Only chips near the visible part of the board animate, and every position is read before any
  // animation starts: reading a position after starting an animation makes the browser lay out the
  // whole board again, which froze the page for seconds with a few thousand clips.
  function refresh(animate = true) {
    const view = { top: -200, bottom: innerHeight + 200, left: -200, right: innerWidth + 200 };
    const near = (r) => r.bottom > view.top && r.top < view.bottom && r.right > view.left && r.left < view.right;
    const rect = (el) => el.getBoundingClientRect();
    const chipKey = (el) => `${el.closest('.column').dataset.value}\n${el.dataset.audio}`;
    // A clip with several use cases has a chip in each of those columns, so key chips by column and audio.
    let colBefore, chipBefore, lastSeen;
    const doAnimate = animate && !reduceMotion.matches;
    if (doAnimate) {
      colBefore = new Map([...document.querySelectorAll('.column')].map((el) => [el.dataset.value, rect(el)]));
      chipBefore = new Map();
      lastSeen = new Map();
      document.querySelectorAll('.chip').forEach((el) => {
        const r = rect(el);
        if (!near(r)) return;
        chipBefore.set(chipKey(el), r);
        lastSeen.set(el.dataset.audio, r);
      });
    }

    board().update({ dimensions: boardDims(), clips: boardClips() });
    renderSide();
    if (!doAnimate) return;

    // Read everything first ...
    const ease = 'cubic-bezier(.2,.8,.2,1)';
    const cols = [...document.querySelectorAll('.column')].map((el) => ({ el, now: rect(el), old: colBefore.get(el.dataset.value) }));
    const colShift = new Map(cols.filter((c) => c.old).map((c) => [c.el.dataset.value, { x: c.old.left - c.now.left, y: c.old.top - c.now.top }]));
    const chips = [];
    document.querySelectorAll('.chip').forEach((el) => {
      const now = rect(el);
      if (!near(now)) return;
      const stayed = chipBefore.get(chipKey(el));
      chips.push({ el, now, stayed, old: stayed || lastSeen.get(el.dataset.audio) });
    });

    // ... then start the animations.
    cols.forEach(({ el, old }) => {
      if (!old) {
        el.animate([{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: ease });
        return;
      }
      const d = colShift.get(el.dataset.value);
      if (d.x || d.y) el.animate([{ transform: `translate(${d.x}px, ${d.y}px)` }, { transform: 'none' }], { duration: 300, easing: ease });
    });
    chips.forEach(({ el, now, stayed, old }) => {
      if (!old) {
        el.animate([{ opacity: 0, transform: 'translateY(-10px) scale(.8)' }, { opacity: 1, transform: 'none' }], { duration: 360, easing: ease });
        return;
      }
      const host = el.closest('.column');
      let dx = old.left - now.left;
      let dy = old.top - now.top;
      const moved = !stayed;
      if (!moved) { const c = colShift.get(host.dataset.value) || { x: 0, y: 0 }; dx -= c.x; dy -= c.y; }
      if (!dx && !dy) return;
      if (moved) host.style.zIndex = 3; // fly over the other columns
      const anim = el.animate(
        moved
          ? [{ transform: `translate(${dx}px, ${dy}px) scale(1.1)`, zIndex: 5, boxShadow: '0 10px 24px rgba(29,31,58,.25)' },
             { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 18}px) scale(1.1)`, zIndex: 5, offset: 0.5 },
             { transform: 'none', zIndex: 5 }]
          : [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
        { duration: moved ? 520 : 260, easing: ease },
      );
      if (moved) anim.finished.then(() => { host.style.zIndex = ''; }, () => {});
    });
  }

  // A new selection only moves the highlight; the board itself is unchanged, so it is not redrawn.
  function showSelected() {
    document.querySelectorAll('.chip.selected').forEach((el) => el.classList.remove('selected'));
    if (selected) document.querySelectorAll(`.chip[data-audio="${CSS.escape(selected)}"]`).forEach((el) => el.classList.add('selected'));
    renderSide();
  }

  // ---------- sidebar ----------

  const KEY_SLOTS = 9;  // use cases on the number keys
  const PILL_CAP = 15;  // pills shown before "Show all"
  let showAllUses = false;
  let keyed = [];        // use cases on keys 1–9, in key order

  // Small DOM helper: el('b', 'cls', 'text', child, ...)
  function el(tagName, cls, ...kids) {
    const node = document.createElement(tagName);
    if (cls) node.className = cls;
    kids.forEach((k) => k != null && node.append(k));
    return node;
  }
  const button = (cls, ...kids) => { const b = el('button', cls, ...kids); b.type = 'button'; return b; };
  const kbd = (text) => el('kbd', '', text);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  const usesOf = (c) => [].concat(c[USE] ?? []).map(String).filter((u) => u.trim());
  // How many clips have each use case, counted in one pass.
  function useCounts() {
    const counts = new Map();
    allClips().forEach((c) => usesOf(c).forEach((u) => counts.set(u, (counts.get(u) || 0) + 1)));
    return counts;
  }

  // The most-used use cases get keys 1–9 when the page opens, so keys don't move while you tag.
  function pinKeys() {
    const counts = useCounts();
    keyed = useCases().map((u, i) => [u, counts.get(u) || 0, i]).sort((a, b) => b[1] - a[1] || a[2] - b[2]).slice(0, KEY_SLOTS).map(([u]) => u);
  }
  // Use cases created later fill free key slots; ones that no longer exist give theirs up.
  function keyedUses() {
    const all = useCases();
    keyed = keyed.filter((u) => all.includes(u));
    for (const u of all) {
      if (keyed.length >= KEY_SLOTS) break;
      if (!keyed.includes(u)) keyed.push(u);
    }
    return keyed;
  }

  function renderSide() {
    renderTagPanel();
    renderActions();
  }

  function renderTagPanel() {
    const clip = selected && clipOf(selected);
    const needGame = allClips().filter((c) => !isDropped(c) && !has(c, GAME));

    // Progress over the clips waiting in the inbox (dropped ones don't count).
    const waiting = inbox.filter((c) => !isDropped(c));
    const total = waiting.length;
    const done = waiting.filter((c) => has(c, USE)).length;
    const progress = $('progress');
    if (total) {
      const bar = el('div', 'bar', el('i'));
      bar.firstChild.style.width = `${(done / total) * 100}%`;
      progress.replaceChildren(el('span', '', el('b', '', `${done} of ${total}`), ' new clips have a use case'), bar);
    } else {
      progress.replaceChildren(el('span', '', 'No new clips waiting. Use ', el('b', '', '+ Import'), ' to add some.'));
    }
    if (needGame.length && !needGame.some((c) => c.audio === selected)) {
      const link = button('more', `${plural(needGame.length, 'clip')} still need${needGame.length === 1 ? 's' : ''} a game →`);
      link.onclick = () => { selected = needGame[0].audio; showSelected(); };
      progress.append(link);
    }

    // The selected clip, or a way to get to the next one.
    if (clip) {
      const play = button('play');
      play.innerHTML = ICON_PLAY;
      play.title = 'Play or stop (Space)';
      play.onclick = () => board().toggle(clip.audio);
      // The game is set per folder on import and rarely changes, so it sits quietly in the subtitle;
      // only a clip without a game gets the full menu below the card.
      const hasGame = Boolean(first(clip[GAME]));
      const wave = !isInbox(clip.audio) && clip[WAVE] ? String(clip[WAVE]) : '';
      const where = el('small', '', hasGame ? gameMenu(clip) : null, hasGame ? ' · ' : '',
        isInbox(clip.audio) ? 'not published' : 'published', wave ? ' · ' : '', wave ? waveLink(wave) : null, isDropped(clip) ? ' · dropped' : '');
      const dropBtn = button('drop-btn', isDropped(clip) ? 'Restore' : 'Drop', kbd('D'));
      dropBtn.title = isDropped(clip)
        ? 'Bring this clip back from the Dropped column'
        : isInbox(clip.audio) ? 'Move this clip to the Dropped column; it is never published' : 'Remove this clip from the gallery on the next Publish';
      dropBtn.onclick = toggleDrop;
      $('now').replaceChildren(
        el('div', 'now' + (isDropped(clip) ? ' is-dropped' : ''), play,
          el('div', 'now-text', el('b', '', clip.title), el('div', 'now-meta', where, dropBtn))),
        ...(hasGame || isDropped(clip) ? [] : [gameMenu(clip)]));
    } else {
      const next = nextUntagged(null);
      const card = el('div', 'now empty', el('b', '', 'No clip selected'));
      if (next) {
        const go = button('btn primary small', 'Next untagged ', kbd('N'));
        go.onclick = goNext;
        card.append(el('span', '', 'Click a chip on the board, or jump to the next clip without a use case.'), go);
      } else {
        card.append(el('span', '', 'Every clip has a use case. Click a chip to change one.'));
      }
      $('now').replaceChildren(card);
    }

    // Use cases: only shown with a clip selected, so nothing sits there disabled.
    $('use-block').hidden = !clip || isDropped(clip);
    if (!clip || isDropped(clip)) return;
    const all = useCases();
    const keys = keyedUses();
    const counts = useCounts();
    const count = (u) => counts.get(u) || 0;
    const rest = all.filter((u) => !keys.includes(u)).sort((a, b) => count(b) - count(a) || a.localeCompare(b));
    const ordered = [...keys, ...rest];
    const raw = $('use-filter').value.trim();
    const q = raw.toLowerCase();
    let shown = q ? ordered.filter((u) => u.toLowerCase().includes(q)) : ordered;
    const capped = !q && !showAllUses && shown.length > PILL_CAP;
    if (capped) shown = shown.slice(0, PILL_CAP);
    const mine = usesOf(clip);
    const pills = shown.map((u) => {
      const at = keys.indexOf(u);
      const b = button('tag' + (mine.includes(u) ? ' on' : '') + (at < 0 ? ' nokey' : ''), at < 0 ? null : kbd(String(at + 1)), u);
      b.title = `${plural(count(u), 'clip')}${mine.includes(u) ? ' · click to remove from this clip' : ''}`;
      b.onclick = () => toggleUse(u);
      return b;
    });
    if (q && !all.some((u) => u.toLowerCase() === q)) {
      const create = button('tag new', `+ Create “${raw}”`);
      create.onclick = () => addUse(raw);
      pills.push(create);
    }
    if (!pills.length) pills.push(el('span', 'hint', 'No use cases yet. Type a name above to create one.'));
    $('uses').replaceChildren(...pills);
    $('use-total').textContent = all.length ? `${all.length} total` : '';
    const more = $('more-uses');
    more.hidden = q || ordered.length <= PILL_CAP;
    more.textContent = showAllUses ? 'Show fewer' : `Show all ${ordered.length}`;
    $('untag').hidden = !mine.length;
    $('untag').replaceChildren(mine.length > 1 ? 'Untag all ' : 'Untag ', kbd('0'));
  }

  // The selected clip's wave; clicking it renames that wave for every clip in it.
  function waveLink(wave) {
    const link = button('linkish wave-link', `wave ${wave} ✎`);
    link.title = 'Rename this wave for every clip in it (published on the next Publish)';
    link.onclick = () => renameWave(wave);
    return link;
  }

  // A renamed wave keeps its place in the Wave order, so the newest wave still comes first.
  function renameWave(old) {
    const inWave = pub.filter((c) => String(c[WAVE]) === old);
    const name = (prompt(`Rename the wave “${old}” (${plural(inWave.length, 'clip')}) to:`, old) || '').trim();
    if (!name || name === old) return;
    if (pub.some((c) => String(c[WAVE]) === name)) { toast(`There is already a wave called “${name}”.`, true); return; }
    inWave.forEach((c) => { c[WAVE] = name; });
    const dim = dims.find((d) => d.key === WAVE);
    if (dim && Array.isArray(dim.order)) dim.order = dim.order.map((v) => (String(v) === old ? name : v));
    refresh();
  }

  // The selected clip's game, for the odd clip whose game differs from the rest of its import.
  function gameMenu(clip) {
    const current = first(clip[GAME]);
    const select = document.createElement('select');
    const opts = [...(current ? [] : [['', 'Pick a game…']]), ...games().map((g) => [g, g]), ['+', '+ New game…']];
    select.replaceChildren(...opts.map(([v, label]) => new Option(label, v)));
    select.value = current;
    select.onchange = () => {
      let value = select.value;
      if (value === '+') value = (prompt('Name of the new game') || '').trim();
      if (!value) { select.value = current; return; }
      clip[GAME] = value;
      if (isInbox(clip.audio)) saveInbox();
      select.blur(); // so the number keys work again
      refresh();
    };
    select.title = 'Source game (set per folder on import)';
    // A plain label with the menu laid invisibly over it, so it is as wide as the game's name in every browser.
    return current ? el('span', 'game-inline', el('span', '', current, ' ▾'), select) : el('label', 'now-game needs', 'Game', select);
  }

  function renderActions() {
    const p = pending();
    const n = pendingCount(p);
    const btn = $('publish');
    btn.disabled = !n || !server.canPublish;
    btn.replaceChildren(n ? 'Publish ' : 'Nothing to publish');
    if (n) btn.append(plural(n, 'change'));
    btn.title = server.canPublish ? '' : 'Publishing needs a branch checked out.';

    const missing = live().filter((c) => server.missing.includes(c.audio));
    const rm = $('remove-missing');
    rm.hidden = !missing.length;
    rm.textContent = `Remove ${plural(missing.length, 'clip')} with missing audio`;

    $('branch').innerHTML = ICON_BRANCH;
    $('branch').append(server.branch || 'no branch');
    $('branch').title = 'Publish commits to this branch';
    const note = $('publish-note');
    if (!server.canPublish) note.replaceChildren('This checkout is not on a branch. You can import and tag, but Publish needs a branch checked out.');
    else if (onBranch()) {
      note.replaceChildren(`Goes live once ${server.branch} is merged into ${server.liveBranch}.`);
      if (server.compareUrl) {
        const link = el('a', '', 'Open a pull request');
        link.href = server.compareUrl;
        link.target = '_blank';
        link.rel = 'noopener';
        note.append(' ', link);
      }
    } else note.replaceChildren('Goes live on the team’s page about a minute after publishing.');
  }

  function wireSide() {
    $('more-uses').onclick = () => { showAllUses = !showAllUses; renderTagPanel(); };
    $('untag').onclick = clearUses;
    const filter = $('use-filter');
    filter.oninput = renderTagPanel;
    filter.onkeydown = (e) => {
      if (e.key === 'Escape') { filter.value = ''; filter.blur(); renderTagPanel(); e.preventDefault(); return; }
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const raw = filter.value.trim();
      if (!raw) return;
      // Enter adds the exact or first matching use case, or creates the typed one when nothing matches.
      const q = raw.toLowerCase();
      const all = useCases();
      addUse(all.find((u) => u.toLowerCase() === q) || all.find((u) => u.toLowerCase().includes(q)) || raw);
    };
  }

  // ---------- tagging ----------

  // Every chip on the board in order, as { audio, col }. A clip with several use cases appears once per column.
  function chipsInOrder() {
    return [...document.querySelectorAll('.chip')].map((el) => ({ audio: el.dataset.audio, col: el.closest('.column').dataset.value }));
  }

  // Where the selected clip is in that order: its chip in the selected column, or else its first chip.
  function selectedAt(order) {
    const at = order.findIndex((c) => c.audio === selected && c.col === selectedCol);
    return at >= 0 ? at : order.findIndex((c) => c.audio === selected);
  }

  function scrollToSelected() {
    const chips = [...document.querySelectorAll('.chip.selected')];
    const chip = chips.find((el) => el.closest('.column').dataset.value === selectedCol) || chips[0];
    chip?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // The next clip without a use case, in board order after `from` (or from the start).
  function nextUntagged(from) {
    const order = chipsInOrder().map((c) => c.audio);
    const at = order.indexOf(from);
    const rest = order.slice(at + 1).concat(order.slice(0, Math.max(at, 0)));
    return rest.find((a) => { const c = clipOf(a); return a !== from && c && !isDropped(c) && !has(c, USE); }) || null;
  }

  function play(audio) {
    if (audio && board().playingAudio() !== audio) board().toggle(audio);
  }

  // A clip can have several use cases. One is stored as a string and several as a list, as in
  // docs/data-format.md. Tagging never moves the selection: N and the arrow keys do that.
  function setUses(update) {
    const clip = selected && clipOf(selected);
    if (!clip || isDropped(clip)) return; // a dropped clip's use cases are hidden, so keys must not change them
    const uses = update(usesOf(clip));
    if (!uses.length) delete clip[USE];
    else clip[USE] = uses.length === 1 ? uses[0] : uses;
    if (isInbox(clip.audio)) saveInbox();
    $('use-filter').value = '';
    if (document.activeElement === $('use-filter')) $('use-filter').blur(); // so the number keys work again
    refresh();
  }
  const toggleUse = (u) => setUses((uses) => (uses.includes(u) ? uses.filter((x) => x !== u) : [...uses, u]));
  const addUse = (u) => setUses((uses) => (uses.includes(u) ? uses : [...uses, u]));
  const clearUses = () => setUses(() => []);

  // Drop the selected clip (or restore a dropped one), move on to the next untagged clip, and offer Undo.
  function toggleDrop() {
    const clip = selected && clipOf(selected);
    if (!clip) return;
    const dropping = !isDropped(clip);
    if (dropping) clip.dropped = true;
    else delete clip.dropped;
    if (isInbox(clip.audio)) saveInbox();
    const next = dropping ? nextUntagged(clip.audio) : null;
    if (next) selected = next;
    refresh();
    play(next);
    if (dropping) {
      const { audio } = clip;
      toast(`Dropped “${clip.title}”.`, false, ['Undo', () => {
        // Look the clip up again: a publish since then reloads every clip from the server.
        const now = clipOf(audio);
        if (!now) { toast(`Too late to undo: “${clip.title}” was already removed by Publish.`, true); return; }
        delete now.dropped;
        if (isInbox(audio)) saveInbox();
        selected = audio;
        refresh();
      }]);
    }
  }

  function goNext() {
    const next = nextUntagged(selected);
    if (!next) { toast('Every clip has a use case.'); return; }
    selected = next;
    selectedCol = null;
    showSelected();
    scrollToSelected();
    play(next);
  }

  function step(delta) {
    const order = chipsInOrder();
    if (!order.length) return;
    const at = selectedAt(order);
    ({ audio: selected, col: selectedCol } = order[(at < 0 ? 0 : at + delta + order.length) % order.length]);
    showSelected();
    scrollToSelected();
  }

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest && e.target.closest('input, select, textarea, dialog')) return;
    if (document.querySelector('dialog[open]')) return;
    const cases = keyedUses();
    if (/^[1-9]$/.test(e.key) && cases[e.key - 1]) toggleUse(cases[e.key - 1]);
    else if (e.key === '0') clearUses();
    else if (e.key === 'n' || e.key === 'N') goNext();
    else if ((e.key === 'd' || e.key === 'D') && selected) toggleDrop();
    else if (e.key === '/' && selected) $('use-filter').focus();
    else if (e.key === 'Escape' && selected) { selected = null; showSelected(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') step(1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') step(-1);
    else if (e.key === ' ' && selected) board().toggle(selected);
    else return;
    e.preventDefault();
  });

  // ---------- import ----------

  // Every clip is stored flat in clips/ under its export file name. A file whose audio is already in
  // the gallery (by SHA-256, under any name) counts as imported; a different clip with a taken name
  // gets "-2", "-3"… added before the extension.

  const preview = new Audio();
  let found = [];     // [{ file, rel, title, recording, hash, audio, saveAs, renamed, dupOf, sameAs, done, checked }]
  let previewing = null;
  let checking = 0;   // files hashed so far while checking, or 0 when done
  let scan = 0;       // bumps on every new folder, so a stale check stops

  const nfc = (s) => s.normalize('NFC');
  const fold = (s) => s.toLowerCase(); // macOS file names ignore case

  function parseName(name) {
    const stem = nfc(name).replace(/\.[^.]+$/, '');
    const m = stem.match(EXPORT_NAME);
    return m && m[3].trim() ? { title: m[3].trim(), recording: m[1] } : { title: stem, recording: '' };
  }

  async function sha256(file) {
    const buf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Decide where each file goes: already in the gallery, a repeat within this folder, or a free name in clips/.
  function plan() {
    const { urlPath, safeName, freeName } = window.clipNaming; // triage/naming.mjs, shared with the server
    const hashes = server.hashes || {};
    const clipByHash = new Map();
    allClips().forEach((c) => { const h = hashes[c.audio]; if (h && !clipByHash.has(h)) clipByHash.set(h, c); });
    const taken = new Set([...Object.keys(hashes), ...allClips().map((c) => c.audio)].map(fold));
    const firstWith = new Map(); // hash -> first file in this folder with that audio
    for (const f of found) {
      f.dupOf = clipByHash.get(f.hash) || null;
      f.sameAs = f.dupOf ? null : firstWith.get(f.hash) || null;
      f.done = Boolean(f.dupOf || f.sameAs);
      f.audio = '';
      if (f.done) continue;
      firstWith.set(f.hash, f);
      const base = safeName(nfc(f.file.name));
      const name = freeName(base, (n) => taken.has(fold(`clips/${urlPath(n)}`)));
      f.saveAs = name;
      f.renamed = name !== base;
      f.audio = `clips/${urlPath(name)}`;
      taken.add(fold(f.audio));
    }
  }

  async function showFound(folderName, files) {
    const audio = files.filter((f) => AUDIO.test(f.file.name) && !f.file.name.startsWith('.'));
    if (!audio.length) { toast('No audio files in that folder.', true); return; }
    const id = ++scan;
    // Group by source folder: the export folder itself first, then its subfolders A–Z.
    const dirOf = (rel) => rel.slice(0, rel.lastIndexOf('/') + 1);
    found = audio.map((f) => ({ ...f, ...parseName(f.file.name), folder: nfc(`${folderName}/${dirOf(f.rel)}`), checked: false, done: false }))
      .sort((a, b) => (dirOf(a.rel) ? 1 : 0) - (dirOf(b.rel) ? 1 : 0) || a.folder.localeCompare(b.folder) || a.rel.localeCompare(b.rel));
    $('drop').hidden = true;
    $('picked').hidden = $('found').hidden = $('select-new').hidden = $('select-none').hidden = false;
    $('picked-name').textContent = `📁 ${folderName}`;
    checking = 1;
    renderFound();
    for (const [i, f] of found.entries()) {
      try { f.hash = await sha256(f.file); } catch { f.hash = `unreadable:${i}`; }
      if (id !== scan) return;
      checking = i + 1;
      summary();
    }
    plan();
    found.forEach((f) => (f.checked = !f.done));
    checking = 0;
    renderFound();
  }

  function renderFound() {
    $('found').replaceChildren(...found.flatMap((f, i) => {
      const head = i === 0 || found[i - 1].folder !== f.folder ? [el('li', 'group', f.folder)] : [];
      const li = document.createElement('li');
      li.className = f.done ? 'done' : '';
      const play = document.createElement('button');
      play.type = 'button';
      play.className = 'play' + (previewing === f ? ' on' : '');
      play.innerHTML = previewing === f ? ICON_STOP : ICON_PLAY;
      play.title = 'Play';
      play.onclick = () => {
        if (previewing === f) { preview.pause(); previewing = null; }
        else {
          previewing = f;
          if (!f.url) f.url = URL.createObjectURL(f.file);
          preview.src = f.url;
          preview.play().catch(() => {});
        }
        renderFound();
      };
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = f.checked;
      box.disabled = f.done || Boolean(checking);
      box.onchange = () => { f.checked = box.checked; summary(); };
      const note = (text, cls = '') => el('span', 'note' + (cls ? ` ${cls}` : ''), text);
      const meta = [f.recording ? `recording ${f.recording}` : '', f.rel];
      let badge = null;
      if (f.dupOf) {
        const as = f.dupOf.title === f.title ? '' : ` as “${f.dupOf.title}”`;
        badge = note(isDropped(f.dupOf) ? `dropped before${as}` : `already imported${as}`);
        if (f.dupOf.title !== f.title) meta.push('same audio, different name');
      } else if (f.sameAs) {
        badge = note('repeat');
        meta.push(`same audio as ${f.sameAs.rel}`);
      } else if (f.renamed) {
        badge = note(`saved as ${f.saveAs}`, 'renamed');
        meta.push('a different clip already has this name');
      }
      const text = el('span', '', el('span', 't', f.title), badge, document.createElement('br'), el('span', 'meta', meta.filter(Boolean).join(' · ')));
      label.append(box, text);
      li.append(play, label);
      return [...head, li];
    }));
    summary();
  }
  preview.addEventListener('ended', () => { previewing = null; renderFound(); });

  function summary() {
    const n = found.filter((f) => f.checked && !f.done).length;
    const imported = found.filter((f) => f.dupOf).length;
    const repeats = found.filter((f) => f.sameAs).length;
    const btn = $('do-import');
    if (checking) {
      $('found-summary').textContent = `Checking ${checking} of ${found.length} files…`;
      btn.disabled = true;
      btn.textContent = 'Import selected';
      return;
    }
    const parts = [`${plural(found.length, 'clip')} found`, `${found.length - imported - repeats} new`, `${imported} already imported`];
    if (repeats) parts.push(plural(repeats, 'repeat'));
    $('found-summary').textContent = found.length ? parts.join(' · ') : '';
    btn.disabled = !n;
    btn.textContent = n ? `Import ${plural(n, 'clip')}` : 'Import selected';
  }

  function resetImport() {
    scan++;
    checking = 0;
    preview.pause();
    previewing = null;
    found.forEach((f) => f.url && URL.revokeObjectURL(f.url));
    found = [];
    $('drop').hidden = false;
    $('picked').hidden = $('found').hidden = $('select-new').hidden = $('select-none').hidden = true;
    $('dir').value = '';
    summary();
  }

  // Read a dropped folder, including subfolders.
  async function readFolder(dirEntry) {
    const out = [];
    async function walk(entry, prefix) {
      if (entry.isFile) {
        const file = await new Promise((ok, fail) => entry.file(ok, fail));
        out.push({ file, rel: prefix + file.name });
        return;
      }
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise((ok, fail) => reader.readEntries(ok, fail));
        if (!batch.length) break;
        for (const child of batch) await walk(child, entry === dirEntry ? '' : prefix + entry.name + '/');
      }
    }
    await walk(dirEntry, '');
    return out;
  }

  async function doImport() {
    const picked = found.filter((f) => f.checked && !f.done);
    if (!picked.length) return;
    const btn = $('do-import');
    btn.disabled = true;
    const added = [];
    try {
      for (const [i, f] of picked.entries()) {
        btn.textContent = `Importing ${i + 1} of ${picked.length}…`;
        await api('PUT', `/api/upload?audio=${encodeURIComponent(f.audio)}`, f.file, true);
        const clip = { title: f.title, audio: f.audio, [FROM]: f.folder };
        if (f.recording) clip[REC] = f.recording;
        inbox.push(clip);
        added.push(clip);
        server.hashes = { ...server.hashes, [f.audio]: f.hash };
      }
    } catch (err) {
      toast(`Import stopped after ${plural(added.length, 'clip')}: ${err.message}`, true);
    }
    if (added.length) await saveInbox();
    $('import').close();
    resetImport();
    if (added.length) selected = added[0].audio;
    refresh();
    if (added.length) openGames(added);
  }

  // ---------- step 2: a game per source folder ----------

  let gameRows = []; // [{ folder, clips, select }]

  function gameOptions(select, placeholder) {
    const keep = select.value;
    select.replaceChildren(new Option(placeholder, ''), ...games().map((g) => new Option(g, g)), new Option('+ New game…', '+'));
    select.value = [...select.options].some((o) => o.value === keep && keep !== '+') ? keep : '';
  }

  // "+ New game…" asks for a name and adds it to every menu; returns false when cancelled.
  function pickNewGame(select) {
    if (select.value !== '+') return true;
    const name = (prompt('Name of the new game') || '').trim();
    if (!name) { select.value = ''; return false; }
    for (const s of [$('games-all'), ...gameRows.map((r) => r.select)]) {
      if (![...s.options].some((o) => o.value === name)) s.insertBefore(new Option(name, name), s.lastElementChild);
    }
    select.value = name;
    return true;
  }

  function openGames(clips) {
    const byFolder = new Map();
    clips.forEach((c) => {
      if (!byFolder.has(c[FROM])) byFolder.set(c[FROM], []);
      byFolder.get(c[FROM]).push(c);
    });
    gameRows = [...byFolder].map(([folder, list]) => {
      const select = document.createElement('select');
      select.setAttribute('aria-label', `Game for ${folder}`);
      gameOptions(select, 'Pick a game…');
      const names = list.map((c) => c.title);
      const sample = names.slice(0, 3).join(', ') + (names.length > 3 ? ', …' : '');
      const row = el('div', 'gf', el('div', 'name', el('code', '', folder), el('small', '', `${plural(list.length, 'clip')} · ${sample}`)), select);
      select.onchange = () => { pickNewGame(select); gamesLeft(); };
      return { folder, clips: list, select, row };
    });
    gameOptions($('games-all'), '—');
    $('games-all').value = '';
    $('games-intro').textContent = `${plural(clips.length, 'clip')} imported. Every clip in a folder gets that folder's game. You can change one clip's game later in the sidebar.`;
    $('games-list').replaceChildren(...gameRows.map((r) => r.row));
    gamesLeft();
    $('import-games').showModal();
  }

  function gamesLeft() {
    gameRows.forEach((r) => r.row.classList.toggle('needs', !r.select.value));
    const n = gameRows.filter((r) => !r.select.value).length;
    $('games-left').textContent = n ? `${plural(n, 'folder')} still need${n === 1 ? 's' : ''} a game` : 'Every folder has a game';
  }

  function saveGames() {
    let changed = false;
    for (const r of gameRows) {
      if (!r.select.value) continue;
      r.clips.forEach((c) => { const clip = clipOf(c.audio); if (clip) { clip[GAME] = r.select.value; changed = true; } });
    }
    gameRows = [];
    $('import-games').close();
    if (changed) { saveInbox(); refresh(); }
  }

  function wireImport() {
    $('open-import').onclick = () => { resetImport(); $('import').showModal(); };
    $('close-import').onclick = () => { resetImport(); $('import').close(); };
    $('import').addEventListener('close', () => { scan++; preview.pause(); });
    $('pick-again').onclick = resetImport;
    $('select-new').onclick = () => { found.forEach((f) => (f.checked = !f.done)); renderFound(); };
    $('select-none').onclick = () => { found.forEach((f) => (f.checked = false)); renderFound(); };
    $('games-all').onchange = () => {
      const all = $('games-all');
      if (!pickNewGame(all) || !all.value) return;
      gameRows.forEach((r) => (r.select.value = all.value));
      gamesLeft();
    };
    $('games-done').onclick = saveGames;
    $('games-skip').onclick = () => { gameRows = []; $('import-games').close(); };
    $('dir').onchange = () => {
      const files = [...$('dir').files];
      if (!files.length) return;
      const root = files[0].webkitRelativePath.split('/')[0];
      showFound(root, files.map((file) => ({ file, rel: file.webkitRelativePath.split('/').slice(1).join('/') })));
    };
    const drop = $('drop');
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = async (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      const entry = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).find((x) => x && x.isDirectory);
      if (!entry) { toast('Drop a folder, not single files.', true); return; }
      showFound(entry.name, await readFolder(entry));
    };
    $('do-import').onclick = doImport;
  }

  // ---------- publish ----------

  // True when Publish goes to a work branch (reviewed in a PR) rather than straight to the live branch.
  const onBranch = () => server.canPublish && server.branch !== server.liveBranch;

  function wirePublish() {
    $('remove-missing').onclick = () => {
      live().filter((c) => server.missing.includes(c.audio)).forEach((c) => removed.add(c.audio));
      if (selected && removed.has(selected)) selected = null;
      refresh();
    };
    $('publish').onclick = () => {
      const p = pending();
      const items = [];
      if (p.add.length) items.push(`Add ${p.add.length} new clip${p.add.length > 1 ? 's' : ''}`);
      if (p.edit.length) items.push(`Update the tags of ${p.edit.length} published clip${p.edit.length > 1 ? 's' : ''}`);
      if (p.dropped.length) items.push(`Remove ${plural(p.dropped.length, 'dropped clip')} and ${p.dropped.length > 1 ? 'their' : 'its'} audio`);
      if (p.missing.length) items.push(`Remove ${p.missing.length} clip${p.missing.length > 1 ? 's' : ''} with missing audio`);
      $('publish-title').textContent = onBranch() ? `Publish to ${server.branch}?` : 'Publish to GitHub Pages?';
      $('publish-target').textContent = server.branch;
      $('publish-after').textContent = onBranch()
        ? ` The clips go live once it is merged into ${server.liveBranch}.`
        : ' The team\'s page updates about a minute later.';
      $('publish-list').replaceChildren(...items.map((t) => { const li = document.createElement('li'); li.textContent = t; return li; }));
      $('confirm-publish').showModal();
    };
    $('cancel-publish').onclick = () => $('confirm-publish').close();
    $('do-publish').onclick = async () => {
      const btn = $('do-publish');
      btn.disabled = true;
      btn.textContent = 'Publishing…';
      // A save still on its way could land after the publish and bring published clips back into the inbox.
      while (saving) await saving;
      const p = pending();
      const clips = live().filter((c) => !isDropped(c)).concat(p.add.map(({ [FROM]: _, ...c }) => c)); // the import folder stays on this computer
      try {
        const result = await api('POST', '/api/publish', {
          version: server.version,
          published: { dimensions: publishDims(clips), clips },
          inbox: { clips: inbox.filter((c) => isDropped(c) || !ready(c)) },
        });
        load(result.state);
        toast(result.message, result.pushed === false, ['Preview gallery', () => window.open('/gallery/', '_blank', 'noopener')]);
      } catch (err) {
        toast(`Not published: ${err.message}`, true);
      }
      btn.disabled = false;
      btn.textContent = 'Publish';
      $('confirm-publish').close();
      refresh();
    };
    window.addEventListener('beforeunload', (e) => {
      const p = pending();
      // Unpublished edits to published clips are only in this page; inbox edits are lost only while a save is on its way.
      if (p.edit.length || p.missing.length || p.dropped.length || saving || unsaved) e.preventDefault();
    });
  }

  // action: optional [label, onClick], shown as a button in the toast (for Undo).
  function toast(text, error, action) {
    const el = document.createElement('div');
    el.className = 'toast' + (error ? ' error' : '');
    el.textContent = text;
    if (action) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = action[0];
      b.onclick = () => { action[1](); el.remove(); };
      el.append(' ', b);
    }
    document.body.append(el);
    el.animate([{ opacity: 0, transform: 'translate(-50%, 12px)' }, { opacity: 1, transform: 'translate(-50%, 0)' }], { duration: 220, easing: 'ease-out' });
    setTimeout(() => el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300 }).finished.then(() => el.remove()), error ? 8000 : 4500);
  }

  // Runs once app.js has drawn the board for the first time.
  function afterStart() {
    const firstUntagged = inbox.find((c) => !isDropped(c) && !has(c, USE));
    selected = firstUntagged ? firstUntagged.audio : null;
    pinKeys();
    wireSide();
    wireImport();
    wirePublish();
    refresh(false);
  }
})();
