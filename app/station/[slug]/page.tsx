import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import MarketingShell from "@/components/marketing/MarketingShell";
import {
  getAllStationsServer,
  getLinesServer,
} from "@/lib/stations.server";
import { findStationBySlug, stationSlug } from "@/lib/stationSlug";
import { lineSlug } from "@/lib/lineSlug";
import { SITE_NAME, SITE_TITLE, SITE_URL } from "@/lib/site";
import { haversineMeters, type StationEntry } from "@/lib/stopsIndex";

interface Params {
  params: Promise<{ slug: string }>;
}

// ─── Per-station SEO landing page ────────────────────────────────────
// Static-generated page for every station in the GTFS index — about
// 470 pages once you account for transfer-complex collapsing. Each
// page is a self-contained landing page with structured data
// (JSON-LD) and a deep link back into the live map at
// /?station=<stopId> so a reader arriving from Google can move
// straight from the description to the live arrivals view.
//
// The pages do NOT render live arrivals server-side: live data
// changes every few seconds, would invalidate the static cache, and
// the SEO target is "what is this station / what lines run here /
// where is it" — a discoverability surface, not a real-time
// dashboard. That's what / is for.

export const dynamicParams = false;

export async function generateStaticParams(): Promise<{ slug: string }[]> {
  return getAllStationsServer().map((s) => ({ slug: stationSlug(s) }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const station = findStationBySlug(getAllStationsServer(), slug);
  if (!station) return { title: "Station not found" };
  const lineList = station.routes.map((r) => r.id).join(", ");
  const title = `${station.name} — Live arrivals & lines`;
  const description = `Real-time subway arrivals at ${station.name}. ${
    station.routes.length === 1
      ? `The ${lineList} train serves this station.`
      : `Trains at this station: ${lineList}.`
  } Open ${SITE_NAME} for live ETAs and the next four trains in each direction.`;
  return {
    title,
    description,
    alternates: { canonical: `/station/${slug}` },
    openGraph: {
      title,
      description,
      url: `/station/${slug}`,
      type: "article",
    },
  };
}

function neighborStations(
  index: StationEntry[],
  station: StationEntry,
  limit = 6,
): { entry: StationEntry; meters: number }[] {
  return index
    .filter((s) => s.stopId !== station.stopId)
    .map((s) => ({
      entry: s,
      meters: haversineMeters(
        { lat: station.lat, lng: station.lng },
        { lat: s.lat, lng: s.lng },
      ),
    }))
    .sort((a, b) => a.meters - b.meters)
    .slice(0, limit);
}

export default async function StationPage({ params }: Params) {
  const { slug } = await params;
  const stations = getAllStationsServer();
  const station = findStationBySlug(stations, slug);
  if (!station) notFound();
  const lines = getLinesServer();

  const neighbors = neighborStations(stations, station);
  // The Lines record is keyed by GTFS routeId, not the display id —
  // they diverge for the three shuttles (GS/FS/H all render as "S" on
  // the badge but key the lookup as their routeId). The same routeId
  // is also the URL slug source for /line/[id]. Looking up by r.id
  // here used to silently return undefined for every shuttle-station
  // row, dropping the line name from the description string.
  const inboundLines = station.routes.map((r) => {
    const line = lines[r.routeId];
    return {
      id: r.id,
      routeId: r.routeId,
      color: r.color,
      textColor: r.textColor,
      name: line?.name ?? "",
    };
  });

  const liveLink = `/?station=${encodeURIComponent(station.stopId)}`;

  // JSON-LD: TouristAttraction with geo + sameAs back to /. Google
  // surfaces transit-station rich results from this when paired with
  // a clear name + geo block.
  const jsonLd = {
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
    publicTransportClosures: false,
    isAccessibleForFree: true,
  };

  // BreadcrumbList: tells Google the slug → display-name mapping for
  // the SERP. Without this, results render the raw URL slug
  // ("14-st-union-sq-635") as the breadcrumb path; with it, the
  // station's actual name + the site home replace the slug-derived
  // crumbs. Flat two-level — there is no /stations index page to
  // act as an intermediate, and Google still uses two-item lists for
  // the breadcrumb SERP enhancement.
  const breadcrumbJsonLd = {
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
  };

  return (
    <MarketingShell
      eyebrow="Station"
      title={station.name}
      description={
        station.routes.length === 1
          ? `Real-time arrivals on the ${station.routes[0].id} train. Live ETAs, walking distance, and active alerts on ${SITE_NAME}.`
          : `Real-time arrivals on ${station.routes.length} lines. Live ETAs, transfer info, and active alerts on ${SITE_NAME}.`
      }
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />

      {/* Header-row bullets deep-link into the per-line landing page
          (the same /line/[id] surface /line/[id] links *out* to from
          its station list). Symmetric internal linking keeps both SEO
          surfaces from being dead-ends — a reader arriving at a
          station page can follow any of its trains to the line's
          full route, and PageRank flows in both directions. */}
      <div className="not-prose flex flex-wrap items-center gap-2 -mt-2">
        {inboundLines.map((l) => (
          <Link
            key={l.routeId}
            href={`/line/${lineSlug(l.routeId)}`}
            className="inline-flex items-center justify-center w-9 h-9 rounded-full text-[15px] font-black tracking-tight ring-1 ring-white/10 hover:ring-white/30 transition-shadow no-underline"
            style={{ background: l.color, color: l.textColor }}
            title={l.name ? `${l.name}` : `${l.id} train`}
            aria-label={`Open ${l.id} train page`}
          >
            {l.id}
          </Link>
        ))}
      </div>

      <div className="not-prose mt-7">
        <Link
          href={liveLink}
          className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-white text-gray-950 font-semibold text-[14px] hover:bg-gray-100 active:bg-gray-200 transition-colors"
        >
          <span aria-hidden>🚇</span>
          See live arrivals at {station.name}
        </Link>
      </div>

      <h2>About this station</h2>
      <p>
        {station.name} is{" "}
        {station.routes.length === 1
          ? `served by the ${station.routes[0].id} train`
          : `a transfer station served by ${station.routes.length} subway lines: ${station.routes
              .map((r) => r.id)
              .join(", ")}`}{" "}
        in the New York City subway system.{" "}
        {station.stopIds.length > 1 && (
          <>
            It&rsquo;s a multi-platform complex covering{" "}
            {station.stopIds.length} MTA stop records, with in-system
            transfers between platforms.
          </>
        )}{" "}
        Pull up {SITE_NAME} for the next four trains in each direction
        with seconds-precise countdowns, plus active service alerts
        scoped to this platform.
      </p>

      <h2>Lines at this station</h2>
      {/* Row visual mirrors the Nearby-stations list below — bullet
          on the left, description on the right, full-row hover state
          to signal the link affordance for keyboard + pointer users.
          Each row drops into the per-line landing page (full route,
          terminals, station count). */}
      <ul className="not-prose space-y-2">
        {inboundLines.map((l) => (
          <li key={l.routeId}>
            <Link
              href={`/line/${lineSlug(l.routeId)}`}
              className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] transition-colors no-underline"
            >
              <span
                className="inline-flex flex-shrink-0 items-center justify-center w-7 h-7 rounded-full text-[12px] font-black tracking-tight"
                style={{ background: l.color, color: l.textColor }}
                aria-hidden
              >
                {l.id}
              </span>
              <span className="text-[14px] text-gray-100 min-w-0 truncate">
                <strong className="font-semibold">{l.id} train</strong>
                {l.name && <span className="text-gray-400"> — {l.name}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <h2>Nearby stations</h2>
      <p>
        Walking-distance stations within a few blocks of {station.name},
        ranked by straight-line distance:
      </p>
      <ul className="not-prose space-y-2">
        {neighbors.map(({ entry, meters }) => (
          <li key={entry.stopId}>
            <Link
              href={`/station/${stationSlug(entry)}`}
              className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] transition-colors"
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <span className="flex flex-shrink-0 items-center gap-1">
                  {entry.routes.slice(0, 4).map((r) => (
                    <span
                      key={r.id}
                      className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-black"
                      style={{ background: r.color, color: r.textColor }}
                    >
                      {r.id}
                    </span>
                  ))}
                </span>
                <span className="text-[14px] text-gray-100 truncate">
                  {entry.name}
                </span>
              </span>
              <span className="flex-shrink-0 text-[12px] text-gray-500 tabular-nums">
                {Math.round(meters)} m
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <h2>Open in {SITE_NAME}</h2>
      <p>
        Tap the button at the top of the page to jump straight to the
        live arrivals panel for this station — or browse{" "}
        <Link href="/">every line in the system</Link> on the live
        map.
      </p>
    </MarketingShell>
  );
}
