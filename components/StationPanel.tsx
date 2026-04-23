"use client";

import { useMemo } from "react";
import { ArrowUp, ArrowDown, Star, X } from "lucide-react";
import { useLines } from "@/lib/subwayData";
import { useTrains, type Arrival } from "@/lib/useTrains";
import { useFavorites } from "@/lib/useFavorites";
import { buildStationIndex } from "@/lib/stopsIndex";
import { useSheetDrag } from "@/lib/useSheetDrag";

interface Props {
  stopId: string;
  onClose: () => void;
  onSelectLine: (routeId: string) => void;
}

function fmtEta(eta: number, now: number): string {
  const secs = eta - now / 1000;
  if (secs < 30) return "Now";
  const mins = Math.round(secs / 60);
  if (mins < 1) return "<1 min";
  return `${mins} min`;
}

// MTA signage uses circles for local service and diamonds for express
// variants — the "<6>", "<7>", and peak-only <F>, <Q>, etc. The realtime
// feed surfaces these as routeIds with a trailing "X" (6X, 7X). We render
// a diamond by rotating a square 45° and counter-rotating the label so
// the letter stays upright. Diamond side = circle_diameter / √2 so both
// variants share the same outer bounding box and align in a row.
function RouteBullet({
  id,
  color,
  textColor,
  size = "md",
  variant = "circle",
  onClick,
}: {
  id: string;
  color: string;
  textColor: "white" | "black";
  size?: "sm" | "md";
  variant?: "circle" | "diamond";
  onClick?: () => void;
}) {
  const fg = textColor === "black" ? "#000" : "#fff";

  if (variant === "diamond") {
    // Bounding box matches the circle size so bullets line up in a row.
    // Inner rotated square is sized so its diagonal ≈ circle diameter.
    const boxDim = size === "sm" ? "w-5 h-5 text-[9px]" : "w-7 h-7 text-[12px]";
    const diamondSize = size === "sm" ? 14 : 20;
    const outer = `inline-flex items-center justify-center flex-shrink-0 relative ${boxDim}`;
    const diamondStyle: React.CSSProperties = {
      width: diamondSize,
      height: diamondSize,
      backgroundColor: color,
      transform: "rotate(45deg)",
      borderRadius: 2,
    };
    const labelStyle: React.CSSProperties = { color: fg };
    const labelClass = `relative font-black leading-none ${size === "sm" ? "text-[9px]" : "text-[12px]"}`;
    const inner = (
      <>
        <span className="absolute inset-0 flex items-center justify-center">
          <span style={diamondStyle} />
        </span>
        <span className={labelClass} style={labelStyle}>
          {id}
        </span>
      </>
    );
    if (onClick) {
      return (
        <button
          type="button"
          onClick={onClick}
          className={`${outer} press touch-manipulation hover:scale-105 active:scale-95 transition-transform`}
          aria-label={`View ${id} express line`}
        >
          {inner}
        </button>
      );
    }
    return <span className={outer}>{inner}</span>;
  }

  const dim = size === "sm" ? "w-5 h-5 text-[10px]" : "w-7 h-7 text-[13px]";
  const base = `inline-flex items-center justify-center rounded-full font-black leading-none flex-shrink-0 ${dim}`;
  const style = { backgroundColor: color, color: fg };
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${base} press touch-manipulation hover:scale-105 active:scale-95 transition-transform`}
        style={style}
        aria-label={`View ${id} line`}
      >
        {id}
      </button>
    );
  }
  return (
    <span className={base} style={style}>
      {id}
    </span>
  );
}

// Express variants in the GTFS realtime feed use a trailing "X" suffix
// (6X = <6> Pelham Bay express, 7X = <7> Flushing express). The base
// route's color, terminus, and line entry all apply; only the badge
// shape changes.
function parseExpress(routeId: string): { baseRouteId: string; isExpress: boolean } {
  if (routeId.length > 1 && routeId.endsWith("X")) {
    return { baseRouteId: routeId.slice(0, -1), isExpress: true };
  }
  return { baseRouteId: routeId, isExpress: false };
}

interface ArrivalRowProps {
  arrival: Arrival;
  now: number;
  badge: { id: string; color: string; textColor: "white" | "black" } | undefined;
  isExpress: boolean;
  terminusName: string | undefined;
  onTapRoute: () => void;
}

function ArrivalRow({ arrival, now, badge, isExpress, terminusName, onTapRoute }: ArrivalRowProps) {
  const etaStr = fmtEta(arrival.eta, now);
  const isImminent = arrival.eta - now / 1000 < 90;
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.04] last:border-b-0">
      {badge ? (
        <RouteBullet
          id={badge.id}
          color={badge.color}
          textColor={badge.textColor}
          variant={isExpress ? "diamond" : "circle"}
          onClick={onTapRoute}
        />
      ) : (
        <span className="w-7 h-7 flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-gray-100 leading-tight truncate">
          {terminusName ? `to ${terminusName}` : badge?.id ?? arrival.routeId}
          {isExpress && (
            <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300/90">
              Express
            </span>
          )}
        </p>
      </div>
      <span
        className={`text-[14px] font-semibold tabular-nums flex-shrink-0 ${
          isImminent ? "text-amber-300" : "text-gray-50"
        }`}
      >
        {etaStr}
      </span>
    </div>
  );
}

// Station-centric view: all upcoming trains at a single station, grouped by
// direction and sorted by ETA. Complements the line-centric LinePanel —
// you pick a station (by tapping it on any list or the map) and see every
// train coming, not just the first per route. Bullets are tappable to
// jump into that line's view.
export default function StationPanel({ stopId, onClose, onSelectLine }: Props) {
  const lines = useLines();
  const data = useTrains();
  const { has, toggle } = useFavorites();

  const index = useMemo(() => (lines ? buildStationIndex(lines) : []), [lines]);
  // A tapped stopId may be any platform in a complex (e.g. tapping the
  // L03 dot at Union Sq should surface the merged complex whose canonical
  // id is 635). Match against every member id, not just the canonical.
  const station = useMemo(
    () => index.find((s) => s.stopIds.includes(stopId)),
    [index, stopId],
  );

  // Split arrivals by direction. `data.arrivals` is already sorted by eta
  // ascending, so the per-direction slices inherit that order. We accept
  // arrivals at ANY stop id belonging to this complex so transfers show
  // up as one unified list.
  const stationIds = useMemo(
    () => (station ? new Set(station.stopIds) : null),
    [station],
  );
  const { north, south } = useMemo(() => {
    const n: Arrival[] = [];
    const s: Arrival[] = [];
    if (!data || !stationIds) return { north: n, south: s };
    const nowSec = data.generatedAt / 1000;
    const CUTOFF = 45 * 60;
    for (const a of data.arrivals) {
      if (!stationIds.has(a.stopId)) continue;
      if (a.eta - nowSec > CUTOFF) continue;
      if (a.direction === "N") n.push(a);
      else s.push(a);
    }
    return { north: n, south: s };
  }, [data, stationIds]);

  // For each route serving the station, figure out which terminus matches
  // each direction by checking which end of the stop list has a higher
  // lat (that end is "north"). MTA GTFS orders line.stops consistently
  // from one terminus to the other, so stops[0] vs stops[last] works.
  const terminusByRouteAndDir = useMemo(() => {
    const m = new Map<string, { N: string; S: string }>();
    if (!lines) return m;
    for (const line of Object.values(lines)) {
      if (line.stops.length < 2) continue;
      const first = line.stops[0];
      const last = line.stops[line.stops.length - 1];
      const firstIsNorth = first.lat > last.lat;
      m.set(line.routeId, {
        N: firstIsNorth ? first.name : last.name,
        S: firstIsNorth ? last.name : first.name,
      });
    }
    return m;
  }, [lines]);

  const routeInfo = useMemo(() => {
    const m = new Map<string, { id: string; color: string; textColor: "white" | "black" }>();
    if (!lines) return m;
    for (const line of Object.values(lines)) {
      m.set(line.routeId, {
        id: line.id,
        color: line.color,
        textColor: line.textColor,
      });
    }
    return m;
  }, [lines]);

  const now = data?.generatedAt ?? Date.now();

  const { detent, sheetStyle, handlers, onHandleTap } = useSheetDrag({
    halfRestingY: "calc(88dvh - 55dvh)",
    open: true,
    onDismiss: onClose,
  });

  if (!station) return null;

  // Favorites key on the canonical stopId so a complex stays "favorited"
  // regardless of which platform the user tapped first.
  const favId = station.stopId;
  const isFav = has(favId);

  return (
    <div
      className="
        absolute z-20 overflow-hidden flex flex-col
        inset-x-0 bottom-0 h-[88dvh] rounded-t-[28px] border-t border-white/[0.08]
        sm:inset-auto sm:right-3 sm:top-3 sm:bottom-3 sm:w-[340px] sm:h-auto sm:rounded-[22px] sm:border sm:border-white/[0.08]
        ios-glass
        shadow-[0_20px_60px_-10px_rgba(0,0,0,0.6)]
        pb-[env(safe-area-inset-bottom)]
      "
      style={sheetStyle}
    >
      <button
        type="button"
        className="sm:hidden flex items-center justify-center h-5 pt-1.5 flex-shrink-0 touch-none w-full"
        onClick={onHandleTap}
        aria-label={detent === "half" ? "Expand panel" : "Collapse panel"}
      >
        <div className="w-9 h-[5px] rounded-full bg-white/25" />
      </button>

      <div
        className="flex items-start gap-3 px-4 pt-2 pb-3 flex-shrink-0 border-b border-white/[0.06] sm:cursor-auto cursor-grab active:cursor-grabbing touch-none"
        onPointerDown={handlers.onPointerDown}
        onPointerMove={handlers.onPointerMove}
        onPointerUp={handlers.onPointerUp}
        onPointerCancel={handlers.onPointerCancel}
      >
        <div className="flex-1 min-w-0">
          <h2 className="text-[18px] font-black tracking-tight text-white leading-tight">
            {station.name}
          </h2>
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            {station.routes.map((r) => {
              const info = routeInfo.get(r.routeId);
              if (!info) return null;
              return (
                <RouteBullet
                  key={r.routeId}
                  id={info.id}
                  color={info.color}
                  textColor={info.textColor}
                  size="sm"
                  onClick={() => onSelectLine(r.routeId)}
                />
              );
            })}
          </div>
        </div>
        <button
          onClick={() => toggle(favId)}
          className="press w-11 h-11 -mt-0.5 flex items-center justify-center rounded-full text-gray-400 hover:text-amber-300 active:text-amber-400 touch-manipulation"
          aria-label={isFav ? "Remove from favorites" : "Add to favorites"}
          aria-pressed={isFav}
        >
          <Star className={`w-5 h-5 ${isFav ? "fill-amber-300 text-amber-300" : ""}`} />
        </button>
        <button
          onClick={onClose}
          className="press text-white opacity-85 hover:opacity-100 w-11 h-11 -mt-0.5 flex items-center justify-center rounded-full bg-white/[0.08] hover:bg-white/[0.12] touch-manipulation"
          aria-label="Close panel"
        >
          <X className="w-[18px] h-[18px]" strokeWidth={2.5} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto ios-scroll">
        {!data && (
          <div className="text-center text-xs text-gray-500 py-8 animate-pulse">
            Loading live arrivals…
          </div>
        )}

        <DirectionSection
          label="Northbound"
          icon={<ArrowUp className="w-4 h-4" />}
          arrivals={north}
          now={now}
          routeInfo={routeInfo}
          terminusByRoute={terminusByRouteAndDir}
          direction="N"
          onSelectLine={onSelectLine}
        />

        <DirectionSection
          label="Southbound"
          icon={<ArrowDown className="w-4 h-4" />}
          arrivals={south}
          now={now}
          routeInfo={routeInfo}
          terminusByRoute={terminusByRouteAndDir}
          direction="S"
          onSelectLine={onSelectLine}
        />
      </div>
    </div>
  );
}

function DirectionSection({
  label,
  icon,
  arrivals,
  now,
  routeInfo,
  terminusByRoute,
  direction,
  onSelectLine,
}: {
  label: string;
  icon: React.ReactNode;
  arrivals: Arrival[];
  now: number;
  routeInfo: Map<string, { id: string; color: string; textColor: "white" | "black" }>;
  terminusByRoute: Map<string, { N: string; S: string }>;
  direction: "N" | "S";
  onSelectLine: (routeId: string) => void;
}) {
  return (
    <section>
      <div className="flex items-center gap-2 px-4 pt-3 pb-2 text-gray-400">
        <span className="flex-shrink-0">{icon}</span>
        <span className="text-[11px] font-semibold uppercase tracking-wider">
          {label}
        </span>
        <span className="text-[11px] text-gray-600 ml-auto tabular-nums">
          {arrivals.length > 0 ? `${arrivals.length} upcoming` : "—"}
        </span>
      </div>
      {arrivals.length === 0 ? (
        <div className="px-4 pb-3 text-[12px] text-gray-600">
          No upcoming trains in the next 45 min.
        </div>
      ) : (
        <div>
          {arrivals.map((a, i) => {
            // Resolve express variants (6X, 7X) to their base line so the
            // badge picks up the familiar color and the row can show the
            // terminus. `isExpress` then switches the bullet to a diamond
            // and flags the row "Express".
            const { baseRouteId, isExpress } = parseExpress(a.routeId);
            return (
              <ArrivalRow
                key={`${a.tripId}-${a.stopId}-${i}`}
                arrival={a}
                now={now}
                badge={routeInfo.get(baseRouteId)}
                isExpress={isExpress}
                terminusName={terminusByRoute.get(baseRouteId)?.[direction]}
                onTapRoute={() => onSelectLine(baseRouteId)}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
