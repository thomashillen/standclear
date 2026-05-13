import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import MarketingShell from "@/components/marketing/MarketingShell";
import {
  getAllStationsServer,
  getLinesServer,
} from "@/lib/stations.server";
import { findLineBySlug, lineSlug } from "@/lib/lineSlug";
import { stationSlug } from "@/lib/stationSlug";
import { getInterchanges } from "@/lib/lineInterchanges";
import { SITE_NAME, SITE_TITLE, SITE_URL } from "@/lib/site";
import type { StationEntry } from "@/lib/stopsIndex";

interface Params {
  params: Promise<{ id: string }>;
}

// ─── Per-line SEO landing page ──────────────────────────────────────
// Static-generated landing page for every subway line keyed in the
// GTFS index — 27 entries (1–7, A/C/E, B/D/F/M, G, J/Z, L, N/Q/R/W,
// shuttles GS/FS/H, plus SI). Mirrors `/station/[slug]` in shape: a
// canonical URL with structured data and a deep link back into the
// live map at `/?line=<id>` so a rider arriving from search lands on
// the descriptive page first and is one tap from live arrivals.
//
// Live alerts are NOT rendered server-side here — the page is a
// statically cached SEO surface, and alerts change on the order of
// minutes, not the monthly cadence we set in the sitemap. The CTA
// button drops the rider into the live map where /api/alerts is
// scoped to the line in the LinePanel.

export const dynamicParams = false;

