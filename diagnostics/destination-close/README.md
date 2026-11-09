# Expanded destination Close diagnostic

Diagnostic only. Keep its PR draft and do not merge it as a product fix.

PR #345 head `e874c7f9cd1c5bc1bb2e6e6e185e806408a0493f` failed native
[run 42432146424](https://github.com/thomashillen/standclear/actions/runs/42432146424).
All 162 unit tests and 55/56 UI tests passed. The expanded destination-editing
case failed after native search Close, when `To` had no `BackButton`.

The downloaded xcresult video shows Close's pressed highlight at approximately
226.43 seconds, then the unchanged Madison search/result. Both later failure
hierarchies still contain Close and Madison, without Back. This establishes a
hit/pressed state, not completed action delivery or a SwiftUI binding mutation.
Neither the generic automation-type hint nor the repeated animation-idle waits
establishes a cause. The full native gate remains failed.

## Question

On the exact hosted toolchain, do observed `searchPresented` and `searchFocused`
transitions show completed dismissal followed by reactivation, or no observed
dismissal transition? A missing observation cannot exclude coalesced writes.

The fixed-source archive changes only `PlacePreview.swift`, adding read-only
`onChange` and lifecycle logs. State/FocusState bindings and the UI test remain
byte-identical to the diagnosed head. No wrapper, delegate replacement, state
mutation, recovery tap, sleep, synchronization adjustment or deadline change is
introduced. The patch is SHA-256 pinned and source/test hashes are guarded.

One local comparison on Xcode 27.2 (27B52), iPhone 17 Pro / iOS 26.4.1 (23E254a)
passed the original expanded test in 92.346 seconds. The conditional Close
branch executed. Return first changed focus to false, and Close subsequently
changed presented to false with an empty query. Back and all later assertions
passed. No local reactivation was observed. This does not reproduce the hosted
failure, establish flakiness or identify a fix.

The first exact-toolchain hosted attempt,
[42583914898](https://github.com/thomashillen/standclear/actions/runs/42583914898),
passed source/tool preflight but failed to type-check the instrumented view body
before any test executed. It was not a timeout. Compiler output and the raw
empty trace survived; collection correctly reported that no usable trace existed.
The successor diagnostic moves logging formatting into a typed helper and types
the two observer parameters explicitly, without changing bindings or observer
placement. This correction passed local lint and build-for-testing. The earlier
local UI pass belongs to the inline-logging version; no new local UI rerun is
claimed for the helper correction.

## Hosted scope and evidence

The workflow requires Xcode 26.6 (17F113) and iOS 26.4.1 (23E254a), with no
fallback. It creates one isolated iPhone 17 Pro simulator, runs the original
expanded test once, and preserves its xcresult and timestamped unified-log
events. The command gets at most ten minutes and must stop by minute eleven
of the diagnostic's first step, leaving up to forty seconds for termination,
one minute for collection and a bounded two-minute upload within the separate
15-minute job. Slow preparation reduces the command budget rather than taking
the evidence reserve. It does not change #345's full-suite ceiling or gate.

Raw logs survive malformed JSON, missing transitions, test failure or command
timeout. Simulator trace stderr is kept separately so warnings cannot corrupt
JSON parsing. Cleanup only shuts down the recorded owned simulator; hosted
runner disposal handles its temporary data. No other simulator or phone is
targeted. Empty or malformed traces fail collection rather than masquerading as
useful evidence. A failed test remains failed even if collection succeeds.

Observers, logging, an isolated simulator, a selected test rather than its
preceding full-suite history, and runner load can alter timing. A pass cannot
clear #345. If this run passes without reproducing the failure, stop rather than
repeat unchanged. If it fails, correlate video/event evidence with observed
state transitions before selecting a production fix. The separate station-Back
investigation (#346/#347) is unchanged.

Local safeguard checks:

```sh
python3 -m unittest discover -s diagnostics/destination-close -p 'test_*.py' -v
python3 -m py_compile diagnostics/destination-close/driver.py
```

The same narrow patch passed SwiftFormat lint, local build-for-testing and the
single expanded regression. Those checks do not substitute for the hosted
diagnostic or the exact-head full merge gates required for production work.
