# Open questions

Items that surfaced during runs but are too large or ambiguous to resolve inline.
The run that logs an item should also leave a note on the PR thread if applicable.

---

<!-- template: YYYY-MM-DD · <description> · (PR #NNN or branch) -->
2026-05-15 · `LiveTrainsPopup` passes `data.generatedAt` (ms) to `summarizeFleetStaleness`'s `fallbackSec` parameter (seconds per the JSDoc, `lib/trainStaleness.test.ts:72` confirms). When a train omits per-vehicle `lastReportedAt`, the helper computes `nowMs/1000 - generatedAtMs ≈ -1.7e9 → capped to 0 → "fresh"`, so a silent-feed outage (header timestamp old, no per-vehicle reports) never lights up the "N trains haven't reported in 90 s+" sub-line. Fix is a one-character change (`data.generatedAt / 1000`), but the right scope is a follow-up that also pins the contract with a regression test against the silent-feed path. · branch (logged from claude/system-pulse-line-nav-2026-05-15)

2026-05-15 · Cinematic follow-train mode is only reachable by tapping a moving
train marker on the Mapbox GL canvas (`SubwayMap.tsx:821` → `MapView.tsx:1184`);
there is no non-map entry point, so the feature is effectively undiscoverable to
a rider who doesn't already know to tap a dot. A "Follow this train" affordance
on the StationPanel arrival row / LiveTrainsPopup would (a) make it discoverable
and (b) make the e2e flow-3 test hermetic without a CI Mapbox token. Product
question — needs a design call on placement + the iOS-glass idiom. ·
(docs/research/playwright-e2e-2026-05-15.md)

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
