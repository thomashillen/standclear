// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MetadataRoute } from "next";
import type { Lines, SubwayLine } from "@/lib/subwayData";
import type { StationEntry } from "@/lib/stopsIndex";

// Mock the fs-backed station/line readers so the test is decoupled
// from public/gtfsData.json — pinning the sitemap shape, not the
// current GTFS snapshot. Same isolation pattern as
// app/api/alerts/route.test.ts (mocks lib/mtaAlerts so the protobuf
// decode is exercised by its own suite).
const stationsMock = vi.fn<() => StationEntry[]>();
const linesMock = vi.fn<() => Lines>();
vi.mock("@/lib/stations.server", () => ({
  getAllStationsServer: () => stationsMock(),
  getLinesServer: () => linesMock(),
}));

const fakeStation = (name: string, stopId: string): StationEntry => ({
  stopId,
  stopIds: [stopId],
  name,
  lat: 0,
  lng: 0,
  routes: [],
});

const fakeLine = (id: string): SubwayLine => ({
  id,
  routeId: id,
  name: id,
  color: "#000",
  textColor: "white",
  stops: [],
  shape: [],
});

async function loadSitemap() {
  vi.resetModules();
  const mod = await import("./sitemap");
  return mod.default;
}

async function getSiteUrl(): Promise<string> {
  const mod = await import("@/lib/site");
  return mod.SITE_URL;
}

// The marketing surface is hand-curated in the route; pinning every
// row (path + changeFrequency + priority) means dropping one
// silently de-indexes that page on the next crawl. Priorities are
// the relative ranking signal Googlebot uses to budget recrawls
// between siblings — a typo'd 0.05 vs 0.5 would tank a page's
// recrawl cadence without any visible build failure.
const MARKETING_ROWS = [
  { path: "", changeFrequency: "weekly", priority: 1 },
  { path: "/about", changeFrequency: "monthly", priority: 0.7 },
  { path: "/changelog", changeFrequency: "weekly", priority: 0.6 },
  { path: "/status", changeFrequency: "daily", priority: 0.5 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.3 },
] as const;

