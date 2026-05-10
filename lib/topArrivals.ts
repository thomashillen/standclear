// ─── Direction-balanced arrival picking ────────────────────────────
// StationRow shows the next ~3 trains at a station. Arrivals come
// from the API pre-sorted by ETA, so a naive `slice(0, 3)` at a
// busy station during rush hour can return three arrivals all in
// the same direction — at Times Square the next three Northbound
// trains can all land in under five minutes while Southbound is
// invisible. A rider scanning the row needs at least one arrival
// per direction to know whether their train is coming at all.
//
// This helper guarantees direction coverage when both directions
// have trains within a reasonable horizon. Outside the horizon
// (default 30 min) we'd be replacing a useful 3-min Northbound
// with a 45-min Southbound, which is worse than the original
// time-ordered slice — so we fall back. Apple Transit does
// something similar: directions show until they go quiet, then
// collapse.

const DEFAULT_HORIZON_SEC = 30 * 60;

/**
 * Pick up to `count` arrivals biased to cover both directions.
 *
 * Preconditions: `arrivals` is treated as ETA-sorted; we re-sort
 * defensively so the helper stays correct if a caller passes an
 * unsorted slice.
 *
 * Behavior:
 *  - 0 arrivals → []
 *  - count < 2 or only one direction has any arrival → soonest by ETA.
 *  - count slot already covers both directions naturally → return as-is.
 *  - secondary direction's soonest arrival is beyond `horizonSec` →
 *    return soonest by ETA (don't bump a near-term primary for a
 *    far-out secondary).
 *  - otherwise → guarantee one of each direction by replacing the
 *    latest primary entry with the secondary's soonest, then re-sort
 *    by ETA so the row reads chronologically.
 */
export function pickBalancedArrivals<
  T extends { direction: "N" | "S"; eta: number },
>(
  arrivals: T[],
  count: number,
  nowSec: number,
  horizonSec: number = DEFAULT_HORIZON_SEC,
): T[] {
  if (count <= 0 || arrivals.length === 0) return [];
  const sorted = arrivals.slice().sort((a, b) => a.eta - b.eta);
  if (sorted.length <= count) return sorted;

  if (count < 2) return sorted.slice(0, count);

  const firstN = sorted.find((a) => a.direction === "N");
  const firstS = sorted.find((a) => a.direction === "S");
  if (!firstN || !firstS) return sorted.slice(0, count);

  const top = sorted.slice(0, count);
  const topHasN = top.some((a) => a.direction === "N");
  const topHasS = top.some((a) => a.direction === "S");
  if (topHasN && topHasS) return top;

  const secondary = topHasN ? firstS : firstN;
  if (secondary.eta - nowSec > horizonSec) return top;

  // Replace the *latest* primary-direction entry so the rider keeps
  // the soonest two same-direction arrivals (the ones they're most
  // likely acting on) and gains the secondary direction's heads-up.
  const balanced = top.slice();
  for (let i = balanced.length - 1; i >= 0; i--) {
    if (balanced[i].direction !== secondary.direction) {
      balanced[i] = secondary;
      break;
    }
  }
  return balanced.sort((a, b) => a.eta - b.eta);
}
