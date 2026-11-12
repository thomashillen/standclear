# Correlated command/state trace qualification

This revision integrates the previously reviewed candidate for one bounded
hosted marker qualification. It is not a product fix or merge gate.
`correlated-candidate.patch` applies to the SHA-guarded original #345 source at
`e874c7f9cd1c5bc1bb2e6e6e185e806408a0493f`. It is an alternative to, not an
additional application of, `apply-diagnostic.patch`. The original baseline
patch/source and raw evidence are retained. Budgets and production gates are
unchanged.

## What it records

- The original conditional Close branch has command markers immediately before
  its existing existence check, before and after its one existing tap, or an
  absent marker if the original condition is false. A final marker precedes the
  original five-second Back assertion. No UI query, tap, wait or assertion is
  added, removed or replaced. Returning from `tap()` is not native action delivery.
- A local UUID is generated once per test helper invocation and passed through
  a diagnostic launch-environment value. It joins test/app logs, not view
  identities. No `@State`, `@StateObject`, namespace, `.id`, delegate, wrapper,
  navigation or search ownership is added or changed.
- The existing read-only app state/lifecycle observers gain the same session
  token and explicit wall/uptime readings in a versioned log format. They still
  observe rendered state transitions, not every binding write. A common session
  alone does not validate a common clock domain. Clock agreement and actual
  marker transport need matching-runtime validation.
- `parse_commands` conservatively records complete, missing, truncated,
  duplicated, mixed-session or reordered command evidence. It always labels
  native Close action delivery and view identity as unrecorded. Test fixtures
  for these markers are synthetic; no new native trace has been produced.

## Why native handler entry and stable view identity are unavailable

PlaceEndpointPicker has no app-owned Close handler or UIKit search delegate.
Its only explicit presentation/focus writes are in `pick()`. SwiftUI owns the
native searchable control. The local SDK exposes delegate callbacks such as
`searchBarCancelButtonClicked:` and search-controller dismissal callbacks, but
assigning a proxy/replacement delegate or intercepting a private target could
change precisely the ownership/dispatch under investigation. No such operation
is proposed by this patch, and callback existence in the local 27.2 SDK does not
establish which handler runs on hosted 26.6.

A SwiftUI View value is also not a stable rendered-view identity. A new stored
UUID would identify value construction, while adding persistent dynamic state
solely for identity could change the diagnostic. This candidate keeps the
previous lifecycle intervals and their overlap/identity uncertainty instead of
inventing an instance identifier. Neither a pressed screenshot, a tap return,
nor a presentation change will be described as handler-entry proof.

## Offline validation and observer effects

The candidate manifest pins original/modified source and patch SHA-256 values.
The generator rejects any other original source. Removing only the explicit
logging/environment additions restores both original files byte for byte.
The patch applied exactly to an independent two-file source copy. Assertions,
existing UI queries/actions/deadlines, and SwiftUI state/binding/identity lines
were independently compared and are unchanged. SwiftFormat lint passed on both
candidate Swift files; 45 Python tests passed, including candidate and collector integration
tests. No local Xcode compilation or native execution was performed.

Instrumentation adds UUID creation, environment reads, clock reads, string
formatting and logging; these can change timing or observable task scheduling.
The test file is no longer byte-identical, despite preserving its original UI
operations and assertions. A future passing candidate cannot clear the failed
full-suite gate, prove flakiness or establish causation.

## One bounded hosted qualification

The workflow now selects the reviewed candidate in explicit correlated mode.
Preflight pins both original and candidate hashes, permits exactly the two
instrumented files and verifies restoration of original source/test bytes.
Collection preserves V2 app records and the original command log. The app-only
baseline mode and original patch remain available as evidence, not an automatic
fallback/retry. All command, collection and upload budgets remain unchanged.

The single changed-head attempt must use Xcode 26.6 (17F113) and iOS 26.4.1
(23E254a); mismatch fails closed. Report compilation separately from actual case
start/completion. Check whether the conditional Close branch ran and whether
tokens and clock orderings can correlate observations. Retain raw logs and any
partial bundle on every outcome. A case pass cannot override a nonzero command
exit or an incomplete bundle. Stop after this attempt without an unchanged retry.

Actual action-entry attribution remains unresolved. Verify a non-intercepting,
matching-runtime native trace hook and its observer effects before proposing a
further delivery/root-cause investigation. Neither this patch nor a successful
marker qualification establishes native handler entry. No full-suite rerun or
product merge follows from this diagnostic.

#345's full native gate remains failed. #349 stays draft and diagnostic only.
No local native build/test, simulator/phone action or benchmark is part of this
qualification. The normal full Native iOS workflow is not triggered by these
diagnostic-only paths. No GitHub comments or formal approvals are added.