describe("sitemap()", () => {
  beforeEach(() => {
    stationsMock.mockReset();
    linesMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits the marketing surface (root + 5 pages) in declared order with pinned priority + changeFrequency", async () => {
    stationsMock.mockReturnValue([]);
    linesMock.mockReturnValue({});

    const sitemap = await loadSitemap();
    const SITE_URL = await getSiteUrl();
    const result = sitemap();

    expect(result).toHaveLength(MARKETING_ROWS.length);
    MARKETING_ROWS.forEach((row, i) => {
      expect(result[i].url).toBe(`${SITE_URL}${row.path}`);
      expect(result[i].changeFrequency).toBe(row.changeFrequency);
      expect(result[i].priority).toBe(row.priority);
    });
  });

  it("appends one entry per line key with the lineSlug URL shape, monthly cadence, priority 0.6", async () => {
    stationsMock.mockReturnValue([]);
    // Mixed-case keys (A vs FS) verify the lineSlug lowercasing flows
    // through. A regression that drops the slug pass would emit
    // /line/A which the [id] page (dynamicParams=false) 404s, so the
    // crawler would index a dead URL.
    linesMock.mockReturnValue({
      "1": fakeLine("1"),
      A: fakeLine("A"),
      FS: fakeLine("FS"),
    });

    const sitemap = await loadSitemap();
    const SITE_URL = await getSiteUrl();
    const lineEntries = sitemap().slice(MARKETING_ROWS.length);

    expect(lineEntries).toHaveLength(3);
    expect(lineEntries.map((e) => e.url)).toEqual([
      `${SITE_URL}/line/1`,
      `${SITE_URL}/line/a`,
      `${SITE_URL}/line/fs`,
    ]);
    for (const entry of lineEntries) {
      expect(entry.changeFrequency).toBe("monthly");
      expect(entry.priority).toBe(0.6);
    }
  });

  it("appends one entry per station with the stationSlug URL shape, monthly cadence, priority 0.5", async () => {
    linesMock.mockReturnValue({});
    // Names + stopIds chosen to exercise the kebab + stopId-lower
    // contract: Union Sq merges into the canonical stopId for the
    // 4/5/6 platform, Times Sq's slash collapses to a hyphen, and
    // a letter-prefixed stopId (R20) gets lowercased.
    stationsMock.mockReturnValue([
      fakeStation("14 St-Union Sq", "635"),
      fakeStation("Times Sq-42 St", "127"),
      fakeStation("14 St-Union Sq", "R20"),
    ]);

    const sitemap = await loadSitemap();
    const SITE_URL = await getSiteUrl();
    const stationEntries = sitemap().slice(MARKETING_ROWS.length);

    expect(stationEntries).toHaveLength(3);
    expect(stationEntries.map((e) => e.url)).toEqual([
      `${SITE_URL}/station/14-st-union-sq-635`,
      `${SITE_URL}/station/times-sq-42-st-127`,
      `${SITE_URL}/station/14-st-union-sq-r20`,
    ]);
    for (const entry of stationEntries) {
      expect(entry.changeFrequency).toBe("monthly");
      expect(entry.priority).toBe(0.5);
    }
  });

  it("orders sections marketing → lines → stations", async () => {
    // Mixed line + station inputs would let an accidental swap of
    // the two spread operators (`...stationEntries, ...lineEntries`)
    // pass any per-section test in isolation. Pin the relative
    // ordering explicitly so the section boundaries can't slide.
    stationsMock.mockReturnValue([
      fakeStation("Astor Pl", "330"),
      fakeStation("Bowery", "M18"),
    ]);
    linesMock.mockReturnValue({
      "6": fakeLine("6"),
      J: fakeLine("J"),
    });

    const sitemap = await loadSitemap();
    const SITE_URL = await getSiteUrl();
    const urls = sitemap().map((e) => e.url);

    expect(urls).toEqual([
      SITE_URL,
      `${SITE_URL}/about`,
      `${SITE_URL}/changelog`,
      `${SITE_URL}/status`,
      `${SITE_URL}/privacy`,
      `${SITE_URL}/terms`,
      `${SITE_URL}/line/6`,
      `${SITE_URL}/line/j`,
      `${SITE_URL}/station/astor-pl-330`,
      `${SITE_URL}/station/bowery-m18`,
    ]);
  });

  it("stamps every entry with a Date lastModified close to now", async () => {
    stationsMock.mockReturnValue([fakeStation("Astor Pl", "330")]);
    linesMock.mockReturnValue({ "6": fakeLine("6") });

    const before = Date.now();
    const sitemap = await loadSitemap();
    const result = sitemap();
    const after = Date.now();

    expect(result.length).toBeGreaterThan(0);
    for (const entry of result) {
      expect(entry.lastModified).toBeInstanceOf(Date);
      const t = (entry.lastModified as Date).getTime();
      // Single `new Date()` call inside the route, so every entry
      // shares the same instant. Allow a small clock-skew window;
      // a regression that calls `new Date()` per-entry would still
      // land inside it, but a regression that hardcodes an epoch
      // (e.g. `new Date(0)`) would trip immediately.
      expect(t).toBeGreaterThanOrEqual(before);
      expect(t).toBeLessThanOrEqual(after);
    }
  });

  it("every URL starts with SITE_URL (no domain mixing)", async () => {
    stationsMock.mockReturnValue([fakeStation("Astor Pl", "330")]);
    linesMock.mockReturnValue({ "6": fakeLine("6") });

    const sitemap = await loadSitemap();
    const SITE_URL = await getSiteUrl();
    const result = sitemap();

    for (const entry of result) {
      expect(entry.url.startsWith(SITE_URL)).toBe(true);
    }
  });
});

// Static type-shape guard. Catches a future refactor that loosens
// the return type away from MetadataRoute.Sitemap (which Next reads
// to derive the sitemap.xml content-type + envelope). The cast is
// the assertion — if the signature drifts, this stops compiling.
type _SitemapShape = ReturnType<typeof import("./sitemap").default> extends MetadataRoute.Sitemap
  ? true
  : never;
const _check: _SitemapShape = true;
void _check;
