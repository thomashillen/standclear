// @vitest-environment node

import { describe, expect, it } from "vitest";
import { findStationBySlug, stationSlug } from "./stationSlug";
import type { StationEntry } from "./stopsIndex";

// Minimal StationEntry — `stationSlug` only consults `name` + `stopId`,
// but the helper accepts the full entry so consumers don't have to
// destructure. Keeping the fixture rows complete documents that the
// rest of the entry shape is intentionally ignored by the slug rules.
const entry = (name: string, stopId: string): StationEntry => ({
  stopId,
  stopIds: [stopId],
  name,
  lat: 0,
  lng: 0,
  routes: [],
});

describe("stationSlug", () => {
  // ── Shape ──────────────────────────────────────────────────────────
  // Format `<name-kebab>-<stopId-lower>` is the contract every consumer
  // depends on: app/sitemap.ts emits 451 of these into sitemap.xml,
  // app/station/[slug]/page.tsx + opengraph-image.tsx prerender on
  // them, and app/line/[id]/page.tsx + app/station/[slug]/page.tsx
  // both build internal `Link` hrefs from them. A change to the
  // separator or the stopId-case would break every shared link
  // landed on Twitter/iMessage and force Google to re-crawl.
  it("emits <name-kebab>-<stopId-lower>", () => {
    expect(stationSlug(entry("14 St-Union Sq", "635"))).toBe(
      "14-st-union-sq-635",
    );
    expect(stationSlug(entry("Times Sq-42 St", "127"))).toBe(
      "times-sq-42-st-127",
    );
  });

  it("lowercases the stopId so /station/r20 and the URL match", () => {
    // R20 (NQRW Union Sq), L03 (L Union Sq), A32 (W 4 St-Wash Sq) are
    // the real GTFS stopIds for the multi-line transfer complexes; all
    // letter-prefixed stopIds in the network are uppercase upstream.
    expect(stationSlug(entry("14 St-Union Sq", "R20"))).toBe(
      "14-st-union-sq-r20",
    );
    expect(stationSlug(entry("W 4 St-Wash Sq", "A32"))).toBe(
      "w-4-st-wash-sq-a32",
    );
    expect(stationSlug(entry("14 St-Union Sq", "L03"))).toBe(
      "14-st-union-sq-l03",
    );
  });

  it("preserves digits in the name and the stopId", () => {
    // 451-style "all numeric" stopIds (the IRT side: 1/2/3 + 4/5/6) are
    // half the network; making sure they round-trip without padding.
    expect(stationSlug(entry("96 St", "120"))).toBe("96-st-120");
    expect(stationSlug(entry("8 Av", "A55"))).toBe("8-av-a55");
  });

  // ── Punctuation collapsing ────────────────────────────────────────
  // The `[^a-z0-9]+` rule is intentionally aggressive — every non-alnum
  // run becomes one hyphen — so URL-unsafe characters never reach the
  // address bar. The cases below are taken from real station names in
  // public/gtfsData.json (the comments cite the GTFS string verbatim);
  // a future "improvement" that special-cases any of these would
  // change live URLs and break shared links.
  it("collapses '/' into a single hyphen (Lexington Av/53 St)", () => {
    expect(stationSlug(entry("Lexington Av/53 St", "F12"))).toBe(
      "lexington-av-53-st-f12",
    );
  });

  it("collapses parentheses (Cathedral Pkwy (110 St))", () => {
    expect(stationSlug(entry("Cathedral Pkwy (110 St)", "120"))).toBe(
      "cathedral-pkwy-110-st-120",
    );
  });

  it("collapses apostrophes (Prince's Bay, St Mary's)", () => {
    expect(stationSlug(entry("Prince's Bay", "S26"))).toBe(
      "prince-s-bay-s26",
    );
    expect(stationSlug(entry("E 143 St-St Mary's St", "621"))).toBe(
      "e-143-st-st-mary-s-st-621",
    );
  });

  it("expands '&' to ' and ' before kebab-collapsing", () => {
    // Documented by the source: `replace(/&/g, " and ")` runs BEFORE
    // the non-alnum collapse, so `A & B` → `a-and-b`, not `a-b`. None
    // of the shipped MTA names contain `&` today, but the rule is on
    // the public surface — pinning so a tidy refactor doesn't drop it.
    expect(stationSlug(entry("Park & Ride", "X01"))).toBe(
      "park-and-ride-x01",
    );
    expect(stationSlug(entry("A&B&C", "X02"))).toBe("a-and-b-and-c-x02");
  });

  it("collapses multiple consecutive separators into one hyphen", () => {
    expect(stationSlug(entry("A   B", "X03"))).toBe("a-b-x03");
    expect(stationSlug(entry("A -- B", "X04"))).toBe("a-b-x04");
    expect(stationSlug(entry("A / / B", "X05"))).toBe("a-b-x05");
  });

  it("trims leading and trailing hyphens from the name kebab", () => {
    // Without NAME_TRIM, ` - 14 St` would become `-14-st` and the
    // joined slug would have `--` between name and stopId. The trim
    // keeps the slug visually clean and the join unambiguous.
    expect(stationSlug(entry(" - 14 St", "120"))).toBe("14-st-120");
    expect(stationSlug(entry("14 St - ", "120"))).toBe("14-st-120");
    expect(stationSlug(entry("--14 St--", "120"))).toBe("14-st-120");
  });

  // ── Stability / disambiguation ────────────────────────────────────
  it("is deterministic — same input → same slug across calls", () => {
    // Stability is the SEO contract: a station's URL must not drift
    // between deploys, otherwise Google re-indexes and shared links
    // 404. The function is pure, so this should be free — pinning so
    // a future caching layer can't accidentally introduce variance.
    const station = entry("Times Sq-42 St", "127");
    const a = stationSlug(station);
    const b = stationSlug(station);
    expect(a).toBe(b);
  });

  it("disambiguates same-name stations by stopId suffix", () => {
    // Real example documented in the source comment: two distinct
    // "Broadway"-flavored stations across boroughs. The stopId
    // suffix is the only thing keeping them on different URLs.
    const a = stationSlug(entry("Broadway", "G40"));
    const b = stationSlug(entry("Broadway", "M16"));
    expect(a).not.toBe(b);
    expect(a).toBe("broadway-g40");
    expect(b).toBe("broadway-m16");
  });
});

