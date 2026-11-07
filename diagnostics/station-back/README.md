# Station Back diagnostic (#346)

This is a temporary diagnostic, not an application improvement or a replacement for PR #345's failed native gate. A pass does not establish flakiness, correct navigation, renderer savings or physical Duo behavior. The phone is not involved.

Create the diagnostic branch from main `24f77a99707447e5d721be0f4ce72728949cd7f0`. Its entire diff must be these four files:

- `diagnostics/station-back/README.md`
- `diagnostics/station-back/apply-diagnostic.patch`
- `diagnostics/station-back/driver.py`
- `.github/workflows/station-back-diagnostic.yml`

There must be **no `ios/**` changes on the diagnostic branch**. The existing full native workflow watches `ios/**` and `.github/workflows/ios.yml`; this diagnostic's paths avoid that trigger. Existing web CI may still run normally. Publish as a **draft** only after the following review is complete.

## Diagnostic scope

The standalone patch applies to fixed source `13752724401a670216dc7498671a6bc62237a505`. It appends the RAM logger to MapShell.swift so the checked-in project needs no new source membership, and assigns the separate bundle `app.standclear.navdiagnostic` in the project and specification. No XcodeGen, secrets or signing configuration is used.

Both selectors retain the original functional assertions and deadlines. The original-mode selector returns the original projected State bindings for station Directions and the typed search path. The wrapped mode forwards the same values and Transactions through logging closures. Both modes retain extra UUID state, lifecycle/direct-write/onChange hooks and existing itinerary-binding logging. Those shared diagnostic changes can still affect identity and timing; neither mode is an uninstrumented control.

The test backgrounds the app only in its cleanup defer, after the original interaction sequence, to flush each RAM log. No tap retry, sleep, animation override, state recovery or ignored assertion is introduced. Native geometry/lifecycle events, binding writes, parent callbacks and the xcresult recording can distinguish observed state replay from absent state changes. They cannot alone prove why a native input was ignored or that a presentation was transition-ready.

The patch SHA256 is pinned in the workflow and checked before execution. It was applied cleanly to a fresh archive of the fixed source and compiled locally with Xcode 27.2. That toolchain differs from the intended hosted Xcode 26.6.

The workflow has a narrowly filtered `pull_request: opened/synchronize` trigger. Each published diagnostic head can schedule one run; it does not retry an unchanged head or run on reopened events. A first workflow-only head was rejected by GitHub before a runner started because runner.temp was used in job-level env; the corrected head uses RUNNER_TEMP in shell steps and runner.temp in the artifact step. `workflow_dispatch` is also declared, but do not rely on manual dispatch of a newly added workflow until GitHub exposes it for that repository/ref. Any additional run needs a deliberate decision; no automatic retry or `continue-on-error` exists.

## Guarded execution

The driver archives **only `ios/` from fixed commit `1375272`** into runner temp, recording the full commit/tree/iOS-tree and archive SHA256. It records the actual and expected patch SHA256, checkout commit, patched file hashes and exact xcodebuild command. It checks patch paths, applies it only to that temporary archive, verifies the separate app bundle and both exact test methods, and uses the checked-in project.

It requires selected **Xcode 26.6**, an available **iOS 26.4.1** runtime, and the **iPhone 17 Pro** device type. No fallback to another Xcode/runtime/model, no package installation, no signing and no physical-device tool is used. A changed hosted image should produce a clear guard failure rather than a misleading comparison. It records tool versions and initial/final host load/memory metadata.

Only one newly created Simulator is booted. Preparation fails if another Simulator is already booted; it does not shut down unrelated devices. One xcodebuild invocation selects both focused UI methods, disables parallel test execution, uses two build jobs and leaves all test assertions/timeouts intact. The child command has a ten-minute diagnostic cap, with interrupt/kill grace; the job has a fifteen-minute cap. A timeout remains a failed diagnostic, not a passing gate.

## Always-run evidence collection

After success or failure, collection attempts **both** RAM exports independently before shutting down/deleting only the Simulator this driver created. `collection-report.json` records each filename, presence/parse failure, event count, hash and final event. A missing/invalid export fails collection and creates an explicit failure report; it must not be interpreted as no navigation event. JSON presence and source mode still need inspection, including export completion and instance/presentation IDs.

The upload step runs `always()` and preserves logs, metadata, errors, exports and the xcresult. There is no `continue-on-error`: a failed test remains failed even if export succeeds, and missing export remains a failure even if tests pass. A runner hard timeout/termination can still prevent cleanup or artifact upload; report that limitation rather than assuming evidence exists. A successful small diagnostic is **not** the full current-head native CI required to clear #345.

## Reading results

Distinguish direct native Binding-set requests from later/coalesced onChange, explicit onAppear restoration, parent callback writes, typed station paths and itinerary-layer pops. Retained per-lifetime IDs must explicitly associate Directions with its StationArrivals owner. A StationArrivals disappearance while Directions is pushed does not prove an outgoing presentation. Wrapped Bindings, additional lifecycle modifiers and logging can affect identity/timing; a wrapped pass alone is not evidence that the original failure is fixed. The original control helps expose this limitation but does not eliminate it.

## Endpoint-clear observation increment

Run42361714550 passed wrapped bindings and failed original bindings only at the later compound endpoint-clear check after both completed Back and station navigation. This new diagnostic head preserves each clause's original short-circuit/order and the original five-second waiter result. A RAM-only test buffer records query start/end, values, skipped clauses, predicate return and nominal versus actual deadline. It performs no extra accessibility query inside the predicate.

Only after the waiter returns, both modes attach an immediate screenshot and the buffer, then separately timed map/clear-button/matching-endpoint/window observations and the full accessibility hierarchy. Postdeadline inspection cannot re-decide the stored assertion and is not evidence of state at the nominal deadline. It delays subsequent Done/background cleanup; compare the preserved clearance result, not total duration or subsequent-action timing.

The temporary app additionally records focusStation before/after, selectedTrip changes and map journey inputs, and samples reported camera regions at most once per second into nonobservable RAM from the existing callback, after its normal update. Sparse samples may miss transient camera movement and do not establish displayed-frame contents. No marker renderer prototype, observable state recovery, custom navigation or camera policy is added. The new hooks still perturb timing/dependencies and are applied identically to both binding modes.

The standalone patch was reapplied to fixed source and its Swift/project files exactly matched the locally compiled source. SwiftFormat lint, Xcode27.2 build-for-testing and analyze passed. The hosted result is separate and remains required; a pass still does not explain the original Back failure or clear PR345.
