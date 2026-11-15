# Goals

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
