// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  homepageJsonLd,
  lineBreadcrumbJsonLd,
  lineJsonLd,
  stationBreadcrumbJsonLd,
  stationJsonLd,
} from "./seoSchemas";
import {
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TITLE,
  SITE_URL,
} from "./site";
import type { StationEntry } from "./stopsIndex";
import type { SubwayLine } from "./subwayData";

describe("homepageJsonLd", () => {
  it("declares the WebApplication shape Google expects", () => {
    const ld = homepageJsonLd();
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("WebApplication");
    expect(ld.name).toBe(SITE_NAME);
    expect(ld.url).toBe(SITE_URL);
    expect(ld.description).toBe(SITE_DESCRIPTION);
  });

  // Free-app rich-result template reads either `isAccessibleForFree`
  // or `offers.price === "0"` depending on the surface. Setting both
  // is the canonical Google-recommended duplication for free apps —
  // miss either field and the rich result can degrade or drop.
  it("signals free access via both fields Google reads", () => {
    const ld = homepageJsonLd();
    expect(ld.isAccessibleForFree).toBe(true);
    expect(ld.offers.price).toBe("0");
    expect(ld.offers.priceCurrency).toBe("USD");
    expect(ld.offers["@type"]).toBe("Offer");
  });

  it("uses a real schema.org applicationCategory (TravelApplication is the closest published type)", () => {
    expect(homepageJsonLd().applicationCategory).toBe("TravelApplication");
  });

  it("serializes to JSON cleanly so the inline <script> tag is valid", () => {
    const ld = homepageJsonLd();
    expect(() => JSON.stringify(ld)).not.toThrow();
    const round = JSON.parse(JSON.stringify(ld));
    expect(round.name).toBe(SITE_NAME);
    expect(Array.isArray(round.featureList)).toBe(true);
    expect(round.featureList.length).toBeGreaterThan(0);
  });
});

// Canonical fixtures — small enough to keep each assertion legible,
// with values shaped like the real `getAllStationsServer()` /
// `getLinesServer()` rows so the tests fail the same way a real-data
// regression would.
const unionSq: StationEntry = {
  stopId: "635",
  stopIds: ["635", "R20", "L03"],
  name: "14 St-Union Sq",
  lat: 40.7349,
  lng: -73.9903,
  routes: [
    { id: "4", routeId: "4", color: "#00933C", textColor: "white" },
    { id: "L", routeId: "L", color: "#A7A9AC", textColor: "white" },
  ],
};

const broadwayLocal: SubwayLine = {
  id: "1",
  routeId: "1",
  name: "Broadway - 7 Avenue Local",
  color: "#EE352E",
  textColor: "white",
  stops: [],
  shape: [],
};

const franklinShuttle: SubwayLine = {
  id: "S",
  routeId: "FS",
  name: "Franklin Av Shuttle",
  color: "#808183",
  textColor: "white",
  stops: [],
  shape: [],
};

describe("stationJsonLd", () => {
  it("declares the TrainStation shape Google expects with geo + address + provider", () => {
    const ld = stationJsonLd(unionSq, "14-st-union-sq-635");
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("TrainStation");
    expect(ld.name).toBe("14 St-Union Sq");
    expect(ld.url).toBe(`${SITE_URL}/station/14-st-union-sq-635`);
    expect(ld.geo).toEqual({
      "@type": "GeoCoordinates",
      latitude: 40.7349,
      longitude: -73.9903,
    });
    expect(ld.address.addressLocality).toBe("New York");
    expect(ld.address.addressRegion).toBe("NY");
    expect(ld.address.addressCountry).toBe("US");
    expect(ld.address["@type"]).toBe("PostalAddress");
  });

  // The prior inline shape claimed `isAccessibleForFree: true` for
  // every station — Google reads that as "free entry," which is
  // wrong for a paid-fare turnstile ($2.90 OMNY tap). The correct
  // schema.org property for "open to the public" is `publicAccess`.
  // A regression that swapped it back would silently re-introduce
  // the misleading SERP signal on every one of the ~470 station
  // pages, so it's worth pinning explicitly.
  it("uses publicAccess (open to public) instead of isAccessibleForFree (free entry — wrong for a paid-fare station)", () => {
    const ld = stationJsonLd(unionSq, "14-st-union-sq-635");
    expect(ld.publicAccess).toBe(true);
    expect("isAccessibleForFree" in ld).toBe(false);
  });

  // `publicTransportClosures` is not a published schema.org property
  // on TrainStation or Place; the prior shape leaked it through to
  // every page's JSON-LD where parsers silently dropped it. The
  // surface only emits real schema.org fields now — a re-add of an
  // invented field would trip this guard.
  it("does not emit invented fields that schema.org parsers will silently drop", () => {
    const ld = stationJsonLd(unionSq, "14-st-union-sq-635");
    expect("publicTransportClosures" in ld).toBe(false);
  });

  // MTA is the operator/provider of every station — pinning it here
  // matches the provider already carried by BusOrSubwayRoute on
  // /line/[id], so Google sees both entities point at the same
  // Organization in the Knowledge Graph. A divergence (different
  // casing on `name`, a trailing slash on `url`) would silently
  // fork the entity.
  it("attributes the station to the MTA via a stable provider Organization", () => {
    const ld = stationJsonLd(unionSq, "14-st-union-sq-635");
    expect(ld.provider).toEqual({
      "@type": "Organization",
      name: "Metropolitan Transportation Authority",
      url: "https://www.mta.info",
    });
  });

  it("serializes to JSON cleanly so the inline <script> tag is valid", () => {
    const ld = stationJsonLd(unionSq, "14-st-union-sq-635");
    expect(() => JSON.stringify(ld)).not.toThrow();
    const round = JSON.parse(JSON.stringify(ld));
    expect(round.geo.latitude).toBe(40.7349);
    expect(round.publicAccess).toBe(true);
    expect(round.provider.name).toBe("Metropolitan Transportation Authority");
  });

  it("composes the canonical url from SITE_URL + the passed slug verbatim (no trim, no normalization)", () => {
    // SITE_URL deliberately does NOT trim trailing slashes — the
    // lib/site.ts contract is "callers concatenate ${SITE_URL}/path
    // literally." If a future "helpful" normalization runs here, the
    // 470 station URLs in the sitemap would drift from the JSON-LD
    // canonical URLs, splitting Google's signal across two paths.
    const ld = stationJsonLd(unionSq, "weird-slug-XYZ");
    expect(ld.url).toBe(`${SITE_URL}/station/weird-slug-XYZ`);
  });
});

