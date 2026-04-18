"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MapPin, Star, Navigation, ArrowUp, ArrowDown, Search, X } from "lucide-react";
import { useLines } from "@/lib/subwayData";
import { useTrains, type Arrival } from "@/lib/useTrains";
import { useGeolocation } from "@/lib/useGeolocation";
import { useFavorites } from "@/lib/useFavorites";
import {
  buildStationIndex,
  catchVerdict,
  haversineMeters,
  nearestStations,
  searchStations,
  type CatchVerdict,
  type NearbyStation,
  type StationEntry,
} from "@/lib/stopsIndex";

interface Props {
  open: boolean;
  onClose: () => void;
  onJumpToLine: (routeId: string, stopId: string) => void;
}

function fmtEta(eta: number, now: number): string {
  const secs = eta - now / 1000;
  if (secs < 30) return "Now";
  const mins = Math.round(secs / 60);
  if (mins < 1) return "<1m";
  return `${mins}m`;
}

function fmtDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function RouteBullet({
  id,
  color,
  textColor,
}: {
  id: string;
  color: string;
  textColor: "white" | "black";
}) {
  return (
    <span
      className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-black leading-none flex-shrink-0"
      style={{ backgroundColor: color, color: textColor === "black" ? "#000" : "#fff" }}
    >
      {id}
    </span>
  );
}

interface StationRowProps {
  station: StationEntry & { meters?: number };
  arrivals: Arrival[];
  routeColors: Map<string, { color: string; textColor: "white" | "black"; displayId: string }>;
  now: number;
  isFavorite: boolean;
  onFavoriteToggle: () => void;
  onTap: (routeId: string) => void;
}

// Styling per verdict. "chill" and unknown (no distance) leave the eta alone
// so the panel stays quiet for the 80% case where there's plenty of time.
const VERDICT_STYLES: Record<CatchVerdict, { pill: string; etaCls: string; label: string | null }> = {
  miss: {
    pill: "bg-gray-700/60 text-gray-400",
    etaCls: "text-gray-500 line-through",
    label: "miss",
  },
  run: {
    pill: "bg-amber-500/90 text-black font-bold",
    etaCls: "text-amber-300",
    label: "RUN",
  },
  walk: {
    pill: "bg-emerald-500/20 text-emerald-300",
    etaCls: "text-emerald-200",
    label: "walk",
  },
  chill: { pill: "", etaCls: "text-gray-200", label: null },
};

function StationRow({
  station,
  arrivals,
  routeColors,
  now,
  isFavorite,
  onFavoriteToggle,
  onTap,
}: StationRowProps) {
  // Show up to 3 soonest upcoming arrivals. The API already sorts by eta
  // ascending; we filter per-station in the parent and slice here.
  const topArrivals = arrivals.slice(0, 3);

  return (
    <div className="border-b border-white/5 last:border-b-0">
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <div className="flex items-center gap-1 flex-shrink-0">
              {station.routes.slice(0, 6).map((r) => {
                const info = routeColors.get(r.routeId);
                if (!info) return null;
                return (
                  <RouteBullet
                    key={r.routeId}
                    id={info.displayId}
                    color={info.color}
                    textColor={info.textColor}
                  />
                );
              })}
            </div>
          </div>
          <button
            onClick={() => onTap(station.routes[0]?.routeId ?? "")}
            className="text-left w-full"
          >
            <p className="text-sm font-semibold text-gray-100 leading-tight">
              {station.name}
            </p>
            {station.meters !== undefined && (
              <p className="text-[11px] text-gray-500 mt-0.5">
                {fmtDistance(station.meters)} away
              </p>
            )}
          </button>

          {topArrivals.length > 0 ? (
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
              {topArrivals.map((a, i) => {
                const info = routeColors.get(a.routeId);
                if (!info) return null;
                // Verdict only meaningful when we know how far we are from
                // the station; without it, render the eta unadorned.
                const verdict: CatchVerdict | null =
                  station.meters !== undefined
                    ? catchVerdict(station.meters, a.eta, now / 1000)
                    : null;
                const style = verdict ? VERDICT_STYLES[verdict] : VERDICT_STYLES.chill;
                return (
                  <span
                    key={`${a.tripId}-${i}`}
                    className="inline-flex items-center gap-1 text-[11px]"
                  >
                    <RouteBullet
                      id={info.displayId}
                      color={info.color}
                      textColor={info.textColor}
                    />
                    {a.direction === "N" ? (
                      <ArrowUp className="w-3 h-3 text-gray-500" />
                    ) : (
                      <ArrowDown className="w-3 h-3 text-gray-500" />
                    )}
                    <span className={`font-medium tabular-nums ${style.etaCls}`}>
                      {fmtEta(a.eta, now)}
                    </span>
                    {style.label && (
                      <span
                        className={`ml-0.5 px-1.5 py-[1px] rounded-full text-[9px] leading-none uppercase tracking-wider ${style.pill}`}
                      >
                        {style.label}
                      </span>
                    )}
                  </span>
                );
              })}
            </div>
          ) : (
            <p className="text-[11px] text-gray-600 mt-2">No upcoming trains</p>
          )}
        </div>

        <button
          onClick={onFavoriteToggle}
          className="p-2 -m-2 text-gray-500 hover:text-amber-300 active:text-amber-400 touch-manipulation"
          aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
        >
          <Star
            className={`w-5 h-5 ${isFavorite ? "fill-amber-300 text-amber-300" : ""}`}
          />
        </button>
      </div>
    </div>
  );
}

