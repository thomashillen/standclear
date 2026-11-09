# Native inspector validation — November 9, 2026

The expanded transit controls use SwiftUI's native inspector, with native navigation and bottom toolbars on each pushed screen. The map navigation stack and inspector presenter remain mounted during width changes; geometry closes the column explicitly while the existing compact sheet takes over. Available bounds and accessibility text size choose the presentation. The inspector host uses regular horizontal presentation, while its map and content retain the actual system trait. There is no device-name condition or custom glass background.

## Initial presentation validation

App and test sources: `85751909ab1ba0bc3a410179d8fab55e62ce64ff`, based on main `243c28a3a2af06fc362033d2746cf676f4753ec6`. The subsequent validation-documentation/screenshots commit does not change those sources.

Xcode 27.2 (27B52), iPhone 18 Pro Simulator, iOS 27.2 (24B8117):

- `xcodebuild build analyze test CODE_SIGNING_ALLOWED=NO` passed; **160 unit tests and six UI tests**, zero failures/skips, in `/tmp/SCNativePanelAcceptance.xcresult`.
- A separate same-source focused run passed **two UI tests**, zero failures/skips, in `/tmp/SCNativePanelPresenter.xcresult`.
- The eight UI cases cover station navigation and persistent/unique/hittable trailing controls; Search/Nearby exclusivity and keyboard/query preservation through rotation; expanded menu actions; largest accessibility text using compact presentation; location-granted glance and grouped arrival clock disclosure; route framing, clearing and reselection across layouts; place-route collapse/restore/clear; and expanded station-arrival disclosure.
- Dark-mode acceptance screenshots were exported and visually inspected. The separate focused run also provided inspected light-mode station/search/permission screenshots. Final runs recorded no repeated 60-second animation-completion notification waits. This observation does not establish the cause of unrelated hosted navigation failures or any renderer performance gain.
- SwiftFormat lint passed for all 33 Swift files. No assertion deadlines, scroll-attempt bounds, animation/idling settings, or CI requirements were relaxed. The route-selection helper now requires its activation point above the floating native toolbar before tapping; all route/clear assertions remain.
- Web lint, TypeScript, all **1,059 tests in 98 files**, and production build passed. No web or backend implementation changed.

## Hosted gate and failure-driven revision

The full native run [42682161501](https://github.com/thomashillen/standclear/actions/runs/42682161501/job/129380319383) at `100d006` **did not pass**. It exceeded the 75-minute ceiling: 160 unit tests passed; 47 of 57 UI cases started, with 43 passing, three failing, one interrupted, and ten not started. The failures were expanded place-origin selection, Nearby's repeated-refresh arrival observation, and expanded Museum alternative-route selection. The uploaded result contains Data/Staging but no Info.plist and is not a complete readable xcresult.

Existing raw PNG/video/AX payloads were recovered into separate local files without inventing result metadata. All 814 original artifact files remained hash-identical. The failure frames put the old station activation at `(662, 389.17)` and Museum activation at `(548.2, 327.5)` inside the native controls' common backing container `(512, 320, 300, 82)`. This supports exposing the target before a single tap, but does not establish which handler received either old event. Museum's route-preview root remained present; its missing expected leg was not proof that the whole list disappeared.

The Nearby sample was absent at 20:00:33.438 UTC. Retained app stdout exposed “Waiting for your location…” at 33.597, strongly supporting a real validity-gap presentation. Exact accepted-fix/expiry callbacks were not logged. Nearby/glance now share the existing 25-second coarse one-shot renewal policy, while retaining the hard 30-second expiry, cached-fix guard, permission/error behavior, and background cancellation. A provider returning the same cached fix can still legitimately reach expiry; stale coordinates are not retained.

The shared UI helper now excludes the native bar's complete backing region and keyboard from its activation/drag range. Each of the two failing place activations uses one exposed center tap, with pre-tap frames/screenshots and independent failure-only observations. Scroll bounds, all outcome assertions, and their original deadlines remain unchanged.

The revised app/test source content is recorded at `26397e14f2706e91170715fbac2fcbc30cd8cfa3`. One serial local `build analyze test` passed **160 unit tests plus exactly the three affected UI cases**, zero failures/skips, on iPhone 17 Pro / iOS 26.4.1 (23E254a), built with local Xcode 27.2. Artifacts: `/tmp/SC357FailureRevision.xcresult`, `/tmp/sc357-failure-revision.log`, and `/tmp/sc357-failure-revision-attachments`. Pre-tap screenshots and geometry were inspected. This matches the hosted screen/runtime, not its Xcode 26.6 linked SDK; it does not replace fresh hosted validation.

The job ceiling is now 100 minutes so the unchanged complete serial suite and evidence can finish. The measured completed prefix was 3,982.191 UI seconds; startup/build/unit overhead was about 499 seconds; retained matching durations for the interrupted case and ten unstarted cases sum to 765.553 seconds. Including roughly 64 seconds of artifact upload projects about 88.5 minutes, with ordinary timing uncertainty. The larger job budget does not waive any assertion failure or make the old run passing. Fresh exact-head CI and review remain mandatory.

## Rendered evidence

These are synthetic fixture predictions and a simulated Times Square location, not live-feed or physical Duo evidence. The operating system supplies the inspector, sheet and toolbar appearance; a full-height inspector can have a subtler material than a compact glance surface.

![Native expanded Nearby inspector and glass toolbars](screenshots/native-inspector-wide.png)

![Native compact Nearby sheet with grouped prediction clock times](screenshots/native-inspector-compact.png)

## Remaining gates

Current-head hosted CI and native Codex review are required before merge. Local passes do not establish the full hosted suite or minimum iOS 26.0 runtime coverage.

A fresh disposable Duo simulator on its dedicated iOS 27.2 runtime failed during data migration and was shut down. The existing Duo simulator and its data were not reset. Actual cover/expanded fold transitions, reserved-region/camera clearance, touch ergonomics, spoken VoiceOver and manual Reduce Motion/Reduce Transparency acceptance still require the physical Duo. This candidate was not installed on the phone.

The original station Back and destination Close investigations remain unresolved. Earlier failed/interrupted local trials are retained separately and are not counted as passing validation.
