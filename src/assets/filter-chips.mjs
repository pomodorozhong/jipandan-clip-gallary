// Filter chips: a minimal multi-value filter bar. No dependencies; copy this file and filter-chips.css
// into another project to reuse it. Usage and options: docs/filter-chips.md.
//
// With nothing filtered the bar shows only a dashed "+ Filter" chip. Picking a field opens a checklist
// of its values with an "is / is not" switch. Each active filter becomes one chip, such as
// "Use case: Victory, Defeat" or "Game is not REPO"; click it to edit, ✕ to remove it.
//
// A filter value is a plain object: { [fieldKey]: { not: boolean, values: string[] } }.
// A row passes a field when it has any of the values (or, with `not`, none of them).

// ---------- pure helpers (no DOM; also used by the tests) ----------

// A predicate for rows. `valuesOf(row, key)` returns the row's values for a field as a list of strings.
export function filterRows(filters, valuesOf) {
  const active = Object.entries(filters || {}).filter(([, f]) => f && f.values && f.values.length);
  return (row) => active.every(([key, f]) => {
    const have = valuesOf(row, key);
    const hit = f.values.some((v) => have.includes(v));
    return f.not ? !hit : hit;
  });
}

// The same filters minus one field: for counting what each value of that field would show.
export function without(filters, key) {
  const out = { ...filters };
  delete out[key];
  return out;
}

// To and from URL parameters, so a filtered view can be shared as a link. One parameter per value
// (`f.use-case=Victory&f.use-case=Defeat`), `nf.` for "is not". Values may contain any character.
export function toParams(filters, params = new URLSearchParams()) {
  for (const [key, f] of Object.entries(filters || {})) {
    if (!f || !f.values || !f.values.length) continue;
    for (const v of f.values) params.append((f.not ? 'nf.' : 'f.') + key, v);
  }
  return params;
}

export function fromParams(params, keys) {
  const filters = {};
  for (const [name, value] of params) {
    const m = /^(n?)f\.(.+)$/.exec(name);
    if (!m || !value || (keys && !keys.includes(m[2]))) continue;
    const f = filters[m[2]] || (filters[m[2]] = { not: m[1] === 'n', values: [] });
    if (!f.values.includes(value)) f.values.push(value);
  }
  return filters;
}

// The chip's text: [field part, values part], such as ["Use case: ", "Victory, Defeat +2"].
export function chipText(label, f) {
  const list = f.values;
  const shown = list.length <= 2 ? list.join(', ') : `${list[0]}, ${list[1]} +${list.length - 2}`;
  return [label + (f.not ? ' is not ' : ': '), shown || '…'];
}

// ---------- the bar ----------

let uid = 0;

/**
 * Render a filter bar into `container`.
 * options:
 *   fields:   [{ key, label, flag? }]          fields offered under "+ Filter". A field with `flag` is an
 *                                              on/off filter (such as "★ Starred"): picking it filters
 *                                              to rows whose value is `flag`, and its chip shows only the label.
 *   values:   (key) => string[]                a field's values, in display order
 *   count:    (key, value) => number           optional: rows that value would show, given the other filters
 *   filters:  { key: { not, values } }         optional: starting filters
 *   onChange: (filters) => void                called after every change, with a fresh copy
 *   text:     optional labels: add, clear, remove, is, isNot, empty, done
 * returns { get(), set(filters), refresh(), close() }
 */
