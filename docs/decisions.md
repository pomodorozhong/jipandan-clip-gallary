# Decisions

## Visual direction: chip board (2026-11-12)

Three directions were mocked up (dark sample browser, multi-level table, playful board), then four variations of the board (lanes, skim player, phone, chips). The team chose the board with minimal "▶ title" chips (mockup C4).

Why: there are many clips (about 50–100 per game), so compact chips that wrap inside each column fit far more on screen than cards. Grouping into columns and colour-coding a second dimension were the parts the team found most useful. The colour sits on the chip's play button, so it adds no width.

The mockups are kept on a private design canvas owned by the project lead.

## Phases: skim first, review later (2026-11-12)

The first version only needs teammates to skim and listen to clips. A review process (statuses, feedback) is wanted later. The data format leaves room for it: a `status` field can be added as a dimension with no code change.

## Static site with no build step (2026-11-12)

The viewer is plain HTML, CSS and JavaScript in `src/`. A GitHub Actions workflow publishes that folder to GitHub Pages as it is, with no build.

Why: the team is three people and the page is small; skipping a build keeps hosting to "push to `main`" and lets anyone edit it.

## Site in `src/`, npm for local tools (2026-11-15)

The site moved from the repository root into `src/`, so the root holds only project-wide files. GitHub Pages can only publish the root or `/docs` from a branch, so a workflow (`.github/workflows/pages.yml`) publishes `src/` instead; the Pages source is "GitHub Actions". Local serving and checks run through npm scripts (`npm run serve`, `npm run check`) rather than Python's HTTP server.

Why: this follows the team's web project defaults (a tidy root, npm for tooling) without adding a build step. Vite was considered and left out for now: it would add a build and more root files for a page this small; it can be added later by pointing it at `src/`.

Gotcha: browsers block `fetch` of `src/data/clips.json` from a page opened with `file://`, so preview through a local HTTP server.

## Data model: every extra field is a dimension (2026-11-12)

Each clip needs `title` and `audio`; every other field is a dimension. A value can be a string or a list of strings, and a clip with a list shows in each matching column. The optional `dimensions` list in `src/data/clips.json` sets labels, menu order, and a fixed value order; without it, dimensions are inferred from the clips.

Why: the team wants to group and sort by more than one dimension (source game and use case today, likely speaker, mood or status later) without code changes.

Colour assignment is built from all clips, not the filtered set, so a value keeps its colour while filtering. The palette has 10 colours and repeats after that.

## Interface in Traditional Chinese, English as the fallback (2026-11-22)

