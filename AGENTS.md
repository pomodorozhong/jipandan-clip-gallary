# Agent notes

Jipandan clip gallery: a static GitHub Pages viewer for a three-person indie game team to skim short voice clips on a board of "▶ title" chips. Any field in `data/clips.json` other than `title` and `audio` is a dimension that can set the columns, colour, sort, or a filter. See [README.md](README.md) for goals and the data format, and [docs/](docs/README.md) for decisions.

Checks: there is no build or test suite yet. Serve the folder with `python3 -m http.server 8765` and open http://localhost:8765; `node --check assets/app.js` catches syntax errors.

<!-- handoff:start (from the handoff skill; edit the skill's template, not this copy) -->
## Handoff

`HANDOFF.md` at the repository root is how sessions resume. It has three sections: `In progress` (one `### <branch>` subsection per active branch, holding its state and its own approval requests), `Ranked work`, and `Pending` (approval requests not tied to a branch). A pending entry, such as `P-01`, records a request, not approval.

- **Start of a session:** read `HANDOFF.md` and the subsection for `git branch --show-current`; none means this branch has no work in progress. Compare its code checkpoint with `git log`, re-check verification made stale by later commits, and run the documented checks before building on it. If this branch's PR merged or closed, follow the `commit` skill's branch-safety rules before committing or pushing. Before recommending or starting work, show each unresolved request that existing authorization doesn't cover, from every branch subsection and `Pending` (marking any a merged or closed PR made obsolete), and each blocking decision in `Ranked work`, and ask the user about them. Pick new work from the default branch's `Ranked work`.
- **Edit only this branch's subsection,** plus `Ranked work` and `Pending` when they actually change. Keep it current rather than a log, and never write secrets.
- **Commit `HANDOFF.md`** only before a push and at wrap-up, as a `docs:` commit on the work branch. Never commit it on the default branch.
- **PRs:** use the `open-pr` skill, and keep its unanswered approval requests in this branch's subsection until they are resolved. **End of a session:** use the `handoff` skill.
- **Before creating a branch, editing `HANDOFF.md`, or resolving a conflict in it,** read the `handoff` skill's working rules (`references/working-rules.md` in that skill).
<!-- handoff:end -->
