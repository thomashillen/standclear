// ─── On-map incoming-ring ETA caption ──────────────────────────────
//
// The StationPanel "incoming" rings (lib/useTrainMarkers.ts) paint a
// short ETA caption above each train headed for the open station.
// That caption is its own compact formatter — deliberately NOT the
// long-form `lib/etaFormat.ts::formatEtaCountdown` and NOT panelUI's
// `fmtEta`: the ring caption floats free over the dark map, so it
// keeps a spelled-out `" min"` suffix (legible at a glance against
// tiles) rather than the tight `"m"` glyph the in-panel chip uses.
// The three compact variants stay separate by design — see the
// header comment in `lib/etaFormat.ts` — but they must agree on the
// *thresholds and rounding*, because a rider sees the ring caption
// and the panel chip for the same train side by side.
//
// This was previously an inline block in `useTrainMarkers.ts` whose
// comment claimed "same formatting as fmtEta in StationPanel" but
// quietly diverged: it branched on the raw float before rounding, so
// an ETA of 59.6 s rendered as "60s" instead of rolling into the
// minute band, and the (5, 5.5] s window read "5s" while the panel
// chip already said "Now". Rounding to whole seconds FIRST — exactly
// like `panelUI.tsx::fmtEta` — closes both gaps: 59.6 → 60 → "1 min"
// (never a nonsensical "60s"), and 5.4 → 5 → "Now" (the ring and the
// chip cross the "Now" boundary together). Accuracy-first: a caption
// that reads "60s" is a wrong number, not a rounding nicety.

/**
 * Compact ETA caption for the on-map incoming rings.
 *
 * `etaSec` is the train's seconds-until-arrival at the open station
 * (already `arrival.eta - nowSec`, clamped by the caller to the
 * [-30, 600] horizon; STOPPED_AT-here trains are passed as 0). Round
 * to whole seconds before branching so the bands line up with
 * `panelUI.tsx::fmtEta`:
 *
 *   - secs <= 5  → "Now"      (functionally at the platform)
 *   - secs <  60 → "{N}s"     (per-second build in the final minute)
 *   - secs >= 60 → "{N} min"  (spelled-out suffix for the map caption)
 */
export function formatRingEta(etaSec: number): string {
  const secs = Math.round(etaSec);
  if (secs <= 5) return "Now";
  if (secs < 60) return `${secs}s`;
  return `${Math.round(secs / 60)} min`;
}
