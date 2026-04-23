"use client";

import { useEffect, useMemo, useState } from "react";
import { MapPin, Star, Navigation, ArrowUp, ArrowDown, Search, X } from "lucide-react";
import { useLines } from "@/lib/subwayData";
import { useTrains, type Arrival } from "@/lib/useTrains";
import { useGeolocation } from "@/lib/useGeolocation";
import { useFavorites } from "@/lib/useFavorites";
import { useSheetDrag } from "@/lib/useSheetDrag";
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
  onStationOpen: (stopId: string) => void;
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
  onTap: () => void;
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
            onClick={onTap}
            className="press text-left w-full touch-manipulation"
            aria-label={`See all trains at ${station.name}`}
          >
            <p className="text-sm font-semibold text-gray-100 leading-tight break-words">
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

export default function NearbyPanel({ open, onClose, onStationOpen }: Props) {
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

  // Shared sheet drag with half/full detents + dismiss threshold. Matches
  // LinePanel so the gesture feels consistent across both mobile sheets.
  const { detent, sheetStyle, handlers, onHandleTap } = useSheetDrag({
    halfRestingY: "calc(88dvh - 60dvh)",
    open,
    onDismiss: onClose,
  });

  if (!open) return null;

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
        className="sm:hidden flex items-center justify-center pt-2.5 pb-1.5 flex-shrink-0 cursor-grab active:cursor-grabbing touch-none w-full"
        onPointerDown={handlers.onPointerDown}
        onPointerMove={handlers.onPointerMove}
        onPointerUp={handlers.onPointerUp}
        onPointerCancel={handlers.onPointerCancel}
        onClick={onHandleTap}
        aria-label={detent === "half" ? "Expand panel" : "Collapse panel"}
      >
        <div className="w-9 h-[5px] rounded-full bg-white/25" />
      </button>

      <div className="flex items-center justify-between px-4 py-2.5 flex-shrink-0">
        <div className="flex items-center gap-2.5 text-white">
          <MapPin className="w-[18px] h-[18px]" />
          <span className="font-black text-[17px] tracking-tight">Near me</span>
        </div>
        <button
          onClick={onClose}
          className="press text-white opacity-85 hover:opacity-100 text-[22px] leading-none font-bold w-11 h-11 -mr-1 flex items-center justify-center rounded-full bg-white/[0.08] hover:bg-white/[0.12] touch-manipulation"
          aria-label="Close panel"
        >
          ×
        </button>
      </div>

      <div className="px-3 pb-3 flex-shrink-0 border-b border-white/[0.06]">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search stations"
            aria-label="Search stations"
            className="w-full h-11 pl-10 pr-10 rounded-xl bg-white/[0.08] border border-white/[0.06] text-[15px] text-gray-50 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-white/25 focus:border-transparent transition-shadow"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="press absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-full text-gray-300 bg-white/[0.08] hover:bg-white/[0.14]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto ios-scroll">
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
                  onTap={() => onStationOpen(s.stopId)}
                />
              ))}
            </div>
          )
        ) : (
          <>
        {geo.status === "idle" ? (
          <div className="px-6 py-10 text-center">
            <Navigation className="w-10 h-10 mx-auto mb-3 text-gray-400" />
            <p className="text-sm text-gray-300 font-medium mb-1">Find stations near you</p>
            <p className="text-[11px] text-gray-500 mb-4 max-w-[240px] mx-auto">
              We&apos;ll surface the closest stops and which trains you can still catch.
            </p>
            <button
              onClick={geo.request}
              className="press inline-flex items-center gap-2 px-4 h-10 rounded-full bg-white text-gray-950 text-[13px] font-semibold shadow-[0_4px_16px_rgba(255,255,255,0.18)]"
            >
              <Navigation className="w-4 h-4" />
              Enable location
            </button>
          </div>
        ) : geo.status === "prompting" && geo.lng == null ? (
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
            <p className="text-sm text-gray-300 mb-1">Couldn&apos;t get your location.</p>
            {geo.error && (
              <p className="text-[11px] text-gray-600 mb-4">{geo.error}</p>
            )}
            <button
              onClick={geo.request}
              className="press inline-flex items-center gap-2 px-4 h-9 rounded-full bg-white/[0.08] border border-white/[0.08] text-[12px] font-semibold text-gray-100"
            >
              Try again
            </button>
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
                onTap={() => onStationOpen(s.stopId)}
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
                onTap={() => onStationOpen(s.stopId)}
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
