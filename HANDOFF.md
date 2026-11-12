# Handoff

## In progress

### feat/chip-board-viewer

- Task: first version of the clip gallery: README goals, then the chip board viewer (no issue yet; see P-02)
- PR: into `main`, opened under P-01; awaiting review
- Code checkpoint: 44bacdc
- State: README goals, phases and visual direction committed (46ce859, 9366502). The chip board viewer with sample data is committed (44bacdc). The branch was renamed from `docs/readme-goals` and pushed for its PR. `feat/import-clips` is stacked on it. An untracked `.claude/launch.json` (local preview config) is intentionally not committed.
- Verification: in the browser at http://localhost:8765 the board renders 44 sample clips; switching columns and colour between `use-case` and `source-game`, sorting by a dimension, filtering, and the URL-hash view all worked; a temporary test tone played and reset on end (then deleted); a missing file marks the chip broken; phone width (375px) stacks the controls and scrolls the board sideways. `node --check assets/app.js` and JSON parse of `data/clips.json` passed. Not tested: Safari or Firefox, real audio files.
- Next action: get the PR reviewed and merged, then turn on GitHub Pages (P-04).

## Ranked work

1. Review and merge the viewer PR (`feat/chip-board-viewer`)
2. P-02 Load the real clip list and audio, after deciding the audio format
3. P-04 Turn on GitHub Pages from `main` once the PR merges
4. P-03 Review phase: statuses and feedback (later phase)

## Pending

- **P-02** File issue: "Load the real clip list and audio". Labels: `enhancement`. Body: Replace the 44 sample clips in `data/clips.json` with the team's real clips (each has `title`, `audio`, `source-game`, `use-case`; roughly 50–100 clips per game and 10–30 per use case) and add the audio files under `clips/<game>/`. Open question (needs decision): which audio format to store. The sample paths use `.ogg`, but Safari support for Ogg is limited, so `.mp3` or `.m4a` may be safer for teammates on Safari or iPhone. Also decide whether audio lives in this repo or elsewhere (GitHub Pages sites are limited to about 1 GB). Done when: the real clips show on the board and play in the browsers the team uses.
  Why: filing issues needs approval. Blocks: real use of the viewer.
- **P-03** File issue: "Review phase: clip statuses and feedback". Labels: `enhancement`. Body: Second phase from the README: let the team move clips through statuses (raw, candidate, approved, used in game, rejected) and leave feedback. Open question (needs decision): where review data is written, since GitHub Pages is static (options: edit `data/clips.json` through PRs, GitHub issues per clip, or an external store). A `status` field can already be added as a dimension today with no code change. Done when: a teammate can mark a clip's status and others see it.
  Why: filing issues needs approval. Blocks: nothing now (later phase).
- **P-04** Turn on GitHub Pages: Settings → Pages → Deploy from a branch → `main`, `/ (root)`. Optionally also turn on "Automatically delete head branches" (currently off). Why: repository settings need approval. Blocks: the team opening the viewer at its github.io address. Waits on: P-01 PR merging.
