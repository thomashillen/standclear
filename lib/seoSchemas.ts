// Structured-data helpers (schema.org JSON-LD) for the marketing
// surface. Per-page schemas (TrainStation on /station/[slug],
// BusOrSubwayRoute on /line/[id]) live inline next to their pages
// because they need request-time data. This module is for the
// route-agnostic schemas — the brand-level WebApplication block that
// describes what StandClear *is* — so the homepage and any future
// brand surface can share one source of truth.

import {
  AUTHOR_NAME,
  GITHUB_URL,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
} from "@/lib/site";

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
