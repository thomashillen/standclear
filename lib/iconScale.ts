// ─── Subway-icon zoom → scale curve ─────────────────────────────────
// The rendered size of each train capsule is a piecewise-linear
// function of map zoom, consumed two ways that MUST stay in lockstep:
//
//   1. As the Mapbox `icon-size` interpolate expression
//      (`iconSizeByZoomExpression()`) — Mapbox evaluates this to size
//      the actual bitmap on screen.
//   2. As a plain JS scalar (`iconScaleAtZoom`) — `useTrainMarkers`
//      evaluates it every frame to scale the perpendicular stack
//      offset that fans out collided trains (4/5/6 at Union Sq,
//      express overtaking local at a shared platform) so the gap
//      between stacked markers matches their rendered size at every
//      zoom.
//
// These were hand-maintained in two places: the Mapbox literal in
// `components/MapView.tsx` and an unrolled if-ladder in
// `lib/useTrainMarkers.ts`. They encode the identical curve, but a
// tune to one that missed the other would silently drift the fan-out
// off the icon size — stacked trains overlapping or leaving a visible
// "missing slot" gap. Both now derive from the single
// `ICON_SCALE_STOPS` table so a curve change moves both signals
// together. Same single-source-of-truth lift as PR #136's
// `markerOpacityMul` extraction out of `useTrainMarkers`.
//
// Stops, chosen so the skeumorphic car silhouette stays legible as
// the rider zooms from the system-wide view into a neighborhood (the
// target visible BODY sizes are documented at the MapView call site):
//   z=10   → 0.29  abstract dot, headlight bulbs visible
//   z=11.5 → 0.50  body shape recognizable
//   z=13   → 0.74  windshield + headlights + letter read
//   z=14   → 1.03  full detail, comfortable letter inside the body
export const ICON_SCALE_STOPS: readonly (readonly [number, number])[] = [
  [10, 0.29],
  [11.5, 0.5],
  [13, 0.74],
  [14, 1.03],
];

/**
 * The Mapbox `icon-size` interpolate expression, built from
 * {@link ICON_SCALE_STOPS}. Returned typed as `unknown` to match
 * MapView's `MapboxExpression` alias, and freshly constructed per
 * call so a consumer can't mutate the shared stop table through the
 * returned literal.
 */
export function iconSizeByZoomExpression(): unknown {
  const tail: number[] = [];
  for (const [z, s] of ICON_SCALE_STOPS) tail.push(z, s);
  return ["interpolate", ["linear"], ["zoom"], ...tail];
}

/**
 * The same curve as a plain scalar: the rendered icon-size multiplier
 * at map `zoom`, linearly interpolated between {@link ICON_SCALE_STOPS}
 * and clamped flat outside the stop range — matching Mapbox
 * `interpolate`'s endpoint extrapolation exactly so the JS value and
 * the GPU-evaluated expression never disagree.
 *
 * The non-finite guard mirrors `markerOpacityMul`'s defensive
 * fallback: callers pass `map.getZoom()` (always finite today), but a
 * NaN here would otherwise propagate into the stack-offset geometry
 * and blank every marker rather than degrade one value.
 */
export function iconScaleAtZoom(zoom: number): number {
  const stops = ICON_SCALE_STOPS;
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (!Number.isFinite(zoom) || zoom <= first[0]) return first[1];
  if (zoom >= last[0]) return last[1];
  for (let i = 1; i < stops.length; i++) {
    const [z0, s0] = stops[i - 1];
    const [z1, s1] = stops[i];
    if (zoom <= z1) {
      return s0 + ((zoom - z0) / (z1 - z0)) * (s1 - s0);
    }
  }
  // Unreachable: the `zoom >= last` guard above covers the tail.
  return last[1];
}
