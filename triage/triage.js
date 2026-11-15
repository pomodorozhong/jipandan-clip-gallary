// Triage page: import exported clips, give each folder a game and each clip a use case, then publish.
//
// The board itself is the viewer's src/assets/app.js. This script loads before it, sets
// `window.clipBoardHooks`, and redraws the board through `window.clipBoard` after each change.
// Clips that are not published yet live in inbox/ (see scripts/triage.py) and never reach GitHub
// until they have both a game and a use case and you press Publish.
(() => {
  'use strict';

  const GAME = 'source-game';
  const USE = 'use-case';
  const REC = 'recording';
  // jipandan-clip export names: <recording>_<4+ digit clip id, maybe "-N">_<title>, maybe " (N)".
  const EXPORT_NAME = /^(.+)_(\d{4,}(?:-\d+)?)_(.+?)(?: \(\d+\))?$/;
  const AUDIO = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)$/i;
  const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5v17l15-8.5z"/></svg>';
  const ICON_STOP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v14H5z"/></svg>';

  const $ = (id) => document.getElementById(id);
  const board = () => window.clipBoard;

  let server = null;     // last /api/state response
  let dims = [];         // published dimensions, plus any the triage adds
  let pub = [];          // published clips, edited in place until Publish
  let original = new Map(); // audio -> JSON of the published clip as loaded
  let removed = new Set();  // published clips to drop (missing audio)
  let inbox = [];        // imported clips not published yet
  let selected = null;   // audio of the selected chip

  // ---------- model ----------

  const isInbox = (audio) => inbox.some((c) => c.audio === audio);
  const clipOf = (audio) => inbox.find((c) => c.audio === audio) || pub.find((c) => c.audio === audio);
  const folderOf = (audio) => audio.split('/').slice(0, 2).join('/') + '/';
  const live = () => pub.filter((c) => !removed.has(c.audio));
  const allClips = () => live().concat(inbox);
  const first = (v) => (Array.isArray(v) ? v[0] : v) || '';
  const has = (c, key) => [].concat(c[key] ?? []).some((v) => String(v).trim());
  const ready = (c) => has(c, GAME) && has(c, USE);
  const edited = (c) => original.get(c.audio) !== JSON.stringify(c);

  function pending() {
    return {
      add: inbox.filter(ready),
      edit: live().filter(edited),
      drop: pub.filter((c) => removed.has(c.audio)),
    };
  }

  function useCases() {
    const dim = dims.find((d) => d.key === USE);
    const seen = new Set((dim && dim.order) || []);
    allClips().forEach((c) => [].concat(c[USE] ?? []).forEach((v) => v && seen.add(String(v))));
    return [...seen];
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
    original = new Map(pub.map((c) => [c.audio, JSON.stringify(c)]));
    removed = new Set();
    inbox = (state.inbox.clips || []).map((c) => ({ ...c }));
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

  let saveTimer = null;
  function saveInbox() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      api('POST', '/api/inbox', { clips: inbox }).catch((err) => toast(`Could not save the inbox: ${err.message}`, true));
    }, 300);
  }

  // ---------- board hooks ----------

  window.clipBoardHooks = {
    async load() {
      const res = await fetch('/api/state', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      load(await res.json());
      setTimeout(afterStart);
      return { dimensions: boardDims(), clips: allClips() };
    },
    decorateChip(btn, clip) {
      btn.classList.toggle('selected', clip.audio === selected);
      btn.classList.toggle('changed', isInbox(clip.audio) || edited(clipOf(clip.audio) || clip));
      if (server && server.missing.includes(clip.audio)) btn.classList.add('broken');
    },
    onChipClick(clip) {
      selected = clip.audio;
      refresh(false);
    },
    orderColumns(values, key) {
      const none = board().NONE;
      return (key === USE || key === GAME) && values.includes(none) ? [none, ...values.filter((v) => v !== none)] : values;
    },
    decorateColumn(section, value, key) {
      if (value !== board().NONE || (key !== USE && key !== GAME)) return;
      section.classList.add('untagged');
      section.querySelector('h2').firstChild.textContent = (key === USE ? 'Untagged' : 'No game yet') + ' ';
    },
  };

  // ---------- drawing ----------

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  // Redraw the board. A chip that changed column flies there; everything else slides into place.
  function refresh(animate = true) {
    const rect = (el) => el.getBoundingClientRect();
    const colBefore = new Map([...document.querySelectorAll('.column')].map((el) => [el.dataset.value, rect(el)]));
    // A clip with several use cases has a chip in each of those columns, so key chips by column and audio.
    const chipKey = (el) => `${el.closest('.column').dataset.value}\n${el.dataset.audio}`;
    const chipBefore = new Map([...document.querySelectorAll('.chip')].map((el) => [chipKey(el), rect(el)]));
    const lastSeen = new Map([...document.querySelectorAll('.chip')].map((el) => [el.dataset.audio, rect(el)]));

    board().update({ dimensions: boardDims(), clips: allClips() });
    renderFolders();
    renderTagbar();
    renderActions();
    if (!animate || reduceMotion.matches) return;

    const ease = 'cubic-bezier(.2,.8,.2,1)';
    const colShift = new Map();
    document.querySelectorAll('.column').forEach((el) => {
      const old = colBefore.get(el.dataset.value);
      if (!old) {
        el.animate([{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: ease });
        return;
      }
      const now = rect(el);
      const d = { x: old.left - now.left, y: old.top - now.top };
      colShift.set(el.dataset.value, d);
      if (d.x || d.y) el.animate([{ transform: `translate(${d.x}px, ${d.y}px)` }, { transform: 'none' }], { duration: 300, easing: ease });
    });
    document.querySelectorAll('.chip').forEach((el) => {
      const stayed = chipBefore.get(chipKey(el));
      const old = stayed || lastSeen.get(el.dataset.audio);
      if (!old) {
        el.animate([{ opacity: 0, transform: 'translateY(-10px) scale(.8)' }, { opacity: 1, transform: 'none' }], { duration: 360, easing: ease });
        return;
      }
      const host = el.closest('.column');
      const now = rect(el);
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

  function renderFolders() {
    const groups = new Map();
    allClips().forEach((c) => {
      if (!c.audio || !c.audio.startsWith('clips/')) return;
      const f = folderOf(c.audio);
      if (!groups.has(f)) groups.set(f, []);
      groups.get(f).push(c);
    });
    const known = games();
    const cards = [...groups].map(([folder, list]) => {
      const values = new Set(list.map((c) => first(c[GAME])));
      const game = values.size === 1 ? [...values][0] : '';
      const el = document.createElement('div');
      el.className = 'folder' + (game ? '' : ' needs');
      const name = document.createElement('code');
      name.textContent = folder;
      const count = document.createElement('span');
      count.className = 'count';
      const waiting = list.filter((c) => isInbox(c.audio)).length;
      count.textContent = `${list.length} clips` + (waiting ? ` · ${waiting} not published` : '');
      const select = document.createElement('select');
      const opts = [['', values.size > 1 ? 'Mixed games' : 'Choose game…'], ...known.map((g) => [g, g]), ['+', '+ New game…']];
      select.replaceChildren(...opts.map(([v, label]) => new Option(label, v)));
      select.value = game;
      select.onchange = () => {
        let value = select.value;
        if (value === '+') value = (prompt('Name of the new game') || '').trim();
        if (!value) { select.value = game; return; }
        list.forEach((c) => { clipOf(c.audio)[GAME] = value; });
        saveInbox();
        refresh();
      };
      el.append(name, count, select);
      return el;
    });
    $('folders').replaceChildren(...cards);
    $('folders-section').hidden = !cards.length;
  }

  function renderTagbar() {
    const clip = selected && clipOf(selected);
    const bar = $('tagbar');
    const now = document.createElement('div');
    now.className = 'now';
    if (clip) {
      now.textContent = `▶ ${clip.title} `;
      const where = document.createElement('small');
      where.textContent = folderOf(clip.audio) + (isInbox(clip.audio) ? ' · not published' : '');
      now.append(where);
    } else {
      now.innerHTML = '<small>Click a chip to play it and tag it</small>';
    }
    const buttons = useCases().map((u, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tag' + (clip && [].concat(clip[USE] ?? []).includes(u) ? ' on' : '');
      b.disabled = !clip;
      b.innerHTML = i < 9 ? `<kbd>${i + 1}</kbd>` : '';
      b.append(u);
      b.onclick = () => tag(u);
      return b;
    });
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'tag new';
    add.textContent = '+ New use case';
    add.disabled = !clip;
    add.onclick = () => { const u = (prompt('New use case') || '').trim(); if (u) tag(u); };
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'btn quiet';
    clear.innerHTML = 'Untag&nbsp;<kbd>0</kbd>';
    clear.disabled = !clip;
    clear.onclick = () => tag('');
    const keys = document.createElement('div');
    keys.className = 'keys';
    keys.innerHTML = '<kbd>Space</kbd> play or stop · <kbd>←</kbd> <kbd>→</kbd> previous or next clip · <kbd>1</kbd>–<kbd>9</kbd> tag, then play the next untagged clip · <kbd>0</kbd> untag';
    bar.replaceChildren(now, ...buttons, add, clear, keys);
  }

  function renderActions() {
    const p = pending();
    const n = p.add.length + p.edit.length + p.drop.length;
    const btn = $('publish');
    btn.disabled = !n || !server.canPublish;
    btn.textContent = n ? `Publish ${n} change${n > 1 ? 's' : ''}` : 'Nothing to publish';
    btn.title = server.canPublish ? '' : `Publishing needs the ${server.publishBranch} branch checked out.`;

    const missing = live().filter((c) => server.missing.includes(c.audio));
    const rm = $('remove-missing');
    rm.hidden = !missing.length;
    rm.textContent = `Remove ${missing.length} clip${missing.length > 1 ? 's' : ''} with missing audio`;

    const notice = $('notice');
    const waiting = inbox.filter((c) => !ready(c)).length;
    const lines = [];
    if (!server.canPublish) lines.push(`This checkout is on “${server.branch || 'no branch'}”. You can import and tag, but Publish works only on ${server.publishBranch}.`);
    if (waiting) lines.push(waiting > 1
      ? `${waiting} imported clips still need a game or a use case; they stay on this computer until then.`
      : '1 imported clip still needs a game or a use case; it stays on this computer until then.');
    notice.textContent = lines.join(' ');
    notice.hidden = !lines.length;
  }

  // ---------- tagging ----------

  function chipsInOrder() {
    return [...document.querySelectorAll('.chip')].map((el) => el.dataset.audio);
  }

  function tag(useCase) {
    const clip = selected && clipOf(selected);
    if (!clip) return;
    if (useCase) clip[USE] = useCase;
    else delete clip[USE];
    if (isInbox(clip.audio)) saveInbox();
    // Move on to the next untagged clip, in board order after this one, and play it.
    let next = null;
    if (useCase) {
      const order = chipsInOrder();
      const at = order.indexOf(clip.audio);
      const rest = order.slice(at + 1).concat(order.slice(0, Math.max(at, 0)));
      next = rest.find((a) => a !== clip.audio && !has(clipOf(a) || {}, USE)) || null;
    }
    if (next) selected = next;
    refresh();
    if (next && board().playingAudio() !== next) board().toggle(next);
  }

  function step(delta) {
    const order = chipsInOrder();
    if (!order.length) return;
    const at = order.indexOf(selected);
    selected = order[(at < 0 ? 0 : at + delta + order.length) % order.length];
    refresh(false);
    document.querySelector('.chip.selected')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest && e.target.closest('input, select, textarea, dialog')) return;
    if (document.querySelector('dialog[open]')) return;
    const cases = useCases();
    if (/^[1-9]$/.test(e.key) && cases[e.key - 1]) tag(cases[e.key - 1]);
    else if (e.key === '0') tag('');
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') step(1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') step(-1);
    else if (e.key === ' ' && selected) board().toggle(selected);
    else return;
    e.preventDefault();
  });

  // ---------- import ----------

  const preview = new Audio();
  let found = [];   // [{ file, rel, title, recording, audio, done, checked }]
  let previewing = null;

  const nfc = (s) => s.normalize('NFC');
  const slug = (s) => nfc(s).trim().toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || 'clips';
  const urlPath = (s) => s.replace(/%/g, '%25').replace(/#/g, '%23');

  function parseName(name) {
    const stem = nfc(name).replace(/\.[^.]+$/, '');
    const m = stem.match(EXPORT_NAME);
    return m && m[3].trim() ? { title: m[3].trim(), recording: m[1] } : { title: stem, recording: '' };
  }

  function audioFor(rel) {
    return `clips/${slug($('dest').value) || 'clips'}/${urlPath(nfc(rel))}`;
  }

  function showFound(folderName, files) {
    $('dest').value = slug(folderName);
    found = files
      .filter((f) => AUDIO.test(f.file.name) && !f.file.name.startsWith('.'))
      .map((f) => ({ ...f, ...parseName(f.file.name) }))
      .sort((a, b) => a.rel.localeCompare(b.rel));
    if (!found.length) { toast('No audio files in that folder.', true); return; }
    markDone();
    found.forEach((f) => (f.checked = !f.done));
    $('drop').hidden = true;
    $('picked').hidden = $('found').hidden = $('select-new').hidden = $('select-none').hidden = false;
    $('picked-name').textContent = `📁 ${folderName}`;
    renderFound();
  }

  function markDone() {
    const known = new Set(allClips().map((c) => c.audio));
    found.forEach((f) => { f.audio = audioFor(f.rel); f.done = known.has(f.audio); if (f.done) f.checked = false; });
  }

  function renderFound() {
    $('found').replaceChildren(...found.map((f) => {
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
      box.disabled = f.done;
      box.onchange = () => { f.checked = box.checked; summary(); };
      const text = document.createElement('span');
      const t = document.createElement('span');
      t.className = 't';
      t.textContent = f.title;
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = (f.done ? 'Already imported · ' : '') + (f.recording ? `recording ${f.recording} · ` : '') + f.rel;
      text.append(t, document.createElement('br'), meta);
      label.append(box, text);
      li.append(play, label);
      return li;
    }));
    summary();
  }
  preview.addEventListener('ended', () => { previewing = null; renderFound(); });

  function summary() {
    const n = found.filter((f) => f.checked).length;
    const done = found.filter((f) => f.done).length;
    $('found-summary').textContent = found.length ? `${found.length} clips found · ${found.length - done} new · ${done} already imported` : '';
    $('do-import').disabled = !n;
    $('do-import').textContent = n ? `Import ${n} clip${n > 1 ? 's' : ''}` : 'Import selected';
  }

  function resetImport() {
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
    const btn = $('do-import');
    btn.disabled = true;
    try {
      for (const [i, f] of picked.entries()) {
        btn.textContent = `Importing ${i + 1} of ${picked.length}…`;
        await api('PUT', `/api/upload?audio=${encodeURIComponent(f.audio)}`, f.file, true);
        const clip = { title: f.title, audio: f.audio };
        if (f.recording) clip[REC] = f.recording;
        // A folder that already has one game passes it on to new clips.
        const sameFolder = allClips().filter((c) => folderOf(c.audio) === folderOf(f.audio) && has(c, GAME));
        const g = new Set(sameFolder.map((c) => first(c[GAME])));
        if (g.size === 1) clip[GAME] = [...g][0];
        inbox.push(clip);
      }
      await api('POST', '/api/inbox', { clips: inbox });
      toast(`Imported ${picked.length} clip${picked.length > 1 ? 's' : ''}. Pick a game for the folder and a use case for each clip.`);
    } catch (err) {
      toast(`Import stopped: ${err.message}`, true);
      await api('POST', '/api/inbox', { clips: inbox }).catch(() => {});
    }
    $('import').close();
    resetImport();
    const firstNew = picked.find((f) => isInbox(f.audio));
    if (firstNew) selected = firstNew.audio;
    refresh();
  }

  function wireImport() {
    $('open-import').onclick = () => { resetImport(); $('import').showModal(); };
    $('close-import').onclick = () => { resetImport(); $('import').close(); };
    $('import').addEventListener('close', () => preview.pause());
    $('pick-again').onclick = resetImport;
    $('select-new').onclick = () => { found.forEach((f) => (f.checked = !f.done)); renderFound(); };
    $('select-none').onclick = () => { found.forEach((f) => (f.checked = false)); renderFound(); };
    // A different destination changes which clips count as already imported.
    $('dest').addEventListener('input', () => { markDone(); found.forEach((f) => { if (!f.done) f.checked = true; }); renderFound(); });
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
      if (p.drop.length) items.push(`Remove ${p.drop.length} clip${p.drop.length > 1 ? 's' : ''} with missing audio`);
      $('publish-list').replaceChildren(...items.map((t) => { const li = document.createElement('li'); li.textContent = t; return li; }));
      $('confirm-publish').showModal();
    };
    $('cancel-publish').onclick = () => $('confirm-publish').close();
    $('do-publish').onclick = async () => {
      const btn = $('do-publish');
      btn.disabled = true;
      btn.textContent = 'Publishing…';
      const p = pending();
      const clips = live().concat(p.add);
      try {
        const result = await api('POST', '/api/publish', {
          version: server.version,
          published: { dimensions: publishDims(clips), clips },
          inbox: { clips: inbox.filter((c) => !ready(c)) },
        });
        load(result.state);
        toast(result.message, result.pushed === false);
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
      if (p.edit.length || p.drop.length) e.preventDefault(); // unpublished edits to published clips are only in this page
    });
  }

  function toast(text, error) {
    const el = document.createElement('div');
    el.className = 'toast' + (error ? ' error' : '');
    el.textContent = text;
    document.body.append(el);
    el.animate([{ opacity: 0, transform: 'translate(-50%, 12px)' }, { opacity: 1, transform: 'translate(-50%, 0)' }], { duration: 220, easing: 'ease-out' });
    setTimeout(() => el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300 }).finished.then(() => el.remove()), error ? 8000 : 4500);
  }

  // Runs once app.js has drawn the board for the first time.
  function afterStart() {
    const firstUntagged = inbox.find((c) => !has(c, USE));
    selected = firstUntagged ? firstUntagged.audio : null;
    wireImport();
    wirePublish();
    refresh(false);
  }
})();
