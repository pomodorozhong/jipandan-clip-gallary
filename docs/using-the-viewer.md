# Using the viewer

The viewer shows every clip from [src/data/clips.json](../src/data/clips.json) as a small "▶ title" chip on a board.

- At the top, a white card holds the ways to find clips: the search box (press **/** to jump to it), **+ Filter**, and how many clips match. Under it, a quieter line sets how the board looks (**Columns**, **Colour**, **Sort**), followed by the colour key.
- **Columns** splits the board into one column per value of the chosen dimension.
- **Colour** gives each value of a dimension its own colour on the chip's play button, with a key beside the settings. Choose **Nothing** for one colour.
- **Sort** orders chips inside each column by title, by the order in the data file, or by any dimension. Once clips have been published with the triage page, the board opens sorted by batch, newest first; clips without a batch come last.
- **+ Filter** narrows the board. Pick a dimension, then tick one or more values; switch **is** to **is not** to hide them instead. Each filter shows as a chip: click it to change it, or its ✕ to remove it. Several filters combine, so `Use case: Victory, 失敗` with `Source game is not REPO` shows Victory and 失敗 clips from every game but REPO. **Search** matches titles and every other field (game, use case, batch, recording) and the clip's file name; a chip found through another field says which, such as "· source game". The filter bar is a reusable component; see [Filter chips](filter-chips.md).
- Click a chip to play it, and click again to stop. While it plays, the chip fills from left to right in a light tint of its colour, so you can see how much of the clip is left. A chip whose audio file is missing turns grey and is struck through.
- Clicking a chip also selects it and opens a bar at the bottom with its title, its tags and its **unique name**, the clip's file name, which no other clip shares (titles can repeat). From the bar:
  - **☆ Star** marks the clip. Starred chips show a ★, and **+ Filter → ★ Starred** shows only them. Stars are kept in your browser, so each teammate has their own.
  - **Copy name** copies the unique name, to paste in chat.
  - **Copy link** copies a link that opens the gallery with that clip selected and scrolled into view. Browsers don't play sound before a click, so click it to play.
- The current view is kept in the page address, so you can send a teammate a link to exactly what you are looking at.
- The page is in Traditional Chinese, with English as the other choice: **中文 | EN** at the end of the view line switches it. Your browser remembers the pick. Switching keeps everything else as it was: the columns, colour, sort, filters, search, the selected clip and a clip that is playing. Only the page's own words change; titles, use cases, games and batches stay as the team wrote them. The built-in fields have Chinese names (用途 for Use case, 來源遊戲 for Source game, 錄音 for Recording, 批次 for Batch); a field added later shows its `label` from `clips.json` in both languages until it gets a translation (see [Interface text](development.md#interface-text)).
