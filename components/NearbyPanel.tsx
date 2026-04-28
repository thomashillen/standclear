"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  MapPin,
  Navigation,
  X,
  Home,
  Briefcase,
  ArrowLeftRight,
  ArrowRight,
} from "lucide-react";
import { useLines } from "@/lib/subwayData";
import { useTrains, type Arrival } from "@/lib/useTrains";
import { useGeolocation } from "@/lib/useGeolocation";
import {
  useFavorites,
  useCommute,
  type CommuteAnchor,
  type CommuteEndpoint,
} from "@/lib/useFavorites";
import { useNow } from "@/lib/useNow";
import { useSheetDrag } from "@/lib/useSheetDrag";
import {
  planTrips,
  rankPlansByTime,
  type TripPlan,
} from "@/lib/commuteRouting";
import {
  buildStationIndex,
  catchVerdict,
  haversineMeters,
  nearestStations,
  nearestStationsWithin,
  type CatchVerdict,
  type NearbyStation,
  type StationEntry,
} from "@/lib/stopsIndex";
import {
  StationRow,
  TripPlanRow,
  type RouteColorMap,
} from "./panelUI";

interface Props {
  open: boolean;
  onClose: () => void;
  onStationOpen: (stopId: string) => void;
  /** Tap handler for a trip plan (in the Going-to-Work card). The
   *  parent renders the trip's legs and station markers on the map.
   *  Pass null to clear. Symmetric with SearchSheet's prop of the
   *  same name. */
  onTripSelect?: (
    selection:
      | {
          plan: TripPlan;
          walkFrom?: { lng: number; lat: number; name?: string };
          walkTo?: { lng: number; lat: number; name?: string };
        }
      | null,
  ) => void;
  /** Stable identifier of the currently-rendered trip so the row
   *  can show a selected highlight. */
  selectedTripKey?: string | null;
  /** Tapping "See all routes" on the Going-to-Work card opens the
   *  SearchSheet pre-filled with current location → destination
   *  anchor in directions mode. The parent owns SearchSheet state so
   *  this callback is the bridge; the preset shape mirrors the
   *  CommuteEndpoint discriminated union. */
  onSeeAllRoutes?: (preset: {
    from:
      | { kind: "station"; stopId: string }
      | { kind: "address"; lng: number; lat: number; name: string };
    to:
      | { kind: "station"; stopId: string }
      | { kind: "address"; lng: number; lat: number; name: string };
  }) => void;
}

/**
 * Resolve a saved commute anchor (which may be either a station pin
 * or an address) into a routable form: the underlying StationEntry
 * to feed planTrips, plus a display label for the UI and the address
 * coordinates when present (for walk legs). Returns null when the
 * endpoint can't be resolved against the current station index —
 * e.g., a saved stopId that no longer exists.
 */
type ResolvedEndpoint = {
  station: StationEntry;
  displayName: string;
  /** Original lat/lng + label for an address pin. Used to compute
   *  the walk leg from/to the underlying station. Undefined for
   *  station pins (the station IS the endpoint). */
  address?: { name: string; lng: number; lat: number };
};

function resolveCommuteEndpoint(
  ep: CommuteEndpoint | null,
  stationsByComplexId: Map<string, StationEntry>,
  index: StationEntry[],
): ResolvedEndpoint | null {
  if (!ep) return null;
  if (ep.kind === "station") {
    const s = stationsByComplexId.get(ep.stopId);
    if (!s) return null;
    return { station: s, displayName: s.name };
  }
  // Address — resolve to the nearest station each time we read so a
  // saved address routes through whatever's nearest in the current
  // index (handles future GTFS updates that might add a closer stop).
  const nearest = nearestStations(index, ep.lng, ep.lat, 1)[0];
  if (!nearest) return null;
  return {
    station: nearest,
    displayName: ep.name,
    address: { name: ep.name, lng: ep.lng, lat: ep.lat },
  };
}

