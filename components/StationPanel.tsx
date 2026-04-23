"use client";

import { useMemo } from "react";
import { ArrowUp, ArrowDown, Star } from "lucide-react";
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

function RouteBullet({
  id,
  color,
  textColor,
  size = "md",
  onClick,
}: {
  id: string;
  color: string;
  textColor: "white" | "black";
  size?: "sm" | "md";
  onClick?: () => void;
}) {
  const dim = size === "sm" ? "w-5 h-5 text-[10px]" : "w-7 h-7 text-[13px]";
  const base = `inline-flex items-center justify-center rounded-full font-black leading-none flex-shrink-0 ${dim}`;
  const style = { backgroundColor: color, color: textColor === "black" ? "#000" : "#fff" };
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

interface ArrivalRowProps {
  arrival: Arrival;
  now: number;
  badge: { id: string; color: string; textColor: "white" | "black" } | undefined;
  terminusName: string | undefined;
  onTapRoute: () => void;
}

function ArrivalRow({ arrival, now, badge, terminusName, onTapRoute }: ArrivalRowProps) {
  const etaStr = fmtEta(arrival.eta, now);
  const isImminent = arrival.eta - now / 1000 < 90;
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.04] last:border-b-0">
      {badge ? (
        <RouteBullet
          id={badge.id}
          color={badge.color}
          textColor={badge.textColor}
          onClick={onTapRoute}
        />
      ) : (
        <span className="w-7 h-7 flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-gray-100 leading-tight truncate">
          {terminusName ? `to ${terminusName}` : badge?.id ?? arrival.routeId}
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
  const station = useMemo(
    () => index.find((s) => s.stopId === stopId),
    [index, stopId],
  );

  // Split arrivals by direction. `data.arrivals` is already sorted by eta
  // ascending, so the per-direction slices inherit that order.
  const { north, south } = useMemo(() => {
    const n: Arrival[] = [];
    const s: Arrival[] = [];
    if (!data) return { north: n, south: s };
    const nowSec = data.generatedAt / 1000;
    const CUTOFF = 45 * 60;
    for (const a of data.arrivals) {
      if (a.stopId !== stopId) continue;
      if (a.eta - nowSec > CUTOFF) continue;
      if (a.direction === "N") n.push(a);
      else s.push(a);
    }
    return { north: n, south: s };
  }, [data, stopId]);

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

  const isFav = has(stopId);

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
        className="sm:hidden flex items-center justify-center h-11 flex-shrink-0 cursor-grab active:cursor-grabbing touch-none w-full"
        onPointerDown={handlers.onPointerDown}
        onPointerMove={handlers.onPointerMove}
        onPointerUp={handlers.onPointerUp}
        onPointerCancel={handlers.onPointerCancel}
        onClick={onHandleTap}
        aria-label={detent === "half" ? "Expand panel" : "Collapse panel"}
      >
        <div className="w-9 h-[5px] rounded-full bg-white/25" />
      </button>

      <div className="flex items-start gap-3 px-4 pt-2 pb-3 flex-shrink-0 border-b border-white/[0.06]">
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
          onClick={() => toggle(stopId)}
          className="press w-11 h-11 -mt-0.5 flex items-center justify-center rounded-full text-gray-400 hover:text-amber-300 active:text-amber-400 touch-manipulation"
          aria-label={isFav ? "Remove from favorites" : "Add to favorites"}
          aria-pressed={isFav}
        >
          <Star className={`w-5 h-5 ${isFav ? "fill-amber-300 text-amber-300" : ""}`} />
        </button>
        <button
          onClick={onClose}
          className="press text-white opacity-85 hover:opacity-100 text-[22px] leading-none font-bold w-11 h-11 -mt-0.5 flex items-center justify-center rounded-full bg-white/[0.08] hover:bg-white/[0.12] touch-manipulation"
          aria-label="Close panel"
        >
          ×
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
          {arrivals.map((a, i) => (
            <ArrivalRow
              key={`${a.tripId}-${a.stopId}-${i}`}
              arrival={a}
              now={now}
              badge={routeInfo.get(a.routeId)}
              terminusName={terminusByRoute.get(a.routeId)?.[direction]}
              onTapRoute={() => onSelectLine(a.routeId)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
