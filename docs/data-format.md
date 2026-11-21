# Data format

[src/data/clips.json](../src/data/clips.json) holds a list of dimensions and a list of clips:

```json
{
  "dimensions": [
    { "key": "use-case", "label": "Use case", "order": ["Hurt", "Victory"] },
    { "key": "source-game", "label": "Source game" }
  ],
  "clips": [
    { "title": "grunt", "audio": "clips/grunt.ogg", "source-game": "Game A", "use-case": "Hurt" },
    { "title": "huh", "audio": "clips/huh.ogg", "source-game": "Game B", "use-case": ["UI feedback", "Idle chatter"] }
  ]
}
```

- `title` and `audio` are required on every clip. `audio` is a path relative to `src/` (the site root), or a full URL.
- Every other field is a dimension. Its value is a string, or a list of strings when a clip belongs to more than one group; the clip then shows up in each of those columns.
- `dimensions` sets the labels and the menu order. `order` is optional and fixes the order of values (for example the column order); values not listed follow in A–Z order. If `dimensions` is left out, the viewer uses every other field on the clips and names it from its key.
- A clip with no value for a dimension goes in a "(none)" group.
- A dimension can set `"defaultSort": true`. The board then opens sorted by that dimension's order until the viewer picks another sort.
- `batch` is set by the [triage page](triage.md) when it publishes a clip: the date of that publish (such as `2026-11-21`), or a name the batch was given later. Its dimension lists the newest batch first in `order` and has `"defaultSort": true`. Lists published before this was renamed use `wave` for the field and dimension; the viewer and the triage page read those as `batch`, and the next publish writes `batch`.
- To add a new dimension, such as `speaker` or `mood`, add the field to the clips and an entry to `dimensions`. No code change is needed.

The clips in the file now are sample data with no audio files behind them. Replace them with the real list and put the audio under `src/clips/`, most easily with the [triage page](triage.md).
