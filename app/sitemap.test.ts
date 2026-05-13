// @vitest-environment node
import { describe, expect, it } from "vitest";
import sitemap from "./sitemap";
import { SITE_URL } from "@/lib/site";

// Sitemap is the crawl-budget contract: every URL listed should be a
// page we *want* in the index. `/status` is the load-bearing exception
// — it sets `robots: { index: false }` (app/status/page.tsx) because
// it reflects transient health, and listing a noindex URL in the
// sitemap is one of the few SEO antipatterns Google explicitly flags
// ("Submitted URL marked 'noindex'"). These tests pin the inclusion
// list so a future edit that re-adds /status, or drops a marketing
// page, trips the suite.

describe("sitemap()", () => {
  const entries = sitemap();
  const urls = entries.map((e) => e.url);

  it("excludes /status (page is noindex)", () => {
    // Belt-and-suspenders: assert the exact URL is missing AND that no
    // entry's path component matches the /status leaf, so a future
    // refactor that ships a "/status/foo" surface still trips this.
    expect(urls).not.toContain(`${SITE_URL}/status`);
    for (const u of urls) {
      expect(new URL(u).pathname.replace(/\/$/, "")).not.toBe("/status");
    }
  });

  it("includes the canonical marketing surfaces", () => {
    expect(urls).toContain(SITE_URL);
    expect(urls).toContain(`${SITE_URL}/about`);
    expect(urls).toContain(`${SITE_URL}/changelog`);
    expect(urls).toContain(`${SITE_URL}/privacy`);
    expect(urls).toContain(`${SITE_URL}/terms`);
  });

  it("emits at least one /line/[id] entry and one /station/[slug] entry", () => {
    // Both come from the GTFS index via `lib/stations.server.ts`. A
    // build that lost public/gtfsData.json would also drop these to
    // zero, so a single-fixture sanity assertion is the right floor.
    const linePaths = urls.filter((u) =>
      new URL(u).pathname.startsWith("/line/"),
    );
    const stationPaths = urls.filter((u) =>
      new URL(u).pathname.startsWith("/station/"),
    );
    expect(linePaths.length).toBeGreaterThan(0);
    expect(stationPaths.length).toBeGreaterThan(0);
  });

  it("every entry carries a lastModified Date", () => {
    // `MetadataRoute.Sitemap` accepts Date | string | number; the
    // sitemap implementation passes `new Date()` to every row. If a
    // future entry forgets it, Next emits `<lastmod>` as the empty
    // string which some crawlers reject — pin the invariant.
    for (const e of entries) {
      expect(e.lastModified).toBeInstanceOf(Date);
    }
  });

  it("emits unique URLs (no duplicate routes)", () => {
    // The two sources (static marketing entries + the dynamic line +
    // station lists) are concatenated; a future edit that adds /about
    // to both halves would silently double-list it.
    const seen = new Set<string>();
    for (const u of urls) {
      expect(seen.has(u)).toBe(false);
      seen.add(u);
    }
  });
});
