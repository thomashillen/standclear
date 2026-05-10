"use client";

import { useMemo } from "react";
import {
  ArrowUp,
  ArrowDown,
  Star,
  X,
  Home,
  Briefcase,
  ArrowRight,
  ChevronRight,
  Compass,
  Footprints,
  MapPin,
  TrainFront,
  CornerUpLeft,
  CornerUpRight,
  Flag,
} from "lucide-react";
import type { Arrival } from "@/lib/useTrains";
import {
  catchVerdict,
  formatWalkSummary,
  walkMinutes,
  type CatchVerdict,
  type StationEntry,
} from "@/lib/stopsIndex";
import type { CommuteAnchor } from "@/lib/useFavorites";
import { estimateTripTimeSec, type TripPlan } from "@/lib/commuteRouting";
import type { WalkingRoute, WalkingStep } from "@/lib/walkingDirections";
import { trainStaleness } from "@/lib/trainStaleness";

// ─── Shared types ───────────────────────────────────────────────────

export type RouteColorMap = Map<
  string,
  { color: string; textColor: "white" | "black"; displayId: string }
>;

// ─── Format helpers ─────────────────────────────────────────────────

/**
 * ETA copy for the compact list rows. The final minute counts down
 * second by second so the rider sees urgency build; minutes-only
 * above that to keep the row from going noisy at distance.
 */
export function fmtEta(eta: number, now: number): string {
  const secs = Math.round(eta - now / 1000);
  if (secs <= 5) return "Now";
  if (secs < 60) return `${secs}s`;
  return `${Math.round(secs / 60)}m`;
}

export function fmtDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

// ─── Route bullet ───────────────────────────────────────────────────

