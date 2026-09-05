# Open questions

Items that surfaced during runs but are too large or ambiguous to resolve inline.
The run that logs an item should also leave a note on the PR thread if applicable.

---

<!-- template: YYYY-MM-DD · <description> · (PR #NNN or branch) -->
2026-09-05 · Panel-grammar touch-target follow-up: the earlier broad sweep is
mostly complete. MoreSheet, LinePicker, InstallPrompt, and the shared mobile
sheet grabber now meet the 44px touch-target baseline. Current `main` still has
compact controls below that baseline in `NearbyPanel.tsx` (saved-destination
swap and Near me close) and `SearchSheet.tsx` (directions back, close,
clear-search, and swap). Exact invisible-hit-area implementations and focused
regression tests for both components were fully validated in Codex and are
preserved in issue #191, but could not be published because those Codex
checkouts had no authenticated Git remote and replacing the large components
wholesale through limited file APIs would be unnecessarily risky. The product
direction is no longer ambiguous: preserve the visible compact controls and
expand only their effective hit areas. Remaining work is safe publication of
the preserved patches plus normal CI/Vercel validation. · (#191)

2026-05-15 · Background "Leave at X" commute reminders (Option B in
`docs/research/leave-at-reminders-2026-05-15.md`) require persisting a
per-rider departure schedule server-side. Current `/privacy` posture is
opaque-UUID + alert line prefs only. Is storing an anonymous rider's
commute schedule an acceptable privacy trade, and does it require a
`/privacy` rewrite + explicit opt-in copy? Trust decision for the human;
gates the Option B schema. The foreground-only Option A is unblocked and
can ship without this answer. · (branch claude/leave-at-research-2026-05-15)
