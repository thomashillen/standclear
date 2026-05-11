"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Search,
  X,
  Compass,
  ChevronRight,
  ArrowLeftRight,
  ArrowLeft,
  MapPin,
  Home,
  Briefcase,
  RefreshCw,
  Footprints,
} from "lucide-react";
import { useLines } from "@/lib/subwayData";
import { useTrains, refreshTrains, type Arrival } from "@/lib/useTrains";
import { fetchWalkingRoute, type WalkingRoute } from "@/lib/walkingDirections";
import { useFavorites, useCommute, type CommuteEndpoint } from "@/lib/useFavorites";
import { useGeolocationState } from "@/lib/useGeolocation";
import { useNow } from "@/lib/useNow";
import { useRecentSearches } from "@/lib/useRecentSearches";
import { useSheetDrag } from "@/lib/useSheetDrag";
import {
  estimateTripTimeSec,
  planTrips,
  rankPlansByTime,
  type TripPlan,
} from "@/lib/commuteRouting";
import {
  buildStationIndex,
  formatWalkSummary,
  haversineMeters,
  nearestStations,
  nearestStationsWithin,
  searchStations,
  walkMinutes,
  type StationEntry,
} from "@/lib/stopsIndex";
import {
  makeDebouncedSuggester,
  retrievePlace,
  type Place,
  type Suggestion,
} from "@/lib/geocoding";
import {
  RouteBullet,
  StationRow,
  PlannerField,
  TripPlanRow,
  TripPlanDetail,
  WalkingDetail,
  type RouteColorMap,
} from "./panelUI";

interface Props {
  open: boolean;
  onClose: () => void;
  onStationOpen: (stopId: string) => void;
  /** Tap on a trip plan in directions mode. The parent renders the
   *  trip's legs, station markers, and walking segments on the map.
   *  Pass null to clear. */
  onTripSelect?: (
    selection:
      | {
          plan: TripPlan;
          walkFrom?: { lng: number; lat: number; name?: string };
          walkTo?: { lng: number; lat: number; name?: string };
        }
      | null,
  ) => void;
  /** Identifier (string) of the currently-selected plan so the row can
   *  show a selected-state highlight. The parent generates this from
   *  the plan it renders on the map. */
  selectedTripKey?: string | null;
  /** Mode the sheet should land in when it opens. Defaults to
   *  "search". The "See all routes" CTA in NearbyPanel sets this to
   *  "directions" so the rider arrives directly at trip planning
   *  with home/work pre-filled (the in-component effect handles
   *  the auto-fill on first directions render). */
  initialMode?: "search" | "directions";
  /** When set, the sheet operates in focused anchor-pick mode: a
   *  prominent banner makes the goal explicit ("Tap a result to set
   *  as Home"), tapping ANY row immediately pins it as the named
   *  anchor and closes the sheet — instead of opening the station
   *  panel or starting a directions flow. Used by MoreSheet's
   *  Set Home / Set Work rows. Cleared when the sheet closes. */
  anchorPickMode?: "home" | "work" | null;
  /** Called after a successful anchor pick so the parent can close
   *  the sheet (and optionally clear the pick mode). */
  onAnchorPicked?: () => void;
  /** Force-fill the directions From/To when the sheet opens. Used
   *  by NearbyPanel's "See all routes" button so the rider always
   *  lands on a fresh "current location → chosen destination" trip
   *  rather than whatever they previously searched. Each endpoint
   *  is either a station (by stopId) or a geocoded place (lng/lat
   *  + name). When this prop changes the sheet re-applies — so
   *  successive "See all routes" taps reset cleanly. Either side
   *  can be omitted: e.g. StationPanel's Directions button sets
   *  only `to` and lets the home/work auto-fill resolve the From. */
  presetTrip?: {
    from?: { kind: "station"; stopId: string } | { kind: "address"; lng: number; lat: number; name: string };
    to?: { kind: "station"; stopId: string } | { kind: "address"; lng: number; lat: number; name: string };
  } | null;
  /** Resolved street-following walking routes for the selected trip
   *  (origin → board, alight → destination). Owned by SubwayMap so
   *  the same fetched routes back both the dashed map polyline and
   *  the expanded detail view's step list — single source of truth,
   *  no double-fetch. Undefined when nothing is selected, or while
   *  the API is still resolving. */
  walkFromRoute?: WalkingRoute | null;
  walkToRoute?: WalkingRoute | null;
  /** True when at least one walking-route fetch failed. Surfaces a
   *  retry strip in TripPlanDetail so a flaky platform connection
   *  doesn't silently leave the rider with the crow-flies fallback. */
  walkRouteError?: boolean;
  /** Callback invoked when the rider taps Retry on the failure strip.
   *  Owned by SubwayMap (the only thing that knows the actual
   *  endpoints to refetch). */
  onRetryWalkRoutes?: () => void;
  /** Index of the leg the rider has zoomed in on from the expanded
   *  route detail. Owned by SubwayMap so the map can refit. Null
   *  means "frame the whole trip". */
  focusedLegIndex?: number | null;
  onFocusLeg?: (i: number | null) => void;
  /** Walking-faster overlay for the map. Set to a from/to pair (and
   *  optional resolved coords) when the rider's trip is shorter on
   *  foot than any subway plan; null clears it. The parent forwards
   *  it to MapView so the dashed pedestrian line renders. */
  onWalkOnlyChange?: (
    overlay:
      | {
          from: { lng: number; lat: number };
          to: { lng: number; lat: number };
          coords?: [number, number][];
        }
      | null,
  ) => void;
  /** Fires when the rider opens / closes a specific plan's detail
   *  view (the A→Z timeline). The parent uses this to tell MapView
   *  whether the SearchSheet is currently in the larger plan-list
   *  state (panel ≈60dvh) or the smaller detail state (≈38dvh) so
   *  the trip's camera fit can leave the right amount of room
   *  below. Without this signal the route's south end can hide
   *  behind the taller plan-list panel. */
  onExpandedPlanChange?: (expanded: boolean) => void;
}

// ─── SearchSheet ─────────────────────────────────────────────────────
// Apple-Maps-style search + directions sheet. Two modes via a
// segmented control at the top:
//   • Search: text input + station results (each row is the same
//     StationRow used in NearbyPanel for visual consistency).
//   • Directions: From/To fields + station picker + ranked trip plans
//     from the planTrips engine (with one transfer support).
//
// This sheet shares chrome conventions (drag handle, sheet drag,
// close X, glass material) with NearbyPanel, but is mounted as its
// own panel and is mutually exclusive with the others — opening
// search closes Near Me / Line / Station panels at the SubwayMap
// level. Keeping the two surfaces separate means NearbyPanel can
// stay focused on "where am I right now" while SearchSheet owns
// "where do I want to go" — same pattern Apple Maps uses.

// Stable identifier for a trip plan — same recipe the planTrips
// dedup uses, so a row's selected state matches the parent's state
// across re-renders even though TripPlan is a value type.
function tripKey(plan: TripPlan): string {
  return (
    plan.legs.map((l) => `${l.routeId}-${l.direction}`).join("|") +
    (plan.transferComplexId ? `:${plan.transferComplexId}` : "")
  );
}

/**
 * Trip endpoint = StationEntry + optional display metadata. Used so a
 * rider can pick an address as their From/To and we still feed a real
 * StationEntry into the routing engine, while showing the address text
 * in the field. `address` is the geocoded place; `displayName` is what
 * the field renders. Plain station picks leave both undefined.
 */
type TripEndpoint = StationEntry & {
  displayName?: string;
  address?: Place;
};

// Visible inline notice rendered when the Mapbox geocode proxy errors
// out (HTTP 5xx, missing MAPBOX_TOKEN env var, network failure). Lets
// a rider distinguish "this address has no match" from "address search
// itself is down" — without this, both states surface as a generic
// empty list and a deploy-time misconfiguration looks identical to a
// typo.
function PlaceSearchUnavailable() {
  return (
    <div className="mx-4 mt-3 mb-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.08] px-3 py-2.5">
      <p className="text-[12px] font-semibold text-amber-200 leading-snug">
        Address search is temporarily unavailable
      </p>
      <p className="mt-0.5 text-[11px] text-amber-100/70 leading-snug">
        Stations still searchable. Try again in a moment.
      </p>
    </div>
  );
}

