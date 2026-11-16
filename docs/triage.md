# Importing and triaging clips

New clips go through a triage page that runs only on your computer. You import exported clips, give each source folder a game and each clip a use case, then publish them. The team's GitHub Pages site only ever shows published clips.

## Opening the triage page

In a terminal in the repository folder, run:

```bash
npm run triage
```

The triage page opens in your browser at http://127.0.0.1:8770. Press Ctrl+C in the terminal to stop it.

It needs Node.js 20 or later (the same Node the project's npm scripts use) and git. The server uses no packages, so there is nothing to install beyond those.

## Importing

1. Click **+ Import** at the top of the sidebar, then **Choose folder…** or drop an export folder onto the box.
2. Every audio file in the folder and its subfolders is listed under its source folder (the export folder first, then each subfolder), with its title, recording and file name. Play any of them to check. **Change folder** goes back to pick a different export.
3. Click **Import**. The clips are copied into `inbox/` in the repository, which git ignores, and appear in the **Untagged** column.
4. The dialog moves on to **Pick a game for each folder**: one menu per source folder, with its clips listed. **Set every folder to** fills them all at once, and **+ New game…** adds a game. **Done** gives every clip its folder's game. **Skip for now** leaves them in the **No game yet** column, to set later from the sidebar.

All clips are stored flat in `clips/` under their export file name; subfolders in the export only group clips for picking games. A clip remembers its source folder while it waits in `inbox/`, and that is dropped when it is published. While listing, the page checks each file's audio content (a SHA-256 hash) against the gallery:

- **Already imported:** the same audio is already a clip, even under another file name. It is greyed out and not imported again.
- **Repeat:** the same audio appears twice in the export folder; only the first is imported.
- **Saved as …-2:** a different clip already has this file name, so `-2` (or `-3`, and so on) is added before the extension.

A file name with `?`, `#` or `%` is saved with the full-width look-alike instead (`？`, `＃`, `％`), because some browsers fail to play such files even when the name is escaped. The title keeps the original characters. When the triage server starts, it renames inbox files saved before this rule.

Titles come from the file names. Files exported by jipandan-clip are named `<recording>_<clip id>_<title>.mp3`, so the title is the last part and the recording name goes into a `recording` dimension. Other files use their whole name as the title.

## Triaging

The page has a sidebar for the triage work and the board on the right, with **Publish** always at the bottom of the sidebar.

- **Sidebar:** shows how many new clips have a use case, and the selected clip.
  - Click a chip to play and select it, or press **N** (or **Next untagged**) to jump to the next clip without a use case.
  - Click a use case, or press its number. The clip moves into that column and the next untagged clip starts playing. **Untag** (or 0) clears it.
  - Keys 1–9 go to the most-used use cases when the page opens, and stay put while you work. New use cases take any free key.
  - With many use cases, only the first 15 show; **Show all** lists the rest. Type in **Filter or create…** (or press **/**) to narrow them. Enter picks the first match, or creates the typed use case when nothing matches.
  - The selected clip's game shows small under its title; click it to change that one clip's `source-game`, for a clip whose game differs from the rest of its import. A clip with no game gets a full **Game** menu under the card instead, and a link above jumps to the next such clip.
  - **Drop** (or D), on the right of the selected clip, moves the selected clip to a **Dropped** column at the end of the board and moves on to the next untagged clip; the message that appears offers **Undo**. A dropped new clip stays in `inbox/` and is never published; importing it again shows it as "dropped before". A dropped published clip is removed from the gallery, with its audio file, on the next Publish. Select a dropped clip and press **Restore** (or D) to bring it back.
- Keys: Space plays or stops the selected clip, the arrow keys move between clips, 1–9 tag, 0 untags, N jumps to the next untagged clip, D drops or restores, / filters use cases, Esc deselects.
- Published clips are on the board too, so you can change their tags. A small orange dot marks a clip that is not published or has unpublished changes.

Your work on unpublished clips is saved in `inbox/` as you go, so you can close the page and continue later. Changes to clips that are already published live only in the open page until you publish them.

## Publishing

**Publish** sends every clip that has both a game and a use case (and is not dropped) to GitHub: it moves their audio into `src/clips/`, adds them to `src/data/clips.json`, commits the clip list and only the audio files it moved in or deleted on the branch you have checked out, and pushes that branch. Other changes under `src/clips/` are never swept into that commit. Clips still missing a game or a use case stay in `inbox/`, on your computer only.

- **On `main`**, the site updates about a minute later.
- **On another branch**, the clips go live once that branch is merged into `main`. **Open a pull request**, under the Publish button, opens one on GitHub so someone can review the clips first.

- Publishing needs a branch checked out. In a detached checkout you can still import and tag.
- Keep clip branches short-lived: two open branches that both add clips will conflict in `src/data/clips.json`.
- If `src/data/clips.json` changed on GitHub since the page loaded, Publish stops and asks you to reload, so nobody's changes are overwritten.
- **Remove N clips with missing audio** appears when the list has clips without an audio file, such as the sample data. They are removed on the next Publish.
- **Preview gallery**, next to the branch name (and in the message after publishing), opens the team's page as published from this checkout, at `http://127.0.0.1:8770/gallery/`. It shows `src/` only, so clips still in the inbox are not on it.
- If the commit itself fails (for example, a git hook refuses it, or git has no name and email set), Publish undoes everything it did: the clips go back to the inbox and the published list is as it was.
- If the push fails (for example, no network), the commit is kept; push the branch once it works again.
