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
  ArrowLeft,
  Compass,
  Footprints,
  TrainFront,
  CornerUpLeft,
  CornerUpRight,
  CornerDownLeft,
  CornerDownRight,
  ArrowUpRight,
  CircleDot,
  MapPin,
} from "lucide-react";
import type { Arrival } from "@/lib/useTrains";
import { catchVerdict, walkMinutes, type CatchVerdict, type StationEntry } from "@/lib/stopsIndex";
import type { CommuteAnchor } from "@/lib/useFavorites";
import { estimateTripTimeSec, type TripPlan } from "@/lib/commuteRouting";
import type { WalkingRoute, WalkingStep } from "@/lib/walkingDirections";

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
}: StationRowProps) {
  // Drop arrivals whose eta has already passed (5s grace so a train
  // STOPPED_AT the platform still shows for a beat). Filtering here,
  // not at the parent memo, lets the live `now` tick drive drop-out
  // instantly rather than on the 8s feed poll cadence.
  const topArrivals = arrivals
    .filter((a) => a.eta - now / 1000 > -5)
    .slice(0, 3);

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
              {fmtDistance(station.meters)} away
            </p>
          )}

          {topArrivals.length > 0 ? (
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
              {topArrivals.map((a, i) => {
                const info = routeColors.get(a.routeId);
                if (!info) return null;
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
          className="flex-1 min-w-0 bg-transparent text-[14px] text-gray-50 placeholder-gray-400 focus:outline-none"
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
}) {
  const leg1 = plan.legs[0];
  const leg2 = plan.legs[1];
  const leg1Info = leg1 ? routeColors.get(leg1.routeId) : null;
  const leg2Info = leg2 ? routeColors.get(leg2.routeId) : null;
  const transferStation = plan.transferComplexId
    ? stationsByComplexId.get(plan.transferComplexId)
    : null;

  const upcoming = useMemo(() => {
    if (!leg1) return [];
    const cutoff = now / 1000 - 5;
    return arrivals
      .filter(
        (a) =>
          a.routeId === leg1.routeId &&
          a.direction === leg1.direction &&
          a.eta >= cutoff,
      )
      .slice(0, 3);
  }, [arrivals, leg1, now]);

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
      {walkFromMin > 0 && (
        <div className="flex items-center gap-1.5 text-[11px] text-gray-400 mb-2">
          <Footprints className="w-3 h-3 flex-shrink-0" />
          <span className="truncate">
            <span className="text-gray-200 font-semibold tabular-nums">
              {walkFromMin} min
            </span>{" "}
            walk from{" "}
            {walkFromName ? (
              <span className="text-gray-200">{walkFromName}</span>
            ) : (
              "your start"
            )}{" "}
            to{" "}
            <span className="text-gray-300">{origin.name}</span>
          </span>
        </div>
      )}
      <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
        {leg1Info && leg1 && (
          <RouteBullet
            id={leg1Info.displayId}
            color={leg1Info.color}
            textColor={leg1Info.textColor}
          />
        )}
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
          No upcoming {leg1Info?.displayId ?? leg1?.routeId} trains in that
          direction right now.
        </p>
      ) : (
        <div className="flex flex-wrap gap-x-3 gap-y-1.5">
          {upcoming.map((a, i) => {
            const info = routeColors.get(a.routeId);
            if (!info) return null;
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
                <span className="text-[13px] font-semibold tabular-nums text-gray-100">
                  {fmtEta(a.eta, now)}
                </span>
              </span>
            );
          })}
          <span className="text-[11px] text-gray-500 ml-1 self-center">
            at {origin.name}
          </span>
        </div>
      )}
      {walkToMin > 0 && (
        <div className="flex items-center gap-1.5 text-[11px] text-gray-400 mt-2">
          <Footprints className="w-3 h-3 flex-shrink-0" />
          <span className="truncate">
            then{" "}
            <span className="text-gray-200 font-semibold tabular-nums">
              {walkToMin} min
            </span>{" "}
            walk to{" "}
            {walkToName ? (
              <span className="text-gray-200">{walkToName}</span>
            ) : (
              "your destination"
            )}
          </span>
        </div>
      )}
    </Container>
  );
}

