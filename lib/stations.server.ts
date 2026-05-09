import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Lines } from "./subwayData";
import { buildStationIndex, type StationEntry } from "./stopsIndex";

// ─── Server-only station index ───────────────────────────────────────
// Reads `public/gtfsData.json` from the filesystem at request / build
// time and builds the station index server-side. Used by the per-
// station SEO pages (`/station/[slug]`) which are statically pre-
// rendered at build time, and by the sitemap which lists every station
// URL.
//
// Why fs and not `fetch('/gtfsData.json')`:
//
//   The CLAUDE.md note explicitly says NOT to import the JSON as a
//   module — bundling it through Turbopack ballooned tsserver memory.
//   Reading via `node:fs` keeps the blob server-side only (the
//   `server-only` import errors at build time if anything client-
//   bundled accidentally pulls this file in) and avoids a runtime
//   network round-trip back to our own /public for SSG.

let cached: StationEntry[] | null = null;
let cachedLines: Lines | null = null;

function load(): { lines: Lines; stations: StationEntry[] } {
  if (cached && cachedLines) return { lines: cachedLines, stations: cached };
  const file = path.join(process.cwd(), "public", "gtfsData.json");
  const raw = readFileSync(file, "utf-8");
  const parsed = JSON.parse(raw) as { lines: Lines };
  cachedLines = parsed.lines;
  cached = buildStationIndex(parsed.lines);
  return { lines: cachedLines, stations: cached };
}

export function getAllStationsServer(): StationEntry[] {
  return load().stations;
}

export function getLinesServer(): Lines {
  return load().lines;
}
