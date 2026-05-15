# Open questions

Items that surfaced during runs but are too large or ambiguous to resolve inline.
The run that logs an item should also leave a note on the PR thread if applicable.

---

<!-- template: YYYY-MM-DD · <description> · (PR #NNN or branch) -->

2026-05-15 · Background "Leave at X" commute reminders (Option B in
`docs/research/leave-at-reminders-2026-05-15.md`) require persisting a
per-rider departure schedule server-side. Current `/privacy` posture is
opaque-UUID + alert line prefs only. Is storing an anonymous rider's
commute schedule an acceptable privacy trade, and does it require a
`/privacy` rewrite + explicit opt-in copy? Trust decision for the human;
gates the Option B schema. The foreground-only Option A is unblocked and
can ship without this answer. · (branch claude/leave-at-research-2026-05-15)