export function createFilterChips(container, options) {
  const t = { add: '+ Filter', clear: 'Clear all', remove: 'Remove filter', is: 'is', isNot: 'is not', empty: 'No values', done: 'Done', ...options.text };
  const id = 'fc' + ++uid;
  let filters = clone(options.filters || {});
  let order = Object.keys(filters).filter((k) => filters[k].values.length); // chips in the order they were added
  let open = null; // null, 'add', or a field key

  const bar = document.createElement('div');
  bar.className = 'fc-bar';
  container.replaceChildren(bar);

  function clone(f) {
    const out = {};
    for (const [k, v] of Object.entries(f)) if (v) out[k] = { not: Boolean(v.not), values: [...(v.values || [])] };
    return out;
  }
  const field = (key) => options.fields.find((f) => f.key === key);
  const changed = () => options.onChange && options.onChange(clone(filters));
  const make = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  // Fields left open with nothing ticked disappear when their menu closes.
  function prune() {
    order = order.filter((k) => filters[k] && filters[k].values.length);
    for (const k of Object.keys(filters)) if (!order.includes(k)) delete filters[k];
  }

  function close(focusKey) {
    if (!open) return;
    open = null;
    prune();
    draw();
    const target = focusKey && bar.querySelector(`[data-key="${CSS.escape(focusKey)}"] .fc-open`);
    (target || bar.querySelector('.fc-add')).focus();
  }

  function draw() {
    bar.replaceChildren();
    for (const key of order) {
      const f = filters[key];
      const fld = field(key);
      if (!f || !fld) continue;
      const slot = make('div', 'fc-slot'); slot.dataset.key = key;
      const chip = make('span', 'fc-chip' + (f.not ? ' fc-not' : ''));
      const openBtn = make('button', 'fc-open'); openBtn.type = 'button';
      if (fld.flag != null) {
        // An on/off filter has nothing to edit: the chip is its label, and ✕ turns it off.
        openBtn.append(make('span', 'fc-values', fld.label));
        openBtn.disabled = true;
        chip.classList.add('fc-flag');
      } else {
        const [a, b] = chipText(fld.label, f);
        openBtn.append(make('span', 'fc-field', a), make('span', 'fc-values', b));
        openBtn.setAttribute('aria-haspopup', 'true');
        openBtn.setAttribute('aria-expanded', String(open === key));
        openBtn.onclick = (e) => { e.stopPropagation(); if (open === key) close(key); else { open = key; prune(); draw(); focusMenu(); } };
      }
      const rm = make('button', 'fc-remove', '✕'); rm.type = 'button';
      rm.setAttribute('aria-label', `${t.remove}: ${fld.label}`);
      rm.onclick = (e) => { e.stopPropagation(); delete filters[key]; order = order.filter((k) => k !== key); open = null; draw(); changed(); bar.querySelector('.fc-add').focus(); };
      chip.append(openBtn, rm);
      slot.append(chip);
      if (open === key) slot.append(valueMenu(fld));
      bar.append(slot);
    }

    const slot = make('div', 'fc-slot');
    const add = make('button', 'fc-add', t.add); add.type = 'button';
    add.setAttribute('aria-haspopup', 'true');
    add.setAttribute('aria-expanded', String(open === 'add'));
    add.onclick = (e) => { e.stopPropagation(); if (open === 'add') close(); else { open = 'add'; prune(); draw(); focusMenu(); } };
    slot.append(add);
    if (open === 'add') slot.append(fieldMenu());
    bar.append(slot);

    if (order.length > 1) {
      const clear = make('button', 'fc-clear', t.clear); clear.type = 'button';
      clear.onclick = () => { filters = {}; order = []; open = null; draw(); changed(); bar.querySelector('.fc-add').focus(); };
      bar.append(clear);
    }
  }

  function fieldMenu() {
    const menu = make('div', 'fc-menu'); menu.id = id + '-menu';
    menu.onclick = (e) => e.stopPropagation();
    const left = options.fields.filter((f) => !order.includes(f.key));
    if (!left.length) menu.append(make('p', 'fc-note', t.empty));
    for (const fld of left) {
      const b = make('button', 'fc-item'); b.type = 'button';
      const flag = fld.flag != null ? String(fld.flag) : null;
      // A field shows how many values it has; an on/off filter shows how many rows it would keep.
      const n = flag != null ? (options.count ? options.count(fld.key, flag) : '') : options.values(fld.key).length;
      b.append(make('span', null, fld.label), make('small', null, String(n)));
      b.onclick = () => {
        order.push(fld.key);
        if (flag != null) { filters[fld.key] = { not: false, values: [flag] }; open = null; draw(); changed(); bar.querySelector('.fc-add').focus(); return; }
        filters[fld.key] = { not: false, values: [] }; open = fld.key; draw(); focusMenu();
      };
      menu.append(b);
    }
    return menu;
  }

  function valueMenu(fld) {
    const f = filters[fld.key];
    const menu = make('div', 'fc-menu'); menu.id = id + '-menu';
    menu.onclick = (e) => e.stopPropagation();
    const head = make('div', 'fc-head');
    head.append(make('span', null, fld.label));
    const seg = make('div', 'fc-seg'); seg.setAttribute('role', 'group');
    for (const [not, label] of [[false, t.is], [true, t.isNot]]) {
      const b = make('button', null, label); b.type = 'button';
      b.setAttribute('aria-pressed', String(f.not === not));
      b.onclick = () => { if (f.not !== not) { f.not = not; update(); } };
      seg.append(b);
    }
    head.append(seg);
    menu.append(head);
    const list = make('div', 'fc-list');
    const values = options.values(fld.key);
    if (!values.length) list.append(make('p', 'fc-note', t.empty));
    for (const v of values) {
      const lab = make('label', 'fc-value');
      const cb = make('input'); cb.type = 'checkbox'; cb.checked = f.values.includes(v); cb.value = v;
      cb.onchange = () => {
        if (cb.checked) { if (!f.values.includes(v)) f.values.push(v); } else f.values = f.values.filter((x) => x !== v);
        update();
      };
      const n = make('small', 'fc-count'); n.dataset.value = v;
      lab.append(cb, make('span', null, v), n);
      list.append(lab);
    }
    menu.append(list);
    const foot = make('div', 'fc-foot');
    const rm = make('button', 'fc-link', t.remove); rm.type = 'button';
    rm.onclick = () => { delete filters[fld.key]; order = order.filter((k) => k !== fld.key); open = null; draw(); changed(); bar.querySelector('.fc-add').focus(); };
    const done = make('button', 'fc-link', t.done); done.type = 'button';
    done.onclick = () => close(fld.key);
    foot.append(rm, done);
    menu.append(foot);

    // Ticking a box updates the chip and counts in place, so focus stays on the checkbox.
    function update() {
      const slot = menu.parentElement;
      const chip = slot.querySelector('.fc-chip');
      chip.classList.toggle('fc-not', f.not);
      const [a, b] = chipText(fld.label, f);
      chip.querySelector('.fc-field').textContent = a;
      chip.querySelector('.fc-values').textContent = b;
      seg.querySelectorAll('button').forEach((b2, i) => b2.setAttribute('aria-pressed', String(f.not === (i === 1))));
      changed();
      counts(menu, fld.key);
    }
    queueMicrotask(() => counts(menu, fld.key));
    return menu;
  }

  function counts(menu, key) {
    if (!options.count) return;
    menu.querySelectorAll('.fc-count').forEach((n) => {
      const c = options.count(key, n.dataset.value);
      n.textContent = String(c);
      n.closest('.fc-value').classList.toggle('fc-zero', c === 0);
    });
  }

  function focusMenu() {
    const first = bar.querySelector('.fc-menu input, .fc-menu .fc-item');
    if (first) first.focus();
  }

  // Click outside or Esc closes an open menu.
  const outside = (e) => { if (open && !bar.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape' && open && !e.isComposing) { e.stopPropagation(); close(open === 'add' ? null : open); } };
  document.addEventListener('click', outside);
  bar.addEventListener('keydown', onKey);

  draw();

  return {
    get: () => clone(filters),
    set(next) {
      filters = clone(next || {});
      order = order.filter((k) => filters[k]).concat(Object.keys(filters).filter((k) => !order.includes(k)));
      open = null; prune(); draw();
    },
    // Call when the rows or the other filters change, to refresh counts in an open menu.
    refresh() { const menu = bar.querySelector('.fc-menu'); if (menu && open && open !== 'add') counts(menu, open); },
    close: () => close(),
    destroy() { document.removeEventListener('click', outside); container.replaceChildren(); },
  };
}