// ─── Going to Work / Going Home — the daily-commute hero card ─────
// Always FROM = current location, TO = the rider's saved Home or
// Work anchor (which can be either a station pin or an address).
// Walk legs render at start (current location → boarding station)
// and at end (alighting station → destination address, when the
// destination is an address). Multiple ranked plans are shown so
// the rider can compare alternatives — a slow next-train on the
// 6 might be beaten by a 5 that arrives sooner even if the
// per-stop time is similar.

interface GoingToCardProps {
  /** Current location resolved into a station-shaped object with the
   *  rider's actual lat/lng + a "Current location" displayName. */
  origin: StationEntry & {
    meters?: number;
    displayName: string;
    address: { name: string; lng: number; lat: number };
  };
  /** Resolved Home/Work endpoint — its station + display name + the
   *  optional saved address. */
  destination: ResolvedEndpoint;
  /** Which anchor is the destination — drives the title and icon. */
  destAnchor: CommuteAnchor;
  /** Per-complex arrivals map. Each plan's TripPlanRow looks up the
   *  arrivals at ITS specific board complex (which can differ from
   *  another plan's when we expand candidate stations around an
   *  address) and then filters by leg-1 route + direction. */
  arrivalsByStation: Map<string, Arrival[]>;
  /** Top trip plans from origin to destination, in display order
   *  (re-ranked by estimated total time). */
  plans: TripPlan[];
  routeColors: RouteColorMap;
  /** complex stopId → station entry, for resolving each plan's
   *  transfer station name. */
  stationsByComplexId: Map<string, StationEntry>;
  now: number;
  onSwap: () => void;
  onTapOrigin: () => void;
  /** Tap handler for a plan row — sets the selected trip on the map. */
  onTripSelect?: (
    selection:
      | {
          plan: TripPlan;
          walkFrom?: { lng: number; lat: number; name?: string };
          walkTo?: { lng: number; lat: number; name?: string };
        }
      | null,
  ) => void;
  /** Stable identifier of the currently-selected trip so this card's
   *  rows can show the matching plan as selected. */
  selectedTripKey?: string | null;
}

// Stable tripKey recipe — must match SubwayMap's so a tap from
// either NearbyPanel or SearchSheet selects the same plan. Mirrors
// the dedup key in lib/commuteRouting.ts.
function tripKey(plan: TripPlan): string {
  return (
    plan.legs.map((l) => `${l.routeId}-${l.direction}`).join("|") +
    (plan.transferComplexId ? `:${plan.transferComplexId}` : "")
  );
}

