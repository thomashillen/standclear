# Open questions

Items that surfaced during runs but are too large or ambiguous to resolve inline.
The run that logs an item should also leave a note on the PR thread if applicable.

---

<!-- template: YYYY-MM-DD · <description> · (PR #NNN or branch) -->

2026-05-15 · Panel-grammar touch-target sweep: several dismiss/close
controls across the sheet grammar are still below the 44px HIG
minimum (principle #3) — `MoreSheet.tsx:185` (w-9 h-9),
`LinePicker.tsx:243` (w-9 h-9), `NearbyPanel.tsx:380` (w-8 h-8) +
`:913` (w-9 h-9), `SearchSheet.tsx:1022/1042/1073/1157` (w-7/w-8/w-9),
`InstallPrompt.tsx:176` (w-8 h-8). FollowCapsule was fixed first (the
critical-path case) on branch claude/keen-goldberg-TVinZ. The rest is
deferred because several of these files (panelUI/SearchSheet/NearbyPanel
call sites) are currently churned by in-flight PRs #153/#155 — a
broad sweep now would conflict. Pick this up once those land. Open
question: bump the visible circle to 44px (simple, in-idiom since
these are already filled-circle buttons) vs. an invisible
hit-area-expander pseudo (Apple-purest, keeps small glyphs, but risks
intercepting adjacent taps in dense header rows — needs per-callsite
spacing review).
