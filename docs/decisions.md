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
