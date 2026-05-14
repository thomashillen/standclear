// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import type { StationEntry } from "./stopsIndex";
import type { Lines } from "./subwayData";

// `server-only` is a Next.js bundler hint with no real package on
// disk — under Vitest's resolver, importing `lib/stations.server.ts`
// would crash on the `import "server-only"` line. Hoisted vi.mock
// intercepts the resolution and returns an empty module so the rest
// of the file loads cleanly. Same effect as the alias PR #127 is
// adding to vitest.config.ts; per-file mock keeps this test
// independent of that config change.
vi.mock("server-only", () => ({}));

// Module-level cache lives inside `lib/stations.server.ts` — re-import
// per test via vi.resetModules + loadFresh so each case starts from a
// cold cache and our cache-survives assertions can't accidentally
// piggy-back on a previous test's warmup.
async function loadFresh() {
  vi.resetModules();
  return await import("./stations.server");
}

describe("getAllStationsServer", () => {
  it("returns a non-empty array of StationEntry objects sourced from public/gtfsData.json", async () => {
    const { getAllStationsServer } = await loadFresh();
    const stations = getAllStationsServer();
    expect(Array.isArray(stations)).toBe(true);
    expect(stations.length).toBeGreaterThan(400);
    // Shape sanity — every entry carries the keys the SEO page +
    // sitemap consume. A future regression that drops one (e.g.
    // narrowing the index build to fewer fields to "save memory")
    // would silently break /station/[slug] generateStaticParams.
    const sample: StationEntry = stations[0];
    expect(typeof sample.stopId).toBe("string");
    expect(Array.isArray(sample.stopIds)).toBe(true);
    expect(typeof sample.name).toBe("string");
    expect(typeof sample.lat).toBe("number");
    expect(typeof sample.lng).toBe("number");
    expect(Array.isArray(sample.routes)).toBe(true);
  });

  it("returns the same array reference on repeated calls (module-level cache)", async () => {
    const { getAllStationsServer } = await loadFresh();
    const first = getAllStationsServer();
    const second = getAllStationsServer();
    const third = getAllStationsServer();
    // Same reference, not just deep-equal — `app/station/[slug]/page.tsx`
    // calls this on every static-prerender + every request-time render,
    // and the entire 451-station index gets rebuilt if the cache stops
    // returning by reference.
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("contains a canonical multi-line complex (Union Square) with merged stop_ids", async () => {
    const { getAllStationsServer } = await loadFresh();
    const stations = getAllStationsServer();
    // Union Sq merges 4/5/6 (635) + N/Q/R/W (R20) + L (L03) per the
    // explicit COMPLEXES table in stopsIndex.ts; pin the merge survives
    // an end-to-end load so an accidental table edit shows up here.
    const unionSq = stations.find(
      (s) =>
        s.stopIds.includes("635") &&
        s.stopIds.includes("R20") &&
        s.stopIds.includes("L03"),
    );
    expect(unionSq).toBeDefined();
    expect(unionSq!.name.toLowerCase()).toContain("14");
  });
});

describe("getLinesServer", () => {
  it("returns a Lines object keyed by routeId with every MTA trunk route", async () => {
    const { getLinesServer } = await loadFresh();
    const lines: Lines = getLinesServer();
    // The 26 routes shipped in public/gtfsData.json (numbered 1–7,
    // lettered A/B/C/D/E/F/G/J/L/M/N/Q/R/W/Z, shuttles GS/FS/H/SI).
    // A regression that drops a route silently breaks `/line/[id]`
    // for every rider on that line.
    for (const routeId of [
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "A",
      "B",
      "C",
      "D",
      "E",
      "F",
      "G",
      "J",
      "L",
      "M",
      "N",
      "Q",
      "R",
      "W",
      "Z",
      "GS",
      "FS",
      "H",
      "SI",
    ]) {
      expect(lines[routeId], `routeId ${routeId} missing`).toBeDefined();
    }
  });

  it("returns the same Lines reference on repeated calls (module-level cache)", async () => {
    const { getLinesServer } = await loadFresh();
    const first = getLinesServer();
    const second = getLinesServer();
    expect(second).toBe(first);
  });

  it("each line entry carries the geometry + stops the per-line page consumes", async () => {
    const { getLinesServer } = await loadFresh();
    const line = getLinesServer()["1"];
    expect(line).toBeDefined();
    expect(typeof line.routeId).toBe("string");
    expect(typeof line.color).toBe("string");
    expect(line.color).toMatch(/^#/);
    expect(Array.isArray(line.shape)).toBe(true);
    expect(line.shape.length).toBeGreaterThan(0);
    expect(Array.isArray(line.stops)).toBe(true);
    expect(line.stops.length).toBeGreaterThan(0);
  });
});

describe("shared cache across getters", () => {
  it("getAllStationsServer and getLinesServer share a single load — order doesn't change either return", async () => {
    // Load A: stations first, lines second.
    const a = await loadFresh();
    const stationsA = a.getAllStationsServer();
    const linesA = a.getLinesServer();

    // Load B: lines first, stations second.
    const b = await loadFresh();
    const linesB = b.getLinesServer();
    const stationsB = b.getAllStationsServer();

    // Same fs file → same content. New module instance → different
    // references, but identical content. The cache discipline (one
    // `load()` body, shared between getters) is what makes this hold.
    expect(stationsB.length).toBe(stationsA.length);
    expect(Object.keys(linesB).sort()).toEqual(Object.keys(linesA).sort());
  });

  it("vi.resetModules drops the cache — fresh import yields a new array reference", async () => {
    const a = await loadFresh();
    const stationsA = a.getAllStationsServer();
    const b = await loadFresh();
    const stationsB = b.getAllStationsServer();
    // Same shape, different reference — proves the module-level cache
    // is per-import, not a process-global that would survive a hot
    // reload and leak stale data across Vercel function invocations
    // on the same Node instance.
    expect(stationsB.length).toBe(stationsA.length);
    expect(stationsB).not.toBe(stationsA);
  });
});
