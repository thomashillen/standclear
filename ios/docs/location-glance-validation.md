# Accessible location glance validation — November 11, 2026

At the largest accessibility text size, the location-permission glance on baseline main obscured much of the map. In short landscape, its status text exceeded the visible panel and Open Settings was outside the panel and not hittable. The candidate keeps a complete native location-status disclosure visible and opens Nearby for the full message and recovery controls.

Final frozen-source iOS 26 build/analyze/test passed. The local iOS 27 cross-check was not executed because its resource guard stopped before installation; current-head hosted gates remain required. Local focused results do not qualify hosted acceptance. Practical Reduce Motion/Reduce Transparency acceptance remains unverified because supported preference automation was unavailable; no preference was changed.

## Behavior and scope

At accessibility Dynamic Type sizes with no usable location fix, the glance uses the available map width with the existing margins. Denied/restricted authorization shows **Location access is off**; a failed fix shows **Location unavailable**. Each is a native Button with a trailing chevron, the existing uncapped subheadline font, multiline text and a minimum 44-point target. Its accessibility hint names the full Nearby recovery destination. The existing geometry-bound height, scroll surface and native material remain.

The disclosure opens the existing Nearby presentation without starting another location request or requesting map focus. A failure message remains available through presentation and rotation until the rider explicitly chooses **Retry location**. Nearby retains its full message, **Open Settings** and **Retry location** controls. Existing Nearby and Browse actions retain their presentation, focus and location-start ordering.

Default text and usable-fix arrival glances keep their existing paths and widths. The locating ProgressView is unchanged apart from the additional available width at accessibility sizes. LocationStore, one-shot renewal/expiry, scene cleanup, map rendering, train motion, polling, freshness rules, backend contracts and glass styling are unchanged.

## Reproduced geometry

The baseline was main `dd7802cd1d0dea1d324e603a04479c0cbc73cdef`. Xcode 27.2 (27B52) used the iPhone 17 Pro Simulator on iOS 26.4.1 (23E254a). Public XCTest accessibility frames and screenshots were retained; no map panning was used for these observations. Measurements are in points.

| Largest accessibility text | Exposed map height | Baseline glance height | Candidate glance height | Candidate status/action height |
| --- | ---: | ---: | ---: | ---: |
| Portrait | 672 | 369.67 | 132.67 | 116.67 |
| Short landscape | 242 | 133 | 74.67 | 58.67 |

The baseline reached the existing 55% map-height limit in both layouts. Its landscape status frame was 232.67 points high inside a 133-point panel; Settings lay beyond the panel and map. In the candidate captures, the complete status/action was hittable and contained by both the panel and exposed map. The fixture train remained clear without moving the camera. The baseline default-text portrait glance was 190.33 × 54.33 points, with readable status and hittable Settings.

## Executed checks and retained evidence

Evidence is under `/tmp/sc-location-glance-20261111/`; original results are retained and inspection/export used copies.

- The corrected baseline observer passed two UI cases, zero failures/skips, in `BaselineObserverCorrected.xcresult`. Its first typed-Link observer failure is retained separately. `baseline-observation.txt` and `baseline-attachments/manifest.json` map the baseline frames and screenshots.
- The installed candidate passed all three new UI cases, zero failures/skips, in `CandidateGlanceInstalled.xcresult` (86.869 seconds). Its test source was `be8423b1…`, before subsequent test-only strengthening. `candidate-installed-attachments/manifest.json` maps the inspected portrait `900603AE…`, landscape `221A9AFF…`, full failure-message `E6710040…` and restored-fix `25202E16…` screenshots.
- The same production app demonstrated a real pending portrait state; a real failure survived passive help and rotation; explicit Retry plus a fresh public XCUIDevice location restored station 127, the location dot and arrival glance. The background-cleanup probe passed. These are simulator/fixture observations, not live-feed completeness evidence.
- Two prequalification test invocations retained five completed prelaunch authorization-reset case failures in the existing 30-second operation and one interrupted case: three failures in `CandidateGlanceFirst.xcresult`, then two failures plus the interrupted case in `CandidateGlanceRecovered.xcresult`. Neither invocation qualifies. One supported restart of the owned simulator did not resolve the reset failure. Read-only inspection found a stale installed app image; one supported normal install made the installed executable and debug image match the compiled candidate. The subsequent three-case pass does not establish a reset-timeout cause or reliability improvement. All failed and partial results remain unqualified.
- Final frozen-source build/analyze/test exited 0: **175 unit tests and seven UI tests (182 total), zero failures/skips**, in `Final26.xcresult` (98 MiB), with `final26.log` retained. The seven cases cover default/largest denied recovery, failure/passive help/Retry/fix/cleanup, refreshed countdowns, granted-location map visibility, Search/Nearby adaptation and largest-text train reconciliation. The Search/Nearby case passed in 1,002.792 seconds with native 60-second idle warnings; no idling or deadline override was used. These durations are observations, not performance claims.
- The final largest-text motion case passed in 25.214 seconds without panning. The observed train frame `(169.64, 463.64, 11.40, 11.40)` was disjoint from glance `(16, 132, 370, 132.67)`; original motion assertions remain intact.
- An earlier strengthened failure-case pass on the same final test source took 34.063 seconds. Its real pending state had ended before the first query. Pending short-landscape containment remains explicitly unmeasured.
- Independent final-source/test review and independent visual review of the captured states identified no concrete blockers. This local review is separate from required current-head native Codex review.
- Normal web checks passed once: lint, TypeScript, 1,060 tests in 98 files and a 973-page production build. All 255 tracked web inputs plus package/lock files remained unchanged. `web/summary.json` records hashes and logs. Existing Node 26 engine, install-script-policy and deprecation warnings remain recorded; no policy or dependency overrides were used.

