# Open questions

Items that surfaced during runs but are too large or ambiguous to resolve inline.
The run that logs an item should also leave a note on the PR thread if applicable.

---

<!-- template: YYYY-MM-DD · <description> · (PR #NNN or branch) -->

2026-05-16 · `components/panelUI.tsx:851` (TripPlanRow `leadStale` sub-line) is the
third inline re-derivation of the spoken staleness phrase — `Soonest train
position last updated ${Math.round(leadStale.ageSec / 60)} minutes ago`. It was
left out of the `trainStaleness.ariaLabel` single-source pass because panelUI.tsx
is heavily churned by open PRs #153 and #155; folding it in now would conflict.
Once those land, swap it to `leadStale.ariaLabel` (prefixed with "Soonest train ")
so all three surfaces speak the identical, single-sourced sentence. · (branch
claude/keen-goldberg-Yf3aT)
