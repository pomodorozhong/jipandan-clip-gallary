# Development

The viewer is a plain static site with no build step: [src/index.html](../src/index.html), [src/assets/app.js](../src/assets/app.js), and [src/assets/style.css](../src/assets/style.css).

## Running it locally

Browsers will not load the data file from a page opened straight from disk, so serve the `src` folder over HTTP. With Node.js installed, install the tools once, then start the server:

```bash
npm install
```

```bash
npm run serve
```

Then open http://localhost:8765. `npm run check` catches syntax errors in the scripts and in the data file.

## Tests

```bash
npm test
```

[tests/triage-server.test.mjs](../tests/triage-server.test.mjs) checks the local triage server (`scripts/triage.mjs`) with Node's built-in test runner. Each run builds a throwaway project in a temporary folder (a git repository with a local bare repository as its remote, a few published clips and a few inbox clips), starts the real server there, and talks to it over HTTP, so it never touches your checkout or GitHub. It covers renaming `?`, `#` and `%` file names on start, the state the page loads, static files and the gallery, audio and byte ranges, refused paths, the check that only the triage page may write, uploads that must not overwrite a different file, inbox saves, and Publish (moving audio, removing dropped clips, committing only `src/` and pushing). It needs Node.js and git, nothing else.

The page itself (layout, playback in the browser, keyboard) has no automated tests yet.

## Interface text

Both pages are in Traditional Chinese (zh-Hant) by default, for everyone, with English as the fallback and the other choice on the language switch. No interface text is written in the HTML or the scripts; it all lives in message tables:

- [src/assets/i18n.mjs](../src/assets/i18n.mjs) holds the words both pages share (the board, search, filters, the clip bar) and the code that picks the language, fills in the page and draws the **中文 | EN** switch.
- [triage/messages.mjs](../triage/messages.mjs) holds the triage page's own words.

Each table has an `en` and a `zh-Hant` block with the same keys. A text is a string with `{name}` placeholders, a function of the values (for English plurals: `({ n }) => plural(n, 'clip')`), or a list of parts with `{ b: … }`, `{ kbd: … }` or `{ code: … }` in it for bold, keys or code. A key missing in Chinese shows the English; a key missing in both shows the key itself.

To add a string:

1. Add the key to both blocks of the right table, English and Chinese. `npm test` fails if a key is in only one of them, or if the Chinese asks for a `{placeholder}` the English doesn't have.
2. In HTML, put the key on the element: `data-i18n="key"` for its text, `data-i18n-html="key"` for text with markup (only for our own messages), or `data-i18n-attr="placeholder:key;title:key2"` for attributes. In a script, use `t('key', { name })`, or `I.nodes('key', vars)` for a message with parts.
3. Text a script draws must be drawn again when the language changes: the pages listen for the `langchange` event (the gallery in `app.js`, the triage page through the board's `onLangChange` hook) and redraw.

Data values (titles, use cases, games, batches, `(none)` aside) are never translated. A built-in dimension's name comes from `dim.<key>` in the table; a dimension without one shows its `label` from `clips.json`, so to translate a new dimension add `dim.<its key>` to both blocks. Clip titles are marked `lang="zh-Hant"`, so they get Chinese fonts and line breaks on the English page too.

## Hosting on GitHub Pages

The workflow in [.github/workflows/pages.yml](../.github/workflows/pages.yml) publishes the `src` folder as it is, with no build. In the repository's **Settings → Pages**, set **Source** to "GitHub Actions". The viewer is then published at `https://<owner>.github.io/jipandan-clip-gallary/` and updates on every push to `main`. The same workflow runs `npm run check` and `npm test` on every pull request.
