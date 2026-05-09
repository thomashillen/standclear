import type { StationEntry } from "./stopsIndex";

// ─── Popular stations ───────────────────────────────────────────────
// Curated list of NYC's highest-traffic interchange complexes, surfaced
// in the SearchSheet empty state for riders without any recent searches
// yet. The intent is "zero onboarding": a first-time visitor lands on
// the search panel with nothing typed and immediately sees a one-tap
// path to the city's anchor destinations rather than a blank canvas.
//
// IDs are canonical complex stopIds matching KNOWN_COMPLEXES in
// stopsIndex.ts — the first entry of each merged complex group, which
// is what stationsByComplexId is keyed off. If KNOWN_COMPLEXES changes
// the canonical ordering for a complex, update the matching entry here
// (the unit test guards against drift).
//
// This is a static curation rather than analytics-driven. A future
// iteration could rank by aggregate query frequency once we have
// privacy-respecting client-side search counts; for now, the rank
// reflects the editorial judgment that these six are the obvious
// "where most riders go" targets in NYC.
const POPULAR_COMPLEX_IDS: readonly string[] = [
  "127", // Times Sq-42 St (1/2/3 + 7 + N/Q/R/W + S shuttle)
  "631", // Grand Central-42 St (4/5/6 + 7 + S shuttle)
  "635", // 14 St-Union Sq (4/5/6 + L + N/Q/R/W)
  "D17", // 34 St-Herald Sq (B/D/F/M + N/Q/R/W) — also walking dist. to Penn
  "235", // Atlantic Av-Barclays Ctr (2/3/4/5 + B/Q + D/N/R/W)
  "125", // 59 St-Columbus Circle (1 + A/B/C/D)
];

/**
 * Resolve POPULAR_COMPLEX_IDS against the live station index, returning
 * StationEntry rows in the curated order. Missing IDs (e.g. if a future
 * GTFS update drops a parent stop) are silently skipped — a partial
 * popular list is better than rendering broken rows.
 */
export function getPopularStations(
  stationsByComplexId: ReadonlyMap<string, StationEntry>,
): StationEntry[] {
  const out: StationEntry[] = [];
  for (const id of POPULAR_COMPLEX_IDS) {
    const s = stationsByComplexId.get(id);
    if (s) out.push(s);
  }
  return out;
}

export { POPULAR_COMPLEX_IDS };