// ─── Trip plan detail (expanded A→Z step-by-step view) ──────────────
// Renders a single TripPlan with full step-by-step directions:
//   • Walk steps from the rider's origin to the boarding station
//     (each Mapbox Directions step rendered as its own row with
//     maneuver icon + instruction + distance).
//   • Subway leg(s): board at X, ride N stops, transfer at Y, ride
//     M stops, alight at Z.
//   • Walk steps from the alighting station to the destination.
// Includes a back button so the rider can return to the plan list
// without losing the search context. Independent of which panel is
// hosting it (SearchSheet today, possibly NearbyPanel tomorrow).

function maneuverIcon(step: WalkingStep): React.ReactNode {
  const m = step.modifier ?? "";
  const t = step.maneuver ?? "";
  const cls = "w-4 h-4";
  if (t === "depart") return <CircleDot className={cls} />;
  if (t === "arrive") return <MapPin className={cls} />;
  if (m.includes("right")) {
    if (m.includes("sharp")) return <CornerDownRight className={cls} />;
    if (m.includes("slight")) return <ArrowUpRight className={cls} />;
    return <CornerUpRight className={cls} />;
  }
  if (m.includes("left")) {
    if (m.includes("sharp")) return <CornerDownLeft className={cls} />;
    if (m.includes("slight"))
      return <ArrowUpRight className={`${cls} -scale-x-100`} />;
    return <CornerUpLeft className={cls} />;
  }
  return <ArrowUp className={cls} />;
}

function fmtStepDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return "";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function WalkStepsList({
  route,
  loading,
  fallbackMinutes,
  fallbackDistance,
}: {
  route: WalkingRoute | null;
  loading: boolean;
  /** Estimated walk minutes from the haversine fallback so the rider
   *  always sees a number even when the API hasn't responded yet. */
  fallbackMinutes?: number;
  fallbackDistance?: string;
}) {
  if (!route) {
    return (
      <p className="text-[12px] text-gray-500 px-1">
        {loading
          ? "Finding the best walking route…"
          : fallbackMinutes
            ? `About ${fallbackMinutes} min walk${fallbackDistance ? ` · ${fallbackDistance}` : ""}.`
            : "Walk to the station."}
      </p>
    );
  }
  return (
    <ol className="space-y-1.5">
      {route.steps.map((step, i) => (
        <li
          key={`step-${i}`}
          className="flex items-start gap-2.5 px-1 py-1 rounded-lg"
        >
          <span className="flex-shrink-0 w-7 h-7 rounded-full bg-white/[0.06] text-gray-200 flex items-center justify-center mt-0.5">
            {maneuverIcon(step)}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] text-gray-100 leading-snug">
              {step.instruction}
            </p>
            {step.distance > 0 && (
              <p className="text-[11px] text-gray-500 tabular-nums mt-0.5">
                {fmtStepDistance(step.distance)}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

interface TripPlanDetailProps {
  plan: TripPlan;
  routeColors: RouteColorMap;
  stationsByComplexId: Map<string, StationEntry>;
  /** Resolved walking route from origin → boarding station. Null
   *  while in flight or if no walk is required (station origin). */
  walkFromRoute: WalkingRoute | null;
  walkToRoute: WalkingRoute | null;
  /** True while a walk fetch is pending — controls loading copy. */
  walkFromLoading: boolean;
  walkToLoading: boolean;
  /** Crow-flies fallback distances (meters) used when the API hasn't
   *  resolved yet — keeps a useful estimate on screen during loading. */
  walkFromMeters?: number;
  walkToMeters?: number;
  /** Display labels for the rider's origin and destination so the
   *  step list can read like "Walk from Home to 14 St-Union Sq". */
  fromName?: string;
  toName?: string;
  onBack: () => void;
}

export function TripPlanDetail({
  plan,
  routeColors,
  stationsByComplexId,
  walkFromRoute,
  walkToRoute,
  walkFromLoading,
  walkToLoading,
  walkFromMeters,
  walkToMeters,
  fromName,
  toName,
  onBack,
}: TripPlanDetailProps) {
  const board = stationsByComplexId.get(plan.legs[0].boardComplexId);
  const alight = stationsByComplexId.get(
    plan.legs[plan.legs.length - 1].alightComplexId,
  );
  const transfer = plan.transferComplexId
    ? stationsByComplexId.get(plan.transferComplexId)
    : null;

  const walkFromMin = walkFromMeters ? walkMinutes(walkFromMeters) : 0;
  const walkToMin = walkToMeters ? walkMinutes(walkToMeters) : 0;

  return (
    <div className="px-3 pb-6">
      {/* Header — back button + plan summary ribbon. The ribbon
          mirrors the plan row's visual so the rider visibly stays
          on the same trip after expanding. */}
      <div className="flex items-center gap-2 mb-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to route options"
          className="press flex-shrink-0 inline-flex items-center gap-1.5 h-9 pl-2 pr-3 rounded-full bg-white/[0.08] hover:bg-white/[0.14] text-[13px] font-semibold text-gray-100 touch-manipulation"
        >
          <ArrowLeft className="w-4 h-4" />
          Routes
        </button>
        <div className="flex items-center gap-1 ml-auto flex-shrink-0">
          {plan.legs.map((leg, i) => {
            const info = routeColors.get(leg.routeId);
            if (!info) return null;
            return (
              <span key={`detail-bullet-${i}`} className="flex items-center gap-1">
                {i > 0 && (
                  <ArrowRight className="w-3 h-3 text-gray-500" />
                )}
                <RouteBullet
                  id={info.displayId}
                  color={info.color}
                  textColor={info.textColor}
                />
              </span>
            );
          })}
        </div>
      </div>

      {/* Walk from origin → board station */}
      {board && (
        <section className="mb-4">
          <header className="flex items-center gap-2 mb-2 px-1">
            <span className="w-6 h-6 rounded-full bg-emerald-300/20 text-emerald-200 flex items-center justify-center">
              <Footprints className="w-3.5 h-3.5" />
            </span>
            <h4 className="text-[13px] font-bold tracking-tight text-gray-100">
              {walkFromMin > 0 || walkFromRoute
                ? `Walk to ${board.name}`
                : `Start at ${board.name}`}
            </h4>
            {(walkFromRoute || walkFromMin > 0) && (
              <span className="ml-auto text-[11px] tabular-nums text-gray-400">
                {walkFromRoute
                  ? `${Math.max(1, Math.round(walkFromRoute.duration / 60))} min · ${fmtStepDistance(walkFromRoute.distance)}`
                  : `~${walkFromMin} min${walkFromMeters ? ` · ${fmtStepDistance(walkFromMeters)}` : ""}`}
              </span>
            )}
          </header>
          {fromName && (
            <p className="text-[11px] text-gray-500 px-1 mb-2 truncate">
              From <span className="text-gray-300">{fromName}</span>
            </p>
          )}
          {(walkFromMeters && walkFromMeters > 0) || walkFromRoute ? (
            <WalkStepsList
              route={walkFromRoute}
              loading={walkFromLoading}
              fallbackMinutes={walkFromMin}
              fallbackDistance={
                walkFromMeters ? fmtStepDistance(walkFromMeters) : undefined
              }
            />
          ) : (
            <p className="text-[12px] text-gray-500 px-1">
              You&apos;re starting at the station — no walking required.
            </p>
          )}
        </section>
      )}

      {/* Subway legs — synthesized from the TripPlan: board, ride N
          stops, transfer (if any), ride M stops, alight. Numbers are
          stop counts, the same metric used elsewhere. */}
      {plan.legs.map((leg, i) => {
        const info = routeColors.get(leg.routeId);
        const legBoard = stationsByComplexId.get(leg.boardComplexId);
        const legAlight = stationsByComplexId.get(leg.alightComplexId);
        const isLast = i === plan.legs.length - 1;
        return (
          <section key={`detail-leg-${i}`} className="mb-4">
            <header className="flex items-center gap-2 mb-2 px-1">
              <span className="w-6 h-6 rounded-full bg-white/[0.10] flex items-center justify-center">
                <TrainFront className="w-3.5 h-3.5 text-gray-100" />
              </span>
              <h4 className="text-[13px] font-bold tracking-tight text-gray-100">
                Take the
              </h4>
              {info && (
                <RouteBullet
                  id={info.displayId}
                  color={info.color}
                  textColor={info.textColor}
                />
              )}
              <span className="text-[11px] text-gray-400">
                {leg.direction === "N" ? "Northbound" : "Southbound"}
              </span>
              <span className="ml-auto text-[11px] tabular-nums text-gray-400">
                {leg.stopCount} stop{leg.stopCount === 1 ? "" : "s"}
              </span>
            </header>
            <ol className="space-y-1.5">
              <li className="flex items-start gap-2.5 px-1 py-1 rounded-lg">
                <span className="flex-shrink-0 w-7 h-7 rounded-full bg-emerald-500/20 text-emerald-300 flex items-center justify-center mt-0.5">
                  <CircleDot className="w-3.5 h-3.5" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-gray-100 leading-snug">
                    Board the{" "}
                    <span className="font-semibold">
                      {info?.displayId ?? leg.routeId}
                    </span>{" "}
                    train at{" "}
                    <span className="font-semibold">
                      {legBoard?.name ?? "the station"}
                    </span>
                    .
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-2.5 px-1 py-1 rounded-lg">
                <span className="flex-shrink-0 w-7 h-7 rounded-full bg-white/[0.06] text-gray-200 flex items-center justify-center mt-0.5">
                  {leg.direction === "N" ? (
                    <ArrowUp className="w-4 h-4" />
                  ) : (
                    <ArrowDown className="w-4 h-4" />
                  )}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-gray-100 leading-snug">
                    Ride {leg.stopCount} stop{leg.stopCount === 1 ? "" : "s"}{" "}
                    {leg.direction === "N" ? "northbound" : "southbound"}.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-2.5 px-1 py-1 rounded-lg">
                <span
                  className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5 ${
                    isLast
                      ? "bg-sky-500/20 text-sky-300"
                      : "bg-amber-500/20 text-amber-300"
                  }`}
                >
                  <MapPin className="w-3.5 h-3.5" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-gray-100 leading-snug">
                    {isLast ? "Get off" : "Transfer"} at{" "}
                    <span className="font-semibold">
                      {legAlight?.name ?? "the station"}
                    </span>
                    {!isLast && transfer ? "." : "."}
                  </p>
                </div>
              </li>
            </ol>
          </section>
        );
      })}

      {/* Walk from alight station → destination */}
      {alight && walkToMeters !== undefined && walkToMeters > 0 && (
        <section className="mb-2">
          <header className="flex items-center gap-2 mb-2 px-1">
            <span className="w-6 h-6 rounded-full bg-sky-300/20 text-sky-200 flex items-center justify-center">
              <Footprints className="w-3.5 h-3.5" />
            </span>
            <h4 className="text-[13px] font-bold tracking-tight text-gray-100">
              Walk to {toName ?? "your destination"}
            </h4>
            <span className="ml-auto text-[11px] tabular-nums text-gray-400">
              {walkToRoute
                ? `${Math.max(1, Math.round(walkToRoute.duration / 60))} min · ${fmtStepDistance(walkToRoute.distance)}`
                : `~${walkToMin} min${walkToMeters ? ` · ${fmtStepDistance(walkToMeters)}` : ""}`}
            </span>
          </header>
          <WalkStepsList
            route={walkToRoute}
            loading={walkToLoading}
            fallbackMinutes={walkToMin}
            fallbackDistance={
              walkToMeters ? fmtStepDistance(walkToMeters) : undefined
            }
          />
        </section>
      )}
    </div>
  );
}
