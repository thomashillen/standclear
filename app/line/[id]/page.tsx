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
import { aggregateInterchanges, getInterchanges } from "@/lib/lineInterchanges";
import { SITE_NAME } from "@/lib/site";
import { lineBreadcrumbJsonLd, lineJsonLd } from "@/lib/seoSchemas";
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

  // Union of every other route a rider can transfer to somewhere on
  // this line — drives the "Direct transfers" overview block between
  // the narrative paragraph and the per-stop station list. Computed
  // here once so both the SEO body copy ("X other lines along the
  // route") and the pill row stay aligned to the same source.
  const transfers = aggregateInterchanges(
    line.stops.map((s) => stopIdToStation.get(s.id)),
    line.routeId,
  );

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

  // schema.org JSON-LD lives in `lib/seoSchemas.ts` alongside the
  // station + homepage entries — keeping all three schemas in one
  // source of truth so a refactor to the shape, the MTA-provider
  // block, or the breadcrumb depth is caught by one test suite.
  const jsonLd = lineJsonLd(line, slug);
  const breadcrumbJsonLd = lineBreadcrumbJsonLd(line, slug);

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

      {transfers.length > 0 && (
        <>
          <h2>Direct transfers</h2>
          <p>
            Riders can transfer between the {line.id} train and{" "}
            {transfers.length} other line{transfers.length === 1 ? "" : "s"} at
            one or more stops along the route. Each bullet opens that
            line&rsquo;s landing page.
          </p>
          {/* Pill style matches the /station/[slug] header bullet row
              (w-9 h-9 ring/hover) so the cross-link affordance reads the
              same on both surfaces. Order follows first-appearance along
              the route — the dedup happens by routeId inside
              aggregateInterchanges, so shuttle pages correctly never see
              their own bullet here. */}
          <div className="not-prose -mt-2 flex flex-wrap items-center gap-2">
            {transfers.map((r) => (
              <Link
                key={r.routeId}
                href={`/line/${lineSlug(r.routeId)}`}
                className="inline-flex items-center justify-center w-9 h-9 rounded-full text-[15px] font-black tracking-tight ring-1 ring-white/10 hover:ring-white/30 transition-shadow no-underline"
                style={{ background: r.color, color: r.textColor }}
                aria-label={`Open ${r.id} train page`}
              >
                {r.id}
              </Link>
            ))}
          </div>
        </>
      )}

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
