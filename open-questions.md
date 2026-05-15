# Open questions

Items that surfaced during runs but are too large or ambiguous to resolve inline.
The run that logs an item should also leave a note on the PR thread if applicable.

---

<!-- template: YYYY-MM-DD · <description> · (PR #NNN or branch) -->

2026-05-15 · Cinematic follow-train mode is only reachable by tapping a moving
train marker on the Mapbox GL canvas (`SubwayMap.tsx:821` → `MapView.tsx:1184`);
there is no non-map entry point, so the feature is effectively undiscoverable to
a rider who doesn't already know to tap a dot. A "Follow this train" affordance
on the StationPanel arrival row / LiveTrainsPopup would (a) make it discoverable
and (b) make the e2e flow-3 test hermetic without a CI Mapbox token. Product
question — needs a design call on placement + the iOS-glass idiom. ·
(docs/research/playwright-e2e-2026-05-15.md)