describe("findStationBySlug", () => {
  // Mirrors a slice of the real station index — three multi-line
  // complexes (mixed letter+numeric stopIds) and two same-name
  // stations on different boroughs that the slug must keep separate.
  const fixture: StationEntry[] = [
    entry("14 St-Union Sq", "635"),
    entry("Times Sq-42 St", "127"),
    entry("Cathedral Pkwy (110 St)", "120"),
    entry("Broadway", "G40"),
    entry("Broadway", "M16"),
  ];

  it("round-trips every station via its own slug", () => {
    // The strongest invariant: for every station the index knows,
    // the slug it produces must resolve back to that exact station.
    // generateStaticParams in the page.tsx routes relies on this.
    for (const s of fixture) {
      const slug = stationSlug(s);
      expect(findStationBySlug(fixture, slug)?.stopId).toBe(s.stopId);
    }
  });

  it("returns null for unknown slugs", () => {
    expect(findStationBySlug(fixture, "not-a-real-slug-zzz")).toBeNull();
    expect(findStationBySlug(fixture, "")).toBeNull();
    // Slug shape with the right name but the wrong stopId is also a
    // miss — the suffix is part of the identity, not decoration.
    expect(findStationBySlug(fixture, "14-st-union-sq-999")).toBeNull();
  });

  it("returns null against an empty index", () => {
    expect(findStationBySlug([], "14-st-union-sq-635")).toBeNull();
  });

  it("disambiguates same-name stations across boroughs", () => {
    // Both "Broadway" entries live in the fixture; the slug suffix
    // is the only signal separating them. A reverse lookup that
    // dropped the stopId portion would alias one URL to both
    // stations and silently mis-render the wrong panel.
    expect(findStationBySlug(fixture, "broadway-g40")?.stopId).toBe("G40");
    expect(findStationBySlug(fixture, "broadway-m16")?.stopId).toBe("M16");
  });

  it("is case-sensitive on the slug — slugs are always lowercase", () => {
    // Unlike findLineBySlug (which case-folds because /line/A is a
    // realistic hand-typed URL), stationSlug always emits lowercase
    // and the SEO entry-points are all internal `Link`s + sitemap
    // entries. An uppercase slug on the address bar is a typo, not
    // a normal flow — let it 404 rather than hide the mismatch.
    expect(findStationBySlug(fixture, "14-ST-Union-Sq-635")).toBeNull();
    expect(findStationBySlug(fixture, "Broadway-G40")).toBeNull();
  });
});
