"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MapPin, Star, Navigation, ArrowUp, ArrowDown, Search, X, Home, Briefcase, ArrowLeftRight, ArrowRight } from "lucide-react";
import { useLines } from "@/lib/subwayData";
import { useTrains, type Arrival } from "@/lib/useTrains";
import { useGeolocation } from "@/lib/useGeolocation";
import { useFavorites, useCommute, type CommuteAnchor } from "@/lib/useFavorites";
import { useNow } from "@/lib/useNow";
import { useSheetDrag } from "@/lib/useSheetDrag";
import { directRoutesBetween } from "@/lib/commuteRouting";
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

// Format ETA for the compact list rows. The final minute counts down
// second by second so the user can see urgency build; minutes-only
// above that to keep the row from getting noisy at distance.
function fmtEta(eta: number, now: number): string {
  const secs = Math.round(eta - now / 1000);
  if (secs <= 5) return "Now";
  if (secs < 60) return `${secs}s`;
  return `${Math.round(secs / 60)}m`;
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
      className="nyc-bullet inline-flex items-center justify-center w-5 h-5 rounded-full text-[12px] leading-none flex-shrink-0"
      style={{ backgroundColor: color, color: textColor === "black" ? "#000" : "#fff" }}
    >
      {id}
    </span>
  );
}

// ─── Going to Work / Going Home — the daily-commute hero card ─────
// Surfaces only when both Home and Work are set. Picks a direction
// (origin → destination) based on which anchor the user is closer to,
// and shows the next few catchable trains at the origin headed toward
// the destination. A swap button flips the direction so a rider mid-day
// can preview the return without changing their commute setup.

interface GoingToCardProps {
  origin: StationEntry & { meters?: number };
  destination: StationEntry;
  /** Which anchor the origin represents — drives the title and badge. */
  originAnchor: CommuteAnchor;
  arrivals: Arrival[];
  routes: { routeId: string; direction: "N" | "S" }[];
  routeColors: Map<string, { color: string; textColor: "white" | "black"; displayId: string }>;
  now: number;
  onSwap: () => void;
  onTapOrigin: () => void;
}