// ─── Set-as-Home/Work toggle button ─────────────────────────────────
export default function SearchSheet({
  open,
  onClose,
  onStationOpen,
  onTripSelect,
  selectedTripKey,
  initialMode = "search",
  anchorPickMode = null,
  onAnchorPicked,
  presetTrip = null,
  walkFromRoute = null,
  walkToRoute = null,
  walkRouteError = false,
  onRetryWalkRoutes,
  focusedLegIndex = null,
  onFocusLeg,
  onWalkOnlyChange,
  onExpandedPlanChange,
}: Props) {
  const lines = useLines();
  const data = useTrains();
  const { has, toggle } = useFavorites();
  const {
    recents,
    addStation: addRecentStation,
    addPlace: addRecentPlace,
    clear: clearRecents,
  } = useRecentSearches();
  const {
    home,
    work,
    assignAnchor,
    assignAnchorAddress,
  } = useCommute();

  // Mode: which pane is showing. Defaults from `initialMode` so the
  // rider lands wherever the entry point dropped them (Search for the
  // header search button, Directions for the Going-to-Work "See all
  // routes" CTA). Flips back to `initialMode` on close so re-opening
  // is consistent with how it was opened.
  const [mode, setMode] = useState<"search" | "directions">(initialMode);
  // Expanded route detail. When set, the directions pane swaps the
  // plan list for an A→Z detail view (walk steps + subway legs +
  // walk steps) with a Back button. Single trip plan instead of a
  // tripKey because the row's onSelect already has the plan in hand
  // — no need to round-trip through the parent.
  const [expandedPlan, setExpandedPlan] = useState<TripPlan | null>(null);
  // Expanded walking-only detail. Mirrors `expandedPlan` but for the
  // walk-is-fastest path: when set, the directions pane swaps the
  // recommendation card for a turn-by-turn timeline. Boolean rather
  // than a captured route because the resolved walk lives in
  // `walkOnlyRoute` already and refreshes on endpoint change.
  const [walkDetailOpen, setWalkDetailOpen] = useState(false);
  // Tick that bumps when the rider taps the refresh button. Forces
  // tripPlans / arrivals to recompute even if the live feed hasn't
  // produced a new arrivals timestamp yet (it polls every 8s but a
  // rider may want fresher numbers right now). Brief spin animation
  // on the icon for tactile feedback.
  const [refreshTick, setRefreshTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // Search-mode state. Stations come from the in-memory index; places
  // come from a debounced Mapbox geocoder so a rider can type an
  // address into the same search bar and see both kinds of results
  // mixed — Apple Maps' single-search pattern.
  const [query, setQuery] = useState("");
  const [searchPlaceResults, setSearchPlaceResults] = useState<Suggestion[]>([]);
  // True after the geocode proxy has failed for the current query.
  // Reset whenever the query changes or the user switches modes so a
  // transient outage doesn't leave a stale notice on screen. We track
  // this separately from "results === []" so the UI can distinguish
  // "no matches for this string" from "address search itself is down"
  // — see lib/geocoding.ts makeDebouncedSuggester for context.
  const [searchPlaceError, setSearchPlaceError] = useState(false);

  // Directions-mode state. Endpoint type is a station-with-optional-
  // address-metadata so the field can show an address label while
  // routing keeps using a real StationEntry.
  const [tripFrom, setTripFrom] = useState<TripEndpoint | null>(null);
  const [tripTo, setTripTo] = useState<TripEndpoint | null>(null);
  // null = neither field is the active input. Used when both
  // endpoints arrive pre-filled (e.g. via the compass "directions to
  // here" shortcut from a station search result) so the input
  // doesn't auto-focus and pop the keyboard before plans render.
  const [activeField, setActiveField] = useState<"from" | "to" | null>("from");
  const [plannerQuery, setPlannerQuery] = useState("");
  const [plannerPlaceResults, setPlannerPlaceResults] = useState<Suggestion[]>([]);
  const [plannerPlaceError, setPlannerPlaceError] = useState(false);

  // Read-only geo (no permission prompt) for proximity-biased
  // geocoding. The NearbyPanel mounts useGeolocation on its open
  // state, so by the time a rider has been in the app long enough
  // to plan a trip, we usually have a location to bias by.
  const geo = useGeolocationState();

  const index = useMemo(() => (lines ? buildStationIndex(lines) : []), [lines]);

  const stationsByComplexId = useMemo(() => {
    const m = new Map<string, StationEntry>();
    for (const s of index) m.set(s.stopId, s);
    return m;
  }, [index]);

  // Top three nearest complexes for the search empty-state "Nearby
  // stations" section. Recomputed only when the rider's read-only
  // location materially moves — the index itself is large but stable.
  // Empty when geo isn't resolved yet; the section short-circuits in
  // that case so first-time visitors don't see a flash of an empty
  // header before the geolocation permission resolves.
  const nearbyStations = useMemo(() => {
    if (geo.lat == null || geo.lng == null || index.length === 0) return [];
    return nearestStations(index, geo.lng, geo.lat, 3);
  }, [geo.lat, geo.lng, index]);

  // Wall-clock tick for live countdowns + catch verdicts. Pause
  // entirely when the sheet is closed.
  const now = useNow(open);

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

  // Bucket arrivals by canonical complex stopId so search-result rows
  // and trip-plan rows can both look up arrivals by the station they
  // represent without iterating the full feed.
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

  // Per-trip last-reported VehiclePosition timestamp, threaded into
  // each TripPlanRow so the row can flip its leg-1 ETA chips amber
  // when the train hasn't reported in 90 s+ — same idiom as
  // StationPanel's ArrivalRow staleness chrome. Trips that show up in
  // stop_time_updates without a paired VehiclePosition get no entry,
  // so by definition their predictions are as fresh as the latest
  // poll and the row stays calm.
  const lastReportedByTripId = useMemo(() => {
    const m = new Map<string, number | undefined>();
    if (!data) return m;
    for (const t of data.trains) m.set(t.id, t.lastReportedAt);
    return m;
  }, [data]);
  const generatedAtSec = data ? data.generatedAt / 1000 : 0;

  // Reset state when sheet closes so re-opening lands clean. Mode
  // resets to whatever the entry point requested (initialMode), not a
  // hardcoded "search" — so opening via "See all routes" repeatedly
  // keeps landing in directions. Also clear From/To so a stale prior
  // trip doesn't show up the next time the rider opens directions.
  // setState-in-effect is the right tool for resetting many slices
  // off a single prop flip; the alternative (track-prev-prop in
  // render) would mean writing 8 setState calls during render.
  useEffect(() => {
    if (!open) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setMode(initialMode);
      setQuery("");
      setPlannerQuery("");
      setSearchPlaceResults([]);
      setTripFrom(null);
      setTripTo(null);
      setActiveField("from");
      setExpandedPlan(null);
      setWalkDetailOpen(false);
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [open, initialMode]);

  // When the sheet is already mounted and the parent flips
  // initialMode (rider tapped "See all routes" while sheet was
  // briefly closed and re-opened), sync the mode without waiting
  // for a close cycle.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional one-way mode sync; depending on `open` would refire on every toggle.
    if (open) setMode(initialMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMode]);

  // Resolve a CommuteEndpoint into a TripEndpoint for the planner fields.
  // Station endpoints map directly; address endpoints resolve to the nearest
  // station but keep the address label + coords as metadata so the field
  // shows the saved name and walk legs route from the real coordinates.
  const endpointToTrip = useMemo(
    () =>
      (ep: CommuteEndpoint | null): TripEndpoint | null => {
        if (!ep) return null;
        if (ep.kind === "station") {
          return stationsByComplexId.get(ep.stopId) ?? null;
        }
        const nearest = nearestStations(index, ep.lng, ep.lat, 1)[0];
        if (!nearest) return null;
        const place: Place = {
          id: `addr:${ep.name}`,
          name: ep.name,
          context: "",
          lng: ep.lng,
          lat: ep.lat,
        };
        return { ...nearest, displayName: ep.name, address: place };
      },
    [stationsByComplexId, index],
  );

  // First-time entry into directions: prefill From with Home and To
  // with Work if those anchors are set. Saves the rider the typing
  // for the most common "what's a non-direct version of my commute"
  // case. Doesn't override values the rider has already chosen.
  // Skipped entirely when a presetTrip supplies both sides — the
  // parent explicitly controls From/To in that path. A partial
  // presetTrip (e.g. just `to`) lets this effect fill the missing
  // side from the rider's anchors so the StationPanel "Directions"
  // hand-off doesn't strand the From field empty when Home is set.
  useEffect(() => {
    if (mode !== "directions") return;
    if (presetTrip?.from && presetTrip?.to) return;
    if (tripFrom && tripTo) return;
    const h = endpointToTrip(home);
    const w = endpointToTrip(work);
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!tripFrom && !presetTrip?.from && h) setTripFrom(h);
    if (!tripTo && !presetTrip?.to && w) setTripTo(w);
    // Land focus on whichever side is still empty so a single tap
    // brings up the search picker. Null when both pre-filled — plans
    // render straight away rather than popping the keyboard.
    const fromFilled = tripFrom || presetTrip?.from || h;
    const toFilled = tripTo || presetTrip?.to || w;
    setActiveField(!fromFilled ? "from" : !toFilled ? "to" : null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [mode, home, work, endpointToTrip, tripFrom, tripTo, presetTrip]);

  // Apply presetTrip on open / preset-change. Runs whenever the
  // preset reference changes, which the parent toggles per "See all
  // routes" tap, so successive taps land cleanly with current
  // location and the right destination.
  useEffect(() => {
    if (!open || !presetTrip) return;
    const resolveEndpoint = (
      ep: NonNullable<NonNullable<typeof presetTrip>["from"]>,
    ): TripEndpoint | null => {
      if (ep.kind === "station") {
        return stationsByComplexId.get(ep.stopId) ?? null;
      }
      const nearest = nearestStations(index, ep.lng, ep.lat, 1)[0];
      if (!nearest) return null;
      return {
        ...nearest,
        displayName: ep.name,
        address: {
          id: `preset:${ep.name}`,
          name: ep.name,
          context: "",
          lng: ep.lng,
          lat: ep.lat,
        },
      };
    };
    const f = presetTrip.from ? resolveEndpoint(presetTrip.from) : null;
    const t = presetTrip.to ? resolveEndpoint(presetTrip.to) : null;
    /* eslint-disable react-hooks/set-state-in-effect */
    if (f) setTripFrom(f);
    if (t) setTripTo(t);
    setActiveField(null);
    setMode("directions");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, presetTrip, stationsByComplexId, index]);

  // ── Search-mode results.
  const searchResults = useMemo<(StationEntry & { meters?: number })[] | null>(
    () => {
      if (mode !== "search") return null;
      const q = query.trim();
      if (q.length < 2) return null;
      return searchStations(index, q, 30);
    },
    [mode, query, index],
  );

  // ── Directions-mode plans, time-ranked.
  // When an endpoint is an address we expand candidates to every
  // station within ~700m so the planner doesn't lock onto a single
  // nearest station and miss alternates. Classic example: an address
  // at 60th & Lex is closest to both 5Av/59 (N/R/W) and Lex/59
  // (4/5/6); locking onto one buries direct routes via the other.
  // The expansion + path-aware dedup in planTrips together produce a
  // diverse plan list. Per-plan walks are computed via address
  // anchors so each plan's timing reflects its actual board/alight
  // station, not the original anchor's station.
  const NEAR_RADIUS_M = 700;
  const tripPlans = useMemo(() => {
    if (mode !== "directions" || !tripFrom || !tripTo || !lines) return [];
    const fromStopIds = tripFrom.address
      ? Array.from(
          new Set(
            nearestStationsWithin(
              index,
              tripFrom.address.lng,
              tripFrom.address.lat,
              NEAR_RADIUS_M,
            ).flatMap((s) => s.stopIds),
          ),
        )
      : tripFrom.stopIds;
    const toStopIds = tripTo.address
      ? Array.from(
          new Set(
            nearestStationsWithin(
              index,
              tripTo.address.lng,
              tripTo.address.lat,
              NEAR_RADIUS_M,
            ).flatMap((s) => s.stopIds),
          ),
        )
      : tripTo.stopIds;
    const raw = planTrips(lines, index, fromStopIds, toStopIds, {
      maxResults: 12,
    });
    return rankPlansByTime(raw, {
      arrivalsByStation,
      nowSec: now / 1000,
      walkFromAnchor: tripFrom.address
        ? { lng: tripFrom.address.lng, lat: tripFrom.address.lat }
        : undefined,
      walkToAnchor: tripTo.address
        ? { lng: tripTo.address.lng, lat: tripTo.address.lat }
        : undefined,
      stationsByComplexId,
      // Fallback constants for non-address endpoints.
      walkFromMeters: 0,
      walkToMeters: 0,
    }).slice(0, 6);
  }, [
    mode,
    tripFrom,
    tripTo,
    lines,
    index,
    arrivalsByStation,
    now,
    stationsByComplexId,
  ]);

  // ── Walk-vs-subway: when the destination is close enough that
  // walking the whole way is at least as fast as the best subway
  // plan, surface walking as the primary recommendation. Subway
  // plans get hidden so a 2-block trip doesn't pretend the L train
  // is the answer. Distance is haversine; time uses the same
  // pedestrian model as the rest of the app (walkMinutes), so it's
  // directly comparable to the per-plan walk legs we already show.
  const directWalk = useMemo(() => {
    if (mode !== "directions" || !tripFrom || !tripTo) return null;
    // For address picks `tripFrom.lat/lng` are the *nearest station's*
    // coordinates (TripEndpoint extends StationEntry); the rider's
    // actual address sits in `tripFrom.address`. Falling back to the
    // station coords would compute the walk between the two boarding
    // platforms instead of door-to-door, which can flip the
    // walk-vs-subway verdict for trips where the addresses are close
    // but the nearest stations are blocks apart in opposite directions.
    const fromLat = tripFrom.address?.lat ?? tripFrom.lat;
    const fromLng = tripFrom.address?.lng ?? tripFrom.lng;
    const toLat = tripTo.address?.lat ?? tripTo.lat;
    const toLng = tripTo.address?.lng ?? tripTo.lng;
    const meters = haversineMeters(
      { lat: fromLat, lng: fromLng },
      { lat: toLat, lng: toLng },
    );
    return { meters, min: walkMinutes(meters) };
  }, [mode, tripFrom, tripTo]);

  // Fastest subway plan total time (minutes), using the same
  // estimator that ranks the plan list. Null when there are no
  // plans — the walk comparison treats that as "subway loses by
  // default."
  const fastestPlanMin = useMemo(() => {
    if (tripPlans.length === 0) return null;
    const sec = estimateTripTimeSec(tripPlans[0], {
      arrivalsByStation,
      nowSec: now / 1000,
      walkFromAnchor: tripFrom?.address
        ? { lng: tripFrom.address.lng, lat: tripFrom.address.lat }
        : undefined,
      walkToAnchor: tripTo?.address
        ? { lng: tripTo.address.lng, lat: tripTo.address.lat }
        : undefined,
      stationsByComplexId,
    });
    return Math.max(1, Math.round(sec / 60));
  }, [tripPlans, arrivalsByStation, now, tripFrom, tripTo, stationsByComplexId]);

  // Walking wins when we have a direct walk estimate AND it's no
  // longer than the fastest subway plan. We also surface walking
  // when there are zero subway plans but the walk is reasonable
  // (under ~45 min) — otherwise a same-borough cross-river trip
  // with no direct subway would suggest a 2-hour walk, which isn't
  // useful. The 45-min ceiling is a soft "actually walkable"
  // threshold rather than a hard cap on what we display.
  const walkIsBest =
    directWalk !== null &&
    (fastestPlanMin === null
      ? directWalk.min <= 45
      : directWalk.min <= fastestPlanMin);

  // Resolved street-following walking route for the walk-only
  // recommendation. Fetched eagerly when walking wins so the dashed
  // line shows up on the map at the same time as the card — no
  // tap-to-expand required. Reset on endpoint change.
  const [walkOnlyRoute, setWalkOnlyRoute] = useState<WalkingRoute | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing the resolved walk route when endpoints change keeps stale geometry off the map until the new fetch lands.
    setWalkOnlyRoute(null);
    // A fresh trip means the walk-detail view (if any) was rendering
    // steps for the previous endpoints; close it so the rider doesn't
    // see stale instructions during the refetch.
    setWalkDetailOpen(false);
  }, [tripFrom, tripTo]);

  useEffect(() => {
    if (!walkIsBest || !tripFrom || !tripTo) return;
    if (walkOnlyRoute) return;
    const ctrl = new AbortController();
    fetchWalkingRoute(
      { lng: tripFrom.lng, lat: tripFrom.lat },
      { lng: tripTo.lng, lat: tripTo.lat },
      { signal: ctrl.signal },
    )
      .then((r) => {
        if (ctrl.signal.aborted) return;
        setWalkOnlyRoute(r);
      })
      .catch(() => {});
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walkIsBest, tripFrom, tripTo]);

  // Push the walking-faster overlay up to the parent so MapView can
  // render the pedestrian line. Use the resolved street geometry when
  // available; otherwise the from/to pair anchors a crow-flies
  // fallback rendered by MapView. Clear when walking is no longer the
  // pick (e.g. rider switched destinations to one with subway, or the
  // sheet leaves directions mode).
  useEffect(() => {
    if (!onWalkOnlyChange) return;
    if (walkIsBest && tripFrom && tripTo) {
      onWalkOnlyChange({
        from: { lng: tripFrom.lng, lat: tripFrom.lat },
        to: { lng: tripTo.lng, lat: tripTo.lat },
        coords: walkOnlyRoute?.coordinates,
      });
    } else {
      onWalkOnlyChange(null);
    }
    return () => {
      onWalkOnlyChange(null);
    };
  }, [walkIsBest, tripFrom, tripTo, walkOnlyRoute, onWalkOnlyChange]);

  // Mirror the expandedPlan flag up to the parent so MapView can
  // pad its trip-fit camera differently based on which detent the
  // sheet is in (plan list ≈60dvh vs detail ≈38dvh).
  useEffect(() => {
    onExpandedPlanChange?.(!!expandedPlan);
    return () => {
      onExpandedPlanChange?.(false);
    };
  }, [expandedPlan, onExpandedPlanChange]);

  // Auto-select the fastest plan whenever a fresh ranked list arrives
  // and nothing is currently selected. The rider almost always wants
  // to see the top result on the map without an extra tap, and the
  // ranked plans are sorted by total time — so tripPlans[0] is the
  // pick. We deliberately don't override a selection the rider has
  // already made (e.g. tapped the second-fastest); that selection
  // sticks until the trip pair changes (which clears tripPlans and
  // brings us back through this effect with no selection).
  //
  // Gate on `open` because closing the sheet clears the parent's
  // `selectedTripSelection` (so `selectedTripKey` flips to null) while
  // the local `tripPlans` memo is still populated — without this
  // guard the effect would re-fire after onClose and re-select the
  // top plan, repainting the route the rider just dismissed.
  useEffect(() => {
    if (!open) return;
    if (mode !== "directions") return;
    if (!onTripSelect || selectedTripKey || tripPlans.length === 0) return;
    const plan = tripPlans[0];
    onTripSelect({
      plan,
      walkFrom: tripFrom?.address
        ? {
            lng: tripFrom.address.lng,
            lat: tripFrom.address.lat,
            name: tripFrom.address.name,
          }
        : undefined,
      walkTo: tripTo?.address
        ? {
            lng: tripTo.address.lng,
            lat: tripTo.address.lat,
            name: tripTo.address.name,
          }
        : undefined,
    });
  }, [open, mode, tripPlans, selectedTripKey, onTripSelect, tripFrom, tripTo]);

  // ── Picker results (when a directions field needs filling).
  const plannerSearchResults = useMemo<StationEntry[] | null>(() => {
    if (mode !== "directions") return null;
    const q = plannerQuery.trim();
    if (q.length < 2) return null;
    return searchStations(index, q, 30);
  }, [mode, plannerQuery, index]);

  // Debounced suggester so an autocomplete that fires on every
  // keystroke doesn't slam the Mapbox API. One instance per mount;
  // useMemo with empty deps so the same closure persists across
  // renders.
  const debouncedSuggester = useMemo(() => makeDebouncedSuggester(250), []);

  // Kick the geocoder when the planner query changes. The result
  // arrives async via setPlannerPlaceResults. Debounced async search
  // is a textbook effect; the synchronous reset clears stale results
  // when the rider switches modes / clears the field.
  useEffect(() => {
    if (mode !== "directions") {
      /* eslint-disable react-hooks/set-state-in-effect */
      setPlannerPlaceResults([]);
      setPlannerPlaceError(false);
      /* eslint-enable react-hooks/set-state-in-effect */
      return;
    }
    const q = plannerQuery.trim();
    setPlannerPlaceError(false);
    if (q.length < 2) {
      setPlannerPlaceResults([]);
      return;
    }
    debouncedSuggester(
      q,
      geo.lat != null && geo.lng != null
        ? { proximity: { lng: geo.lng, lat: geo.lat }, limit: 10 }
        : { limit: 10 },
      setPlannerPlaceResults,
      () => setPlannerPlaceError(true),
    );
  }, [mode, plannerQuery, debouncedSuggester, geo.lat, geo.lng]);

  // Same idea for Search mode: as the rider types into the top-level
  // search bar, fire the debounced geocoder so addresses, neighborhoods,
  // and POIs surface alongside station hits. One shared geocoder
  // instance — the debounce window means consecutive keystrokes
  // collapse into a single API call.
  useEffect(() => {
    if (mode !== "search") {
      /* eslint-disable react-hooks/set-state-in-effect */
      setSearchPlaceResults([]);
      setSearchPlaceError(false);
      /* eslint-enable react-hooks/set-state-in-effect */
      return;
    }
    const q = query.trim();
    setSearchPlaceError(false);
    if (q.length < 2) {
      setSearchPlaceResults([]);
      return;
    }
    debouncedSuggester(
      q,
      geo.lat != null && geo.lng != null
        ? { proximity: { lng: geo.lng, lat: geo.lat }, limit: 10 }
        : { limit: 10 },
      setSearchPlaceResults,
      () => setSearchPlaceError(true),
    );
  }, [mode, query, debouncedSuggester, geo.lat, geo.lng]);

  // Resolve a Suggestion to a Place + nearest station. Called on tap
  // (not on every keystroke) — `/retrieve` is what fills in the
  // coordinates the suggest endpoint deliberately omits.
  const resolveSuggestion = async (
    suggestion: Suggestion,
  ): Promise<{ place: Place; nearest: StationEntry & { meters: number } } | null> => {
    try {
      const place = await retrievePlace(suggestion);
      if (!place) return null;
      const nearest = nearestStations(index, place.lng, place.lat, 1)[0];
      if (!nearest) return null;
      return { place, nearest };
    } catch {
      return null;
    }
  };

  // Unified "directions to here from current location" handoff used
  // by every result row in Search mode. The compass on a station, the
  // tap on a place — both end here. Origin defaults to the rider's
  // nearest station tagged as "Current location"; if geo isn't
  // available the From field stays empty and gets focus so the rider
  // can fill it manually. Picks are recorded in recent searches so
  // they surface in the empty state next time.
  const startDirectionsTo = (destination: TripEndpoint) => {
    if (destination.address) {
      addRecentPlace({
        id: destination.address.id,
        name: destination.address.name,
        context: destination.address.context,
        lng: destination.address.lng,
        lat: destination.address.lat,
      });
    } else {
      addRecentStation(destination.stopId, destination.name);
    }
    setMode("directions");
    setQuery("");
    setPlannerQuery("");
    setSearchPlaceResults([]);
    let nextFrom: TripEndpoint | null = null;
    if (geo.lat != null && geo.lng != null) {
      const nearestFrom = nearestStations(index, geo.lng, geo.lat, 1)[0];
      if (nearestFrom) {
        nextFrom = {
          ...nearestFrom,
          displayName: "Current location",
          address: {
            id: "current-location",
            name: "Current location",
            context: "",
            lng: geo.lng,
            lat: geo.lat,
          },
        };
      }
    }
    setTripFrom(nextFrom);
    setTripTo(destination);
    setActiveField(nextFrom ? null : "from");
  };

  const swapTrip = () => {
    setTripFrom(tripTo);
    setTripTo(tripFrom);
  };

  const pickPlannerStation = (s: StationEntry) => {
    // Plain station pick — no displayName / address attached, the
    // field will render station.name as before.
    const ep = s as TripEndpoint;
    if (activeField === "from") {
      setTripFrom(ep);
      // Auto-advance to the still-empty side, or null when both are
      // now filled (plans render without re-popping a keyboard).
      setActiveField(!tripTo ? "to" : null);
    } else {
      setTripTo(ep);
      setActiveField(!tripFrom ? "from" : null);
    }
    setPlannerQuery("");
  };

  const pickPlannerPlace = (place: Place, nearest: StationEntry) => {
    // Address pick — wrap the nearest station with the address as
    // displayName + address metadata so the field shows the address
    // text and the trip planner still routes from a real station.
    const ep: TripEndpoint = {
      ...nearest,
      displayName: place.name,
      address: place,
    };
    if (activeField === "from") {
      setTripFrom(ep);
      setActiveField(!tripTo ? "to" : null);
    } else {
      setTripTo(ep);
      setActiveField(!tripFrom ? "from" : null);
    }
    setPlannerQuery("");
    setPlannerPlaceResults([]);
  };

  // Shared sheet drag with half/full detents. Drag-to-dismiss is
  // disabled here: a small downward pull would otherwise close the
  // sheet AND wipe the rider's in-progress search (mode reset, From/To
  // cleared) which is destructive. The X button remains the explicit
  // dismiss; drag only cycles between half and full detents.
  //
  // The half-detent visible portion shrinks when viewing the A→Z
  // route detail — at that point the rider mostly cares about seeing
  // the rendered route on the map, so a 60dvh panel covers more of
  // the trip than they want. Drop to ~38dvh (matching NearbyPanel) so
  // the map dominates while detail steps are still glanceable. The
  // walk-only detail view inherits the same treatment for the same
  // reason: the dashed route on the map is the primary content, the
  // step list is supporting context.
  //
  // The plan-list view sits at 48dvh (was 60). The taller panel was
  // covering the southern end of routes that span much of NYC — the
  // rider would tap a plan, see only the top half of the trip
  // rendered, and have to drag the sheet down before the destination
  // pin came into view. 48dvh leaves enough vertical room to render a
  // full city-spanning route with both endpoints visible while still
  // showing 3-4 plan rows above the fold. Drag-up to "full" remains
  // available for riders who want the whole list at once.
  const halfVisibleDvh = expandedPlan || walkDetailOpen ? 38 : 48;
  const { detent, sheetStyle, handlers, contentHandlers, onHandleTap, setDetent, isDragging } = useSheetDrag({
    halfRestingY: `calc(100dvh - var(--panel-top-rest) - ${halfVisibleDvh}dvh)`,
    open,
    onDismiss: onClose,
    dismissOnDrag: false,
  });

  // When opening directly into directions mode (via "See all routes"
  // from NearbyPanel), default to the full detent so the rider sees
  // every plan without having to drag the sheet up. The hook's own
  // close-effect resets to "half" so this only fires on (re)open
  // while initialMode says directions.
  useEffect(() => {
    if (open && initialMode === "directions") {
      setDetent("full");
    }
  }, [open, initialMode, setDetent]);

  // Walk-detail view is a "supporting" panel — the dashed route on
  // the map carries the primary information, so we collapse to the
  // half detent when the rider opens it. Mirrors how a tap on a trip
  // plan in the list pulls the sheet down to make room for the route.
  useEffect(() => {
    if (walkDetailOpen) setDetent("half");
  }, [walkDetailOpen, setDetent]);

  if (!open) return null;

  // Picker is "active" whenever the rider has typed enough into the
  // active field's inline input to trigger results. Plans only render
  // when the field is quiet AND both endpoints are filled.
  const plannerPicking =
    mode === "directions" && plannerQuery.trim().length >= 2;

  return (
    <div
      className="
        absolute z-20 overflow-hidden flex flex-col
        inset-x-0 bottom-0 top-[var(--panel-top-rest)] rounded-t-[28px] border-t border-white/[0.08]
        sm:inset-auto sm:right-3 sm:top-[var(--panel-top-rest)] sm:bottom-3 sm:w-[340px] sm:h-auto sm:rounded-[22px] sm:border sm:border-white/[0.08]
        ios-glass ios-glass--sheet
        shadow-[0_20px_60px_-10px_rgba(0,0,0,0.6)]
        pb-[env(safe-area-inset-bottom)]
      "
      style={sheetStyle}
      data-glass-active={isDragging || undefined}
    >
      {/* Drag handle — separate flow row above the title row so it
          gets a proper tap target (h-7 = 28px) for the tap-to-toggle
          gesture. Visual rhythm matches NearbyPanel / StationPanel /
          LinePanel. */}
      <button
        type="button"
        className="sm:hidden flex items-start justify-center h-7 pt-1.5 flex-shrink-0 touch-none w-full"
        onClick={onHandleTap}
        aria-label={detent === "half" ? "Expand panel" : "Collapse panel"}
      >
        <div className="w-9 h-[5px] rounded-full bg-white/25" />
      </button>

      {/* Title row — drag-zone for the panel. */}
      <div
        className="relative flex items-center justify-between px-4 pt-1.5 pb-2 flex-shrink-0 sm:cursor-auto cursor-grab active:cursor-grabbing touch-none sm:pt-2"
        onPointerDown={handlers.onPointerDown}
        onPointerMove={handlers.onPointerMove}
        onPointerUp={handlers.onPointerUp}
        onPointerCancel={handlers.onPointerCancel}
      >
        <div className="flex items-center gap-2 text-white min-w-0">
          {mode === "directions" && (
            // Back-to-search arrow. The segmented control is gone
            // (Search and Directions aren't peer tabs anymore — Search
            // is the entry surface; Directions is what you get when
            // you tap the compass on a result), so the rider needs
            // an explicit back affordance to return to the search
            // list without dismissing the whole sheet.
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                // Step back one screen at a time: from the expanded
                // A→Z detail view, the first tap drops back to the
                // plan list (keeping the search context); a second
                // tap (now in plan-list view) returns to Search
                // mode and clears the trip overlay. Mirrors how iOS
                // treats stacked sheets — closer to user intent than
                // a single tap that wipes everything.
                if (expandedPlan) {
                  setExpandedPlan(null);
                  onFocusLeg?.(null);
                  return;
                }
                if (walkDetailOpen) {
                  setWalkDetailOpen(false);
                  return;
                }
                setMode("search");
                setPlannerQuery("");
                setPlannerPlaceResults([]);
                onTripSelect?.(null);
              }}
              aria-label={
                expandedPlan
                  ? "Back to route options"
                  : walkDetailOpen
                    ? "Back to route options"
                    : "Back to search"
              }
              className="press w-8 h-8 -ml-1 flex items-center justify-center rounded-full bg-white/[0.08] hover:bg-white/[0.14] touch-manipulation flex-shrink-0"
            >
              <ArrowLeft className="w-[16px] h-[16px]" strokeWidth={2.5} />
            </button>
          )}
          {mode === "search" ? (
            <Search className="w-[17px] h-[17px]" />
          ) : (
            <Compass className="w-[17px] h-[17px]" />
          )}
          <span className="font-black text-[16px] tracking-tight truncate">
            {mode === "search"
              ? "Search"
              : expandedPlan
                ? "Route details"
                : walkDetailOpen
                  ? "Walking directions"
                  : "Directions"}
          </span>
        </div>
        <button
          onClick={onClose}
          className="press text-white opacity-85 hover:opacity-100 w-9 h-9 -mr-1 flex items-center justify-center rounded-full bg-white/[0.08] hover:bg-white/[0.12] touch-manipulation flex-shrink-0"
          aria-label="Close panel"
        >
          <X className="w-[16px] h-[16px]" strokeWidth={2.5} />
        </button>
      </div>

      {/* ── Mode-specific input row ───────────────────────────────── */}
      {mode === "search" ? (
        <div className="px-3 pb-2.5 flex-shrink-0 border-b border-white/[0.06]">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Where are you going?"
              aria-label="Search NYC"
              // 16px font-size prevents iOS Safari from auto-zooming
              // on focus. Below that threshold Safari zooms the page
              // to make text legible, then doesn't always cleanly
              // reset on blur — leaving the top floating UI shifted
              // behind the Dynamic Island. Same constraint applies
              // to every other input in the app.
              className="w-full h-11 pl-10 pr-10 rounded-xl bg-white/[0.08] border border-white/[0.06] text-[16px] text-gray-50 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-white/25 focus:border-transparent transition-shadow"
              autoFocus
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
      ) : expandedPlan || walkDetailOpen ? null : (
        <div className="px-3 pb-2.5 flex-shrink-0 border-b border-white/[0.06]">
          {/* Inline search: the active field IS the input. Tapping
              an inactive field activates it, focuses an embedded
              input, and search results appear in the scroll area
              below. No separate search bar — the field is the bar.
              When the endpoint is an address (TripEndpoint with a
              displayName), shadow `name` with displayName so the
              field shows "123 Main St" instead of the underlying
              station's name.

              Suppressed when the rider is inside a specific route's
              detail view: the previous screen already showed From/To
              prominently and TripPlanDetail re-states them as the
              "Walk to <board>" / "Walk to <destination>" rows, so
              keeping the editable fields here just steals vertical
              space from the timeline. The header back button is the
              way back to the list (where the fields live). */}
          <div className="relative flex gap-2">
            <div className="flex-1 min-w-0 space-y-1.5">
              <PlannerField
                label="From"
                station={
                  tripFrom
                    ? { ...tripFrom, name: tripFrom.displayName ?? tripFrom.name }
                    : null
                }
                active={activeField === "from"}
                query={activeField === "from" ? plannerQuery : ""}
                onQueryChange={setPlannerQuery}
                placeholder="Search start"
                accent="emerald"
                onTap={() => {
                  setActiveField("from");
                  setPlannerQuery("");
                }}
                onClear={() => {
                  setTripFrom(null);
                  setActiveField("from");
                  setPlannerQuery("");
                  // The selected route is invalid the moment an
                  // endpoint changes — drop the overlay so the
                  // rider isn't seeing a stale path on the map.
                  onTripSelect?.(null);
                  setExpandedPlan(null);
                }}
              />
              <PlannerField
                label="To"
                station={
                  tripTo
                    ? { ...tripTo, name: tripTo.displayName ?? tripTo.name }
                    : null
                }
                active={activeField === "to"}
                query={activeField === "to" ? plannerQuery : ""}
                onQueryChange={setPlannerQuery}
                placeholder="Search destination"
                accent="sky"
                onTap={() => {
                  setActiveField("to");
                  setPlannerQuery("");
                }}
                onClear={() => {
                  setTripTo(null);
                  setActiveField("to");
                  setPlannerQuery("");
                  onTripSelect?.(null);
                  setExpandedPlan(null);
                }}
              />
            </div>
            <button
              type="button"
              onClick={swapTrip}
              aria-label="Swap from and to"
              disabled={!tripFrom && !tripTo}
              className="press w-9 h-9 self-center flex items-center justify-center rounded-full bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.08] text-gray-100 disabled:opacity-40 disabled:pointer-events-none touch-manipulation flex-shrink-0"
            >
              <ArrowLeftRight className="w-4 h-4 rotate-90" />
            </button>
          </div>
        </div>
      )}

      {/* Anchor-pick mode banner. Renders above the scroll content so
          the rider can never miss the goal: "tap any result and that's
          your Home / Work." Tinted to match the anchor's accent (emerald
          for Home, sky for Work) and dismissible by closing the sheet. */}
      {anchorPickMode && (
        <div
          className={`mx-3 mb-2 mt-1 px-3 py-2 rounded-xl text-[12px] flex items-center gap-2 ${
            anchorPickMode === "home"
              ? "bg-emerald-500/15 text-emerald-100 ring-1 ring-emerald-500/30"
              : "bg-sky-500/15 text-sky-100 ring-1 ring-sky-500/30"
          }`}
        >
          {anchorPickMode === "home" ? (
            <Home className="w-3.5 h-3.5 flex-shrink-0" />
          ) : (
            <Briefcase className="w-3.5 h-3.5 flex-shrink-0" />
          )}
          <span className="font-semibold">
            Tap any result to set as{" "}
            {anchorPickMode === "home" ? "Home" : "Work"}.
          </span>
        </div>
      )}

      {/* ── Mode-specific scroll content ──────────────────────────── */}
      <div
        className="flex-1 overflow-y-auto ios-scroll"
        // At half detent the sheet's hidden portion lives below
        // viewport. Pad enough that the last item is reachable by
        // scrolling without first dragging the sheet up. The padding
        // grows when expanded route detail is showing because the
        // half-detent shrinks (more sheet hangs below viewport).
        style={{
          paddingBottom: `calc(${88 - halfVisibleDvh}dvh + 1rem + env(safe-area-inset-bottom))`,
        }}
        // Mirror iOS native "scroll to dismiss keyboard": as soon as
        // the rider drags the results, blur the focused input so the
        // keyboard collapses and the full list becomes visible. Tap
        // gestures alone don't fire touchmove, so this only triggers
        // on actual scrolls. blur() is idempotent — repeated calls
        // during a drag are harmless. Then hand off to the hook's
        // content gesture handlers so a top-of-list pull also drives
        // detent changes.
        onTouchStart={contentHandlers.onTouchStart}
        onTouchMove={(e) => {
          const el = document.activeElement;
          if (
            el instanceof HTMLElement &&
            (el.tagName === "INPUT" || el.tagName === "TEXTAREA")
          ) {
            el.blur();
          }
          contentHandlers.onTouchMove(e);
        }}
        onTouchEnd={contentHandlers.onTouchEnd}
        onTouchCancel={contentHandlers.onTouchCancel}
      >
        {mode === "search" ? (
          searchResults === null && searchPlaceResults.length === 0 ? (
            // Empty + idle state. Three sections, all rendered as
            // flat row lists so the rider gets a uniform Apple-Maps-
            // style scan: Favorites (Commute / Home / Work) → Nearby
            // stations → Recent. The previous layout fought for
            // hierarchy — a big Quick-Commute card crowned over two
            // small Home/Work pills crowned over a Recent list, three
            // different visual idioms — even though all three boil
            // down to the same intent ("one-tap shortcut to a place").
            // Flattening them removes the redundancy between the big
            // card (Home→Work as a commute) and the small Home pill
            // (current→Home), and frees vertical space for the new
            // Nearby section which uses the read-only geolocation we
            // already have. Suppressed in anchor-pick mode: the
            // rider is choosing a Home/Work pin, not navigating —
            // none of these "directions to" shortcuts are
            // relevant, and the Commute row would conflict with
            // what they're trying to do.
            <div className="px-3 py-3 space-y-5">
              {!anchorPickMode && (home || work) && (
                <section>
                  <h3 className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                    Favorites
                  </h3>
                  <div className="space-y-1">
                    {/* Commute — only renders when BOTH anchors are
                        set. Tapping plans an explicit Home→Work trip
                        from the rider's current location's nearest
                        station; the Home/Work rows below cover the
                        single-endpoint case. */}
                    {home && work && (() => {
                      const h = endpointToTrip(home);
                      const w = endpointToTrip(work);
                      if (!h || !w) return null;
                      return (
                        <button
                          type="button"
                          onClick={() => {
                            setMode("directions");
                            setQuery("");
                            setSearchPlaceResults([]);
                            setTripFrom(h);
                            setTripTo(w);
                            setActiveField(null);
                          }}
                          className="press w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-left touch-manipulation"
                        >
                          <span className="flex items-center justify-center w-9 h-9 rounded-full bg-emerald-300/15 text-emerald-200 ring-1 ring-emerald-300/30 flex-shrink-0">
                            <Compass className="w-4 h-4" />
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-[13px] font-semibold text-gray-100 truncate">
                              Commute
                            </span>
                            <span className="block text-[11px] text-gray-500 truncate">
                              Home → Work
                            </span>
                          </span>
                          <ChevronRight className="w-4 h-4 text-gray-500 flex-shrink-0" />
                        </button>
                      );
                    })()}
                    {home && (() => {
                      const h = endpointToTrip(home);
                      if (!h) return null;
                      const sub =
                        home.kind === "address"
                          ? home.name
                          : stationsByComplexId.get(home.stopId)?.name ??
                            "Pinned station";
                      return (
                        <button
                          type="button"
                          onClick={() => startDirectionsTo(h)}
                          aria-label="Directions to Home"
                          className="press w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-left touch-manipulation"
                        >
                          <span className="flex items-center justify-center w-9 h-9 rounded-full bg-emerald-300/15 text-emerald-200 ring-1 ring-emerald-300/30 flex-shrink-0">
                            <Home className="w-4 h-4" />
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-[13px] font-semibold text-gray-100 truncate">
                              Home
                            </span>
                            <span className="block text-[11px] text-gray-500 truncate">
                              {sub}
                            </span>
                          </span>
                          <ChevronRight className="w-4 h-4 text-gray-500 flex-shrink-0" />
                        </button>
                      );
                    })()}
                    {work && (() => {
                      const w = endpointToTrip(work);
                      if (!w) return null;
                      const sub =
                        work.kind === "address"
                          ? work.name
                          : stationsByComplexId.get(work.stopId)?.name ??
                            "Pinned station";
                      return (
                        <button
                          type="button"
                          onClick={() => startDirectionsTo(w)}
                          aria-label="Directions to Work"
                          className="press w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-left touch-manipulation"
                        >
                          <span className="flex items-center justify-center w-9 h-9 rounded-full bg-sky-300/15 text-sky-200 ring-1 ring-sky-300/30 flex-shrink-0">
                            <Briefcase className="w-4 h-4" />
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-[13px] font-semibold text-gray-100 truncate">
                              Work
                            </span>
                            <span className="block text-[11px] text-gray-500 truncate">
                              {sub}
                            </span>
                          </span>
                          <ChevronRight className="w-4 h-4 text-gray-500 flex-shrink-0" />
                        </button>
                      );
                    })()}
                  </div>
                </section>
              )}

              {/* Nearby stations — three closest complexes when geo
                  is known. Anchor-pick mode keeps this surface so a
                  rider Setting Home can pin the nearest station with
                  one tap; the underlying StationRow tap handler
                  routes through `assignAnchor` in that mode. */}
              {nearbyStations.length > 0 && (
                <section>
                  <h3 className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                    Nearby stations
                  </h3>
                  <div className="space-y-1">
                    {nearbyStations.map((s) => (
                      <button
                        key={`nearby-${s.stopId}`}
                        type="button"
                        onClick={() => {
                          if (anchorPickMode) {
                            assignAnchor(anchorPickMode, s.stopId);
                            onAnchorPicked?.();
                            return;
                          }
                          onStationOpen(s.stopId);
                        }}
                        className="press w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-left touch-manipulation"
                      >
                        <span className="flex items-center gap-1 flex-shrink-0">
                          {s.routes.slice(0, 3).map((r) => (
                            <RouteBullet
                              key={r.id}
                              id={r.id}
                              color={r.color}
                              textColor={r.textColor}
                            />
                          ))}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-[13px] font-semibold text-gray-100 truncate">
                            {s.name}
                          </span>
                          <span className="block text-[11px] text-gray-500 truncate">
                            {formatWalkSummary(s.meters)}
                          </span>
                        </span>
                        <ChevronRight className="w-4 h-4 text-gray-500 flex-shrink-0" />
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {/* Recent searches — last 10 places the rider tapped
                  on. Each row replays the same "directions to here"
                  flow tapping in the search results would. Section
                  hidden entirely when empty so the empty state stays
                  clean for first-time users. */}
              {recents.length > 0 && (
                <section>
                  <div className="flex items-center justify-between px-2 pb-1.5">
                    <h3 className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                      Recent
                    </h3>
                    <button
                      type="button"
                      onClick={clearRecents}
                      className="press text-[11px] text-gray-500 hover:text-gray-300 touch-manipulation"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="space-y-1">
                    {recents.map((r) => {
                      if (r.kind === "station") {
                        return (
                          <button
                            key={`recent-station-${r.stopId}`}
                            type="button"
                            onClick={() => onStationOpen(r.stopId)}
                            className="press w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-left touch-manipulation"
                          >
                            <span className="w-8 h-8 rounded-full bg-white/[0.08] border border-white/[0.10] flex items-center justify-center flex-shrink-0">
                              <Search className="w-3.5 h-3.5 text-gray-300" />
                            </span>
                            <span className="flex-1 min-w-0">
                              <span className="block text-[13px] font-semibold text-gray-100 truncate">
                                {r.name}
                              </span>
                              <span className="block text-[11px] text-gray-500 truncate">
                                Subway station
                              </span>
                            </span>
                            <ChevronRight className="w-4 h-4 text-gray-500 flex-shrink-0" />
                          </button>
                        );
                      }
                      // Place recent — resolve to the nearest station
                      // for routing.
                      return (
                        <button
                          key={`recent-place-${r.id}`}
                          type="button"
                          onClick={() => {
                            const nearest = nearestStations(
                              index,
                              r.lng,
                              r.lat,
                              1,
                            )[0];
                            if (!nearest) return;
                            startDirectionsTo({
                              ...nearest,
                              displayName: r.name,
                              address: {
                                id: r.id,
                                name: r.name,
                                context: r.context,
                                lng: r.lng,
                                lat: r.lat,
                              },
                            });
                          }}
                          className="press w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-left touch-manipulation"
                        >
                          <span className="w-8 h-8 rounded-full bg-white/[0.08] border border-white/[0.10] flex items-center justify-center flex-shrink-0">
                            <MapPin className="w-3.5 h-3.5 text-gray-300" />
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-[13px] font-semibold text-gray-100 truncate">
                              {r.name}
                            </span>
                            {r.context && (
                              <span className="block text-[11px] text-gray-500 truncate">
                                {r.context}
                              </span>
                            )}
                          </span>
                          <Compass className="w-4 h-4 text-gray-500 flex-shrink-0" />
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}
            </div>
          ) : (searchResults?.length ?? 0) === 0 &&
            searchPlaceResults.length === 0 &&
            !searchPlaceError ? (
            <div className="px-6 py-10 text-center text-sm text-gray-500">
              No stations or places match &ldquo;{query}&rdquo;
            </div>
          ) : (
            <div>
              {searchResults && searchResults.length > 0 && (
                <>
                  <div className="px-4 pt-3 pb-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                    Stations
                  </div>
                  {searchResults.slice(0, 8).map((s) => (
                    <StationRow
                      key={`search-${s.stopId}`}
                      station={s}
                      arrivals={arrivalsByStation.get(s.stopId) ?? []}
                      routeColors={routeColors}
                      now={now}
                      isFavorite={has(s.stopId)}
                      onFavoriteToggle={() => toggle(s.stopId)}
                      // Tapping a station search result opens the
                      // StationPanel for live arrivals — the panel
                      // itself carries a Directions button for riders
                      // who want to navigate there. Matches the map-tap
                      // and Near-me row behaviour so the rider gets a
                      // single, consistent destination when picking a
                      // station, and avoids dropping them into a
                      // directions form when they were just looking up
                      // a station. Anchor-pick mode keeps the one-tap
                      // pin path.
                      onTap={() => {
                        if (anchorPickMode) {
                          assignAnchor(anchorPickMode, s.stopId);
                          onAnchorPicked?.();
                          return;
                        }
                        onStationOpen(s.stopId);
                      }}
                    />
                  ))}
                </>
              )}
              {searchPlaceResults.length > 0 && (
                <>
                  <div className="px-4 pt-3 pb-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                    Places
                  </div>
                  {searchPlaceResults.map((suggestion) => (
                    <div
                      key={`search-suggestion-${suggestion.mapboxId}`}
                      className="flex items-start gap-2 px-4 py-3 border-b border-white/5 hover:bg-white/[0.04]"
                    >
                      <button
                        type="button"
                        onClick={async () => {
                          const resolved = await resolveSuggestion(suggestion);
                          if (!resolved) return;
                          const { place, nearest } = resolved;
                          // Anchor-pick mode: pin this address and
                          // close. No directions side-trip.
                          if (anchorPickMode) {
                            assignAnchorAddress(anchorPickMode, {
                              name: place.name,
                              lng: place.lng,
                              lat: place.lat,
                            });
                            onAnchorPicked?.();
                            return;
                          }
                          startDirectionsTo({
                            ...nearest,
                            displayName: place.name,
                            address: place,
                          });
                        }}
                        className="press flex-1 min-w-0 text-left flex items-start gap-3 touch-manipulation"
                      >
                        <span className="w-7 h-7 rounded-full bg-white/[0.08] border border-white/[0.10] flex items-center justify-center flex-shrink-0 mt-0.5">
                          <MapPin className="w-3.5 h-3.5 text-gray-300" />
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-100 leading-tight truncate">
                            {suggestion.name}
                          </p>
                          {suggestion.context && (
                            <p className="text-[11px] text-gray-500 leading-tight truncate">
                              {suggestion.context}
                            </p>
                          )}
                        </div>
                      </button>
                    </div>
                  ))}
                </>
              )}
              {searchPlaceError && <PlaceSearchUnavailable />}
            </div>
          )
        ) : plannerPicking ? (
          plannerSearchResults === null ? (
            <div className="px-6 py-10 text-center text-[12px] text-gray-500">
              Type a station, address, or place to fill the{" "}
              <span className="text-gray-300 font-semibold">
                {activeField === "from" ? "start" : "destination"}
              </span>
              .
            </div>
          ) : plannerSearchResults.length === 0 &&
            plannerPlaceResults.length === 0 &&
            !plannerPlaceError ? (
            <div className="px-6 py-10 text-center text-sm text-gray-500">
              No stations or places match &ldquo;{plannerQuery}&rdquo;
            </div>
          ) : (
            <div>
              {/* Stations first — exact subway matches typically rank
                  highest for a transit-app intent. Each shows route
                  bullets so the rider can clock the line at a glance. */}
              {plannerSearchResults.length > 0 && (
                <>
                  <div className="px-4 pt-3 pb-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                    Stations
                  </div>
                  {plannerSearchResults.map((s) => (
                    <div
                      key={`pick-station-${s.stopId}`}
                      className="flex items-start gap-2 px-4 py-3 border-b border-white/5 hover:bg-white/[0.04]"
                    >
                      <button
                        type="button"
                        onClick={() => pickPlannerStation(s)}
                        className="press flex-1 min-w-0 text-left touch-manipulation"
                      >
                        <div className="flex items-center gap-1 flex-wrap mb-1.5">
                          {s.routes.slice(0, 6).map((r) => {
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
                        <p className="text-sm font-semibold text-gray-100 leading-tight">
                          {s.name}
                        </p>
                      </button>
                    </div>
                  ))}
                </>
              )}
              {/* Places — addresses, neighborhoods, POIs from Mapbox
                  Search Box `/suggest`. Coordinates aren't included in
                  the suggestion payload; tapping triggers a `/retrieve`
                  call that resolves coords and the routing engine's
                  station endpoint. */}
              {plannerPlaceResults.length > 0 && (
                <>
                  <div className="px-4 pt-3 pb-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                    Places
                  </div>
                  {plannerPlaceResults.map((suggestion) => (
                    <div
                      key={`pick-suggestion-${suggestion.mapboxId}`}
                      className="flex items-start gap-2 px-4 py-3 border-b border-white/5 hover:bg-white/[0.04]"
                    >
                      <button
                        type="button"
                        onClick={async () => {
                          const resolved = await resolveSuggestion(suggestion);
                          if (!resolved) return;
                          pickPlannerPlace(resolved.place, resolved.nearest);
                        }}
                        className="press flex-1 min-w-0 text-left flex items-start gap-3 touch-manipulation"
                      >
                        <span className="w-7 h-7 rounded-full bg-white/[0.08] border border-white/[0.10] flex items-center justify-center flex-shrink-0 mt-0.5">
                          <MapPin className="w-3.5 h-3.5 text-gray-300" />
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-100 leading-tight truncate">
                            {suggestion.name}
                          </p>
                          {suggestion.context && (
                            <p className="text-[11px] text-gray-500 leading-tight truncate">
                              {suggestion.context}
                            </p>
                          )}
                        </div>
                      </button>
                    </div>
                  ))}
                </>
              )}
              {plannerPlaceError && <PlaceSearchUnavailable />}
            </div>
          )
        ) : tripFrom && tripTo ? (
          expandedPlan ? (
            (() => {
              // Expanded route view — A→Z step-by-step. Walk meters
              // are recomputed off the expanded plan's actual
              // board/alight (NOT just the first plan), so a swap
              // between alternates flips the walk numbers correctly.
              const expBoard = stationsByComplexId.get(
                expandedPlan.legs[0].boardComplexId,
              );
              const expAlight = stationsByComplexId.get(
                expandedPlan.legs[expandedPlan.legs.length - 1]
                  .alightComplexId,
              );
              const expWalkFromMeters =
                tripFrom.address && expBoard
                  ? haversineMeters(
                      {
                        lat: tripFrom.address.lat,
                        lng: tripFrom.address.lng,
                      },
                      { lat: expBoard.lat, lng: expBoard.lng },
                    )
                  : undefined;
              const expWalkToMeters =
                tripTo.address && expAlight
                  ? haversineMeters(
                      { lat: tripTo.address.lat, lng: tripTo.address.lng },
                      { lat: expAlight.lat, lng: expAlight.lng },
                    )
                  : undefined;
              return (
                <TripPlanDetail
                  plan={expandedPlan}
                  routeColors={routeColors}
                  stationsByComplexId={stationsByComplexId}
                  walkFromRoute={walkFromRoute ?? null}
                  walkToRoute={walkToRoute ?? null}
                  walkFromMeters={expWalkFromMeters}
                  walkToMeters={expWalkToMeters}
                  toName={
                    tripTo.address?.name ??
                    tripTo.displayName ??
                    tripTo.name
                  }
                  arrivalsByStation={arrivalsByStation}
                  now={now}
                  focusedLegIndex={focusedLegIndex}
                  onFocusLeg={onFocusLeg}
                  walkRouteError={walkRouteError}
                  onRetryWalkRoutes={onRetryWalkRoutes}
                />
              );
            })()
          ) : walkIsBest && directWalk ? (
            walkDetailOpen ? (
              <WalkingDetail
                route={walkOnlyRoute}
                fallbackMeters={directWalk.meters}
                fallbackMin={directWalk.min}
                fromName={
                  tripFrom?.address?.name ??
                  tripFrom?.displayName ??
                  tripFrom?.name ??
                  "your starting point"
                }
                toName={
                  tripTo?.address?.name ??
                  tripTo?.displayName ??
                  tripTo?.name ??
                  "your destination"
                }
              />
            ) : (
              <div className="px-3 pt-3 pb-8">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-2 px-1">
                  {fastestPlanMin === null
                    ? "No subway route found"
                    : "Fastest option"}
                </p>
                {/* Tappable: opens the turn-by-turn detail view, which
                    snaps the sheet to the half detent so the dashed
                    map route stays visible. Mirrors how a TripPlanRow
                    expands into TripPlanDetail. */}
                <button
                  type="button"
                  onClick={() => setWalkDetailOpen(true)}
                  aria-label="Show walking directions"
                  className="press w-full text-left rounded-2xl bg-emerald-300/10 ring-1 ring-emerald-300/30 hover:bg-emerald-300/15 px-4 py-3 touch-manipulation transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex-shrink-0 w-9 h-9 rounded-full bg-emerald-300/20 text-emerald-200 flex items-center justify-center">
                      <Footprints className="w-[18px] h-[18px]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-gray-100">
                        Walking is faster
                      </p>
                      <p className="text-[12px] text-gray-300 tabular-nums">
                        {directWalk.min} min ·{" "}
                        {directWalk.meters >= 1000
                          ? `${(directWalk.meters / 1000).toFixed(1)} km`
                          : `${Math.round(directWalk.meters)} m`}
                        {fastestPlanMin !== null
                          ? ` · subway ${fastestPlanMin} min`
                          : ""}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  </div>
                </button>
                <p className="text-[11px] text-gray-500 mt-3 px-1">
                  Tap for turn-by-turn directions.
                </p>
              </div>
            )
          ) : tripPlans.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <Compass className="w-10 h-10 mx-auto mb-3 text-gray-600" />
              <p className="text-sm text-gray-300 font-medium">
                No subway route found
              </p>
              <p className="text-[11px] text-gray-500 mt-1 max-w-[260px] mx-auto">
                These stations may need more than one transfer or aren&apos;t
                connected by subway alone.
              </p>
            </div>
          ) : (
            <div className="space-y-2 px-3 pt-3 pb-8">
              {/* Refresh strip — pulls fresh live arrivals so the
                  next-train ETAs and total-time estimates re-rank
                  with the latest feed. Spins the icon while a
                  refresh is in flight for tactile feedback. */}
              <div className="flex items-center justify-between px-1 -mt-1 mb-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  {tripPlans.length} route{tripPlans.length === 1 ? "" : "s"}
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    if (refreshing) return;
                    setRefreshing(true);
                    try {
                      await refreshTrains();
                    } finally {
                      setRefreshTick((t) => t + 1);
                      // Brief minimum spin so the rider sees feedback
                      // even when the cached promise resolves
                      // instantly.
                      setTimeout(() => setRefreshing(false), 500);
                    }
                  }}
                  aria-label="Refresh routes"
                  className="press inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-gray-200 text-[11px] font-semibold touch-manipulation"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`}
                  />
                  Refresh
                </button>
              </div>
              {/* refreshTick is read here to wire the bump into the
                  render path; tripPlans depends on `now` already, so
                  the actual recompute happens when refreshTrains
                  resolves and pushes new data through useTrains. */}
              <span className="hidden" data-refresh-tick={refreshTick} />
              {tripPlans.map((plan, i) => {
                const k = tripKey(plan);
                const isSelected = selectedTripKey === k;
                // Per-plan walk: address → plan's actual board /
                // alight station, not the original tripFrom/tripTo
                // anchor. Two plans that board at different
                // complexes (e.g. one at Wall St 4/5, one at
                // Rector St 1) get different walk numbers.
                const board = stationsByComplexId.get(
                  plan.legs[0].boardComplexId,
                );
                const alight = stationsByComplexId.get(
                  plan.legs[plan.legs.length - 1].alightComplexId,
                );
                const walkFromMeters =
                  tripFrom.address && board
                    ? haversineMeters(
                        {
                          lat: tripFrom.address.lat,
                          lng: tripFrom.address.lng,
                        },
                        { lat: board.lat, lng: board.lng },
                      )
                    : undefined;
                const walkToMeters =
                  tripTo.address && alight
                    ? haversineMeters(
                        { lat: tripTo.address.lat, lng: tripTo.address.lng },
                        { lat: alight.lat, lng: alight.lng },
                      )
                    : undefined;
                return (
                  <TripPlanRow
                    key={`plan-${k}`}
                    plan={plan}
                    origin={tripFrom}
                    routeColors={routeColors}
                    stationsByComplexId={stationsByComplexId}
                    arrivals={
                      arrivalsByStation.get(plan.legs[0].boardComplexId) ?? []
                    }
                    now={now}
                    isPrimary={i === 0}
                    isSelected={isSelected}
                    onSelect={
                      onTripSelect
                        ? () => {
                            // Tap on a plan: push selection to map
                            // AND drop into the expanded A→Z view so
                            // the rider gets step-by-step directions
                            // for the route they just chose. Tapping
                            // again from the detail view goes back
                            // via the explicit back button rather
                            // than a toggle, since users expect tap
                            // to be a deterministic "open" action
                            // rather than a hidden toggle.
                            onTripSelect({
                              plan,
                              walkFrom: tripFrom.address
                                ? {
                                    lng: tripFrom.address.lng,
                                    lat: tripFrom.address.lat,
                                    name: tripFrom.address.name,
                                  }
                                : undefined,
                              walkTo: tripTo.address
                                ? {
                                    lng: tripTo.address.lng,
                                    lat: tripTo.address.lat,
                                    name: tripTo.address.name,
                                  }
                                : undefined,
                            });
                            setExpandedPlan(plan);
                            // Apple-Maps pattern: collapse the sheet
                            // to half so the trip overlay is visible
                            // on the map.
                            setDetent("half");
                          }
                        : undefined
                    }
                    walkFromMeters={walkFromMeters}
                    walkFromName={tripFrom.address?.name}
                    walkToMeters={walkToMeters}
                    walkToName={tripTo.address?.name}
                    lastReportedByTripId={lastReportedByTripId}
                    generatedAtSec={generatedAtSec}
                  />
                );
              })}
            </div>
          )
        ) : (
          <div className="px-6 py-10 text-center text-[12px] text-gray-500">
            Choose a {!tripFrom ? "start" : "destination"} to see your options.
          </div>
        )}
      </div>
    </div>
  );
}