export function RouteBullet({
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

// ─── Anchor badge (Home / Work) ─────────────────────────────────────

export function AnchorBadge({ anchor }: { anchor: CommuteAnchor }) {
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

// ─── Catch verdict styles ───────────────────────────────────────────
// "chill" + "no distance known" leave the eta alone so panels stay
// quiet for the common case where there's plenty of time.

export const VERDICT_STYLES: Record<
  CatchVerdict,
  { pill: string; etaCls: string; label: string | null }
> = {
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

// ─── Direction-labeled arrivals row ─────────────────────────────────
// Single row for one direction at a station: a leading arrow acts as
// the row's axis label, then up to three (route bullet + ETA + catch
// verdict) chips. The per-chip arrow is intentionally dropped — once
// the row owns the direction the rider's eye locks onto ↑ vs ↓ once
// and reads across, instead of re-parsing direction on every chip.
// Empty rows render a faint em-dash so both directions stay anchored
// in the same vertical positions across stations.

function DirectionArrivalsRow({
  direction,
  arrivals,
  routeColors,
  meters,
  now,
}: {
  direction: "N" | "S";
  arrivals: Arrival[];
  routeColors: RouteColorMap;
  /** Walk distance to this station in meters. Drives the catch-verdict
   *  pill (miss/run/walk). Undefined for stations without a known
   *  rider position (e.g. favorites without geolocation). */
  meters?: number;
  now: number;
}) {
  const Arrow = direction === "N" ? ArrowUp : ArrowDown;
  return (
    <div className="flex items-center gap-2">
      <Arrow
        className="w-3.5 h-3.5 text-gray-400 flex-shrink-0"
        aria-label={direction === "N" ? "Northbound" : "Southbound"}
      />
      {arrivals.length === 0 ? (
        <span className="text-[11px] text-gray-600">—</span>
      ) : (
        <div className="flex flex-wrap gap-x-3 gap-y-1 min-w-0">
          {arrivals.map((a, i) => {
            const info = routeColors.get(a.routeId);
            if (!info) return null;
            const verdict: CatchVerdict | null =
              meters !== undefined
                ? catchVerdict(meters, a.eta, now / 1000)
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
      )}
    </div>
  );
}

// ─── Station row (search results, favorites, nearby) ────────────────

export interface StationRowProps {
  station: StationEntry & { meters?: number };
  arrivals: Arrival[];
  routeColors: RouteColorMap;
  now: number;
  isFavorite: boolean;
  onFavoriteToggle: () => void;
  onTap: () => void;
  /** Optional Home/Work badge in front of the route bullets. */
  anchor?: CommuteAnchor | null;
  /** When provided, render a small compass-icon action button that
   *  starts a directions search from this station. Used in the
   *  SearchSheet's search-mode results so a rider can jump from
   *  "find a station" to "plan a trip from here" without a detour. */
  onDirectionsFrom?: () => void;
  /** When provided, render a chevron action button that opens the
   *  station's detail panel (live arrivals, transfers). Used in
   *  SearchSheet results where the row body itself is wired to
   *  start a trip — this preserves a one-tap path to the station's
   *  schedule for riders who want to glance at trains rather than
   *  navigate. */
  onOpenInfo?: () => void;
}

export function StationRow({
  station,
  arrivals,
  routeColors,
  now,
  isFavorite,
  onFavoriteToggle,
  onTap,
  anchor,
  onDirectionsFrom,
  onOpenInfo,
}: StationRowProps) {
  // Drop arrivals whose eta has already passed (5s grace so a train
  // STOPPED_AT the platform still shows for a beat). Filtering here,
  // not at the parent memo, lets the live `now` tick drive drop-out
  // instantly rather than on the 8s feed poll cadence.
  //
  // Then split by direction so the rider can scan one axis at a time
  // ("when's the next downtown train?") rather than parsing a mixed
  // list. Each direction gets its own row labeled by an arrow; up to
  // three trains per row keeps the tile compact while guaranteeing
  // both directions stay visible at busy stations where the soonest
  // arrivals would otherwise all be one way.
  const upcoming = arrivals.filter((a) => a.eta - now / 1000 > -5);
  const northbound = upcoming
    .filter((a) => a.direction === "N")
    .sort((a, b) => a.eta - b.eta)
    .slice(0, 3);
  const southbound = upcoming
    .filter((a) => a.direction === "S")
    .sort((a, b) => a.eta - b.eta)
    .slice(0, 3);
  const hasAnyArrivals = northbound.length > 0 || southbound.length > 0;

  return (
    <div className="border-b border-white/5 last:border-b-0">
      <div className="flex items-start gap-2 px-4 py-3">
        {/* The whole left content (badges, route bullets, name,
            distance, arrivals) is one big tap target. Action buttons
            sit to the right and don't trigger this. */}
        <button
          onClick={onTap}
          className="press flex-1 min-w-0 text-left touch-manipulation"
          aria-label={`See all trains at ${station.name}`}
        >
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
          <p className="text-sm font-semibold text-gray-100 leading-tight break-words">
            {station.name}
          </p>
          {station.meters !== undefined && (
            <p className="text-[11px] text-gray-500 mt-0.5">
              {formatWalkSummary(station.meters)}
            </p>
          )}

          {hasAnyArrivals ? (
            <div className="mt-2 space-y-1">
              <DirectionArrivalsRow
                direction="N"
                arrivals={northbound}
                routeColors={routeColors}
                meters={station.meters}
                now={now}
              />
              <DirectionArrivalsRow
                direction="S"
                arrivals={southbound}
                routeColors={routeColors}
                meters={station.meters}
                now={now}
              />
            </div>
          ) : (
            <p className="text-[11px] text-gray-600 mt-2">No upcoming trains</p>
          )}
        </button>

        {/* Action column — directions-from-here (when provided) and
            favorite star. Each is its own tap target so they don't
            trigger the row's open-station handler. */}
        <div className="flex items-center gap-0.5 flex-shrink-0 pt-0.5">
          {onDirectionsFrom && (
            <button
              type="button"
              onClick={onDirectionsFrom}
              aria-label={`Plan a trip from ${station.name}`}
              className="press p-2 text-gray-400 hover:text-sky-300 active:text-sky-400 touch-manipulation"
            >
              <Compass className="w-5 h-5" />
            </button>
          )}
          {onOpenInfo && (
            <button
              type="button"
              onClick={onOpenInfo}
              aria-label={`Show ${station.name} details`}
              className="press p-2 text-gray-500 hover:text-gray-200 active:text-gray-100 touch-manipulation"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          )}
          <button
            type="button"
            onClick={onFavoriteToggle}
            className="press p-2 text-gray-500 hover:text-amber-300 active:text-amber-400 touch-manipulation"
            aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
          >
            <Star
              className={`w-5 h-5 ${isFavorite ? "fill-amber-300 text-amber-300" : ""}`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Trip planner From/To field ─────────────────────────────────────
// Apple-Maps-style row: colored dot + label + station name (or
// placeholder). Active state outlines the field with the accent
// color so the rider sees which input the search will fill.

export function PlannerField({
  label,
  station,
  active,
  query,
  onQueryChange,
  placeholder,
  accent,
  onTap,
  onClear,
}: {
  label: string;
  station: StationEntry | null;
  active: boolean;
  /** Search input value when this field is active. Ignored when
   *  inactive (the field shows the chosen station's name instead). */
  query: string;
  /** Called as the rider types into the active field. Inactive fields
   *  never raise this. */
  onQueryChange: (q: string) => void;
  placeholder: string;
  accent: "emerald" | "sky";
  onTap: () => void;
  onClear: () => void;
}) {
  const dot =
    accent === "emerald"
      ? "bg-emerald-400 ring-emerald-300/30"
      : "bg-sky-400 ring-sky-300/30";
  const ring = active
    ? accent === "emerald"
      ? "ring-emerald-400/40"
      : "ring-sky-400/40"
    : "ring-white/[0.08]";

  // Active fields render a div + nested <input> — the input handles
  // typing, so the outer container can't be a button (a button
  // wrapping an input swallows focus). Inactive fields render a
  // <button> so a single tap activates the field.
  if (active) {
    return (
      <div
        className={`relative w-full h-10 px-3 rounded-xl bg-white/[0.06] ring-1 ${ring} flex items-center gap-2.5 transition-colors`}
      >
        <span
          className={`inline-block w-2 h-2 rounded-full ${dot} ring-2 flex-shrink-0`}
        />
        <span className="text-[10px] uppercase tracking-wider text-gray-500 w-9 flex-shrink-0">
          {label}
        </span>
        <input
          autoFocus
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={station ? `Change ${label.toLowerCase()}` : placeholder}
          aria-label={`${label} station search`}
          // 16px font-size prevents iOS Safari from auto-zooming
          // the page on focus, which leaves the layout shifted
          // behind the Dynamic Island even after blur.
          className="flex-1 min-w-0 bg-transparent text-[16px] text-gray-50 placeholder-gray-400 focus:outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQueryChange("")}
            aria-label="Clear search"
            className="press w-6 h-6 flex items-center justify-center rounded-full bg-white/[0.10] hover:bg-white/[0.18] text-gray-200 flex-shrink-0"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onTap}
      className={`press w-full h-10 px-3 rounded-xl bg-white/[0.06] hover:bg-white/[0.10] ring-1 ${ring} flex items-center gap-2.5 text-left touch-manipulation transition-colors`}
    >
      <span
        className={`inline-block w-2 h-2 rounded-full ${dot} ring-2 flex-shrink-0`}
      />
      <span className="text-[10px] uppercase tracking-wider text-gray-500 w-9 flex-shrink-0">
        {label}
      </span>
      <span
        className={`flex-1 min-w-0 text-[14px] truncate ${
          station ? "font-semibold text-gray-50" : "text-gray-400"
        }`}
      >
        {station ? station.name : placeholder}
      </span>
      {station && (
        <span
          role="button"
          aria-label={`Clear ${label.toLowerCase()}`}
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          className="press w-6 h-6 flex items-center justify-center rounded-full bg-white/[0.10] hover:bg-white/[0.18] text-gray-200 flex-shrink-0"
        >
          <X className="w-3 h-3" />
        </span>
      )}
    </button>
  );
}

// ─── Trip plan row (planner result card) ────────────────────────────
// Renders a single TripPlan: leg ribbon (route bullets + arrows),
// total stop count + transfer info, and live arrivals on leg 1 at
// the origin so the rider knows when to leave. The "best" plan is
// visually emphasized; alternatives are quieter.

export function TripPlanRow({
  plan,
  origin,
  routeColors,
  stationsByComplexId,
  arrivals,
  now,
  isPrimary,
  isSelected,
  onSelect,
  walkFromMeters,
  walkFromName,
  walkToMeters,
  walkToName,
  lastReportedByTripId,
  generatedAtSec,
}: {
  plan: TripPlan;
  origin: StationEntry;
  routeColors: RouteColorMap;
  stationsByComplexId: Map<string, StationEntry>;
  arrivals: Arrival[];
  now: number;
  isPrimary: boolean;
  /** Visual highlight when this is the trip currently shown on the map. */
  isSelected?: boolean;
  /** Tap handler — typically toggles map overlay for this plan. */
  onSelect?: () => void;
  /** Walking distance in meters from a non-station origin (address)
   *  to the boarding station. When set, renders a "Walk X min from
   *  <walkFromName>" prefix above the leg ribbon. */
  walkFromMeters?: number;
  walkFromName?: string;
  /** Walking distance in meters from the alighting station to a
   *  non-station destination (address). When set, renders "Walk X
   *  min to <walkToName>" beneath the arrivals. */
  walkToMeters?: number;
  walkToName?: string;
  /** Per-trip last-reported VehiclePosition timestamp (epoch seconds).
   *  When provided, each upcoming-arrival ETA is colored amber once
   *  its train's position slips past the marker-fade threshold (90 s),
   *  matching ArrivalRow's per-row staleness chrome. Trips that aren't
   *  in the map are by definition as fresh as the latest poll —
   *  stop_time_update without a paired VehiclePosition — so no chrome
   *  changes for them. Optional so call sites that don't have train
   *  data (early-load, tests) keep working unchanged. */
  lastReportedByTripId?: Map<string, number | undefined>;
  /** Snapshot's generatedAt in epoch seconds. Falls in to
   *  `trainStaleness` when a trip's per-vehicle timestamp is omitted,
   *  so silent-feed outages still surface. */
  generatedAtSec?: number;
}) {
  const leg1 = plan.legs[0];
  const leg2 = plan.legs[1];
  const leg1Info = leg1 ? routeColors.get(leg1.routeId) : null;
  const leg2Info = leg2 ? routeColors.get(leg2.routeId) : null;
  const transferStation = plan.transferComplexId
    ? stationsByComplexId.get(plan.transferComplexId)
    : null;

  // Co-running route bullets, resolved against the route color map.
  // These get rendered next to the primary bullets so the rider sees
  // every train that goes their way (N + R + W on Broadway BMT,
  // 4 + 5 across the Lex express trunk, etc.). Plain `Set`-keyed
  // resolution avoids re-rendering the bullets if the color map
  // identity changes but the underlying list doesn't.
  const leg1Siblings = useMemo(() => {
    if (!leg1?.siblingRouteIds) return [];
    return leg1.siblingRouteIds
      .map((rid) => routeColors.get(rid))
      .filter((x): x is NonNullable<typeof x> => !!x);
  }, [leg1, routeColors]);
  const leg2Siblings = useMemo(() => {
    if (!leg2?.siblingRouteIds) return [];
    return leg2.siblingRouteIds
      .map((rid) => routeColors.get(rid))
      .filter((x): x is NonNullable<typeof x> => !!x);
  }, [leg2, routeColors]);

  // Set of routeIds that count as a board-able train for leg 1.
  // Includes primary + siblings so live arrivals on co-running routes
  // count toward "next train" — the rider doesn't care which BMT
  // bullet pulls in first.
  const leg1ValidRouteIds = useMemo(() => {
    const s = new Set<string>();
    if (leg1) {
      s.add(leg1.routeId);
      if (leg1.siblingRouteIds) {
        for (const sib of leg1.siblingRouteIds) s.add(sib);
      }
    }
    return s;
  }, [leg1]);

  const upcoming = useMemo(() => {
    if (!leg1) return [];
    const cutoff = now / 1000 - 5;
    return arrivals
      .filter(
        (a) =>
          leg1ValidRouteIds.has(a.routeId) &&
          a.direction === leg1.direction &&
          a.eta >= cutoff,
      )
      // Sort by ETA so the rider always sees the soonest train first
      // even when arrivals on different sibling routes interleave
      // (the upstream feed sorts per-route, but mixing trunks means
      // the merged list might not be).
      .slice()
      .sort((a, b) => a.eta - b.eta)
      .slice(0, 3);
  }, [arrivals, leg1, leg1ValidRouteIds, now]);

  // Per-upcoming-arrival staleness, parallel to `upcoming`. Each entry
  // is `null` when the train is fresh OR when its trip has no Train
  // entry in the snapshot (a stop_time_update without a paired
  // VehiclePosition is by definition as fresh as the latest poll).
  // Colors the ETA amber inline + drives the at-glance "Updated Nm
  // ago" sub-line below — same visual idiom as ArrivalRow.
  const upcomingStaleness = useMemo(() => {
    if (!lastReportedByTripId || !generatedAtSec) {
      return upcoming.map(() => null);
    }
    return upcoming.map((a) => {
      if (!lastReportedByTripId.has(a.tripId)) return null;
      const ts = lastReportedByTripId.get(a.tripId);
      const s = trainStaleness(ts, now, generatedAtSec);
      return s.stale ? s : null;
    });
  }, [upcoming, lastReportedByTripId, generatedAtSec, now]);
  // Soonest stale entry in the list — the train the rider would
  // typically chase. Surface ITS label as a single sub-line below the
  // inline ETAs so the rider gets the why-amber explanation without
  // crowding the per-ETA chips.
  const leadStale = upcomingStaleness.find((s) => s != null) ?? null;

  // Per-upcoming-arrival catchability when the rider is walking up
  // from a non-station origin. Each entry mirrors `upcoming` —
  // "miss" / "run" / "walk" / "chill" or `null` (no walk distance,
  // rider already on the platform). Drives the inline ETA tint via
  // VERDICT_STYLES so a missed train renders strikethrough-gray and
  // a runnable train renders amber, matching StationRow's idiom on
  // the same data. Without this signal the rider sees "Next: 2m"
  // and tries to make a train they can't physically reach.
  const upcomingVerdicts = useMemo<(CatchVerdict | null)[]>(() => {
    if (!walkFromMeters || walkFromMeters <= 0) {
      return upcoming.map(() => null);
    }
    return upcoming.map((a) => catchVerdict(walkFromMeters, a.eta, now / 1000));
  }, [upcoming, walkFromMeters, now]);

  // Total trip time in minutes — walk + wait (live next-train ETA
  // when known) + travel + transfer + walk. Wraps the row's already
  // filtered arrivals into a single-entry map keyed on leg-1's
  // boarding complex so estimateTripTimeSec can find the live wait.
  const totalMin = useMemo(() => {
    if (!leg1) return 0;
    const m = new Map<string, Arrival[]>();
    m.set(leg1.boardComplexId, arrivals);
    const sec = estimateTripTimeSec(plan, {
      arrivalsByStation: m,
      nowSec: now / 1000,
      walkFromMeters,
      walkToMeters,
    });
    return Math.max(1, Math.round(sec / 60));
  }, [plan, leg1, arrivals, now, walkFromMeters, walkToMeters]);

  // Outer element switches between div (purely informational) and
  // button (when onSelect is provided). The latter gives keyboard /
  // screen-reader semantics for "tap to show this trip on the map"
  // without losing the rich nested layout.
  const Container: React.ElementType = onSelect ? "button" : "div";
  // iOS-26 selected state: vibrant ring + ambient glow tinted to the
  // leg-1 route color, matching the trip overlay's color on the map.
  // Inline style (instead of Tailwind classes) so the color flows
  // directly from the route data — no per-route class explosion.
  const accentColor = leg1Info?.color ?? "#ffffff";
  const selectedStyle: React.CSSProperties | undefined = isSelected
    ? {
        boxShadow: `inset 0 0 0 2px ${accentColor}, 0 10px 32px -8px ${accentColor}66, 0 1px 0 rgba(255,255,255,0.10) inset`,
        backgroundColor: `${accentColor}22`,
      }
    : undefined;
  const ringCls = isSelected
    ? ""
    : isPrimary
      ? "ring-1 bg-white/[0.05] ring-white/[0.10]"
      : "ring-1 bg-white/[0.02] ring-white/[0.06]";
  const interactiveCls = onSelect
    ? "press touch-manipulation w-full text-left hover:bg-white/[0.07]"
    : "";

  const walkFromMin = walkFromMeters ? walkMinutes(walkFromMeters) : 0;
  const walkToMin = walkToMeters ? walkMinutes(walkToMeters) : 0;

  return (
    <Container
      type={onSelect ? "button" : undefined}
      onClick={onSelect}
      aria-pressed={onSelect ? !!isSelected : undefined}
      style={selectedStyle}
      className={`rounded-2xl px-3.5 pt-3 pb-3 ${ringCls} ${interactiveCls} transition-all duration-200`}
    >
      <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
        {leg1Info && leg1 && (
          <RouteBullet
            id={leg1Info.displayId}
            color={leg1Info.color}
            textColor={leg1Info.textColor}
          />
        )}
        {leg1Siblings.map((info) => (
          <RouteBullet
            key={`leg1-sib-${info.displayId}`}
            id={info.displayId}
            color={info.color}
            textColor={info.textColor}
          />
        ))}
        {leg2 && (
          <>
            <ArrowRight className="w-3 h-3 text-gray-500 flex-shrink-0" />
            {leg2Info && (
              <RouteBullet
                id={leg2Info.displayId}
                color={leg2Info.color}
                textColor={leg2Info.textColor}
              />
            )}
            {leg2Siblings.map((info) => (
              <RouteBullet
                key={`leg2-sib-${info.displayId}`}
                id={info.displayId}
                color={info.color}
                textColor={info.textColor}
              />
            ))}
          </>
        )}
        <span className="text-[11px] text-gray-400 ml-1.5 truncate min-w-0">
          {plan.totalStops} stop{plan.totalStops === 1 ? "" : "s"}
          {transferStation
            ? ` · ${transferStation.name}`
            : " · direct"}
        </span>
        {/* Total time pill — vibrant, tabular numerals, route-color
            tinted on the selected plan and quiet otherwise. Pinned
            to the right of the ribbon so the rider's eye lands on
            "how long" first. */}
        <span
          className="ml-auto flex-shrink-0 inline-flex items-center px-2 h-5 rounded-full text-[11px] font-bold tabular-nums"
          style={
            isSelected
              ? {
                  backgroundColor: `${accentColor}33`,
                  color: "#ffffff",
                  boxShadow: `inset 0 0 0 1px ${accentColor}80`,
                }
              : { backgroundColor: "rgba(255,255,255,0.08)", color: "#f3f4f6" }
          }
        >
          {totalMin} min
        </span>
      </div>

      {upcoming.length === 0 ? (
        <p className="text-[12px] text-gray-500 leading-snug">
          No upcoming{" "}
          {leg1ValidRouteIds.size > 1
            ? "trains on this trunk"
            : `${leg1Info?.displayId ?? leg1?.routeId} trains`}{" "}
          in that direction right now.
        </p>
      ) : leg1Siblings.length > 0 ? (
        // Trunk case (N/R/W, A/C, etc.): each upcoming train gets its
        // own route bullet so the rider knows whether to board a W or
        // an N as the train pulls in. Without this they'd see the
        // primary survivor's bullet only, which lies about "what's
        // arriving."
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[13px] text-gray-500 leading-snug">Next:</span>
          {upcoming.map((a, i) => {
            const info = routeColors.get(a.routeId);
            const stale = upcomingStaleness[i] != null;
            return (
              <span
                key={`${a.tripId}-${i}`}
                className={`inline-flex items-center gap-1 text-[13px] tabular-nums ${
                  stale ? "text-amber-300" : "text-gray-100"
                }`}
              >
                {info && (
                  <RouteBullet
                    id={info.displayId}
                    color={info.color}
                    textColor={info.textColor}
                  />
                )}
                <span className="font-semibold">{fmtEta(a.eta, now)}</span>
              </span>
            );
          })}
          <span className="text-[11px] text-gray-500 ml-0.5 self-center">
            at {origin.name}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 flex-wrap">
          {leg1Info && (
            <RouteBullet
              id={leg1Info.displayId}
              color={leg1Info.color}
              textColor={leg1Info.textColor}
            />
          )}
          <span className="text-[13px] tabular-nums leading-snug">
            {/* "Next:" prefix instead of "in" — with the route bullet
                immediately to the left, "[4] in 4m · 11m · 19m" parsed
                as "the 4 train in 4m" before the eye reached the dot
                separator. "Next:" makes the list reading unambiguous. */}
            <span className="text-gray-500">Next: </span>
            {upcoming.map((a, i) => {
              const stale = upcomingStaleness[i] != null;
              const verdict = upcomingVerdicts[i];
              // Verdict wins when the rider is walking up — catchability
              // is the action signal. Stale tinting falls back when
              // there's no walk (rider on the platform); the leadStale
              // sub-line still surfaces "updated Nm ago" textually
              // either way. "miss" carries strikethrough via
              // VERDICT_STYLES so a missed train is unmistakable even
              // when several ETAs run together in the inline list.
              const verdictCls = verdict ? VERDICT_STYLES[verdict].etaCls : null;
              const tint =
                verdictCls ?? (stale ? "text-amber-300" : "text-gray-100");
              return (
                <span key={`${a.tripId}-${i}`}>
                  {i > 0 && <span className="text-gray-600"> · </span>}
                  <span className={`font-semibold ${tint}`}>
                    {fmtEta(a.eta, now)}
                  </span>
                </span>
              );
            })}
          </span>
          <span className="text-[11px] text-gray-500 ml-0.5 self-center">
            at {origin.name}
          </span>
        </div>
      )}
      {leadStale && (
        // Single sub-line that surfaces WHY a stale ETA is amber:
        // mirrors ArrivalRow's "Updated Nm ago" / "Stale · Nm" copy
        // from `trainStaleness.label`. Renders only when at least one
        // upcoming arrival on this leg is past the marker-fade
        // threshold; uses the soonest stale train (the one the rider
        // is most likely to chase) so the band — soft vs. hard stale —
        // matches what the rider's eye is on.
        <p
          className="text-[11px] text-amber-300 leading-tight mt-1 truncate"
          aria-label={`Soonest train position last updated ${Math.round(leadStale.ageSec / 60)} minutes ago`}
        >
          {leadStale.label}
        </p>
      )}
      {(walkFromMin > 0 || walkToMin > 0) && (
        <div className="flex items-center gap-1.5 text-[11px] text-gray-400 mt-2 flex-wrap">
          <Footprints className="w-3 h-3 flex-shrink-0" />
          {walkFromMin > 0 && (
            <span className="truncate">
              <span className="text-gray-200 font-semibold tabular-nums">
                {walkFromMin} min
              </span>
              {walkFromName ? (
                <>
                  {" "}from{" "}
                  <span className="text-gray-200">{walkFromName}</span>
                </>
              ) : null}
            </span>
          )}
          {walkFromMin > 0 && walkToMin > 0 && (
            <span className="text-gray-600">·</span>
          )}
          {walkToMin > 0 && (
            <span className="truncate">
              <span className="text-gray-200 font-semibold tabular-nums">
                {walkToMin} min
              </span>{" "}
              to{" "}
              {walkToName ? (
                <span className="text-gray-200">{walkToName}</span>
              ) : (
                "destination"
              )}
            </span>
          )}
        </div>
      )}
    </Container>
  );
}

// ─── Trip plan detail (expanded summary view) ───────────────────────
// Renders a single TripPlan as a single-column timeline of high-level
// steps. Each step is one row:
//   • Walk to the boarding station.
//   • Take the [route] N stops to the next station (one row per leg —
//     the implicit transfer is "the next subway row continues from
//     where the previous one ended").
//   • Walk to the destination.
// Turn-by-turn walking and per-leg subheaders are intentionally
// omitted — the rider just wants the punch list, not a play-by-play.

function fmtStepDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return "";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function fmtWalkMeta(
  route: WalkingRoute | null,
  fallbackMin: number,
  fallbackMeters?: number,
): string | undefined {
  if (route) {
    return `${Math.max(1, Math.round(route.duration / 60))} min · ${fmtStepDistance(route.distance)}`;
  }
  if (fallbackMin > 0) {
    return `~${fallbackMin} min${fallbackMeters ? ` · ${fmtStepDistance(fallbackMeters)}` : ""}`;
  }
  return undefined;
}

// Single timeline row: round icon on the left (with an optional
// vertical connector line below it), title in the middle, and a meta
// string (right-aligned) for the duration/distance summary. Becomes
// a tappable button when `onClick` is provided — used to focus the
// map on a specific subway leg.
function TimelineRow({
  icon,
  iconBg,
  title,
  subtitle,
  meta,
  showConnector,
  onClick,
  selected,
}: {
  icon: React.ReactNode;
  /** Tailwind classes for the icon's background + foreground. */
  iconBg: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  meta?: string;
  /** Whether to render the vertical line under this row connecting
   *  it to the next one. Off for the last row. */
  showConnector: boolean;
  onClick?: () => void;
  selected?: boolean;
}) {
  const interactive = !!onClick;
  const Inner: React.ElementType = interactive ? "button" : "div";
  const interactiveCls = interactive
    ? `press touch-manipulation w-full text-left rounded-lg -mx-2 px-2 py-1 transition-colors ${
        selected ? "bg-white/[0.08]" : "hover:bg-white/[0.04]"
      }`
    : "";
  return (
    <li className="flex items-start gap-3">
      <div className="flex flex-col items-center self-stretch">
        <span
          className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${iconBg}`}
        >
          {icon}
        </span>
        {showConnector && (
          <span className="flex-1 w-px bg-white/10 mt-1 mb-1" />
        )}
      </div>
      <Inner
        type={interactive ? "button" : undefined}
        onClick={onClick}
        aria-pressed={interactive ? !!selected : undefined}
        className={`flex-1 min-w-0 pb-3 ${interactiveCls}`}
      >
        <div className="flex items-baseline gap-2">
          <p className="text-[13px] text-gray-100 leading-snug flex-1 min-w-0">
            {title}
          </p>
          {meta && (
            <span className="text-[11px] tabular-nums text-gray-400 flex-shrink-0">
              {meta}
            </span>
          )}
        </div>
        {subtitle && (
          <p className="text-[11px] text-gray-500 mt-0.5 truncate">
            {subtitle}
          </p>
        )}
      </Inner>
    </li>
  );
}

interface TripPlanDetailProps {
  plan: TripPlan;
  routeColors: RouteColorMap;
  stationsByComplexId: Map<string, StationEntry>;
  /** Resolved walking route from origin → boarding station. Used
   *  only to display the precise walk duration + distance when
   *  available. */
  walkFromRoute: WalkingRoute | null;
  walkToRoute: WalkingRoute | null;
  /** Crow-flies fallback distances (meters) used until the API
   *  resolves — keeps a useful estimate on screen meanwhile. */
  walkFromMeters?: number;
  walkToMeters?: number;
  /** Display label for the rider's destination, used in the final
   *  walk row title ("Walk to Brooklyn Office"). */
  toName?: string;
  /** Live arrivals + clock so the header total matches the plan
   *  row's countdown. Falls back to a generic wait constant when
   *  absent. */
  arrivalsByStation?: Map<string, Arrival[]>;
  now?: number;
  /** Index of the leg the rider has zoomed in on, or null for the
   *  whole-trip view. Owned by SubwayMap so the camera can refit. */
  focusedLegIndex?: number | null;
  /** Toggle map focus on a specific leg. Tap the same leg again to
   *  return to the whole-trip frame. */
  onFocusLeg?: (i: number | null) => void;
  /** True when at least one walking-route fetch failed. Drives a
   *  small retry strip at the top of the card so a flaky platform
   *  connection doesn't silently leave the rider with the
   *  crow-flies fallback. */
  walkRouteError?: boolean;
  /** Tapped from the retry strip. Owned upstream so the SubwayMap
   *  knows the actual endpoints to refetch. */
  onRetryWalkRoutes?: () => void;
}

export function TripPlanDetail({
  plan,
  routeColors,
  stationsByComplexId,
  walkFromRoute,
  walkToRoute,
  walkFromMeters,
  walkToMeters,
  toName,
  arrivalsByStation,
  now,
  focusedLegIndex,
  onFocusLeg,
  walkRouteError = false,
  onRetryWalkRoutes,
}: TripPlanDetailProps) {
  const board = stationsByComplexId.get(plan.legs[0].boardComplexId);
  const alight = stationsByComplexId.get(
    plan.legs[plan.legs.length - 1].alightComplexId,
  );

  const walkFromMin = walkFromMeters ? walkMinutes(walkFromMeters) : 0;
  const walkToMin = walkToMeters ? walkMinutes(walkToMeters) : 0;

  const totalSec = useMemo(
    () =>
      estimateTripTimeSec(plan, {
        arrivalsByStation,
        nowSec: typeof now === "number" ? now / 1000 : undefined,
        walkFromMeters: walkFromMeters ?? 0,
        walkToMeters: walkToMeters ?? 0,
        stationsByComplexId,
      }),
    [
      plan,
      arrivalsByStation,
      now,
      walkFromMeters,
      walkToMeters,
      stationsByComplexId,
    ],
  );
  const totalMin = Math.max(1, Math.round(totalSec / 60));

  // Soonest upcoming arrival on leg 1 — drives the "L in 2m" hint
  // next to the total. Filters by leg 1's route(s) + direction so the
  // countdown corresponds to the train the rider needs to catch.
  // Siblings (co-running trunk routes) count: at Times Sq inbound,
  // a W arriving sooner than the primary N is the train to catch.
  const nextLeg1 = useMemo(() => {
    if (!arrivalsByStation || typeof now !== "number") return null;
    const leg1 = plan.legs[0];
    if (!leg1) return null;
    const arrivals = arrivalsByStation.get(leg1.boardComplexId);
    if (!arrivals) return null;
    const validRoutes = new Set<string>([leg1.routeId]);
    if (leg1.siblingRouteIds) {
      for (const sib of leg1.siblingRouteIds) validRoutes.add(sib);
    }
    const cutoff = now / 1000 - 5;
    let earliest = Infinity;
    let earliestRouteId = leg1.routeId;
    for (const a of arrivals) {
      if (!validRoutes.has(a.routeId)) continue;
      if (a.direction !== leg1.direction) continue;
      if (a.eta < cutoff) continue;
      if (a.eta < earliest) {
        earliest = a.eta;
        earliestRouteId = a.routeId;
      }
    }
    return Number.isFinite(earliest)
      ? { eta: earliest, routeId: earliestRouteId }
      : null;
  }, [arrivalsByStation, now, plan]);
  const nextLeg1Info = nextLeg1 ? routeColors.get(nextLeg1.routeId) : null;

  const showWalkFrom = !!board;
  const showWalkTo =
    !!alight && walkToMeters !== undefined && walkToMeters > 0;
  const walkFromActive = walkFromRoute || (walkFromMeters ?? 0) > 0;

  return (
    <div className="px-3 pb-6">
      {/* Header — total trip time. The unexpanded plan row already
          showed the bullets, so we surface the most decision-useful
          number (total minutes) here. The panel's outer header
          already provides a back button, so we don't duplicate one
          here — two adjacent back arrows read as ambiguous. */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="text-[22px] font-bold tabular-nums text-gray-100 leading-none">
            {totalMin}
          </span>
          <span className="text-[13px] text-gray-400">min total</span>
        </div>
        {nextLeg1 && nextLeg1Info && typeof now === "number" && (
          <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
            <RouteBullet
              id={nextLeg1Info.displayId}
              color={nextLeg1Info.color}
              textColor={nextLeg1Info.textColor}
            />
            <span className="text-[13px] tabular-nums text-gray-200">
              <span className="text-gray-500">in </span>
              <span className="font-semibold text-gray-100">
                {fmtEta(nextLeg1.eta, now)}
              </span>
            </span>
          </div>
        )}
      </div>

      {walkRouteError && (
        <div className="mb-3 flex items-center gap-2 rounded-xl bg-amber-500/10 ring-1 ring-amber-500/30 px-3 py-2 text-[12px] text-amber-200">
          <span className="flex-1 min-w-0">
            Couldn&rsquo;t load walking directions. Showing a straight line.
          </span>
          {onRetryWalkRoutes && (
            <button
              type="button"
              onClick={onRetryWalkRoutes}
              className="press flex-shrink-0 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 px-2.5 py-1 text-[12px] font-semibold text-amber-100 touch-manipulation"
            >
              Retry
            </button>
          )}
        </div>
      )}

      <ol className="px-1">
        {showWalkFrom && (
          <TimelineRow
            icon={<Footprints className="w-3.5 h-3.5" />}
            iconBg="bg-emerald-300/20 text-emerald-200"
            title={
              walkFromActive ? (
                <>
                  Walk to{" "}
                  <span className="font-semibold">{board.name}</span>
                </>
              ) : (
                <>
                  Start at{" "}
                  <span className="font-semibold">{board.name}</span>
                </>
              )
            }
            meta={
              walkFromActive
                ? fmtWalkMeta(walkFromRoute, walkFromMin, walkFromMeters)
                : undefined
            }
            showConnector
          />
        )}

        {plan.legs.map((leg, i) => {
          const info = routeColors.get(leg.routeId);
          const legAlight = stationsByComplexId.get(leg.alightComplexId);
          const isLastLeg = i === plan.legs.length - 1;
          const isFocused = focusedLegIndex === i;
          // Ride duration mirrors the estimator's per-leg model:
          // stops × 90 s. Surfaced as the row's meta so the rider
          // sees how long the actual subway segment takes — the
          // walking and total are already shown elsewhere, but a
          // 25-min total split as "3 walk / 18 train / 4 walk"
          // tells a different story than "3 / 8 / 4" at the same
          // total. Floor of 1 min so a one-stop hop doesn't
          // collapse to "0".
          const rideMin = Math.max(1, Math.round((leg.stopCount * 90) / 60));
          return (
            <TimelineRow
              key={`detail-leg-${i}`}
              icon={
                info ? (
                  <RouteBullet
                    id={info.displayId}
                    color={info.color}
                    textColor={info.textColor}
                  />
                ) : (
                  <TrainFront className="w-3.5 h-3.5 text-gray-100" />
                )
              }
              iconBg="bg-transparent"
              title={
                <>
                  Ride {leg.stopCount} stop
                  {leg.stopCount === 1 ? "" : "s"}{" "}
                  {leg.direction === "N" ? "northbound" : "southbound"} to{" "}
                  <span className="font-semibold">
                    {legAlight?.name ?? "the station"}
                  </span>
                </>
              }
              meta={`${rideMin} min`}
              subtitle={
                isFocused
                  ? "Tap again to see whole trip"
                  : !isLastLeg
                    ? "Transfer here"
                    : undefined
              }
              showConnector={!isLastLeg || showWalkTo}
              onClick={
                onFocusLeg
                  ? () => onFocusLeg(isFocused ? null : i)
                  : undefined
              }
              selected={isFocused}
            />
          );
        })}

        {showWalkTo && (
          <TimelineRow
            icon={<Footprints className="w-3.5 h-3.5" />}
            iconBg="bg-sky-300/20 text-sky-200"
            title={
              <>
                Walk to{" "}
                <span className="font-semibold">
                  {toName ?? "your destination"}
                </span>
              </>
            }
            meta={fmtWalkMeta(walkToRoute, walkToMin, walkToMeters)}
            showConnector={false}
          />
        )}
      </ol>
    </div>
  );
}

// ─── Walking-only detail (turn-by-turn) ─────────────────────────────
// Shown when walking is the fastest option and the rider taps the
// "Walking is faster" card. The route on the map is already visible;
// this panel surfaces the same Mapbox steps the trip detail uses for
// its walk segments, but as a standalone view (no subway legs).

function maneuverIcon(step: WalkingStep): React.ReactNode {
  const m = step.maneuver;
  if (m === "depart") return <Footprints className="w-3.5 h-3.5" />;
  if (m === "arrive") return <Flag className="w-3.5 h-3.5" />;
  if (step.modifier?.includes("left"))
    return <CornerUpLeft className="w-3.5 h-3.5" />;
  if (step.modifier?.includes("right"))
    return <CornerUpRight className="w-3.5 h-3.5" />;
  return <ArrowUp className="w-3.5 h-3.5" />;
}

interface WalkingDetailProps {
  /** Resolved street-following route. Null while the Mapbox call is
   *  in flight or after a network failure — the component renders a
   *  one-row fallback with the crow-flies estimate so the rider
   *  always sees something useful. */
  route: WalkingRoute | null;
  /** Crow-flies fallback (meters) when `route` hasn't resolved yet. */
  fallbackMeters: number;
  fallbackMin: number;
  fromName: string;
  toName: string;
}

export function WalkingDetail({
  route,
  fallbackMeters,
  fallbackMin,
  fromName,
  toName,
}: WalkingDetailProps) {
  const totalMin = route
    ? Math.max(1, Math.round(route.duration / 60))
    : fallbackMin;
  const totalMeters = route?.distance ?? fallbackMeters;

  return (
    <div className="px-3 pb-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-shrink-0 w-9 h-9 rounded-full bg-emerald-300/20 text-emerald-200 flex items-center justify-center">
          <Footprints className="w-[18px] h-[18px]" />
        </div>
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="text-[22px] font-bold tabular-nums text-gray-100 leading-none">
            {totalMin}
          </span>
          <span className="text-[13px] text-gray-400">min walk</span>
          {totalMeters > 0 && (
            <span className="text-[13px] text-gray-500 tabular-nums">
              · {fmtStepDistance(totalMeters)}
            </span>
          )}
        </div>
      </div>

      <ol className="px-1">
        <TimelineRow
          icon={<MapPin className="w-3.5 h-3.5" />}
          iconBg="bg-emerald-300/20 text-emerald-200"
          title={
            <>
              Start at <span className="font-semibold">{fromName}</span>
            </>
          }
          showConnector
        />

        {route?.steps?.map((step, i) => {
          const isLast = i === route.steps.length - 1;
          const meta =
            step.distance > 0
              ? fmtStepDistance(step.distance)
              : undefined;
          return (
            <TimelineRow
              key={`walk-step-${i}`}
              icon={maneuverIcon(step)}
              iconBg="bg-white/[0.08] text-gray-200"
              title={step.instruction}
              meta={meta}
              showConnector={!isLast}
            />
          );
        })}

        <TimelineRow
          icon={<Flag className="w-3.5 h-3.5" />}
          iconBg="bg-sky-300/20 text-sky-200"
          title={
            <>
              Arrive at <span className="font-semibold">{toName}</span>
            </>
          }
          showConnector={false}
        />
      </ol>
    </div>
  );
}
