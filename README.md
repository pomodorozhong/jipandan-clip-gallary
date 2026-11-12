# jipandan-clip-gallary

A small gallery for sorting, tagging, and browsing short audio clips, built for our three-person indie game team.

## Why this exists

While making our game we collect many short audio clips, mostly voice lines under about 5 seconds. They pile up quickly, and plain folders make it hard to answer questions like "which clips could work as a hurt sound?" or "what do we have for the shopkeeper?". This project gives the team one shared place to listen to clips, see how they are organized, and find the right one fast.

## Goals

- **Quick listening.** Play any clip with one click or key press, so we can audition many clips in a row.
- **Multi-dimensional grouping and sorting.** Each clip can carry several independent labels, and the viewer can group, filter, and sort by any of them, alone or combined. Example dimensions:
  - Proposed use case (for example: UI feedback, hurt, victory, idle chatter, tutorial line)
  - Character or speaker
  - Mood or emotion
  - Status (raw, candidate, approved, used in game, rejected)
  - Length, date added, or who recorded it
- **Easy to add dimensions.** A new way of grouping clips should only need a new field in the clip data, not a code change to the viewer.
- **Hosted on GitHub Pages.** The viewer is a static site served from this repo, so everyone on the team can open it in a browser with no server, login, or install.
- **Simple for a small team.** Clips and their labels live in the repo, so changes are tracked in Git and reviewed like any other change.

## Phases

1. **Skim (now).** Teammates open the viewer and quickly listen through clips. This is the immediate goal.
2. **Review (later).** Build a review process into the viewer, such as moving clips through statuses (raw, candidate, approved, used in game, rejected) and leaving feedback. The data format should leave room for this, but the first version does not need it.

## Visual direction

A board of compact chips: one column per value of a chosen dimension (use case by default). Each clip is a small "▶ title" chip, and its play button takes the colour of another chosen dimension (such as speaker or source game), so the board stays dense even with many clips. The viewer lets you pick which dimension sets the columns, which one sets the colours, and how chips sort inside a column.

## Non-goals

- Not an audio editor. Trimming, mixing, and processing happen in other tools.
- Not built for long audio such as music tracks or ambient loops, though it should not break on them.
- Not a public asset store. It is a working tool for our team.

## How it works

The viewer is a plain static site with no build step: [index.html](index.html), [assets/app.js](assets/app.js), and [assets/style.css](assets/style.css). It reads every clip from [data/clips.json](data/clips.json) and shows each one as a small "▶ title" chip on a board.

- **Columns** splits the board into one column per value of the chosen dimension.
- **Colour by** gives each value of a dimension its own colour on the chip's play button, with a key above the board.
- **Sort** orders chips inside each column by title, by the order in the data file, or by any dimension.
- **Filters** narrow the board to one value of any dimension. **Search** matches clip titles.
- Click a chip to play it, and click again to stop. A chip whose audio file is missing turns grey and is struck through.
- The current view is kept in the page address, so you can send a teammate a link to exactly what you are looking at.

## Data format

`data/clips.json` holds a list of dimensions and a list of clips:

```json
{
  "dimensions": [
    { "key": "use-case", "label": "Use case", "order": ["Hurt", "Victory"] },
    { "key": "source-game", "label": "Source game" }
  ],
  "clips": [
    { "title": "grunt", "audio": "clips/game-a/grunt.ogg", "source-game": "Game A", "use-case": "Hurt" },
    { "title": "huh", "audio": "clips/game-b/huh.ogg", "source-game": "Game B", "use-case": ["UI feedback", "Idle chatter"] }
  ]
}
```

- `title` and `audio` are required on every clip. `audio` is a path relative to the site root, or a full URL.
- Every other field is a dimension. Its value is a string, or a list of strings when a clip belongs to more than one group; the clip then shows up in each of those columns.
- `dimensions` sets the labels and the menu order. `order` is optional and fixes the order of values (for example the column order); values not listed follow in A–Z order. If `dimensions` is left out, the viewer uses every other field on the clips and names it from its key.
- A clip with no value for a dimension goes in a "(none)" group.
- To add a new dimension, such as `speaker` or `mood`, add the field to the clips and an entry to `dimensions`. No code change is needed.

The clips in the file now are sample data with no audio files behind them. Replace them with the real list and put the audio under `clips/`.

## Running it locally

Browsers will not load the data file from a page opened straight from disk, so serve the folder over HTTP:

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765.

## Hosting on GitHub Pages

In the repository's **Settings → Pages**, set **Source** to "Deploy from a branch", pick `main` and the `/ (root)` folder, and save. The viewer is then published at `https://<owner>.github.io/jipandan-clip-gallary/` and updates on every push to `main`.

## Status

The first version of the viewer works with sample data. Next steps are loading the real clips and, later, the review phase.
