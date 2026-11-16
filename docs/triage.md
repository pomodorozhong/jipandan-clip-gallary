# Importing and triaging clips

New clips go through a triage page that runs only on your computer. You import exported clips, give each source folder a game and each clip a use case, then publish them. The team's GitHub Pages site only ever shows published clips.

## Opening the triage page

Double-click **Triage.command** in the repository folder in Finder. A Terminal window opens and the triage page opens in your browser at http://127.0.0.1:8770. Close the Terminal window to stop it. (`npm run triage` does the same from a terminal.)

It needs Python 3 and git, which macOS already has once the Xcode command line tools are installed. No packages to install.

The first time, macOS may ask whether to open the file; choose Open.

## Importing

1. Click **+ Import** at the top of the sidebar, then **Choose folder…** or drop an export folder onto the box.
2. Every audio file in the folder and its subfolders is listed under its source folder (the export folder first, then each subfolder), with its title, recording and file name. Play any of them to check. **Change folder** goes back to pick a different export.
3. Click **Import**. The clips are copied into `inbox/` in the repository, which git ignores, and appear in the **Untagged** column.
4. The dialog moves on to **Pick a game for each folder**: one menu per source folder, with its clips listed. **Set every folder to** fills them all at once, and **+ New game…** adds a game. **Done** gives every clip its folder's game. **Skip for now** leaves them in the **No game yet** column, to set later from the sidebar.

All clips are stored flat in `clips/` under their export file name; subfolders in the export only group clips for picking games. A clip remembers its source folder while it waits in `inbox/`, and that is dropped when it is published. While listing, the page checks each file's audio content (a SHA-256 hash) against the gallery:

- **Already imported:** the same audio is already a clip, even under another file name. It is greyed out and not imported again.
- **Repeat:** the same audio appears twice in the export folder; only the first is imported.
- **Saved as …-2:** a different clip already has this file name, so `-2` (or `-3`, and so on) is added before the extension.

Titles come from the file names. Files exported by jipandan-clip are named `<recording>_<clip id>_<title>.mp3`, so the title is the last part and the recording name goes into a `recording` dimension. Other files use their whole name as the title.

## Triaging

The page has a sidebar for the triage work and the board on the right, with **Publish** always at the bottom of the sidebar.

- **Sidebar:** shows how many new clips have a use case, and the selected clip.
  - Click a chip to play and select it, or press **N** (or **Next untagged**) to jump to the next clip without a use case.
  - Click a use case, or press its number. The clip moves into that column and the next untagged clip starts playing. **Untag** (or 0) clears it.
  - Keys 1–9 go to the most-used use cases when the page opens, and stay put while you work. New use cases take any free key.
  - With many use cases, only the first 15 show; **Show all** lists the rest. Type in **Filter or create…** (or press **/**) to narrow them. Enter picks the first match, or creates the typed use case when nothing matches.
  - **Game** under the selected clip changes that one clip's `source-game`, for a clip whose game differs from the rest of its import. If any clip has no game, a link above jumps to it.
  - **Drop** (or D) moves the selected clip to a **Dropped** column at the end of the board and moves on to the next untagged clip; the message that appears offers **Undo**. A dropped new clip stays in `inbox/` and is never published; importing it again shows it as "dropped before". A dropped published clip is removed from the gallery, with its audio file, on the next Publish. Select a dropped clip and press **Restore** (or D) to bring it back.
- Keys: Space plays or stops the selected clip, the arrow keys move between clips, 1–9 tag, 0 untags, N jumps to the next untagged clip, D drops or restores, / filters use cases, Esc deselects.
- Published clips are on the board too, so you can change their tags. A small orange dot marks a clip that is not published or has unpublished changes.

Your work on unpublished clips is saved in `inbox/` as you go, so you can close the page and continue later. Changes to clips that are already published live only in the open page until you publish them.

## Publishing

**Publish** sends every clip that has both a game and a use case (and is not dropped) to GitHub: it moves their audio into `src/clips/`, adds them to `src/data/clips.json`, commits only those two paths on the branch you have checked out, and pushes that branch. Clips still missing a game or a use case stay in `inbox/`, on your computer only.

- **On `main`**, the site updates about a minute later.
- **On another branch**, the clips go live once that branch is merged into `main`. **Open a pull request**, under the Publish button, opens one on GitHub so someone can review the clips first.

- Publishing needs a branch checked out. In a detached checkout you can still import and tag.
- Keep clip branches short-lived: two open branches that both add clips will conflict in `src/data/clips.json`.
- If `src/data/clips.json` changed on GitHub since the page loaded, Publish stops and asks you to reload, so nobody's changes are overwritten.
- **Remove N clips with missing audio** appears when the list has clips without an audio file, such as the sample data. They are removed on the next Publish.
- If the push fails (for example, no network), the commit is kept; push the branch once it works again.
