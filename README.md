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

## Non-goals

- Not an audio editor. Trimming, mixing, and processing happen in other tools.
- Not built for long audio such as music tracks or ambient loops, though it should not break on them.
- Not a public asset store. It is a working tool for our team.

## Planned shape

- Audio files stored in the repo (for example under `clips/`).
- One data file (for example `clips.json` or YAML) that lists each clip with its labels for every dimension.
- A static viewer page that reads the data file, shows clips as a list or grid, and lets you pick which dimensions to group by, filter on, and sort by.
- Published with GitHub Pages from this repo.

## Status

Early planning. This README records the goals; the data format and viewer are not built yet.
