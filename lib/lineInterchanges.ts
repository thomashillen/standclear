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