export default function NearbyPanel({ open, onClose, onJumpToLine }: Props) {
  const geo = useGeolocation(open);
  const lines = useLines();
  const data = useTrains();
  const { favorites, toggle, has } = useFavorites();
  const [query, setQuery] = useState("");

  const index = useMemo(() => (lines ? buildStationIndex(lines) : []), [lines]);

  // When the panel closes, drop any in-flight query so it doesn't reappear
  // next time the user opens the sheet.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  // Search results. When the user has location, annotate each match with its
  // distance so the search view reuses the same catchable-train verdicts as
  // the nearby list. Without location, matches render as plain rows.
  const searchResults = useMemo<(StationEntry & { meters?: number })[] | null>(() => {
    const q = query.trim();
    if (q.length < 2) return null;
    const matches = searchStations(index, q, 20);
    if (geo.lng == null || geo.lat == null) return matches;
    return matches.map((s) => ({
      ...s,
      meters: haversineMeters({ lat: geo.lat!, lng: geo.lng! }, { lat: s.lat, lng: s.lng }),
    }));
  }, [query, index, geo.lat, geo.lng]);

  // Lookup table so rows can render route bullets without walking the lines
  // map per arrival. Same shape as the LinePanel bullet lookup.
  const routeColors = useMemo(() => {
    const m = new Map<
      string,
      { color: string; textColor: "white" | "black"; displayId: string }
    >();
    if (!lines) return m;
    for (const line of Object.values(lines)) {
      m.set(line.routeId, {
        color: line.color,
        textColor: line.textColor,
        displayId: line.id,
      });
    }
    return m;
  }, [lines]);

  // Arrivals grouped by station id. Done once per poll instead of per row.
  const arrivalsByStation = useMemo(() => {
    const m = new Map<string, Arrival[]>();
    if (!data) return m;
    for (const a of data.arrivals) {
      const arr = m.get(a.stopId) ?? [];
      arr.push(a);
      m.set(a.stopId, arr);
    }
    return m;
  }, [data]);

  const nearby: NearbyStation[] = useMemo(() => {
    if (geo.lng == null || geo.lat == null) return [];
    return nearestStations(index, geo.lng, geo.lat, 6);
  }, [geo.lng, geo.lat, index]);

  const favStations: StationEntry[] = useMemo(() => {
    if (favorites.size === 0) return [];
    // Skip favorites that already appear in the nearby list — otherwise
    // your closest-favorite shows up twice, and only the nearby copy gets
    // a catchable-train verdict. Single source of truth per station.
    const nearbyIds = new Set(nearby.map((s) => s.stopId));
    const byId = new Map(index.map((s) => [s.stopId, s]));
    const out: StationEntry[] = [];
    for (const id of favorites) {
      if (nearbyIds.has(id)) continue;
      const s = byId.get(id);
      if (s) out.push(s);
    }
    return out;
  }, [favorites, index, nearby]);

  const now = data?.generatedAt ?? Date.now();

  // Swipe-to-dismiss identical to LinePanel so the gesture feels the same
  // across both sheets on mobile. Disabled on sm+ where the sheet is a
  // fixed side card.
  const [dragY, setDragY] = useState(0);
  const dragStartY = useRef<number | null>(null);
  const isDraggable = () =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches;
  const onDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggable()) return;
    dragStartY.current = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartY.current === null) return;
    setDragY(Math.max(0, e.clientY - dragStartY.current));
  };
  const onDragEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartY.current === null) return;
    const dy = e.clientY - dragStartY.current;
    dragStartY.current = null;
    if (dy > 120) onClose();
    else setDragY(0);
  };

  // Reset drag offset when the sheet is closed and re-opened so we don't
  // remember an in-flight gesture.
  useEffect(() => {
    if (!open) setDragY(0);
  }, [open]);

  if (!open) return null;

  const handleTap = (routeId: string, stopId: string) => {
    if (!routeId) return;
    onJumpToLine(routeId, stopId);
  };

  return (
    <div
      className="
        absolute z-20 overflow-hidden flex flex-col shadow-2xl
        inset-x-0 bottom-0 max-h-[55vh] rounded-t-3xl border-t border-white/10
        sm:inset-auto sm:right-3 sm:top-3 sm:bottom-3 sm:w-80 sm:max-h-none sm:rounded-2xl sm:border sm:border-white/10
        bg-gray-950/80 supports-[backdrop-filter]:bg-gray-950/55
        backdrop-blur-2xl backdrop-saturate-150
        pb-[env(safe-area-inset-bottom)]
      "
      style={{
        transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
        transition: dragStartY.current === null ? "transform 200ms ease-out" : undefined,
      }}
    >
      <div
        className="sm:hidden flex items-center justify-center pt-3 pb-2 flex-shrink-0 cursor-grab active:cursor-grabbing touch-none"
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        aria-label="Drag to dismiss"
        role="button"
      >
        <div className="w-10 h-1.5 rounded-full bg-white/30" />
      </div>

      <div className="flex items-center justify-between px-4 py-3 flex-shrink-0">
        <div className="flex items-center gap-2.5 text-white">
          <MapPin className="w-5 h-5" />
          <span className="font-black text-base">Near me</span>
        </div>
        <button
          onClick={onClose}
          className="text-white opacity-80 hover:opacity-100 active:opacity-60 text-2xl leading-none font-bold w-11 h-11 flex items-center justify-center -mr-2 touch-manipulation"
          aria-label="Close panel"
        >
          ×
        </button>
      </div>

      <div className="px-3 pb-3 flex-shrink-0 border-b border-white/5">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search stations…"
            aria-label="Search stations"
            className="w-full h-10 pl-9 pr-9 rounded-full bg-gray-900/70 border border-white/10 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-white/20"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full text-gray-500 hover:text-gray-200 hover:bg-white/10"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain">
        {/* Search view takes over whenever the user has typed a query.
            Favorites/Nearby are hidden so the results don't fight for space. */}
        {searchResults !== null ? (
          searchResults.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-gray-500">
              No stations match &ldquo;{query}&rdquo;
            </div>
          ) : (
            <div>
              <div className="px-4 pt-3 pb-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                Matches
              </div>
              {searchResults.map((s) => (
                <StationRow
                  key={`search-${s.stopId}`}
                  station={s}
                  arrivals={arrivalsByStation.get(s.stopId) ?? []}
                  routeColors={routeColors}
                  now={now}
                  isFavorite={has(s.stopId)}
                  onFavoriteToggle={() => toggle(s.stopId)}
                  onTap={(rid) => handleTap(rid, s.stopId)}
                />
              ))}
            </div>
          )
        ) : (
          <>
        {geo.status === "idle" || geo.status === "prompting" ? (
          <div className="px-6 py-10 text-center">
            <Navigation className="w-10 h-10 mx-auto mb-3 text-gray-500 animate-pulse" />
            <p className="text-sm text-gray-400">Finding your location…</p>
            <p className="text-[11px] text-gray-600 mt-1">
              Allow location access to see nearby stations.
            </p>
          </div>
        ) : geo.status === "denied" ? (
          <div className="px-6 py-10 text-center">
            <MapPin className="w-10 h-10 mx-auto mb-3 text-gray-600" />
            <p className="text-sm text-gray-300 font-medium">Location is blocked</p>
            <p className="text-[11px] text-gray-500 mt-1 max-w-[240px] mx-auto">
              Enable location access for SubwaySurfer in your browser settings, then reopen this panel.
            </p>
          </div>
        ) : geo.status === "unavailable" ? (
          <div className="px-6 py-10 text-center text-sm text-gray-400">
            Geolocation isn&apos;t available in this browser.
          </div>
        ) : geo.status === "error" ? (
          <div className="px-6 py-10 text-center">
            <p className="text-sm text-gray-300">Couldn&apos;t get your location.</p>
            {geo.error && (
              <p className="text-[11px] text-gray-600 mt-1">{geo.error}</p>
            )}
          </div>
        ) : null}

        {favStations.length > 0 && (
          <div>
            <div className="px-4 pt-3 pb-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
              Favorites
            </div>
            {favStations.map((s) => (
              <StationRow
                key={`fav-${s.stopId}`}
                station={s}
                arrivals={arrivalsByStation.get(s.stopId) ?? []}
                routeColors={routeColors}
                now={now}
                isFavorite={true}
                onFavoriteToggle={() => toggle(s.stopId)}
                onTap={(rid) => handleTap(rid, s.stopId)}
              />
            ))}
          </div>
        )}

        {nearby.length > 0 && (
          <div>
            <div className="px-4 pt-3 pb-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
              Nearest stations
            </div>
            {nearby.map((s) => (
              <StationRow
                key={`near-${s.stopId}`}
                station={s}
                arrivals={arrivalsByStation.get(s.stopId) ?? []}
                routeColors={routeColors}
                now={now}
                isFavorite={has(s.stopId)}
                onFavoriteToggle={() => toggle(s.stopId)}
                onTap={(rid) => handleTap(rid, s.stopId)}
              />
            ))}
          </div>
        )}
          </>
        )}
      </div>
    </div>
  );
}
