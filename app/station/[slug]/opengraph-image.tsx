import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import {
  getAllStationsServer,
  getLinesServer,
} from "@/lib/stations.server";
import { findStationBySlug, stationSlug } from "@/lib/stationSlug";
import { SITE_NAME, SITE_HOST } from "@/lib/site";

// ─── Per-station OG card ─────────────────────────────────────────────
// One image per station slug, rendered at build time alongside the
// /station/[slug] static page (matching `dynamicParams = false` on
// the parent). A tweeted station link gets a card that names the
// station and shows the actual MTA route bullets — far better signal
// than the generic site-wide card the parent OG would otherwise serve.
//
// Notes:
//   • No edge runtime: `lib/stations.server.ts` reads the GTFS blob
//     via `node:fs`, which Edge can't do. With `generateStaticParams`
//     pinning every slug, the images are built once and cached by the
//     CDN; runtime mode is irrelevant for the request path.
//   • Bundling the GTFS JSON as a module would re-trigger the
//     65 GB tsserver incident documented in CLAUDE.md, so we keep the
//     fs-reader path the rest of the SEO surface uses.
//   • Long station names ("Atlantic Av-Barclays Ctr",
//     "Tremont Av-177 St") shrink to fit a fixed three-line cap so
//     the card never overflows.

export const alt = `${SITE_NAME} — Live arrivals`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export async function generateStaticParams(): Promise<{ slug: string }[]> {
  return getAllStationsServer().map((s) => ({ slug: stationSlug(s) }));
}

interface Params {
  params: Promise<{ slug: string }>;
}

function fontSizeForName(name: string): number {
  // Step down by character count so the longest names in the system
  // ("Atlantic Av-Barclays Ctr" at 24, "Pelham Bay Park" at 15,
  // "Aqueduct-N Conduit Av" at 21) still fit on two lines inside the
  // 980px content box without manual line-break tuning.
  if (name.length <= 22) return 110;
  if (name.length <= 32) return 92;
  return 76;
}

export default async function Image({ params }: Params) {
  const { slug } = await params;
  const stations = getAllStationsServer();
  const station = findStationBySlug(stations, slug);
  if (!station) notFound();

  const lines = getLinesServer();
  const inboundLines = station.routes.map((r) => ({
    id: r.id,
    color: r.color,
    textColor: r.textColor,
    name: lines[r.id]?.name ?? "",
  }));
  const lineCount = inboundLines.length;
  const transferLabel =
    lineCount === 1
      ? "1 line · Live arrivals · Service alerts"
      : `${lineCount} lines · transfer station · Live arrivals`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 88px",
          color: "white",
          fontFamily: "system-ui, sans-serif",
          background:
            "radial-gradient(circle at 80% 20%, rgba(59,130,246,0.25), transparent 55%), radial-gradient(circle at 15% 85%, rgba(16,185,129,0.22), transparent 50%), linear-gradient(135deg, #050507 0%, #0a0a0f 50%, #11131a 100%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              fontSize: 56,
              lineHeight: 1,
              filter: "drop-shadow(0 4px 12px rgba(0,0,0,0.4))",
            }}
          >
            🚇
          </div>
          <div
            style={{
              fontSize: 36,
              fontWeight: 900,
              letterSpacing: "-0.03em",
            }}
          >
            {SITE_NAME}
          </div>
          <div
            style={{
              marginLeft: 14,
              padding: "6px 14px",
              borderRadius: 999,
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.12)",
              fontSize: 22,
              color: "#d1d5db",
            }}
          >
            Station
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div
            style={{
              fontSize: fontSizeForName(station.name),
              fontWeight: 900,
              letterSpacing: "-0.04em",
              lineHeight: 1.02,
              maxWidth: 980,
            }}
          >
            {station.name}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 14,
            }}
          >
            {inboundLines.slice(0, 8).map((l) => (
              <div
                key={l.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 72,
                  height: 72,
                  borderRadius: 999,
                  background: l.color,
                  color: l.textColor,
                  fontSize: 38,
                  fontWeight: 900,
                  letterSpacing: "-0.02em",
                  boxShadow: "0 6px 18px rgba(0,0,0,0.35)",
                }}
              >
                {l.id}
              </div>
            ))}
            {inboundLines.length > 8 && (
              <div
                style={{
                  display: "flex",
                  fontSize: 28,
                  color: "#9ca3af",
                  marginLeft: 6,
                }}
              >
                {`+${inboundLines.length - 8}`}
              </div>
            )}
          </div>

          <div
            style={{
              display: "flex",
              fontSize: 28,
              color: "#9ca3af",
              fontWeight: 500,
              letterSpacing: "-0.01em",
            }}
          >
            {transferLabel}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            color: "#6b7280",
            fontSize: 22,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 999,
                background: "#34d399",
                boxShadow: "0 0 16px #34d399",
              }}
            />
            <span>Streaming MTA GTFS-Realtime</span>
          </div>
          <div>{SITE_HOST}</div>
        </div>
      </div>
    ),
    size,
  );
}
