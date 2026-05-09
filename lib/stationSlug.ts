// Stable URL slug for per-station SEO pages. Format:
//
//   <name-kebab>-<stopId-lower>
//
// e.g. "14-st-union-sq-635", "times-sq-42-st-127", "a32-w-4-st-wash-sq".
//
// The stopId suffix guarantees uniqueness even when two distinct stations
// share a name across boroughs ("Broadway Junction" complex vs Brooklyn
// "Broadway"). Kept short enough to read in a tweet — the SEO target is
// "${station} live arrivals", and Google ignores trailing IDs in titles.

import type { StationEntry } from "./stopsIndex";

const NAME_TRIM = /^-+|-+$/g;

function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    // Replace any non-alphanumeric run with a single hyphen.
    .replace(/[^a-z0-9]+/g, "-")
    .replace(NAME_TRIM, "");
}

export function stationSlug(station: { name: string; stopId: string }): string {
  const base = slugifyName(station.name);
  const id = station.stopId.toLowerCase();
  return `${base}-${id}`;
}

// Reverse lookup helper. Slugs collide rarely (same name + same stopId
// → same slug, which is the desired identity), so an O(N) sweep over
// the index is fine — N ≈ 470. For build-time generateStaticParams
// the cost is negligible.
export function findStationBySlug(
  index: StationEntry[],
  slug: string,
): StationEntry | null {
  for (const s of index) {
    if (stationSlug(s) === slug) return s;
  }
  return null;
}
