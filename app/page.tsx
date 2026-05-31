import SubwayMap from "@/components/SubwayMap";
import { homepageJsonLd, websiteJsonLd } from "@/lib/seoSchemas";

export default function Home() {
  // h-dvh (100dvh) tracks the *visible* viewport on iOS Safari as the
  // URL bar shows/hides. Tailwind's h-screen compiles to 100vh, which
  // is the LARGE viewport (URL-bar-collapsed) — using it here meant
  // the wrapper rendered ~80px taller than what was actually visible
  // on first load, hiding the bottom of the bottom-sheet panels under
  // Safari's toolbar.
  //
  // Two JSON-LD blocks, two different SERP surfaces:
  //   • WebApplication — Google's app rich-result for the canonical
  //     "NYC subway tracker" query, and the brand-level entity the
  //     per-page TrainStation / BusOrSubwayRoute entries on
  //     /station/[slug] and /line/[id] anchor back to.
  //   • WebSite — the documented signal for Google's "Site names"
  //     feature (the name printed above the result URL). Without it
  //     Google infers the name from <title>/og:site_name, which can
  //     show the descriptive title instead of the bare brand.
  // Both inline (not <Script>) because the crawler needs them in the
  // initial SSR payload, not after client-side hydration.
  return (
    <div className="h-dvh w-screen overflow-hidden">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(homepageJsonLd()) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd()) }}
      />
      <SubwayMap />
    </div>
  );
}
