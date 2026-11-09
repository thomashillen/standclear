# Native inspector validation — November 9, 2026

The expanded transit controls use SwiftUI's native inspector, with native navigation and bottom toolbars on each pushed screen. The map navigation stack and inspector presenter remain mounted during width changes; geometry closes the column explicitly while the existing compact sheet takes over. Available bounds and accessibility text size choose the presentation. The inspector host uses regular horizontal presentation, while its map and content retain the actual system trait. There is no device-name condition or custom glass background.

## Executed locally

App and test sources: `85751909ab1ba0bc3a410179d8fab55e62ce64ff`, based on main `243c28a3a2af06fc362033d2746cf676f4753ec6`. The subsequent validation-documentation/screenshots commit does not change those sources.

Xcode 27.2 (27B52), iPhone 18 Pro Simulator, iOS 27.2 (24B8117):

- `xcodebuild build analyze test CODE_SIGNING_ALLOWED=NO` passed; **160 unit tests and six UI tests**, zero failures/skips, in `/tmp/SCNativePanelAcceptance.xcresult`.
- A separate same-source focused run passed **two UI tests**, zero failures/skips, in `/tmp/SCNativePanelPresenter.xcresult`.
- The eight UI cases cover station navigation and persistent/unique/hittable trailing controls; Search/Nearby exclusivity and keyboard/query preservation through rotation; expanded menu actions; largest accessibility text using compact presentation; location-granted glance and grouped arrival clock disclosure; route framing, clearing and reselection across layouts; place-route collapse/restore/clear; and expanded station-arrival disclosure.
- Dark-mode acceptance screenshots were exported and visually inspected. The separate focused run also provided inspected light-mode station/search/permission screenshots. Final runs recorded no repeated 60-second animation-completion notification waits. This observation does not establish the cause of unrelated hosted navigation failures or any renderer performance gain.
- SwiftFormat lint passed for all 33 Swift files. No assertion deadlines, scroll-attempt bounds, animation/idling settings, or CI requirements were relaxed. The route-selection helper now requires its activation point above the floating native toolbar before tapping; all route/clear assertions remain.
- Web lint, TypeScript, all **1,059 tests in 98 files**, and production build passed. No web or backend implementation changed.

## Rendered evidence

These are synthetic fixture predictions and a simulated Times Square location, not live-feed or physical Duo evidence. The operating system supplies the inspector, sheet and toolbar appearance; a full-height inspector can have a subtler material than a compact glance surface.

![Native expanded Nearby inspector and glass toolbars](screenshots/native-inspector-wide.png)

![Native compact Nearby sheet with grouped prediction clock times](screenshots/native-inspector-compact.png)

## Remaining gates

Current-head hosted CI and native Codex review are required before merge. Local passes do not establish the full hosted suite or minimum iOS 26.0 runtime coverage.

A fresh disposable Duo simulator on its dedicated iOS 27.2 runtime failed during data migration and was shut down. The existing Duo simulator and its data were not reset. Actual cover/expanded fold transitions, reserved-region/camera clearance, touch ergonomics, spoken VoiceOver and manual Reduce Motion/Reduce Transparency acceptance still require the physical Duo. This candidate was not installed on the phone.

The original station Back and destination Close investigations remain unresolved. Earlier failed/interrupted local trials are retained separately and are not counted as passing validation.
