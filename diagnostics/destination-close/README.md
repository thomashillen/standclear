# Expanded destination Close diagnostic

Diagnostic only. Keep its PR draft and do not merge it as a product fix.

## Current correlated-marker qualification

This revision selects `correlated-candidate.patch` for one bounded changed-head
hosted qualification. Its purpose is matching-Xcode compilation and per-test
marker transport/correlation, not a product fix or clearing #345. The candidate
adds a per-test log token and markers around the original conditional Close tap
and before the original Back assertion. It keeps every original UI query,
action, assertion, deadline, navigation operation and binding. The test file is
instrumented rather than byte-identical; removing only diagnostic additions
must restore both original source files byte for byte. Original and candidate
hashes are pinned, and any extra changed file fails preflight.

The previous app-only patch remains `apply-diagnostic.patch`. Original source
files and that baseline patch are copied into the uploaded `baseline/` evidence;
the selected patch and raw command/app logs are retained. Only diagnostic files
and this diagnostic workflow change, so the full Native iOS workflow is not
triggered. Ordinary repository CI/preview checks may run separately.

The integrated collector writes `correlation-report.json`, `trace-coverage.json`
and `outcome-report.json`. It distinguishes command boundary completion,
case-level output, process exit/timeout, bundle metadata and state observations.
Mixed sessions, malformed markers, clock-order disagreement or incomplete
command boundaries do not qualify the correlation. State observations are
placed before/during/after the command window only when both explicit clock
orderings agree. That comparison is observational, not proof of a common clock
domain or causation. Neither native handler entry nor stable view identity is
recorded. Later appearance intervals remain distinct.

All 45 offline safeguard/parser/regression tests, Python compilation,
SHA-pinned patch application/restoration and SwiftFormat lint passed before
publication. No local Xcode build, simulator or phone action was performed.
Exact Xcode 26.6 (17F113), iOS 26.4.1 (23E254a), all existing work/evidence budgets
and nonzero command outcomes remain enforced. No automatic rerun follows this
one attempt. See `CORRELATED-CANDIDATE.md` for limitations and the qualification
plan. Hosted compilation and runtime results are pending for this revision.

## Prior evidence and baseline design

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

The prior app-only fixed-source archive changed only `PlacePreview.swift`, adding read-only
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

The corrected exact-toolchain run,
[42585565250](https://github.com/thomashillen/standclear/actions/runs/42585565250),
built and analyzed successfully. The original expanded test actually executed
and passed in 237.489 seconds, including native Close and the later Back/trip
assertions. Its 60 trace records show focus becoming false after Return, then
presentation becoming false after Close, with no observed reactivation. The
passing case had zero animation-notification warnings; the original failed case
had five. This difference is a timing symptom, not a demonstrated cause.

That workflow still **failed**: the command reached its existing budget and
returned 124 while post-test log/session cleanup was pending. This does not
establish a persistent cleanup hang. The retained xcresult has a Data directory
but no Info.plist, and xcresulttool cannot read it. No hosted video or screenshot
review is claimed for this run. The original failure was not reproduced, no
production fix was identified, and #345's full native gate remains failed.

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

Collection also writes `outcome-report.json`, an offline description of three
separate facts: exact case start/completion lines, the recorded command result,
and xcresult structure. Missing, malformed, repeated or conflicting evidence
does not become a case pass or command success. A case pass never overrides a
nonzero command result. Metadata presence is not xcresult reader validation,
and no outcome report can clear a production gate. Raw logs and command records
are hashed and left unchanged. The regression fixture captures the passing-case,
timed-out-command, incomplete-bundle combination from run 42585565250.

`trace-coverage.json` separately describes search observations within each
recorded destination appearance/disappearance interval. An initial appearance
alone is not activation or dismissal evidence. A truncated interval remains
open; malformed, overlapping, mixed-process or out-of-order evidence is marked
ambiguous rather than sorted or combined into a favorable narrative. Later
explicit visits cannot count as reactivation within an earlier interval.
The trace still has no stable view-instance identifier or native Close action
entry marker. Consequently these are observed presentation transitions, not
proof of Close delivery, complete mutation history, or a cause of failure.
The existing basic trace validation and command outcomes are unchanged.

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

The helper correction passed SwiftFormat lint and local build-for-testing; its
single hosted case passed within the failed workflow described above. The
classifier checks are offline Python tests, not another native test run. None
substitutes for the exact-head full merge gates required for production work.
