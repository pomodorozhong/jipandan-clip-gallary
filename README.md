# jipandan-clip-gallary

A small gallery for sorting, tagging, and browsing short audio clips, built for our three-person indie game team.

While making our game we collect many short voice clips, and plain folders make it hard to answer questions like "which clips could work as a hurt sound?". This viewer shows every clip as a "▶ title" chip on a board that you can split into columns, colour, sort, and filter by any label, such as use case or source game.

## Quick start

```bash
npm install
```

```bash
npm run serve
```

Then open http://localhost:8765.

To import, tag and publish new clips, open the local triage page:

```bash
npm run triage
```

It opens in your browser at http://127.0.0.1:8770. See [Importing and triaging clips](docs/triage.md).

## Docs

- [Goals](docs/goals.md): what the gallery is for, its phases, and non-goals.
- [Using the viewer](docs/using-the-viewer.md): how the board works.
- [Data format](docs/data-format.md): how to add clips and dimensions.
- [Importing and triaging clips](docs/triage.md): adding new clips, tagging them, and publishing them.
- [Development](docs/development.md): checks and GitHub Pages hosting.
- [Decisions](docs/decisions.md): what was chosen and why.

## Status

The first version of the viewer works with sample data, and a local triage page can import, tag and publish real clips. Next steps are loading the real clips and, later, the review phase.
