# Filter chips

The viewer's filters are a small, self-contained component, so the same "+ Filter" bar can be reused in other projects. It is two files with no dependencies: [src/assets/filter-chips.mjs](../src/assets/filter-chips.mjs) and [src/assets/filter-chips.css](../src/assets/filter-chips.css).

## How it behaves

- With nothing filtered, the bar shows only a dashed **+ Filter** chip.
- **+ Filter** lists the fields that are not filtered yet, with how many values each has. Picking one opens a checklist of its values, each with the number of rows it would show given the other filters.
- An **is / is not** switch at the top of the checklist chooses between keeping and hiding the ticked values.
- Each active filter is one chip: blue for "is" (`Use case: Victory, 失敗`, or `Victory, 失敗 +2` for more), red for "is not" (`Source game is not REPO`). Click the chip to change it; click its ✕ to remove it.
- A field opened and left with nothing ticked disappears when its menu closes. **Clear all** appears once two or more filters are active.
- A row passes a field when it has any of the ticked values ("is"), or none of them ("is not"). Fields combine with AND.
- Esc or a click outside closes a menu and puts focus back on its chip. Ticking a box updates the chip in place, so keyboard focus stays where it was.

## Reusing it in another project

Copy both files, load the stylesheet, and import the module:

```html
<link rel="stylesheet" href="filter-chips.css">
<div id="filters"></div>
<script type="module">
  import { createFilterChips, filterRows } from './filter-chips.mjs';

  const rows = [{ title: 'grunt', game: 'REPO', tags: ['Hurt', 'Short'] }, /* … */];
  const fields = [{ key: 'game', label: 'Game' }, { key: 'tags', label: 'Tag' }];
  const valuesOf = (row, key) => [].concat(row[key] ?? []).map(String);
  const distinct = (key) => [...new Set(rows.flatMap((r) => valuesOf(r, key)))].sort();

  let filters = {};
  const bar = createFilterChips(document.getElementById('filters'), {
    fields,
    values: distinct,
    count: (key, value) => rows.filter((r) => valuesOf(r, key).includes(value)).length, // optional
    onChange: (next) => { filters = next; draw(); },
  });

  function draw() {
    const shown = rows.filter(filterRows(filters, valuesOf));
    // … render `shown`
  }
</script>
```

`createFilterChips(container, options)` takes:

| Option | Meaning |
| --- | --- |
| `fields` | `[{ key, label }]`: the fields offered under **+ Filter**, in that order. |
| `values(key)` | The field's values, in the order the checklist lists them. |
| `count(key, value)` | Optional. How many rows ticking that value would show. For counts that follow the other filters, filter with `filterRows(without(filters, key), valuesOf)` first. |
| `filters` | Optional starting filters. |
| `onChange(filters)` | Called after every change, with a fresh copy of the filters. |
| `text` | Optional labels: `add`, `clear`, `remove`, `is`, `isNot`, `empty`, `done`. |

It returns `{ get(), set(filters), refresh(), close(), destroy() }`. Call `refresh()` when the rows or anything else that affects `count` changes (the viewer calls it when the search text changes), and `set()` to replace the filters from outside, for example when the page address changes.

Filters are plain objects, `{ [key]: { not: boolean, values: string[] } }`. The module also exports the helpers it uses, which have no DOM code and are covered by [tests/filter-chips.test.mjs](../tests/filter-chips.test.mjs):

- `filterRows(filters, valuesOf)` returns a predicate for rows.
- `without(filters, key)` returns the filters minus one field.
- `toParams(filters, params?)` and `fromParams(params, keys?)` store filters in `URLSearchParams`: one `f.<key>=<value>` per value, `nf.<key>` for "is not". Values may contain any character.
- `chipText(label, filter)` returns the chip's text as `[field part, values part]`.

## Styling

Every colour is a CSS custom property on `.fc-bar`, with a fallback, so the bar looks right on its own and picks up a host page's `--link`, `--surface`, `--bg`, `--ink` and `--muted` tokens when they exist. Override any of them on `.fc-bar` or a parent:

| Property | Used for |
| --- | --- |
| `--fc-accent` | "is" chips, the dashed chip, links, focus rings |
| `--fc-not` | "is not" chips |
| `--fc-surface` | Menus |
| `--fc-soft` | Hovered rows and the is / is not switch |
| `--fc-ink`, `--fc-muted` | Text |

All class names start with `fc-`, so they don't clash with the host page.