Storage/evidence: `storage-cleanup-receipt.json` records removal of exactly 18 approved old SDK cache directories plus this worktree’s `.next/cache`: 492,650,496 allocated bytes removed and a 490,233,856-byte free-space increase. The conservative post-budget margin initially exceeded 1.25 GiB. Current DerivedData, original results and source identities were preserved. A fresh owned iPhone 17 Pro / iOS 27.2 (24B8117) simulator booted, but its pre-install resource guard then failed. `native-lane-ended-receipt.json` records 1,920,610,304 free bytes before stopping, 1,943,801,856 after shutdown and 1,778,364,416 at final lane closure. Both owned simulators are shut down with their data preserved; all native commands ended and source hashes remained unchanged. There was no iOS 27 candidate install, xcodebuild, test, screenshot or result bundle. This was an unexecuted resource stop, not a test failure, skip or pass.

The production-source SHA256 identities are `4daaaba9af49c57cc504751e374683ce8bff16ec93dfdffdd36d72a1baff7784` for NearbyGlancePanel and `289c1c4e3e5c4653450819648fbb83696ad64c9bb36aa10206f197edaa86c341` for MapShell. Final UI-test SHA256 is `5563d7b8a46fcb9ecbf23a7a12f3e557ed15f4c3def5e5a0c55066032a71848b`. The final tests replace the former largest-text map pan with measured train/glance nonintersection and add recovery containment, passive failure preservation, explicit Retry, restored-fix and cleanup checks. Existing motion assertions and deadlines remain intact.

## Remaining gates and limits

- The local iPhone 17 Pro / iOS 27.2 four-UI cross-check is an unexecuted coverage gap: after the fresh boot, available capacity fell below the 2.1 GiB artifacts/CI/safety reserve. Candidate installation did not run and zero tests started. Independent source review identified no concrete blocker from this local resource limitation; hosted exact-head native validation remains mandatory.
- Practical native Reduce Motion/Reduce Transparency acceptance is unverified. `accessibility-preference-limit.txt` records that supported simctl UI controls do not expose these preferences and native Simulator automation was unavailable. No preference was changed or prior value assumed. The 175-unit suite includes existing Reduce Motion engine coverage; this does not establish manual native preference acceptance.
- A real pending portrait was captured, but pending short-landscape containment has not been positively observed. No loading delay or hidden state hook was added to manufacture it.
- Restricted authorization cannot be forced through the available public app/test mechanisms without changing OS policy; runtime coverage uses real denied authorization. The restricted presentation shares the denied branch and has source review only.
- Native status labels, target bounds and hittability are verified with XCTest; accessibility hints were reviewed in source. Spoken VoiceOver order/focus/announcements and physical Duo folding, camera clearance, touch and system-overlay behavior remain unverified. No physical phone action was taken.
- Exact final-head hosted native CI, web CI, preview/deployment when present, and native Codex review must pass before guarded merge. Local focused results do not substitute for those gates. No checks, coverage, deadlines or review requirements are relaxed.
