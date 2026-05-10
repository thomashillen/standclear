import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { getLinesServer } from "@/lib/stations.server";
import { findLineBySlug, lineSlug } from "@/lib/lineSlug";
import { SITE_NAME } from "@/lib/site";

// ─── Per-line OG card ────────────────────────────────────────────────
// One image per subway line, rendered at build time alongside the
// /line/[id] static page (matching `dynamicParams = false` on the
// parent). A tweeted line link gets a card that names the route,
// shows the actual MTA bullet at hero scale, and lists the from/to
// terminals — far better signal than the generic site-wide card the
// parent OG would otherwise serve. Mirrors the per-station OG idiom.
//
// Notes:
//   • No edge runtime: `lib/stations.server.ts` reads the GTFS blob
//     via `node:fs`, which Edge can't do. With `generateStaticParams`
//     pinning every line slug, the images are built once and cached
//     by the CDN.
//   • Shuttles: `line.id` is the display bullet ("S") while the slug
//     keys off `routeId` ("GS" / "FS" / "H"). The hero bullet renders
//     `line.id` to match what the rider sees on the live map.
//   • Long line names ("Broadway-Seventh Avenue Local") shrink so the
//     hero text fits inside the 980px content box.

export const alt = `${SITE_NAME} — Live arrivals`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export async function generateStaticParams(): Promise<{ id: string }[]> {
  const lines = getLinesServer();
  return Object.keys(lines).map((id) => ({ id: lineSlug(id) }));
}

interface Params {
  params: Promise<{ id: string }>;
}

function fontSizeForName(name: string): number {
  // Step down by character count so the longest names in the system
  // ("Broadway-Seventh Avenue Local" at 29, "Brighton Local / Sea Beach
  // Express" at 38) still fit on two lines inside the 980px content
  // box without manual line-break tuning.
  if (name.length <= 22) return 88;
  if (name.length <= 32) return 72;
  return 60;
}

export default async function Image({ params }: Params) {
  const { id } = await params;
  const lines = getLinesServer();
  const line = findLineBySlug(lines, id);
  if (!line) notFound();

  const first = line.stops[0];
  const last = line.stops[line.stops.length - 1];
  const stopCount = line.stops.length;

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
            Line
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 200,
              height: 200,
              borderRadius: 999,
              background: line.color,
              color: line.textColor,
              fontSize: 124,
              fontWeight: 900,
              letterSpacing: "-0.04em",
              boxShadow: "0 12px 36px rgba(0,0,0,0.45)",
              flexShrink: 0,
            }}
          >
            {line.id}
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 18,
              maxWidth: 760,
            }}
          >
            <div
              style={{
                fontSize: 38,
                color: "#9ca3af",
                fontWeight: 600,
                letterSpacing: "-0.02em",
              }}
            >
              {`${line.id} train`}
            </div>
            <div
              style={{
                fontSize: fontSizeForName(line.name),
                fontWeight: 900,
                letterSpacing: "-0.03em",
                lineHeight: 1.04,
              }}
            >
              {line.name}
            </div>
            {first && last && (
              <div
                style={{
                  display: "flex",
                  fontSize: 26,
                  color: "#9ca3af",
                  fontWeight: 500,
                  letterSpacing: "-0.01em",
                }}
              >
                {`${stopCount} stations · ${first.name} ↔ ${last.name}`}
              </div>
            )}
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
          <div>standclear.app</div>
        </div>
      </div>
    ),
    size,
  );
}