Both pages show their interface in Traditional Chinese (zh-Hant), with a **中文 | EN** switch each browser remembers ([#9](https://github.com/pomodorozhong/jipandan-clip-gallary/issues/9)). The clips, the use cases and the team are Chinese, and the English controls sat oddly beside them.

- zh-Hant is the default for everyone, not only for browsers that ask for Chinese, because the team is Chinese whatever their browser says.
- Built-in dimension names are translated in the message table by key (`dim.use-case` and so on), not in `clips.json`, so the data format and Publish stay as they were; `clips.json` keeps its English `label` as the fallback for dimensions added later. Per-language labels in the JSON were the other option.
- Switching redraws in place instead of reloading, so the view, the selected clip, playback and unpublished triage work all stay.
- The triage server reports what Publish did as a `notice` the page words in its language; its refusals and git errors stay in English, since they are rare and mostly read when debugging.
- No i18n library: two languages and a few hundred strings fit in plain modules, and the site has no build step.

## Clips come in through a local triage page (2026-11-16)

New clips are imported, tagged and published from a triage page that runs only on the project lead's computer ([triage/](../triage/), served by [scripts/triage.mjs](../scripts/triage.mjs), started with `npm run triage`). It grew out of `clip_picker.py`, an untracked local page in the jipandan-clip repo that listed exported MP3s, played them, and copied a selection to the Desktop. A first version was a command-line import script; it was replaced before merging because the lead wanted to pick, listen and tag in a GUI, without a terminal.

Why: a static GitHub Pages site cannot read a folder or write files, so importing needs a local server. The page reuses the viewer's board (`src/assets/app.js` exposes a few hooks that only the triage page sets), so chips, columns and playback look and work the same.

The server is plain Node.js with no packages. It was first written in Python, because macOS ships `python3` with the same command line tools as git, so a Mac that can publish could run it without installing anything. It was rewritten in Node before merging so the project uses one language: the viewer, the triage page and the npm scripts are already JavaScript, and everyone who works on the project already has Node for `npm run check` and `npm run serve`. The cost is that whoever triages needs Node installed.

- Games are picked per source folder right after import, in a second step of the import dialog, and use cases per clip afterwards, because exports arrive per recording session of one game while use cases differ clip by clip. Each subfolder of an export is its own group, so an export that mixes games by subfolder still takes one pick per game. Games were first set per storage folder in a **Folders** tab; with flat storage (below) a one-game menu in the import dialog was tried and replaced, since the lead wanted to pick games after import and per source folder. A small game menu in the selected clip's subtitle covers the odd exception; it was a full row first, but the game rarely changes after import, so it moved out of the way. The source folder is kept in the inbox only (`import-folder`) and dropped on publish, so `clips.json` keeps its shape.
- Clips are stored flat in `src/clips/` under their export file name. The import dialog first asked for a destination folder per import, which the lead found confusing, and folders added nothing once the game is a field on each clip. Duplicates are found by audio content (SHA-256, sent by the server for every file under `src/clips/` and `inbox/clips/`), so a re-export under a new name is still recognised; a different clip with a taken name gets `-2`, `-3`… The server also refuses an upload that would overwrite a different file. `?`, `#` and `%` in a file name are stored as full-width look-alikes: escaping them (`%3F` and so on) worked in Chromium, but the lead still could not play such clips, so names avoid URL characters altogether.
- **Drop** moves a clip to a Dropped column instead of deleting it: a dropped new clip stays in the inbox (with `dropped: true`) so it can be restored and is recognised if the same export is imported again; a dropped published clip, and its audio, is removed on the next Publish. It was chosen over deleting the file, with or without remembering it, so nothing is lost by a mistaken key press; Undo covers the common slip.
- A clip can have several use cases. A number key or a click turns a use case on or off for the selected clip and never moves the selection, so a second or third use case is one more key press; N and the arrow keys move on. Tagging first replaced the use case and jumped to the next untagged clip, which silently dropped the other use cases of a clip that had several. Drop still jumps on, since a dropped clip needs nothing more.
- Untriaged clips wait in a git-ignored `inbox/` and are published only once they have both a game and a use case, so the team only sees triaged clips and unfinished audio never reaches GitHub.
- Publish commits `src/data/clips.json` and only the audio files it moved in, deleted, or found already in `src/clips/` for a new clip, on the checked-out branch, and pushes it. If the commit fails it undoes its own changes, so a failed publish never leaves the inbox and the published list half-moved. On `main` that goes live straight away, since one person publishes and the team only listens; on another branch the clips can be reviewed in a pull request before they go live. It first published only from `main`; the lead wanted the option of a PR, so it was opened up to any branch. It refuses if the list changed on GitHub since the page loaded, and it refuses to publish a new clip whose audio file is missing, so the live page never lists a clip it cannot play.
- The page puts the triage work in a left sidebar, and keeps Publish pinned at its bottom. It had **Tag clips** and **Folders** tabs until games moved into the import dialog; with one job left, the tabs were removed. It replaced a header, tag bar and folder strip stacked above the board, which grew busy and showed disabled tag buttons when no clip was selected. It was picked from clickable mockups over a two-tier header and a guided focus card, and over sidebar variants with a pinned search list and a board navigator, because tabs keep each job short as use cases and folders grow.
- Titles are parsed from jipandan-clip's export names (`<recording>_<4+ digit clip id>_<title>`), matching the last clip id so recording names that contain digits still parse.
- Each publish is a batch: Publish gives every clip it adds a `batch` with the day's date, and the gallery opens sorted by batch, newest first, with every batch shown. The lead adds clips in batches and wants to sort and filter by batch. A date needs no typing and sorts by itself; a batch can be renamed later in the page. The order lives in the Batch dimension's `order`, newest first, so a renamed batch keeps its place, and the viewer only needed a `defaultSort` flag rather than a new way of sorting. A name typed at every publish was the alternative, but it adds a step each time.
- A use case or game can be renamed on every clip at once, and a taken name merges the two after asking, so a typo or a duplicate tag is fixed in one step instead of re-tagging each clip. The rename replaces the value in the dimension's `order` too, so it keeps its column position and its number key. Batches can be renamed the same way but never merged, since a batch records when its clips were published.
- Filters are a minimal "+ Filter" bar: nothing but a dashed chip until something is filtered, then one chip per field with any number of values and an is / is not switch. It replaced one dropdown per dimension, which allowed only one value each and took a row of space even when unused. It was picked from four clickable mockups (checklist pills, always-visible value rows, a typed query box, a sideways-scrolling row of every value) because the default view stays empty. It is a separate, dependency-free module with its own stylesheet so other projects can copy it.
- "Wave" was renamed "Batch" everywhere, including the `wave` field in `clips.json`, because the team found "wave" confusing and already said "batch". Lists published before keep working: the viewer and the triage server read `wave` as `batch`, and the next publish writes `batch`, so no one-off migration was needed.
- Search matches every field, not only titles: a teammate looking for a game or a use case types it, and the chip says which field matched when it wasn't the title.
- Each clip's unique name is its audio file name without the extension, because the triage page already keeps file names unique and titles repeat (several clips are called "(笑)"). The gallery shows it in a bar under the selected clip with **Copy name** and **Copy link** (`#clip=<name>`). Stars are kept in each browser's storage, so marking clips needs no accounts or server; shared marks would need somewhere to store them and were left for later.
- The top bar separates finding clips from arranging the board. Search, **+ Filter** and the match count share one white card where every control is 40px tall and fully round; the view settings (Columns, Colour, Sort) sit under it as quiet label + value text dropdowns sized to their text, then a hairline and the colour key. It was picked from a high-fidelity mockup after a review found mismatched control heights (44px search beside 34px chips), two shapes side by side, dot separators that read as bullets, fixed-width dropdowns, four text sizes and a key that wrapped onto a third line. The colour key wraps inside its own column so its divider never dangles; at 720px and narrower the settings become three columns over a horizontal hairline.
- Layout and look were settled with clickable mockups in `mockups/` (kept out of git) before any build, because choices changed a lot between rounds: four filter designs, five top-bar layouts, then three high-fidelity versions.
