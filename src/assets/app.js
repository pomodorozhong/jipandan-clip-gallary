// Jipandan clip gallery: a board of audio clip chips.
//
// Every field on a clip other than `title` and `audio` is a "dimension".
// Any dimension can set the columns, the chip colour, the sort order, or a filter.
// Dimensions come from `dimensions` in data/clips.json, or are inferred from the clips.
//
// The local triage page (triage/) reuses this board. It sets `window.clipBoardHooks` before this
// script runs, and drives the board through `window.clipBoard`. The published viewer sets no hooks.
(() => {
  'use strict';

  const hooks = window.clipBoardHooks || {};
  const DATA_URL = 'data/clips.json';
  const RESERVED = new Set(['title', 'audio']);
  const NONE = '(none)';

  // Background and icon colour pairs. Neighbours differ in lightness, not only hue.
  const PALETTE = [
    ['#c2410c', '#ffffff'],
    ['#7dd3fc', '#0c2a3a'],
    ['#3730a3', '#ffffff'],
    ['#fde047', '#3a2f00'],
    ['#0f766e', '#ffffff'],
    ['#f9a8d4', '#4a0d2b'],
    ['#7e22ce', '#ffffff'],
    ['#86efac', '#0b3a1c'],
    ['#1d1f3a', '#ffffff'],
    ['#fdba74', '#4a2100'],
  ];
  const PLAIN = ['#e8542a', '#ffffff'];

  const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5v17l15-8.5z"/></svg>';
  const ICON_STOP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v14H5z"/></svg>';

  const $ = (id) => document.getElementById(id);

  let dims = [];   // [{ key, label, order? }]
  let clips = [];  // [{ id, title, audio, ...dimension fields }]
  let state = { cols: '', colour: '', sort: 'title', q: '', filters: {} };

  const player = new Audio();
  let playingId = null;
  const broken = new Set();

  // ---------- data helpers ----------

  function humanise(key) {
    const s = key.replace(/[-_]+/g, ' ').trim();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // A dimension value can be a string, a number, or a list of them. Always returns a non-empty list.
  function valuesOf(clip, key) {
    const v = clip[key];
    const list = Array.isArray(v) ? v : (v === undefined || v === null ? [] : [v]);
    const clean = list.map((x) => String(x).trim()).filter(Boolean);
    return clean.length ? clean : [NONE];
  }

  function inferDims(list) {
    const keys = [];
    for (const clip of list) {
      for (const [k, v] of Object.entries(clip)) {
        if (RESERVED.has(k) || keys.includes(k)) continue;
        const ok = (x) => typeof x === 'string' || typeof x === 'number';
        if (ok(v) || (Array.isArray(v) && v.every(ok))) keys.push(k);
      }
    }
    return keys.map((key) => ({ key, label: humanise(key) }));
  }

  function dimByKey(key) {
    return dims.find((d) => d.key === key);
  }

  // Distinct values of a dimension: the declared `order` first, then the rest A–Z, "(none)" last.
  function valueList(dim, list) {
    const seen = new Set();
    for (const clip of list) for (const v of valuesOf(clip, dim.key)) seen.add(v);
    const ordered = (dim.order || []).map(String).filter((v) => seen.has(v));
    const rest = [...seen]
      .filter((v) => v !== NONE && !ordered.includes(v))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    const out = ordered.concat(rest);
    if (seen.has(NONE)) out.push(NONE);
    return out;
  }

  // ---------- state in the URL hash, so a view can be shared as a link ----------

  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    const keys = dims.map((d) => d.key);
    const pick = (v, fallback, allowed) => (allowed.includes(v) ? v : fallback);
    const filters = {};
    for (const [k, v] of p) {
      if (k.startsWith('f.') && keys.includes(k.slice(2)) && v) filters[k.slice(2)] = v;
    }
    // A dimension marked `defaultSort` (such as the wave, newest first) sorts the board until the viewer picks another order.
    const sortDim = dims.find((d) => d.defaultSort);
    state = {
      cols: pick(p.get('cols'), keys[0], keys),
      colour: pick(p.get('colour'), keys[1] || keys[0] || 'none', keys.concat('none')),
      sort: pick(p.get('sort'), sortDim ? 'dim:' + sortDim.key : 'title', sortOptions().map((o) => o.value)),
      q: p.get('q') || '',
      filters,
    };
  }

  function writeHash() {
    const p = new URLSearchParams();
    p.set('cols', state.cols);
    p.set('colour', state.colour);
    p.set('sort', state.sort);
    if (state.q) p.set('q', state.q);
    for (const [k, v] of Object.entries(state.filters)) if (v) p.set('f.' + k, v);
    history.replaceState(null, '', '#' + p.toString());
  }

  // ---------- controls ----------

  function sortOptions() {
    return [
      { value: 'title', label: 'Title A–Z' },
      { value: 'title-desc', label: 'Title Z–A' },
      { value: 'file', label: 'As listed' },
      ...dims.map((d) => ({ value: 'dim:' + d.key, label: 'By ' + d.label.toLowerCase() })),
    ];
  }

  function fillSelect(select, options, value) {
    select.replaceChildren(...options.map((o) => {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      return opt;
    }));
    select.value = value;
  }

  function buildControls() {
    const dimOptions = dims.map((d) => ({ value: d.key, label: d.label }));
    fillSelect($('columns-by'), dimOptions, state.cols);
    fillSelect($('colour-by'), dimOptions.concat({ value: 'none', label: 'None' }), state.colour);
    fillSelect($('sort-by'), sortOptions(), state.sort);
    $('search').value = state.q;

    const filters = $('filters');
    filters.replaceChildren(...dims.map((d) => {
      const label = document.createElement('label');
      label.className = 'pill' + (state.filters[d.key] ? ' active' : '');
      label.append(d.label + ' ');
      const select = document.createElement('select');
      fillSelect(select, [{ value: '', label: 'All' }].concat(valueList(d, clips).map((v) => ({ value: v, label: v }))), state.filters[d.key] || '');
      select.addEventListener('change', () => {
        if (select.value) state.filters[d.key] = select.value;
        else delete state.filters[d.key];
        label.classList.toggle('active', Boolean(select.value));
        update();
      });
      label.append(select);
      return label;
    }));
  }

  // ---------- rendering ----------

  function matches(clip) {
    for (const [k, v] of Object.entries(state.filters)) {
      if (!valuesOf(clip, k).includes(v)) return false;
    }
    if (state.q && !clip.title.toLowerCase().includes(state.q.toLowerCase())) return false;
    return true;
  }

  function sorter() {
    const byTitle = (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
    if (state.sort === 'title-desc') return (a, b) => byTitle(b, a);
    if (state.sort === 'file') return (a, b) => a.id - b.id;
    if (state.sort.startsWith('dim:')) {
      const dim = dimByKey(state.sort.slice(4));
      const rank = new Map(valueList(dim, clips).map((v, i) => [v, i]));
      return (a, b) => (rank.get(valuesOf(a, dim.key)[0]) - rank.get(valuesOf(b, dim.key)[0])) || byTitle(a, b);
    }
    return byTitle;
  }

  function colourMap() {
    const map = new Map();
    const dim = dimByKey(state.colour);
    if (!dim) return map;
    // Built from all clips, not just the filtered ones, so colours stay put while filtering.
    valueList(dim, clips).forEach((v, i) => map.set(v, PALETTE[i % PALETTE.length]));
    return map;
  }

  function chipFor(clip, colours) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.dataset.id = clip.id;
    btn.dataset.audio = clip.audio || '';
    const colourDim = dimByKey(state.colour);
    const [bg, fg] = colourDim ? colours.get(valuesOf(clip, colourDim.key)[0]) : PLAIN;
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = bg;
    dot.style.fill = fg;
    btn.style.setProperty('--fill', bg); // the playing chip fills with its own colour
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = clip.title;
    btn.append(dot, label);
    btn.title = dims.map((d) => d.label + ': ' + valuesOf(clip, d.key).join(', ')).join('\n');
    btn.addEventListener('click', () => {
      toggle(clip);
      if (hooks.onChipClick) hooks.onChipClick(clip, btn);
    });
    paintChip(btn);
    if (hooks.decorateChip) hooks.decorateChip(btn, clip);
    return btn;
  }

  function paintChip(btn) {
    const id = Number(btn.dataset.id);
    const clip = clips[id];
    const playing = id === playingId;
    btn.classList.toggle('playing', playing);
    btn.classList.toggle('broken', broken.has(id));
    btn.setAttribute('aria-pressed', String(playing));
    btn.setAttribute('aria-label', (broken.has(id) ? 'Audio missing: ' : 'Play ') + clip.title);
    btn.querySelector('.dot').innerHTML = playing ? ICON_STOP : ICON_PLAY;
    btn.style.setProperty('--progress', playing ? progressPercent() : '0%');
  }

  function repaintChips() {
    document.querySelectorAll('.chip').forEach(paintChip);
  }

  function render() {
    const visible = clips.filter(matches);
    const colours = colourMap();

    $('legend').replaceChildren(...[...colours].map(([value, [bg]]) => {
      const span = document.createElement('span');
      const swatch = document.createElement('i');
      swatch.style.background = bg;
      span.append(swatch, value);
      return span;
    }));
    $('total').textContent = visible.length === clips.length
      ? `${clips.length} clips`
      : `${visible.length} of ${clips.length} clips`;

    const message = $('message');
    message.hidden = visible.length > 0;
    message.textContent = clips.length ? 'No clips match these filters.' : 'There are no clips in data/clips.json yet.';

    const colsDim = dimByKey(state.cols);
    const sort = sorter();
    let columns = colsDim ? valueList(colsDim, visible) : [];
    if (colsDim && hooks.orderColumns) columns = hooks.orderColumns(columns, colsDim.key);
    $('board').replaceChildren(...columns.map((value) => {
      const items = visible.filter((c) => valuesOf(c, colsDim.key).includes(value)).sort(sort);
      const section = document.createElement('section');
      section.className = 'column';
      section.dataset.value = value;
      const h2 = document.createElement('h2');
      const count = document.createElement('small');
      count.textContent = items.length;
      h2.append(value + ' ', count);
      const chips = document.createElement('div');
      chips.className = 'chips';
      chips.append(...items.map((c) => chipFor(c, colours)));
      section.append(h2, chips);
      if (hooks.decorateColumn) hooks.decorateColumn(section, value, colsDim.key);
      return section;
    }));
  }

  function update() {
    writeHash();
    render();
  }

  // ---------- playback ----------

  function toggle(clip) {
    if (playingId === clip.id) {
      player.pause();
      playingId = null;
      repaintChips();
      return;
    }
    playingId = clip.id;
    // Load the new clip before repainting, so its fill starts at 0% rather than where the last one was.
    if (clip.audio) player.src = new URL(clip.audio, location.href).href;
    repaintChips();
    if (!clip.audio) return markBroken(clip.id);
    player.play().catch((err) => {
      if (err && err.name === 'AbortError') return; // another chip was clicked first
      markBroken(clip.id);
    });
  }

  // How far the playing clip has got, as a CSS percentage. 0% until the length is known.
  function progressPercent() {
    const { currentTime, duration } = player;
    if (!Number.isFinite(duration) || duration <= 0) return '0%';
    return `${Math.min(100, (currentTime / duration) * 100).toFixed(2)}%`;
  }

  // While a clip plays, move the fill on its chip (every copy, when it sits in several columns) each
  // frame; timeupdate alone fires only about four times a second, which looks jumpy on short clips.
  let frame = 0;
  function tick() {
    frame = 0;
    if (playingId === null || player.paused) return;
    const value = progressPercent();
    document.querySelectorAll(`.chip[data-id="${playingId}"]`).forEach((el) => el.style.setProperty('--progress', value));
    frame = requestAnimationFrame(tick);
  }
  player.addEventListener('playing', () => { if (!frame) frame = requestAnimationFrame(tick); });

  function markBroken(id) {
    broken.add(id);
    if (playingId === id) playingId = null;
    repaintChips();
  }

  player.addEventListener('ended', () => {
    playingId = null;
    repaintChips();
  });

  // ---------- start ----------

  function wireControls() {
    $('columns-by').addEventListener('change', (e) => { state.cols = e.target.value; update(); });
    $('colour-by').addEventListener('change', (e) => { state.colour = e.target.value; update(); });
    $('sort-by').addEventListener('change', (e) => { state.sort = e.target.value; update(); });
    $('search').addEventListener('input', (e) => { state.q = e.target.value.trim(); update(); });
    window.addEventListener('hashchange', () => { readHash(); buildControls(); render(); });
  }

  function setData(data) {
    const list = Array.isArray(data) ? data : (data.clips || []);
    clips = list
      .filter((c) => c && typeof c.title === 'string' && c.title.trim())
      .map((c, id) => ({ ...c, id }));
    const declared = Array.isArray(data.dimensions) ? data.dimensions : null;
    dims = declared
      ? declared.filter((d) => d && d.key).map((d) => ({ key: d.key, label: d.label || humanise(d.key), order: d.order, defaultSort: d.defaultSort === true }))
      : inferDims(clips);
  }

  // For the triage page: swap in edited data and redraw, keeping the current view and playback.
  window.clipBoard = {
    NONE,
    clips: () => clips,
    state: () => ({ ...state }),
    playingAudio: () => (playingId === null ? null : clips[playingId] && clips[playingId].audio),
    toggle: (audio) => { const clip = clips.find((c) => c.audio === audio); if (clip) toggle(clip); },
    update(data) {
      const playing = this.playingAudio();
      setData(data);
      const next = clips.find((c) => c.audio === playing);
      playingId = next ? next.id : null;
      if (!next && playing) player.pause();
      broken.clear();
      readHash();
      buildControls();
      update();
    },
  };

  async function start() {
    try {
      let data;
      if (hooks.load) {
        data = await hooks.load();
      } else {
        const res = await fetch(DATA_URL, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();
      }
      setData(data);
    } catch (err) {
      const message = $('message');
      message.hidden = false;
      message.textContent = `Could not load ${DATA_URL} (${err.message}). If you opened this file directly, serve the folder over HTTP instead.`;
      return;
    }
    readHash();
    buildControls();
    wireControls();
    update();
  }

  start();
})();
