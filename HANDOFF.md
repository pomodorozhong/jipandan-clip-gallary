# Handoff

## In progress

### feat/chip-board-viewer

- Task: first version of the clip gallery: README goals, then the chip board viewer (no issue yet; see P-02)
- PR: #1 into `main`, opened under P-01; awaiting review
- Code checkpoint: bb78ccb
- State: README goals, phases and visual direction committed (46ce859, 9366502). The chip board viewer with sample data is committed (44bacdc). To follow the web project defaults, the site moved into `src/` (37ea47e), local serving and checks moved to npm scripts with the `serve` package (b5d6a1b), and a workflow publishes `src/` to GitHub Pages and runs `npm run check` on PRs (bb78ccb). `feat/import-clips` is stacked on this branch and does not have these commits yet: its import script and docs still name `data/clips.json` and `clips/`, which are now under `src/`, and its "Importing clips" README section should move to a doc in `docs/`, since the README is now a short overview that links to focused docs (goals, using the viewer, data format, development, decisions). An untracked `.claude/launch.json` (local preview config, now `npm run serve`) is intentionally not committed.
- Verification: after the move, `npm run serve` served the board with 44 sample clips at http://localhost:8765, CSS and data loaded, a missing audio file returned 404 (so chips can mark it broken), and the console had no errors. `npm run check` passed on each of the three new commits in a clean worktree. Earlier, at 44bacdc, switching columns, colour, sort, filters, the URL-hash view, playing a test tone and phone width (375px) all worked; the move changed no code, so these were not re-run. On PR #1 the workflow's `check` job passed and `deploy` was skipped as intended; the deploy job has not run yet (it needs `main` and the Pages setting). Not tested: Safari or Firefox, real audio files.
- Next action: get the PR reviewed and merged, then turn on GitHub Pages (P-04).

## Ranked work

1. Review and merge the viewer PR (`feat/chip-board-viewer`)
2. P-02 Load the real clip list and audio, after deciding the audio format
3. P-04 Turn on GitHub Pages (source: GitHub Actions) once the PR merges
4. Bring `feat/import-clips` up to date with the `src/` move and the docs split (merge the base branch, update its script and docs paths, move its README section into `docs/`)
5. P-03 Review phase: statuses and feedback (later phase)

## Pending

- **P-02** File issue: "Load the real clip list and audio". Labels: `enhancement`. Body: Replace the 44 sample clips in `data/clips.json` with the team's real clips (each has `title`, `audio`, `source-game`, `use-case`; roughly 50–100 clips per game and 10–30 per use case) and add the audio files under `clips/<game>/`. Open question (needs decision): which audio format to store. The sample paths use `.ogg`, but Safari support for Ogg is limited, so `.mp3` or `.m4a` may be safer for teammates on Safari or iPhone. Also decide whether audio lives in this repo or elsewhere (GitHub Pages sites are limited to about 1 GB). Done when: the real clips show on the board and play in the browsers the team uses.
  Why: filing issues needs approval. Blocks: real use of the viewer.
- **P-03** File issue: "Review phase: clip statuses and feedback". Labels: `enhancement`. Body: Second phase from the README: let the team move clips through statuses (raw, candidate, approved, used in game, rejected) and leave feedback. Open question (needs decision): where review data is written, since GitHub Pages is static (options: edit `data/clips.json` through PRs, GitHub issues per clip, or an external store). A `status` field can already be added as a dimension today with no code change. Done when: a teammate can mark a clip's status and others see it.
  Why: filing issues needs approval. Blocks: nothing now (later phase).
- **P-04** Turn on GitHub Pages: Settings → Pages → Source: "GitHub Actions" (the workflow in `.github/workflows/pages.yml` publishes `src/`). Optionally also turn on "Automatically delete head branches" (currently off). Why: repository settings need approval. Blocks: the team opening the viewer at its github.io address. Waits on: PR #1 merging.