function GoingToCard({
  origin,
  destination,
  destAnchor,
  arrivalsByStation,
  plans,
  routeColors,
  stationsByComplexId,
  now,
  onSwap,
  onTapOrigin,
  onTripSelect,
  onSeeAllRoutes,
  selectedTripKey,
}: GoingToCardProps & {
  onSeeAllRoutes?: (preset: {
    from:
      | { kind: "station"; stopId: string }
      | { kind: "address"; lng: number; lat: number; name: string };
    to:
      | { kind: "station"; stopId: string }
      | { kind: "address"; lng: number; lat: number; name: string };
  }) => void;
}) {
  const title = destAnchor === "work" ? "Going to Work" : "Going Home";
  const tint =
    destAnchor === "work"
      ? "from-sky-500/15 via-sky-500/[0.06] to-transparent ring-sky-400/20"
      : "from-emerald-500/15 via-emerald-500/[0.06] to-transparent ring-emerald-400/20";

  return (
    <div
      // iOS-26 ambient material: gradient tint + ring + thin top
      // highlight (inset shadow) for the "raised glass" feel, plus a
      // soft outer drop shadow so the card sits above the panel's
      // base material.
      style={{
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.10), 0 8px 24px -12px rgba(0,0,0,0.4)",
      }}
      className={`mx-3 mt-3 mb-1 rounded-2xl bg-gradient-to-br ${tint} ring-1 px-3 pt-3 pb-3 backdrop-blur-sm`}
    >
      <div className="flex items-center gap-2 mb-2 px-0.5">
        <span
          className={`inline-flex items-center justify-center w-6 h-6 rounded-full ${
            destAnchor === "work"
              ? "bg-sky-300/20 text-sky-200"
              : "bg-emerald-300/20 text-emerald-200"
          }`}
        >
          {destAnchor === "work" ? (
            <Briefcase className="w-3.5 h-3.5" />
          ) : (
            <Home className="w-3.5 h-3.5" />
          )}
        </span>
        <h3 className="text-[14px] font-black tracking-tight text-white">
          {title}
        </h3>
        <button
          type="button"
          onClick={onSwap}
          aria-label="Swap destination"
          className="press ml-auto w-8 h-8 -mr-1 flex items-center justify-center rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-gray-200 touch-manipulation"
        >
          <ArrowLeftRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* From → To micro-line. Origin is "Current location" tappable
          to open the boarding station; destination is informational
          but shows the saved displayName (address or station name). */}
      <button
        type="button"
        onClick={onTapOrigin}
        className="press w-full text-left flex items-center gap-1.5 text-[12px] text-gray-300 mb-2 px-0.5 touch-manipulation"
      >
        <span className="font-semibold text-gray-100 truncate">
          {origin.displayName}
        </span>
        <ArrowRight className="w-3 h-3 flex-shrink-0 text-gray-500" />
        <span className="text-gray-400 truncate">{destination.displayName}</span>
      </button>

      {plans.length === 0 ? (
        <p className="text-[12px] text-gray-400 leading-snug px-0.5">
          No subway route found between these endpoints.
        </p>
      ) : (
        <div className="space-y-2">
          {/* "See all routes" CTA — opens SearchSheet in directions
              mode with home/work pre-filled. The home/work auto-fill
              already happens inside SearchSheet's directions effect,
              so we only need to flip the panel into directions mode
              and the rest follows. Pinned at the bottom of the
              card; visible only when more plans exist. */}
          {plans.map((plan, i) => {
            const k = tripKey(plan);
            const isSelected = selectedTripKey === k;
            // Per-plan walks. Each plan boards/alights at a complex
            // that may differ from another plan's (we expand the
            // candidate set when origin or destination is an
            // address), so the walk is plan-specific. Same shape as
            // SearchSheet's TripPlanRow rendering.
            const board = stationsByComplexId.get(plan.legs[0].boardComplexId);
            const alight = stationsByComplexId.get(
              plan.legs[plan.legs.length - 1].alightComplexId,
            );
            const walkFromMeters = board
              ? haversineMeters(
                  { lat: origin.address.lat, lng: origin.address.lng },
                  { lat: board.lat, lng: board.lng },
                )
              : undefined;
            const walkToMeters =
              destination.address && alight
                ? haversineMeters(
                    {
                      lat: destination.address.lat,
                      lng: destination.address.lng,
                    },
                    { lat: alight.lat, lng: alight.lng },
                  )
                : undefined;
            return (
              <TripPlanRow
                key={`going-${k}-${i}`}
                plan={plan}
                origin={origin}
                routeColors={routeColors}
                stationsByComplexId={stationsByComplexId}
                // Per-plan boarding-station arrivals so the live
                // first-leg ETA matches the plan's actual platform.
                arrivals={
                  arrivalsByStation.get(plan.legs[0].boardComplexId) ?? []
                }
                now={now}
                isPrimary={i === 0}
                isSelected={isSelected}
                onSelect={
                  onTripSelect
                    ? () => {
                        if (isSelected) {
                          onTripSelect(null);
                          return;
                        }
                        onTripSelect({
                          plan,
                          // Origin walk = current location → board
                          // station. Destination walk = alight
                          // station → saved address (when present).
                          walkFrom: {
                            lng: origin.address.lng,
                            lat: origin.address.lat,
                            name: origin.address.name,
                          },
                          walkTo: destination.address
                            ? {
                                lng: destination.address.lng,
                                lat: destination.address.lat,
                                name: destination.address.name,
                              }
                            : undefined,
                        });
                      }
                    : undefined
                }
                walkFromMeters={walkFromMeters}
                walkFromName={origin.address.name}
                walkToMeters={
                  walkToMeters && walkToMeters > 0 ? walkToMeters : undefined
                }
                walkToName={destination.address?.name}
              />
            );
          })}
          {onSeeAllRoutes && (
            <button
              type="button"
              onClick={() => {
                // Pass the rider's actual current trip so the
                // SearchSheet lands with current location → chosen
                // destination — instead of inheriting whatever was
                // last searched.
                onSeeAllRoutes({
                  from: {
                    kind: "address",
                    lng: origin.address.lng,
                    lat: origin.address.lat,
                    name: origin.displayName,
                  },
                  to: destination.address
                    ? {
                        kind: "address",
                        lng: destination.address.lng,
                        lat: destination.address.lat,
                        name: destination.address.name,
                      }
                    : {
                        kind: "station",
                        stopId: destination.station.stopId,
                      },
                });
              }}
              className="press w-full mt-1 flex items-center justify-center gap-1 px-3 h-9 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-[12px] font-semibold text-gray-200 touch-manipulation"
            >
              See all routes
              <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── NearbyPanel ────────────────────────────────────────────────────
// Now scoped to "what's near me right now": the Going-to-Work card,
// individual Home/Work station cards, favorites, and nearest stations.
// Search and trip planning live in SearchSheet so they have their own
// dedicated surface (Apple Maps pattern).

export default function NearbyPanel({
  open,
  onClose,
  onStationOpen,
  onTripSelect,
  selectedTripKey,
  onSeeAllRoutes,
}: Props) {
  const geo = useGeolocation(open);
  const lines = useLines();
  const data = useTrains();
  const { favorites, toggle, has } = useFavorites();
  const { home, work, anchorOf } = useCommute();

  const index = useMemo(() => (lines ? buildStationIndex(lines) : []), [lines]);

  const stationsByComplexId = useMemo(() => {
    const m = new Map<string, StationEntry>();
    for (const s of index) m.set(s.stopId, s);
    return m;
  }, [index]);

  // Wall-clock tick for live countdowns + catch verdicts. Pause when
  // the panel is closed — saves battery during the dismiss animation
  // and beyond.
  const now = useNow(open);

  // routeId → display info; one lookup table for every row.
  const routeColors = useMemo<RouteColorMap>(() => {
    const m: RouteColorMap = new Map();
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

  // Bucket arrivals by canonical complex stopId so a station-row
  // lookup gets every arrival across the complex's platforms.
  const arrivalsByStation = useMemo(() => {
    const m = new Map<string, Arrival[]>();
    if (!data) return m;
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

  // ─── Going to Work / Going Home ────────────────────────────────────
  // Always FROM = current location, TO = Home or Work. Auto-picks
  // the destination as the FARTHER anchor (the rider is at the
  // closer one). Manual swap toggles destination, and the auto-pick
  // doesn't fire again — rider's intent wins. Skipped entirely
  // without geolocation since "current location" is the origin.
  const [destAnchor, setDestAnchor] = useState<CommuteAnchor>("work");
  const destAnchorAutoPicked = useRef(false);
  useEffect(() => {
    if (destAnchorAutoPicked.current) return;
    if (!home || !work) return;
    if (geo.lat == null || geo.lng == null) return;
    const h = resolveCommuteEndpoint(home, stationsByComplexId, index);
    const w = resolveCommuteEndpoint(work, stationsByComplexId, index);
    if (!h || !w) return;
    // Distance to the address (or station, when no address is
    // attached) since the rider's actual proximity is what matters,
    // not the proximity to the routing station.
    const homeRefLat = h.address?.lat ?? h.station.lat;
    const homeRefLng = h.address?.lng ?? h.station.lng;
    const workRefLat = w.address?.lat ?? w.station.lat;
    const workRefLng = w.address?.lng ?? w.station.lng;
    const dh = haversineMeters(
      { lat: geo.lat, lng: geo.lng },
      { lat: homeRefLat, lng: homeRefLng },
    );
    const dw = haversineMeters(
      { lat: geo.lat, lng: geo.lng },
      { lat: workRefLat, lng: workRefLng },
    );
    // Closer to Home → going to Work. Closer to Work → going Home.
    setDestAnchor(dh < dw ? "work" : "home");
    destAnchorAutoPicked.current = true;
  }, [home, work, geo.lat, geo.lng, stationsByComplexId, index]);

  // Resolve current location into a TripEndpoint-shaped origin and
  // the chosen anchor into a destination. Returns null when either
  // endpoint can't resolve (e.g., no geo, missing anchor) so the
  // card silently disappears rather than rendering an empty state
  // for a misconfigured commute.
  const goingTo = useMemo(() => {
    if (!home || !work || !lines) return null;
    if (geo.lat == null || geo.lng == null) return null;

    const h = resolveCommuteEndpoint(home, stationsByComplexId, index);
    const w = resolveCommuteEndpoint(work, stationsByComplexId, index);
    if (!h || !w) return null;

    const dest = destAnchor === "work" ? w : h;

    // FROM = the rider's current location, resolved to the nearest
    // station for routing. The address coords stay attached so the
    // walk leg from the user's actual position to the boarding
    // station renders in each plan.
    const fromNearest = nearestStations(index, geo.lng, geo.lat, 1)[0];
    if (!fromNearest) return null;
    const origin: StationEntry & {
      meters?: number;
      displayName: string;
      address: { name: string; lng: number; lat: number };
    } = {
      ...fromNearest,
      meters: 0,
      displayName: "Current location",
      address: {
        name: "Current location",
        lng: geo.lng,
        lat: geo.lat,
      },
    };

    // Expand origin candidates: every station within ~700m of the
    // rider's current location, not just the absolute nearest. This
    // is the same fix as the address-search side — if the rider is
    // standing between Wall St (4/5) and Rector St (1) we want both
    // as boarding candidates so the planner can find the direct
    // 4/5 to Lexington/59 St rather than only the 1-train route.
    const NEAR_RADIUS_M = 700;
    const fromStopIds = Array.from(
      new Set(
        nearestStationsWithin(index, geo.lng, geo.lat, NEAR_RADIUS_M).flatMap(
          (s) => s.stopIds,
        ),
      ),
    );
    // Same for the destination when it's an address (the saved Home
    // or Work pin). When it's a station we keep the station's own
    // stopIds so the rider's chosen platform wins.
    const toStopIds = dest.address
      ? Array.from(
          new Set(
            nearestStationsWithin(
              index,
              dest.address.lng,
              dest.address.lat,
              NEAR_RADIUS_M,
            ).flatMap((s) => s.stopIds),
          ),
        )
      : dest.station.stopIds;

    const rawPlans = planTrips(lines, index, fromStopIds, toStopIds, {
      maxResults: 12,
    });

    // Re-rank by estimated total time. Per-plan walks come from the
    // address anchors + stationsByComplexId so each plan's timing
    // reflects ITS actual board/alight station. Trim to top 6 so the
    // rider sees a healthy spread of options without overwhelm.
    const ranked = rankPlansByTime(rawPlans, {
      arrivalsByStation,
      nowSec: now / 1000,
      walkFromAnchor: { lng: geo.lng, lat: geo.lat },
      walkToAnchor: dest.address
        ? { lng: dest.address.lng, lat: dest.address.lat }
        : undefined,
      stationsByComplexId,
    });
    // Apple Maps Today widget pattern — surface ONE recommendation on
    // the home surface. Riders who want options tap "See all routes"
    // and land in the directions sheet with home/work pre-filled.
    const plans = ranked.slice(0, 1);

    return {
      origin,
      destination: dest,
      plans,
    };
  }, [
    home,
    work,
    lines,
    index,
    stationsByComplexId,
    destAnchor,
    geo.lat,
    geo.lng,
    arrivalsByStation,
    now,
  ]);

  // Station-pinned anchors only — for those it's correct to dedupe
  // them out of Nearest Stations so the same station doesn't appear
  // twice on screen (the anchor still surfaces via the Going-to-Work
  // card or the Home/Work badge on a remaining list, depending on
  // context). Address-pinned anchors don't get filtered: an address
  // has many equally-valid nearby stations, and hiding "the closest"
  // one from Nearest Stations would just remove a useful row for an
  // arbitrary reason.
  const anchorIds = useMemo(() => {
    const s = new Set<string>();
    const add = (ep: CommuteEndpoint | null) => {
      if (!ep) return;
      if (ep.kind === "station") s.add(ep.stopId);
    };
    add(home);
    add(work);
    return s;
  }, [home, work]);

  const nearby = useMemo(
    () => nearbyAll.filter((s) => !anchorIds.has(s.stopId)),
    [nearbyAll, anchorIds],
  );

  const favStations: StationEntry[] = useMemo(() => {
    if (favorites.size === 0) return [];
    const nearbyIds = new Set(nearby.map((s) => s.stopId));
    const out: StationEntry[] = [];
    for (const id of favorites) {
      if (nearbyIds.has(id) || anchorIds.has(id)) continue;
      const s = stationsByComplexId.get(id);
      if (s) out.push(s);
    }
    return out;
  }, [favorites, stationsByComplexId, nearby, anchorIds]);

  // Shared sheet drag with half/full detents + dismiss threshold.
  const { detent, sheetStyle, handlers, onHandleTap, setDetent } = useSheetDrag({
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
          at the top of the row so it doesn't claim its own line, and
          the entire row is draggable. */}
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

      <div
        className="flex-1 overflow-y-auto ios-scroll"
        // At half detent the sheet hangs ~28dvh below the visible
        // viewport, so the last items in the scroll content end up
        // physically below where the rider can see. Adding 28dvh of
        // bottom padding pushes the scrollable bottom past the
        // overlap — the rider can scroll to the end without dragging
        // the sheet up. Harmless at full detent (just adds dead space
        // at the bottom of the list, which already has visual breathing
        // room from the safe-area inset).
        style={{
          paddingBottom: "calc(28dvh + 1rem + env(safe-area-inset-bottom))",
        }}
      >
        {/* Hero card: when both Home and Work are set, show next
            departures in the rider's likely commute direction. */}
        {goingTo && home && work && (
          <GoingToCard
            origin={goingTo.origin}
            destination={goingTo.destination}
            destAnchor={destAnchor}
            arrivalsByStation={arrivalsByStation}
            plans={goingTo.plans}
            routeColors={routeColors}
            onSeeAllRoutes={onSeeAllRoutes}
            stationsByComplexId={stationsByComplexId}
            now={now}
            onSwap={() => {
              setDestAnchor((a) => (a === "home" ? "work" : "home"));
              destAnchorAutoPicked.current = true;
            }}
            onTapOrigin={() => onStationOpen(goingTo.origin.stopId)}
            onTripSelect={
              onTripSelect
                ? (plan) => {
                    onTripSelect(plan);
                    // Apple-Maps pattern: tapping a route plan
                    // collapses the sheet to its half-detent so the
                    // map's trip overlay is visible. Tapping the
                    // same plan again clears (plan === null) — keep
                    // the sheet at whatever detent it's at; the
                    // rider can drag if they want more room.
                    if (plan) setDetent("half");
                  }
                : undefined
            }
            selectedTripKey={selectedTripKey}
          />
        )}

        {/* First-run hint: shown only when neither anchor is set, the
            user has location, and no other empty state is visible. */}
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

        {/* Empty geo states (no location yet, denied, etc.). Kept at
            the bottom so the rest of the panel still renders if any
            useful content exists above. */}
        {nearby.length === 0 && favStations.length === 0 && !goingTo && (
          geo.status === "idle" ? (
            <div className="px-6 py-10 text-center">
              <Navigation className="w-10 h-10 mx-auto mb-3 text-gray-400" />
              <p className="text-sm text-gray-300 font-medium mb-1">
                Find stations near you
              </p>
              <p className="text-[11px] text-gray-500 mb-4 max-w-[240px] mx-auto">
                We&apos;ll surface the closest stops and which trains you can
                still catch.
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
            </div>
          ) : geo.status === "denied" ? (
            <div className="px-6 py-10 text-center">
              <MapPin className="w-10 h-10 mx-auto mb-3 text-gray-600" />
              <p className="text-sm text-gray-300 font-medium">
                Location is blocked
              </p>
              <p className="text-[11px] text-gray-500 mt-1 max-w-[240px] mx-auto">
                Enable location access for SubwaySurfer in your browser
                settings, then reopen this panel.
              </p>
            </div>
          ) : null
        )}
      </div>
    </div>
  );
}
