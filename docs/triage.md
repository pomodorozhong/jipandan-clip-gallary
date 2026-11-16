# Importing and triaging clips

New clips go through a triage page that runs only on your computer. You import exported clips, give each folder a source game and each clip a use case, then publish them. The team's GitHub Pages site only ever shows published clips.

## Opening the triage page

Double-click **Triage.command** in the repository folder in Finder. A Terminal window opens and the triage page opens in your browser at http://127.0.0.1:8770. Close the Terminal window to stop it. (`npm run triage` does the same from a terminal.)

It needs Python 3 and git, which macOS already has once the Xcode command line tools are installed. No packages to install.

The first time, macOS may ask whether to open the file; choose Open.

## Importing

1. Click **Import clips**, then **Choose folder…** or drop an export folder onto the box.
2. Every audio file in the folder and its subfolders is listed with its title, recording and file name. Play any of them to check. New clips are ticked; clips already in the gallery are greyed out.
3. **Copy into clips/** sets the folder the clips go into (for example `clips/0526-session/`). Keep one folder per game, since games are set per folder.
4. Click **Import**. The clips are copied into `inbox/` in the repository, which git ignores, and appear in the **Untagged** column.

Titles come from the file names. Files exported by jipandan-clip are named `<recording>_<clip id>_<title>.mp3`, so the title is the last part and the recording name goes into a `recording` dimension. Other files use their whole name as the title.

## Triaging

- **Game per folder:** the **Folders** panel lists each clip folder. Pick its game (or **New game…**) and every clip in it gets that `source-game`. Clips imported later into the same folder get it automatically.
- **Use case per clip:** click a chip to play and select it, then click a use-case button or press its number. The clip moves into that column and the next untagged clip starts playing. **+ New use case** adds one; **Untag** (or 0) clears it.
- Keys: Space plays or stops the selected clip, the arrow keys move between clips, 1–9 tag, 0 untags.
- Published clips are on the board too, so you can change their tags. A small orange dot marks a clip that is not published or has unpublished changes.

Your work on unpublished clips is saved in `inbox/` as you go, so you can close the page and continue later. Changes to clips that are already published live only in the open page until you publish them.

## Publishing

**Publish** sends every clip that has both a game and a use case to GitHub: it moves their audio into `src/clips/`, adds them to `src/data/clips.json`, commits only those two paths on the branch you have checked out, and pushes that branch. Clips still missing a game or a use case stay in `inbox/`, on your computer only.

- **On `main`**, the site updates about a minute later.
- **On another branch**, the clips go live once that branch is merged into `main`. The notice at the top of the page links to GitHub to open a pull request, so someone can review the clips first.

- Publishing needs a branch checked out. In a detached checkout you can still import and tag.
- Keep clip branches short-lived: two open branches that both add clips will conflict in `src/data/clips.json`.
- If `src/data/clips.json` changed on GitHub since the page loaded, Publish stops and asks you to reload, so nobody's changes are overwritten.
- **Remove N clips with missing audio** appears when the list has clips without an audio file, such as the sample data. They are removed on the next Publish.
- If the push fails (for example, no network), the commit is kept; push the branch once it works again.
