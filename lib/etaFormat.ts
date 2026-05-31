// ─── Arrival countdown formatters ───────────────────────────────────
//
// Shared formatters for live arrival countdowns. Two surfaces — the
// StationPanel arrival rows and the FollowCapsule next-stop pill —
// were each carrying a private copy of the same six-line `fmtEta`
// helper but with a subtle unit-handling divergence: StationPanel's
// took `(etaSec, nowMs)` and divided inside, while FollowCapsule's
// took `(etaSec, nowSec)` and divided at the call site. Same string
// output today, but two functions named identically with mismatched
// unit contracts are a foot-gun for the third caller — pick one
// canonical signature and route both through it.
//
// Canonical contract: `eta` is the GTFS-RT arrival timestamp in
// SECONDS (matches `Arrival.eta` produced by lib/useTrains and
// app/api/trains/route.ts), `now` is wall-clock MILLISECONDS
// (matches `Date.now()` and `useNow()`, the dominant time-shape
// across the codebase). Parameter names spell the units to make
// future call sites obvious.
//
// LinePanel keeps its own formatter — its 30 s "Now" threshold and
// minute-only granularity are an intentional "calm at distance"
// choice for the dense corridor view, not accidental drift.
// panelUI.ts carries a compact short-form variant ("Xs"/"Xm") that
// targets the in-panel chip layout, and lib/ringEta.ts carries the
// on-map incoming-ring caption ("Xs"/"X min"); those are also
// intentional and stay separate — but ringEta mirrors panelUI's
// thresholds + round-first rule so the two read consistently for
// the same train.

/**
 * Long-form arrival countdown for the urgency-rich detail surfaces.
 *
 *   - secs <= 5  → "Now"      (crossover when the train is
 *                              functionally at the platform)
 *   - secs <  60 → "{N} sec"  (per-second tick in the final minute
 *                              so the rider sees urgency build)
 *   - secs >= 60 → "{N} min"  (rounded — 90 s reads as "2 min" so
 *                              "1 min" doesn't linger past the
 *                              one-minute mark)
 */
export function formatEtaCountdown(etaSec: number, nowMs: number): string {
  const secs = Math.round(etaSec - nowMs / 1000);
  if (secs <= 5) return "Now";
  if (secs < 60) return `${secs} sec`;
  return `${Math.round(secs / 60)} min`;
}
