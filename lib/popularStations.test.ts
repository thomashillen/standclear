// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { getPopularStations, POPULAR_COMPLEX_IDS } from "./popularStations";
import { buildStationIndex, type StationEntry } from "./stopsIndex";
import type { Lines } from "./subwayData";

function loadStations(): StationEntry[] {
  // Read the prebuilt GTFS blob directly rather than going through
  // stations.server.ts — that module has a "server-only" guard which
  // throws under Vitest's Node environment.
  const file = path.join(process.cwd(), "public", "gtfsData.json");
  const raw = readFileSync(file, "utf-8");
  const parsed = JSON.parse(raw) as { lines: Lines };
  return buildStationIndex(parsed.lines);
}

function indexByComplexId(stations: StationEntry[]): Map<string, StationEntry> {
  const m = new Map<string, StationEntry>();
  for (const s of stations) m.set(s.stopId, s);
  return m;
}

describe("getPopularStations", () => {
  it("resolves every curated complex id against the real station index", () => {
    // Guards against drift between POPULAR_COMPLEX_IDS and the canonical
    // first-member id used by KNOWN_COMPLEXES in stopsIndex.ts. If a
    // complex is reordered (e.g. ["L03", "635", ...] instead of
    // ["635", "L03", ...]) the resolved entry would be a different
    // platform — this test would fail at build time so the discrepancy
    // can't ship.
    const idx = indexByComplexId(loadStations());
    const popular = getPopularStations(idx);
    expect(popular.length).toBe(POPULAR_COMPLEX_IDS.length);
    for (const s of popular) {
      expect(s.name.length).toBeGreaterThan(0);
      expect(s.routes.length).toBeGreaterThan(0);
    }
  });

  it("preserves the curated order", () => {
    const idx = indexByComplexId(loadStations());
    const popular = getPopularStations(idx);
    expect(popular.map((s) => s.stopId)).toEqual([...POPULAR_COMPLEX_IDS]);
  });

  it("silently skips ids that aren't in the live index", () => {
    // Empty index → empty result, not a thrown error. Keeps the
    // SearchSheet empty state resilient if a future GTFS update drops
    // one of the curated parent stops.
    const popular = getPopularStations(new Map());
    expect(popular).toEqual([]);
  });
});