function GoingToCard({
  origin,
  destination,
  originAnchor,
  arrivals,
  routes,
  routeColors,
  now,
  onSwap,
  onTapOrigin,
}: GoingToCardProps) {
  // Filter to arrivals on the relevant route+direction at the origin's
  // member stop_ids, drop any already departed (5s grace), and trim to
  // the soonest few. The `arrivals` prop is already scoped to the origin
  // station; we just narrow further by route+direction here.
  const routeKey = useMemo(() => {
    const m = new Map<string, "N" | "S">();
    for (const r of routes) m.set(r.routeId, r.direction);
    return m;
  }, [routes]);

  const upcoming = useMemo(() => {
    const cutoff = now / 1000 - 5;
    return arrivals
      .filter((a) => {
        const d = routeKey.get(a.routeId);
        return d != null && d === a.direction && a.eta >= cutoff;
      })
      .slice(0, 4);
  }, [arrivals, routeKey, now]);

  const destAnchor: CommuteAnchor = originAnchor === "home" ? "work" : "home";
  const title = destAnchor === "work" ? "Going to Work" : "Going Home";

  // Container styles: gradient backdrop tinted by destination anchor
  // (sky for Work, emerald for Home) so the card visually maps to the
  // header chip color rider already learned in StationPanel.
  const tint =
    destAnchor === "work"
      ? "from-sky-500/15 via-sky-500/[0.06] to-transparent ring-sky-400/20"
      : "from-emerald-500/15 via-emerald-500/[0.06] to-transparent ring-emerald-400/20";

  return (
    <div
      className={`mx-3 mt-3 mb-1 rounded-2xl bg-gradient-to-br ${tint} ring-1 px-3.5 pt-3 pb-3.5 backdrop-blur-sm`}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className={`inline-flex items-center justify-center w-6 h-6 rounded-full ${
            destAnchor === "work" ? "bg-sky-300/20 text-sky-200" : "bg-emerald-300/20 text-emerald-200"
          }`}
        >
          {destAnchor === "work" ? <Briefcase className="w-3.5 h-3.5" /> : <Home className="w-3.5 h-3.5" />}
        </span>
        <h3 className="text-[14px] font-black tracking-tight text-white">{title}</h3>
        <button
          type="button"
          onClick={onSwap}
          aria-label="Swap direction"
          className="press ml-auto w-8 h-8 -mr-1 flex items-center justify-center rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-gray-200 touch-manipulation"
        >
          <ArrowLeftRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* From → To micro-line. Origin is tappable to open its full
          station detail; destination is informational. */}
      <button
        type="button"
        onClick={onTapOrigin}
        className="press w-full text-left flex items-center gap-1.5 text-[12px] text-gray-300 mb-2.5 touch-manipulation"
      >
        <span className="font-semibold text-gray-100 truncate">{origin.name}</span>
        <ArrowRight className="w-3 h-3 flex-shrink-0 text-gray-500" />
        <span className="text-gray-400 truncate">{destination.name}</span>
      </button>

      {routes.length === 0 ? (
        <p className="text-[12px] text-gray-400 leading-snug">
          No direct route between these stations. Open one of them to plan a
          transfer.
        </p>
      ) : upcoming.length === 0 ? (
        <p className="text-[12px] text-gray-500 leading-snug">
          No upcoming{" "}
          {routes.map((r) => routeColors.get(r.routeId)?.displayId ?? r.routeId).join("/")}{" "}
          trains in that direction right now.
        </p>
      ) : (
        <div className="flex flex-wrap gap-x-3 gap-y-1.5">
          {upcoming.map((a, i) => {
            const info = routeColors.get(a.routeId);
            if (!info) return null;
            const verdict: CatchVerdict | null =
              origin.meters !== undefined
                ? catchVerdict(origin.meters, a.eta, now / 1000)
                : null;
            const style = verdict ? VERDICT_STYLES[verdict] : VERDICT_STYLES.chill;
            return (
              <span
                key={`${a.tripId}-${i}`}
                className="inline-flex items-center gap-1"
              >
                <RouteBullet
                  id={info.displayId}
                  color={info.color}
                  textColor={info.textColor}
                />
                <span
                  className={`text-[13px] font-semibold tabular-nums ${style.etaCls}`}
                >
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
      )}
    </div>
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
  /** When set, renders a small Home/Work badge in front of the route
   *  bullets. Pure visual annotation — doesn't change tap behavior. */
  anchor?: CommuteAnchor | null;
}

// Small inline pill flagging a station as Home or Work. Sits next to the
// route bullets so the user clocks "this is my home stop" before reading
// the name.
function AnchorBadge({ anchor }: { anchor: CommuteAnchor }) {
  if (anchor === "home") {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 h-5 rounded-full text-[10px] font-bold bg-emerald-300/15 text-emerald-200 ring-1 ring-emerald-300/30">
        <Home className="w-3 h-3" />
        Home
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 h-5 rounded-full text-[10px] font-bold bg-sky-300/15 text-sky-200 ring-1 ring-sky-300/30">
      <Briefcase className="w-3 h-3" />
      Work
    </span>
  );
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
  anchor,
}: StationRowProps) {
  // Drop arrivals whose eta has already passed (with a 5s grace so a
  // train STOPPED_AT the platform still shows for a beat). Without this
  // filter, departed trains linger up to 8s — until the next /api/trains
  // poll drops them — and render as "Now miss", which is misleading.
  // Filtering here (not in the parent's memo) means the live `now` tick
  // drives drop-out instantly, not on the feed cadence.
  const topArrivals = arrivals
    .filter((a) => a.eta - now / 1000 > -5)
    .slice(0, 3);

  return (
    <div className="border-b border-white/5 last:border-b-0">
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            {anchor && <AnchorBadge anchor={anchor} />}
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
  const { home, work, anchorOf } = useCommute();
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

  // Arrivals grouped by station's canonical stopId. Each station entry
  // may span multiple physical platform stopIds (a transfer complex like
  // Union Sq: 635 + R20 + L03), so we fan arrivals out to the complex's
  // canonical id. Done once per poll instead of per row.
  const arrivalsByStation = useMemo(() => {
    const m = new Map<string, Arrival[]>();
    if (!data) return m;
    // Reverse map: every member stopId → canonical stopId.
    const memberToCanonical = new Map<string, string>();
    for (const s of index) {
      for (const id of s.stopIds) memberToCanonical.set(id, s.stopId);
    }
    for (const a of data.arrivals) {
      const canonical = memberToCanonical.get(a.stopId) ?? a.stopId;
      const arr = m.get(canonical) ?? [];
      arr.push(a);
      m.set(canonical, arr);
    }
    return m;
  }, [data, index]);

  const nearbyAll: NearbyStation[] = useMemo(() => {
    if (geo.lng == null || geo.lat == null) return [];
    return nearestStations(index, geo.lng, geo.lat, 6);
  }, [geo.lng, geo.lat, index]);

  // Resolve the commute anchors into renderable rows. Annotate with
  // distance when location is available so the catchable-train verdict
  // applies to your home/work stops too — that's exactly when the
  // verdict matters most ("can I still make the 7:43?").
  const commuteRows = useMemo<
    { anchor: CommuteAnchor; station: StationEntry & { meters?: number } }[]
  >(() => {
    if (!home && !work) return [];
    const byId = new Map(index.map((s) => [s.stopId, s]));
    const have = geo.lng != null && geo.lat != null;
    const rows: { anchor: CommuteAnchor; station: StationEntry & { meters?: number } }[] = [];
    const pairs: [CommuteAnchor, string | null][] = [
      ["home", home],
      ["work", work],
    ];
    for (const [anchor, id] of pairs) {
      if (!id) continue;
      const s = byId.get(id);
      if (!s) continue;
      const meters = have
        ? haversineMeters({ lat: geo.lat!, lng: geo.lng! }, { lat: s.lat, lng: s.lng })
        : undefined;
      rows.push({ anchor, station: { ...s, meters } });
    }
    return rows;
  }, [home, work, index, geo.lat, geo.lng]);

  // ─── Going to Work / Going Home ────────────────────────────────────
  // Origin defaults to whichever anchor the user is closer to once
  // geolocation lands (e.g. you're at home in the morning → "Going to
  // Work" pre-selected). The default is computed once and then sticks
  // — manual swaps win, and we don't want a fresh location reading to
  // override the rider's expressed intent.
  const [originAnchor, setOriginAnchor] = useState<CommuteAnchor>("home");
  const originAutoPicked = useRef(false);
  useEffect(() => {
    if (originAutoPicked.current) return;
    if (!home || !work) return;
    if (geo.lat == null || geo.lng == null) return;
    const byId = new Map(index.map((s) => [s.stopId, s]));
    const h = byId.get(home);
    const w = byId.get(work);
    if (!h || !w) return;
    const dh = haversineMeters({ lat: geo.lat, lng: geo.lng }, { lat: h.lat, lng: h.lng });
    const dw = haversineMeters({ lat: geo.lat, lng: geo.lng }, { lat: w.lat, lng: w.lng });
    setOriginAnchor(dw < dh ? "work" : "home");
    originAutoPicked.current = true;
  }, [home, work, geo.lat, geo.lng, index]);

  // Resolve origin/destination StationEntries + the direct routes between
  // them. Origin carries a meters distance when geo is known so the
  // GoingToCard can color arrivals with the catch verdict.
  const goingTo = useMemo(() => {
    if (!home || !work || !lines) return null;
    const byId = new Map(index.map((s) => [s.stopId, s]));
    const h = byId.get(home);
    const w = byId.get(work);
    if (!h || !w) return null;
    const origin = originAnchor === "home" ? h : w;
    const destination = originAnchor === "home" ? w : h;
    const meters =
      geo.lat != null && geo.lng != null
        ? haversineMeters(
            { lat: geo.lat, lng: geo.lng },
            { lat: origin.lat, lng: origin.lng },
          )
        : undefined;
    const routes = directRoutesBetween(lines, origin.stopIds, destination.stopIds);
    return {
      origin: { ...origin, meters } as StationEntry & { meters?: number },
      destination: destination as StationEntry,
      routes,
    };
  }, [home, work, lines, index, originAnchor, geo.lat, geo.lng]);

  // Anchors get their own section, so strip them out of the other lists
  // to avoid the same station rendering twice.
  const anchorIds = useMemo(() => {
    const s = new Set<string>();
    if (home) s.add(home);
    if (work) s.add(work);
    return s;
  }, [home, work]);

  const nearby = useMemo(
    () => nearbyAll.filter((s) => !anchorIds.has(s.stopId)),
    [nearbyAll, anchorIds],
  );

  const favStations: StationEntry[] = useMemo(() => {
    if (favorites.size === 0) return [];
    // Skip favorites that already appear in the commute or nearby lists
    // — otherwise the same station shows up two or three times. Commute
    // wins, then nearby (which carries the catch verdict), so favorites
    // is the residual "saved-but-not-already-shown" bucket.
    const nearbyIds = new Set(nearby.map((s) => s.stopId));
    const byId = new Map(index.map((s) => [s.stopId, s]));
    const out: StationEntry[] = [];
    for (const id of favorites) {
      if (nearbyIds.has(id) || anchorIds.has(id)) continue;
      const s = byId.get(id);
      if (s) out.push(s);
    }
    return out;
  }, [favorites, index, nearby, anchorIds]);

  // Wall-clock "now" ticking every second so countdowns + catch verdicts
  // update live, not on the 8s feed-poll cadence. Pause the timer when
  // the panel is closed — the unmount path also handles it, but this
  // prevents a brief tick storm during dismiss animations.
  const now = useNow(open);

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
      {/* Combined handle + title row. The grab handle sits absolutely
          at the top of the row so it doesn't claim its own line of
          vertical real estate, and the entire row (including the
          area around the handle) is draggable. The handle button is
          still tap-to-toggle-detent on mobile; stopPropagation keeps
          a tap from bleeding into the parent's pointerdown drag. */}
      <div
        className="relative flex items-center justify-between px-4 pt-3.5 pb-1.5 flex-shrink-0 sm:cursor-auto cursor-grab active:cursor-grabbing touch-none sm:pt-2"
        onPointerDown={handlers.onPointerDown}
        onPointerMove={handlers.onPointerMove}
        onPointerUp={handlers.onPointerUp}
        onPointerCancel={handlers.onPointerCancel}
      >
        <button
          type="button"
          className="sm:hidden absolute top-1.5 left-1/2 -translate-x-1/2 w-9 h-[5px] rounded-full bg-white/30 hover:bg-white/50 touch-manipulation"
          onClick={(e) => {
            e.stopPropagation();
            onHandleTap();
          }}
          aria-label={detent === "half" ? "Expand panel" : "Collapse panel"}
        />
        <div className="flex items-center gap-2 text-white">
          <MapPin className="w-[17px] h-[17px]" />
          <span className="font-black text-[16px] tracking-tight">Near me</span>
        </div>
        <button
          onClick={onClose}
          className="press text-white opacity-85 hover:opacity-100 w-9 h-9 -mr-1 flex items-center justify-center rounded-full bg-white/[0.08] hover:bg-white/[0.12] touch-manipulation"
          aria-label="Close panel"
        >
          <X className="w-[16px] h-[16px]" strokeWidth={2.5} />
        </button>
      </div>

      <div className="px-3 pb-2.5 flex-shrink-0 border-b border-white/[0.06]">
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
                  anchor={anchorOf(s.stopId)}
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

        {/* Hero card: when both Home and Work are set, show next departures
            in the rider's likely commute direction. Sits above the
            individual Home/Work station cards which serve as drill-in. */}
        {goingTo && home && work && (
          <GoingToCard
            origin={goingTo.origin}
            destination={goingTo.destination}
            originAnchor={originAnchor}
            arrivals={arrivalsByStation.get(goingTo.origin.stopId) ?? []}
            routes={goingTo.routes}
            routeColors={routeColors}
            now={now}
            onSwap={() => {
              setOriginAnchor((a) => (a === "home" ? "work" : "home"));
              originAutoPicked.current = true;
            }}
            onTapOrigin={() => onStationOpen(goingTo.origin.stopId)}
          />
        )}

        {commuteRows.length > 0 && (
          <div>
            <div className="px-4 pt-3 pb-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
              Commute
            </div>
            {commuteRows.map(({ anchor, station }) => (
              <StationRow
                key={`commute-${anchor}`}
                station={station}
                arrivals={arrivalsByStation.get(station.stopId) ?? []}
                routeColors={routeColors}
                now={now}
                isFavorite={has(station.stopId)}
                onFavoriteToggle={() => toggle(station.stopId)}
                onTap={() => onStationOpen(station.stopId)}
                anchor={anchor}
              />
            ))}
          </div>
        )}

        {/* First-run hint: shown only when neither anchor is set, the
            user has location enabled (so they can see nearby stations
            to anchor), and no other empty state is visible above. */}
        {!home && !work && geo.lng != null && (
          <div className="mx-4 mt-3 mb-1 rounded-2xl border border-white/[0.06] bg-white/[0.04] px-3.5 py-2.5">
            <p className="text-[12px] text-gray-300 leading-snug">
              <span className="font-semibold text-gray-100">Pin your commute.</span>{" "}
              Tap any station and choose{" "}
              <span className="inline-flex items-center gap-1 px-1.5 py-px rounded-full bg-emerald-300/15 text-emerald-200 text-[10px] font-bold align-baseline">
                <Home className="w-2.5 h-2.5" /> Home
              </span>{" "}
              or{" "}
              <span className="inline-flex items-center gap-1 px-1.5 py-px rounded-full bg-sky-300/15 text-sky-200 text-[10px] font-bold align-baseline">
                <Briefcase className="w-2.5 h-2.5" /> Work
              </span>{" "}
              to keep it one tap away.
            </p>
          </div>
        )}

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
                anchor={anchorOf(s.stopId)}
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
                anchor={anchorOf(s.stopId)}
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
