# Using the viewer

The viewer shows every clip from [src/data/clips.json](../src/data/clips.json) as a small "▶ title" chip on a board.

- At the top, the search box and **+ Filter** find clips. Under them, a line of small dropdowns sets how the board looks: "Columns by … · coloured by … · sorted by …", followed by the colour key and the number of clips shown.
- **Columns by** splits the board into one column per value of the chosen dimension.
- **coloured by** gives each value of a dimension its own colour on the chip's play button, with a key beside the settings. Choose **nothing** for one colour.
- **sorted by** orders chips inside each column by title, by the order in the data file, or by any dimension. Once clips have been published with the triage page, the board opens sorted by batch, newest first; clips without a batch come last.
- **+ Filter** narrows the board. Pick a dimension, then tick one or more values; switch **is** to **is not** to hide them instead. Each filter shows as a chip: click it to change it, or its ✕ to remove it. Several filters combine, so `Use case: Victory, 失敗` with `Source game is not REPO` shows Victory and 失敗 clips from every game but REPO. **Search** matches titles and every other field (game, use case, batch, recording) and the clip's file name; a chip found through another field says which, such as "· source game". The filter bar is a reusable component; see [Filter chips](filter-chips.md).
- Click a chip to play it, and click again to stop. While it plays, the chip fills from left to right in a light tint of its colour, so you can see how much of the clip is left. A chip whose audio file is missing turns grey and is struck through.
- Clicking a chip also selects it and opens a bar at the bottom with its title, its tags and its **unique name**, the clip's file name, which no other clip shares (titles can repeat). From the bar:
  - **☆ Star** marks the clip. Starred chips show a ★, and **+ Filter → ★ Starred** shows only them. Stars are kept in your browser, so each teammate has their own.
  - **Copy name** copies the unique name, to paste in chat.
  - **Copy link** copies a link that opens the gallery with that clip selected and scrolled into view. Browsers don't play sound before a click, so click it to play.
- The current view is kept in the page address, so you can send a teammate a link to exactly what you are looking at.