describe("stationBreadcrumbJsonLd", () => {
  it("renders a flat two-level BreadcrumbList with the station name as the leaf", () => {
    const ld = stationBreadcrumbJsonLd(unionSq, "14-st-union-sq-635");
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("BreadcrumbList");
    expect(ld.itemListElement).toHaveLength(2);
    expect(ld.itemListElement[0]).toEqual({
      "@type": "ListItem",
      position: 1,
      name: SITE_TITLE,
      item: SITE_URL,
    });
    expect(ld.itemListElement[1]).toEqual({
      "@type": "ListItem",
      position: 2,
      name: "14 St-Union Sq",
      item: `${SITE_URL}/station/14-st-union-sq-635`,
    });
  });
});

describe("lineJsonLd", () => {
  it("declares the BusOrSubwayRoute shape (closest schema.org type for a transit line) with provider", () => {
    const ld = lineJsonLd(broadwayLocal, "1");
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("BusOrSubwayRoute");
    expect(ld.name).toBe("1 train — Broadway - 7 Avenue Local");
    expect(ld.description).toBe("Broadway - 7 Avenue Local");
    expect(ld.url).toBe(`${SITE_URL}/line/1`);
    expect(ld.provider.name).toBe("Metropolitan Transportation Authority");
  });

  // Shuttles have a divergent `id` (display "S") vs `routeId`
  // (GS/FS/H). The caller passes `lineSlug(line.routeId)` so the URL
  // routes to the right one of three, but the rendered name uses the
  // display `id` because that's what riders see on the badge. This
  // case pins the divergence so a future refactor that "fixed" it to
  // route everything through `routeId` (collapsing all three shuttles
  // to a single Franklin/Rockaway/42 St name) trips the suite.
  it("uses the display id for the rider-facing name but accepts the routeId-based slug for the URL", () => {
    const ld = lineJsonLd(franklinShuttle, "fs");
    expect(ld.name).toBe("S train — Franklin Av Shuttle");
    expect(ld.url).toBe(`${SITE_URL}/line/fs`);
  });

  it("shares the MTA provider block with stationJsonLd (same entity in Google's Knowledge Graph)", () => {
    const stationProvider = stationJsonLd(unionSq, "14-st-union-sq-635").provider;
    const lineProvider = lineJsonLd(broadwayLocal, "1").provider;
    expect(lineProvider).toEqual(stationProvider);
  });

  it("serializes to JSON cleanly so the inline <script> tag is valid", () => {
    const ld = lineJsonLd(broadwayLocal, "1");
    expect(() => JSON.stringify(ld)).not.toThrow();
    const round = JSON.parse(JSON.stringify(ld));
    expect(round["@type"]).toBe("BusOrSubwayRoute");
    expect(round.provider.url).toBe("https://www.mta.info");
  });
});

describe("lineBreadcrumbJsonLd", () => {
  it("renders a flat two-level BreadcrumbList with the line label as the leaf", () => {
    const ld = lineBreadcrumbJsonLd(broadwayLocal, "1");
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("BreadcrumbList");
    expect(ld.itemListElement).toHaveLength(2);
    expect(ld.itemListElement[0]).toEqual({
      "@type": "ListItem",
      position: 1,
      name: SITE_TITLE,
      item: SITE_URL,
    });
    expect(ld.itemListElement[1]).toEqual({
      "@type": "ListItem",
      position: 2,
      name: "1 train",
      item: `${SITE_URL}/line/1`,
    });
  });

  it("uses the display id (not routeId) for the leaf name so shuttle crumbs read 'S train' on the SERP", () => {
    const ld = lineBreadcrumbJsonLd(franklinShuttle, "fs");
    expect(ld.itemListElement[1].name).toBe("S train");
    expect(ld.itemListElement[1].item).toBe(`${SITE_URL}/line/fs`);
  });
});
