import SubwayMap from "@/components/SubwayMap";
import { homepageJsonLd } from "@/lib/seoSchemas";

export default function Home() {
  // h-dvh (100dvh) tracks the *visible* viewport on iOS Safari as the
  // URL bar shows/hides. Tailwind's h-screen compiles to 100vh, which
  // is the LARGE viewport (URL-bar-collapsed) — using it here meant
  // the wrapper rendered ~80px taller than what was actually visible
  // on first load, hiding the bottom of the bottom-sheet panels under
  // Safari's toolbar.
  //
  // JSON-LD describes the live-map surface as a free WebApplication so
  // Google can render an app rich-result for the canonical
  // "NYC subway tracker" query and so the per-page TrainStation /
  // BusOrSubwayRoute entries on /station/[slug] and /line/[id] anchor
  // back to a brand-level entity. Inline (not <Script>) because the
  // crawler needs the block in the initial SSR payload, not after
  // client-side hydration.
  return (
    <div className="h-dvh w-screen overflow-hidden">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(homepageJsonLd()) }}
      />
      <SubwayMap />
    </div>
  );
}
