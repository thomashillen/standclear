// Stable URL slug for per-line SEO pages. Format:
//
//   <id-lower>
//
// e.g. "1", "a", "fs", "si". The IDs are short (1–2 chars) and unique
// across the system, so no name kebab-casing is needed — the URL is a
// clean /line/a, /line/fs, etc. Lowercase keeps URLs canonical and
// case-folds gracefully when a reader hand-types or pastes.
//
// The reverse lookup is case-insensitive so /line/A and /line/a resolve
// to the same page (Next's static-params guard makes /line/A a 404
// otherwise, since `dynamicParams = false` enforces exact-match).

import type { Lines, SubwayLine } from "./subwayData";

export function lineSlug(id: string): string {
  return id.toLowerCase();
}

export function findLineBySlug(lines: Lines, slug: string): SubwayLine | null {
  const norm = slug.toLowerCase();
  for (const id of Object.keys(lines)) {
    if (lineSlug(id) === norm) return lines[id];
  }
  return null;
}
