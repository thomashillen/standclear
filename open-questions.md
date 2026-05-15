# Open questions

Items that surfaced during runs but are too large or ambiguous to resolve inline.
The run that logs an item should also leave a note on the PR thread if applicable.

---

<!-- template: YYYY-MM-DD · <description> · (PR #NNN or branch) -->
2026-05-15 · `LiveTrainsPopup` passes `data.generatedAt` (ms) to `summarizeFleetStaleness`'s `fallbackSec` parameter (seconds per the JSDoc, `lib/trainStaleness.test.ts:72` confirms). When a train omits per-vehicle `lastReportedAt`, the helper computes `nowMs/1000 - generatedAtMs ≈ -1.7e9 → capped to 0 → "fresh"`, so a silent-feed outage (header timestamp old, no per-vehicle reports) never lights up the "N trains haven't reported in 90 s+" sub-line. Fix is a one-character change (`data.generatedAt / 1000`), but the right scope is a follow-up that also pins the contract with a regression test against the silent-feed path. · branch (logged from claude/system-pulse-line-nav-2026-05-15)
