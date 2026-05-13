import type { RouteBadge, StationEntry } from "./stopsIndex";

// Routes at a station complex that are NOT the current line. Used by
// the /line/[id] station list to surface only the *transfer* bullets
// next to each stop. The current line is already implied by the page
// context (eyebrow + title + URL), so re-rendering its own bullet on
// every row adds visual noise without adding information.
//
// Filtering is on `routeId`, not the display `id`, so a shuttle landing
// page (routeId = "GS" / "FS" / "H", display id = "S") correctly drops
// itself out of its own station list — the display id "S" alone would
// be ambiguous if a complex were ever served by two shuttle routes.
export function getInterchanges(
  entry: StationEntry | undefined,
  currentRouteId: string,
): RouteBadge[] {
  if (!entry) return [];
  return entry.routes.filter((r) => r.routeId !== currentRouteId);
}

// Aggregate `getInterchanges` across every stop on a line into a single
// dedup'd, route-ordered list — the union of every other route a rider
// can transfer to *somewhere* on the line. Powers the "Direct
// transfers" overview at the top of /line/[id]: an at-a-glance Apple-
// Maps-style connections summary above the per-stop detail, so a
// reader scanning the page sees "this line connects to A, C, E, F, …"
// before drilling into the 30+ station list.
//
// Dedup key is `routeId` (matches `getInterchanges`'s filter axis):
// preserves order of first appearance along the line, so on the 1
// train the bullets read in the order they appear travelling south
// (2, 3 share 242 St → 7 appears at Times Sq, etc.). `undefined`
// entries (stops with no matching StationEntry) are skipped silently
// — same shape as `getInterchanges`'s own undefined guard.
export function aggregateInterchanges(
  entries: Iterable<StationEntry | undefined>,
  currentRouteId: string,
): RouteBadge[] {
  const seen = new Set<string>();
  const out: RouteBadge[] = [];
  for (const entry of entries) {
    for (const route of getInterchanges(entry, currentRouteId)) {
      if (seen.has(route.routeId)) continue;
      seen.add(route.routeId);
      out.push(route);
    }
  }
  return out;
}
