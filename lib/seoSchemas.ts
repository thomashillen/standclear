// Structured-data helpers (schema.org JSON-LD) for the marketing
// surface. The route-agnostic homepage WebApplication entry plus the
// per-page TrainStation (/station/[slug]) and BusOrSubwayRoute
// (/line/[id]) entries all live here so a refactor to the schema
// shape is a single-file edit caught by one test suite — and so a
// future surface that wants the brand JSON-LD has one import path.
// BreadcrumbList helpers live alongside their parent entity so the
// crumb-name → page-name link can't drift across separate sources.

import {
  AUTHOR_NAME,
  GITHUB_URL,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TITLE,
  SITE_URL,
} from "@/lib/site";
import type { StationEntry } from "@/lib/stopsIndex";
import type { SubwayLine } from "@/lib/subwayData";

// MTA is the operator/provider for every station and every route
// rendered on the marketing surface. Centralizing the block keeps
// both TrainStation and BusOrSubwayRoute pointing at the exact same
// Organization entity — a divergence (different `name` casing or a
// trailing slash on `url`) would silently fork the entity in
// Google's Knowledge Graph.
const MTA_PROVIDER = {
  "@type": "Organization",
  name: "Metropolitan Transportation Authority",
  url: "https://www.mta.info",
} as const;

// WebApplication entry for the live-map homepage. Google surfaces
// app rich-results from this when paired with name + price + free
// access — and gives the brand a stable identity in the Knowledge
// Graph that the per-page TrainStation / BusOrSubwayRoute entries
// can attach to. `applicationCategory: TravelApplication` is the
// schema.org pick that maps cleanest onto "transit tracker"; there
// is no transit-specific subtype. `offers: 0 USD` + `isAccessibleForFree`
// both signal "free" because Google reads either field depending on
// the rich-result template — duplicating is the canonical fix and
// costs nothing.
export function homepageJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: SITE_NAME,
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    applicationCategory: "TravelApplication",
    operatingSystem: "Any",
    browserRequirements: "Requires JavaScript and a modern browser",
    inLanguage: "en-US",
    isAccessibleForFree: true,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    featureList: [
      "Real-time NYC subway arrivals",
      "Live train positions on a Mapbox map",
      "Service alerts per route",
      "Nearby stations with walking time",
      "Address-to-address subway trip planning",
      "Opt-in push notifications for severe service alerts",
    ],
    author: { "@type": "Person", name: AUTHOR_NAME },
    publisher: { "@type": "Person", name: AUTHOR_NAME, url: GITHUB_URL },
  } as const;
}

// TrainStation entry for /station/[slug]. Google reads this to render
// transit-station rich results — name + geo + operator (provider) is
// the minimum the SERP card wants. `publicAccess: true` is the
// correct schema.org property for "the station is open to the
// public": the prior shape used `isAccessibleForFree: true`, which
// Google interprets as "free entry" — semantically wrong for a paid
// fare turnstile ($2.90 OMNY tap). The prior shape also carried
// `publicTransportClosures: false`, which isn't a published
// schema.org property on TrainStation/Place; dropped so the JSON-LD
// surface only emits fields a parser will recognize.
export function stationJsonLd(station: StationEntry, slug: string) {
  return {
    "@context": "https://schema.org",
    "@type": "TrainStation",
    name: station.name,
    url: `${SITE_URL}/station/${slug}`,
    geo: {
      "@type": "GeoCoordinates",
      latitude: station.lat,
      longitude: station.lng,
    },
    address: {
      "@type": "PostalAddress",
      addressLocality: "New York",
      addressRegion: "NY",
      addressCountry: "US",
    },
    publicAccess: true,
    provider: MTA_PROVIDER,
  } as const;
}

// BreadcrumbList for /station/[slug]. Replaces the raw URL slug in
// Google's SERP breadcrumb path with the station's display name.
// Flat two-level — there is no /stations index page to serve as an
// intermediate crumb, and Google still renders two-item lists in
// the breadcrumb SERP enhancement.
export function stationBreadcrumbJsonLd(station: StationEntry, slug: string) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: SITE_TITLE,
        item: SITE_URL,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: station.name,
        item: `${SITE_URL}/station/${slug}`,
      },
    ],
  } as const;
}

// BusOrSubwayRoute entry for /line/[id]. schema.org has no
// SubwayLine type; BusOrSubwayRoute is the closest published mapping
// for "a named transit route through a city" and surfaces transit
// rich-results when paired with name + provider.
export function lineJsonLd(line: SubwayLine, slug: string) {
  return {
    "@context": "https://schema.org",
    "@type": "BusOrSubwayRoute",
    name: `${line.id} train — ${line.name}`,
    url: `${SITE_URL}/line/${slug}`,
    description: line.name,
    provider: MTA_PROVIDER,
  } as const;
}

// BreadcrumbList for /line/[id]. Mirrors the station shape — flat
// two-level, no /lines index to act as the intermediate crumb.
export function lineBreadcrumbJsonLd(line: SubwayLine, slug: string) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: SITE_TITLE,
        item: SITE_URL,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: `${line.id} train`,
        item: `${SITE_URL}/line/${slug}`,
      },
    ],
  } as const;
}
