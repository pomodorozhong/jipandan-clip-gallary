# Using the viewer

The viewer shows every clip from [src/data/clips.json](../src/data/clips.json) as a small "▶ title" chip on a board.

- **Columns** splits the board into one column per value of the chosen dimension.
- **Colour by** gives each value of a dimension its own colour on the chip's play button, with a key above the board.
- **Sort** orders chips inside each column by title, by the order in the data file, or by any dimension. Once clips have been published with the triage page, the board opens sorted by wave, newest first; clips without a wave come last.
- **+ Filter** narrows the board. Pick a dimension, then tick one or more values; switch **is** to **is not** to hide them instead. Each filter shows as a chip: click it to change it, or its ✕ to remove it. Several filters combine, so `Use case: Victory, 失敗` with `Source game is not REPO` shows Victory and 失敗 clips from every game but REPO. **Search** matches clip titles. The filter bar is a reusable component; see [Filter chips](filter-chips.md).
- Click a chip to play it, and click again to stop. While it plays, the chip fills from left to right in a light tint of its colour, so you can see how much of the clip is left. A chip whose audio file is missing turns grey and is struck through.
- The current view is kept in the page address, so you can send a teammate a link to exactly what you are looking at.