export async function generateStaticParams(): Promise<{ id: string }[]> {
  const lines = getLinesServer();
  return Object.keys(lines).map((id) => ({ id: lineSlug(id) }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const line = findLineBySlug(getLinesServer(), id);
  if (!line) return { title: "Line not found" };

  const first = line.stops[0];
  const last = line.stops[line.stops.length - 1];
  const title = `${line.id} train — ${line.name}`;
  const description =
    first && last
      ? `Real-time arrivals on the ${line.id} train (${line.name}). ${line.stops.length} stations from ${first.name} to ${last.name}. Open ${SITE_NAME} for live ETAs and active alerts.`
      : `Real-time arrivals on the ${line.id} train (${line.name}). Open ${SITE_NAME} for live ETAs and active alerts.`;

  // URL slug uses `routeId`, not `id` — see the live-link comment in
  // the page body for why the two diverge for shuttles.
  const slug = lineSlug(line.routeId);
  return {
    title,
    description,
    alternates: { canonical: `/line/${slug}` },
    openGraph: {
      title,
      description,
      url: `/line/${slug}`,
      type: "article",
    },
  };
}

// stopId → StationEntry, so each stop on the line links to its
// canonical /station/[slug] SEO page rather than a raw deep link
// that bypasses the descriptive surface. Stations that fall outside
// the merged complex set (uncommon — most stops belong to a complex
// of size 1) still resolve via the entry whose stopIds array
// contains the platform stop id.
function buildStopIdToStation(
  stations: StationEntry[],
): Map<string, StationEntry> {
  const m = new Map<string, StationEntry>();
  for (const s of stations) {
    for (const sid of s.stopIds) m.set(sid, s);
  }
  return m;
}

export default async function LinePage({ params }: Params) {
  const { id } = await params;
  const lines = getLinesServer();
  const line = findLineBySlug(lines, id);
  if (!line) notFound();

  const stations = getAllStationsServer();
  const stopIdToStation = buildStopIdToStation(stations);

  // The deep-link bootstrap in SubwayMap does a direct
  // `lines[selectedLine]` lookup, where the Lines record is keyed by
  // GTFS routeId. For most trains `line.id === line.routeId`, but the
  // three shuttles are aliased — `line.id` is the display bullet "S"
  // (because that's what the map renders) while the lookup key stays
  // "GS" / "FS" / "H". Using `line.id` here would produce `?line=S`,
  // which `lines["S"]` returns undefined for, breaking the CTA on
  // every shuttle landing page. Always route through `routeId`.
  const liveLink = `/?line=${encodeURIComponent(line.routeId)}`;
  const slug = lineSlug(line.routeId);
  const first = line.stops[0];
  const last = line.stops[line.stops.length - 1];

  // schema.org has no SubwayLine type; BusOrSubwayRoute is the
  // closest published mapping for "a named transit route through a
  // city," and surfaces transit rich-results when paired with name +
  // operator.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BusOrSubwayRoute",
    name: `${line.id} train — ${line.name}`,
    url: `${SITE_URL}/line/${slug}`,
    description: line.name,
    provider: {
      "@type": "Organization",
      name: "Metropolitan Transportation Authority",
      url: "https://www.mta.info",
    },
  };

  // BreadcrumbList: SERP-only enhancement that replaces the raw URL
  // slug in the breadcrumb path with the line's display label. Flat
  // two-level — no /lines index page to act as a category-level
  // crumb, and Google still uses two-item lists for the breadcrumb
  // rich result. Mirrors the same block on /station/[slug].
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
        name: `${line.id} train`,
        item: `${SITE_URL}/line/${slug}`,
      },
    ],
  };

  return (
    <MarketingShell
      eyebrow="Line"
      title={`${line.id} train`}
      description={`${line.name}. Live arrivals, the full station list, and active alerts on ${SITE_NAME}.`}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />

      <div className="not-prose flex flex-wrap items-center gap-3 -mt-2">
        <span
          className="inline-flex items-center justify-center w-12 h-12 rounded-full text-[20px] font-black tracking-tight ring-1 ring-white/10"
          style={{ background: line.color, color: line.textColor }}
          title={`${line.id} train`}
        >
          {line.id}
        </span>
        {first && last && (
          <span className="text-[14px] text-gray-400">
            {line.stops.length} stations · {first.name} ↔ {last.name}
          </span>
        )}
      </div>

      <div className="not-prose mt-7">
        <Link
          href={liveLink}
          className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-white text-gray-950 font-semibold text-[14px] hover:bg-gray-100 active:bg-gray-200 transition-colors"
        >
          <span aria-hidden>🚇</span>
          See live {line.id}-train arrivals
        </Link>
      </div>

      <h2>About the {line.id} train</h2>
      <p>
        The {line.id} ({line.name}) runs through {line.stops.length} stations
        in the New York City subway system. Pull up {SITE_NAME} for the next
        four trains in each direction with seconds-precise countdowns, plus
        active service alerts scoped to this route.
      </p>

      <h2>Stations on this line</h2>
      {first && last && (
        <p>
          From {first.name} to {last.name}, in route order:
        </p>
      )}
      {/* Each row used to lead with the current line's own bullet,
          repeated 30+ times — redundant since the page header already
          establishes which line we're on. Surface the *transfer*
          bullets instead (Apple Maps / Google Maps transit idiom): a
          rider scanning the stop list is planning transfers off this
          line, not confirming they're still on it. Rows for single-
          line stops carry no trailing bullets; rows for hub complexes
          (Times Sq, Union Sq, Atlantic-Barclays) flex-wrap their
          transfer-strip when the count is high. */}
      <ul className="not-prose space-y-2">
        {line.stops.map((s) => {
          const entry = stopIdToStation.get(s.id);
          const slug = entry ? stationSlug(entry) : null;
          const interchanges = getInterchanges(entry, line.routeId);
          const inner = (
            <span className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] transition-colors">
              <span className="text-[14px] text-gray-100 truncate min-w-0">
                {s.name}
              </span>
              {interchanges.length > 0 && (
                <span className="flex flex-wrap items-center justify-end gap-1 flex-shrink-0">
                  {interchanges.map((r) => (
                    <span
                      key={r.routeId}
                      className="inline-flex flex-shrink-0 items-center justify-center w-5 h-5 rounded-full text-[10px] font-black"
                      style={{ background: r.color, color: r.textColor }}
                      aria-label={`Transfer to ${r.id} train`}
                    >
                      {r.id}
                    </span>
                  ))}
                </span>
              )}
            </span>
          );
          return (
            <li key={s.id}>
              {slug ? (
                <Link href={`/station/${slug}`} className="block no-underline">
                  {inner}
                </Link>
              ) : (
                inner
              )}
            </li>
          );
        })}
      </ul>

      <h2>Open in {SITE_NAME}</h2>
      <p>
        Tap the button at the top of the page to jump straight to the{" "}
        {line.id}-train layer on the live map — or browse{" "}
        <Link href="/">every line in the system</Link> from there.
      </p>
    </MarketingShell>
  );
}
