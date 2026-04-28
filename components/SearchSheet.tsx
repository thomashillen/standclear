"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, X, Compass, ArrowLeftRight, MapPin } from "lucide-react";
import { useLines } from "@/lib/subwayData";
import { useTrains, type Arrival } from "@/lib/useTrains";
import { useFavorites, useCommute, type CommuteEndpoint } from "@/lib/useFavorites";
import { useGeolocationState } from "@/lib/useGeolocation";
import { useNow } from "@/lib/useNow";
import { useSheetDrag } from "@/lib/useSheetDrag";
import { planTrips, type TripPlan } from "@/lib/commuteRouting";
import {
  buildStationIndex,
  haversineMeters,
  nearestStations,
  searchStations,
  type StationEntry,
} from "@/lib/stopsIndex";
import {
  makeDebouncedGeocoder,
  type Place,
} from "@/lib/geocoding";
import {
  RouteBullet,
  StationRow,
  PlannerField,
  TripPlanRow,
  type RouteColorMap,
} from "./panelUI";

interface Props {
  open: boolean;
  onClose: () => void;
  onStationOpen: (stopId: string) => void;
  /** Tap on a trip plan in directions mode. The parent renders the
   *  trip's legs and station markers on the map. Pass null to clear. */
  onTripSelect?: (plan: TripPlan | null, fromStopId: string) => void;
  /** Identifier (string) of the currently-selected plan so the row can
   *  show a selected-state highlight. The parent generates this from
   *  the plan it renders on the map. */
  selectedTripKey?: string | null;
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

export default function SearchSheet({
  open,
  onClose,
  onStationOpen,
  onTripSelect,
  selectedTripKey,
}: Props) {
  const lines = useLines();
  const data = useTrains();
  const { has, toggle } = useFavorites();
  const { home, work, anchorOf } = useCommute();

  // Mode: which pane is showing. Defaults to search; flips back to
  // search on close so re-opening lands in the more general surface.
  const [mode, setMode] = useState<"search" | "directions">("search");

  // Search-mode state.
  const [query, setQuery] = useState("");

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
  const [plannerPlaceResults, setPlannerPlaceResults] = useState<Place[]>([]);

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

  // Reset state when sheet closes so re-opening lands clean.
  useEffect(() => {
    if (!open) {
      setMode("search");
      setQuery("");
      setPlannerQuery("");
    }
  }, [open]);

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
  useEffect(() => {
    if (mode !== "directions") return;
    if (tripFrom || tripTo) return;
    const h = endpointToTrip(home);
    const w = endpointToTrip(work);
    if (h) setTripFrom(h);
    if (w) setTripTo(w);
    // Land focus on whichever side is still empty so a single tap
    // brings up the search picker.
    // null when both pre-filled — plans render straight away rather
    // than popping the keyboard.
    setActiveField(!h ? "from" : !w ? "to" : null);
  }, [mode, home, work, endpointToTrip, tripFrom, tripTo]);

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

  // ── Directions-mode plans.
  const tripPlans = useMemo(() => {
    if (mode !== "directions" || !tripFrom || !tripTo || !lines) return [];
    return planTrips(lines, index, tripFrom.stopIds, tripTo.stopIds, {
      maxResults: 4,
    });
  }, [mode, tripFrom, tripTo, lines, index]);

  // ── Picker results (when a directions field needs filling).
  const plannerSearchResults = useMemo<StationEntry[] | null>(() => {
    if (mode !== "directions") return null;
    const q = plannerQuery.trim();
    if (q.length < 2) return null;
    return searchStations(index, q, 30);
  }, [mode, plannerQuery, index]);

  // Debounced geocoder so an autocomplete that fires on every
  // keystroke doesn't slam the Mapbox API. One instance per mount;
  // useMemo with empty deps so the same closure persists across
  // renders.
  const debouncedGeocoder = useMemo(() => makeDebouncedGeocoder(250), []);

  // Kick the geocoder when the planner query changes. The result
  // arrives async via setPlannerPlaceResults.
  useEffect(() => {
    if (mode !== "directions") {
      setPlannerPlaceResults([]);
      return;
    }
    const q = plannerQuery.trim();
    if (q.length < 2) {
      setPlannerPlaceResults([]);
      return;
    }
    debouncedGeocoder(
      q,
      geo.lat != null && geo.lng != null
        ? { proximity: { lng: geo.lng, lat: geo.lat }, limit: 5 }
        : { limit: 5 },
      setPlannerPlaceResults,
    );
  }, [mode, plannerQuery, debouncedGeocoder, geo.lat, geo.lng]);

  // Resolve each place to the nearest station so the trip planner
  // (which routes between StationEntries) has a real subway endpoint
  // to work with. Recomputes only when the place set or the index
  // changes, which is rare relative to render cadence.
  const placeRows = useMemo(
    () =>
      plannerPlaceResults
        .map((place) => ({
          place,
          nearest: nearestStations(index, place.lng, place.lat, 1)[0] ?? null,
        }))
        .filter(
          (r): r is { place: Place; nearest: StationEntry & { meters: number } } =>
            r.nearest !== null,
        ),
    [plannerPlaceResults, index],
  );

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

  // Shared sheet drag with half/full detents + dismiss threshold.
  const { detent, sheetStyle, handlers, onHandleTap } = useSheetDrag({
    halfRestingY: "calc(88dvh - 60dvh)",
    open,
    onDismiss: onClose,
  });

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
        inset-x-0 bottom-0 h-[88dvh] rounded-t-[28px] border-t border-white/[0.08]
        sm:inset-auto sm:right-3 sm:top-3 sm:bottom-3 sm:w-[340px] sm:h-auto sm:rounded-[22px] sm:border sm:border-white/[0.08]
        ios-glass
        shadow-[0_20px_60px_-10px_rgba(0,0,0,0.6)]
        pb-[env(safe-area-inset-bottom)]
      "
      style={sheetStyle}
    >
      {/* Combined handle + title row. Same conventions as NearbyPanel
          so the two sheets feel like siblings. */}
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
          <Search className="w-[17px] h-[17px]" />
          <span className="font-black text-[16px] tracking-tight">
            {mode === "search" ? "Search" : "Directions"}
          </span>
        </div>
        <button
          onClick={onClose}
          className="press text-white opacity-85 hover:opacity-100 w-9 h-9 -mr-1 flex items-center justify-center rounded-full bg-white/[0.08] hover:bg-white/[0.12] touch-manipulation"
          aria-label="Close panel"
        >
          <X className="w-[16px] h-[16px]" strokeWidth={2.5} />
        </button>
      </div>

      {/* Segmented control — Apple's two-button toggle pattern. The
          active segment gets a brighter inner pill; the inactive one
          stays in the gray-on-glass background. */}
      <div className="px-3 pb-2 flex-shrink-0">
        <div className="p-1 rounded-xl bg-white/[0.06] flex">
          <button
            type="button"
            onClick={() => setMode("search")}
            className={`flex-1 h-8 rounded-lg text-[13px] font-semibold touch-manipulation transition-colors ${
              mode === "search"
                ? "bg-white/[0.16] text-white shadow-[0_1px_2px_rgba(0,0,0,0.2)]"
                : "text-gray-400 hover:text-gray-200"
            }`}
            aria-pressed={mode === "search"}
          >
            <Search className="inline w-3.5 h-3.5 mr-1 -mt-0.5" />
            Search
          </button>
          <button
            type="button"
            onClick={() => setMode("directions")}
            className={`flex-1 h-8 rounded-lg text-[13px] font-semibold touch-manipulation transition-colors ${
              mode === "directions"
                ? "bg-white/[0.16] text-white shadow-[0_1px_2px_rgba(0,0,0,0.2)]"
                : "text-gray-400 hover:text-gray-200"
            }`}
            aria-pressed={mode === "directions"}
          >
            <Compass className="inline w-3.5 h-3.5 mr-1 -mt-0.5" />
            Directions
          </button>
        </div>
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
              placeholder="Search stations"
              aria-label="Search stations"
              className="w-full h-11 pl-10 pr-10 rounded-xl bg-white/[0.08] border border-white/[0.06] text-[15px] text-gray-50 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-white/25 focus:border-transparent transition-shadow"
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
      ) : (
        <div className="px-3 pb-2.5 flex-shrink-0 border-b border-white/[0.06]">
          {/* Inline search: the active field IS the input. Tapping
              an inactive field activates it, focuses an embedded
              input, and search results appear in the scroll area
              below. No separate search bar — the field is the bar.
              When the endpoint is an address (TripEndpoint with a
              displayName), shadow `name` with displayName so the
              field shows "123 Main St" instead of the underlying
              station's name. */}
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
                placeholder="Search start station or address"
                accent="emerald"
                onTap={() => {
                  setActiveField("from");
                  setPlannerQuery("");
                }}
                onClear={() => {
                  setTripFrom(null);
                  setActiveField("from");
                  setPlannerQuery("");
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
                placeholder="Search destination or address"
                accent="sky"
                onTap={() => {
                  setActiveField("to");
                  setPlannerQuery("");
                }}
                onClear={() => {
                  setTripTo(null);
                  setActiveField("to");
                  setPlannerQuery("");
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

      {/* ── Mode-specific scroll content ──────────────────────────── */}
      <div className="flex-1 overflow-y-auto ios-scroll">
        {mode === "search" ? (
          searchResults === null ? (
            <div className="px-6 py-10 text-center text-[12px] text-gray-500">
              Type at least two letters to search NYC subway stations.
            </div>
          ) : searchResults.length === 0 ? (
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
                  // Tapping the compass icon jumps to directions
                  // with this station as the *destination* and the
                  // rider's current location resolved to its nearest
                  // station as the *origin*. The intent is "get me
                  // there from here," not "plan a trip from this
                  // station." If geo isn't available, the From field
                  // stays empty and is auto-focused for the rider to
                  // fill manually.
                  onDirectionsFrom={() => {
                    setMode("directions");
                    setQuery("");
                    setPlannerQuery("");
                    let nextFrom: TripEndpoint | null = null;
                    if (geo.lat != null && geo.lng != null) {
                      const nearest = nearestStations(
                        index,
                        geo.lng,
                        geo.lat,
                        1,
                      )[0];
                      if (nearest) {
                        nextFrom = {
                          ...nearest,
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
                    setTripTo(s as TripEndpoint);
                    // null = both endpoints filled, plans render
                    // immediately. "from" = need user to fill From.
                    setActiveField(nextFrom ? null : "from");
                  }}
                />
              ))}
            </div>
          )
        ) : plannerPicking ? (
          plannerSearchResults === null ? (
            <div className="px-6 py-10 text-center text-[12px] text-gray-500">
              Type a station name or address to fill the{" "}
              <span className="text-gray-300 font-semibold">
                {activeField === "from" ? "start" : "destination"}
              </span>
              .
            </div>
          ) : plannerSearchResults.length === 0 && placeRows.length === 0 ? (
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
                    <button
                      key={`pick-station-${s.stopId}`}
                      type="button"
                      onClick={() => pickPlannerStation(s)}
                      className="press w-full text-left flex items-start gap-3 px-4 py-3 border-b border-white/5 hover:bg-white/[0.04] touch-manipulation"
                    >
                      <div className="flex-1 min-w-0">
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
                      </div>
                    </button>
                  ))}
                </>
              )}
              {/* Places — addresses, neighborhoods, POIs from Mapbox
                  geocoding. Each row shows a pin icon, the place
                  name, the neighborhood/borough context, and the
                  nearest station (which the routing engine will use
                  as the actual subway endpoint). */}
              {placeRows.length > 0 && (
                <>
                  <div className="px-4 pt-3 pb-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                    Places
                  </div>
                  {placeRows.map(({ place, nearest }) => (
                    <button
                      key={`pick-place-${place.id}`}
                      type="button"
                      onClick={() => pickPlannerPlace(place, nearest)}
                      className="press w-full text-left flex items-start gap-3 px-4 py-3 border-b border-white/5 hover:bg-white/[0.04] touch-manipulation"
                    >
                      <span className="w-7 h-7 rounded-full bg-white/[0.08] border border-white/[0.10] flex items-center justify-center flex-shrink-0 mt-0.5">
                        <MapPin className="w-3.5 h-3.5 text-gray-300" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-100 leading-tight truncate">
                          {place.name}
                        </p>
                        {place.context && (
                          <p className="text-[11px] text-gray-500 leading-tight truncate">
                            {place.context}
                          </p>
                        )}
                        <p className="text-[11px] text-gray-400 mt-1 truncate">
                          Nearest: {nearest.name}
                          {nearest.meters !== undefined &&
                            ` · ${
                              nearest.meters < 1000
                                ? `${Math.round(nearest.meters)} m`
                                : `${(nearest.meters / 1000).toFixed(1)} km`
                            } walk`}
                        </p>
                      </div>
                    </button>
                  ))}
                </>
              )}
            </div>
          )
        ) : tripFrom && tripTo ? (
          tripPlans.length === 0 ? (
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
            (() => {
              // Walk legs: same for every plan (all plans share the
              // same boarding/alighting complex with the From/To
              // endpoint), so compute once outside the map.
              const walkFromMeters = tripFrom.address
                ? haversineMeters(
                    { lat: tripFrom.address.lat, lng: tripFrom.address.lng },
                    { lat: tripFrom.lat, lng: tripFrom.lng },
                  )
                : undefined;
              const walkToMeters = tripTo.address
                ? haversineMeters(
                    { lat: tripTo.address.lat, lng: tripTo.address.lng },
                    { lat: tripTo.lat, lng: tripTo.lng },
                  )
                : undefined;
              return (
                <div className="space-y-2 px-3 pt-3 pb-2">
                  {tripPlans.map((plan, i) => {
                    const k = tripKey(plan);
                    const isSelected = selectedTripKey === k;
                    return (
                      <TripPlanRow
                        key={`plan-${k}`}
                        plan={plan}
                        origin={tripFrom}
                        routeColors={routeColors}
                        stationsByComplexId={stationsByComplexId}
                        arrivals={arrivalsByStation.get(tripFrom.stopId) ?? []}
                        now={now}
                        isPrimary={i === 0}
                        isSelected={isSelected}
                        onSelect={
                          onTripSelect
                            ? () =>
                                onTripSelect(
                                  isSelected ? null : plan,
                                  tripFrom.stopId,
                                )
                            : undefined
                        }
                        walkFromMeters={walkFromMeters}
                        walkFromName={tripFrom.address?.name}
                        walkToMeters={walkToMeters}
                        walkToName={tripTo.address?.name}
                      />
                    );
                  })}
                </div>
              );
            })()
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
