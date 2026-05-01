"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { MapPin, MoreHorizontal, Search, X } from "lucide-react";
import { useLines } from "@/lib/subwayData";
import { useTrains } from "@/lib/useTrains";
import { legGeometry, type TripPlan } from "@/lib/commuteRouting";
import { buildStationIndex, type StationEntry } from "@/lib/stopsIndex";

/**
 * What the panels hand back when a rider taps a trip plan. Wraps the
 * subway plan with optional walking endpoints so the map can render
 * dashed pedestrian segments connecting the rider's actual origin /
 * destination to the boarding / alighting stations.
 */
export type TripSelection = {
  plan: TripPlan;
  walkFrom?: { lng: number; lat: number; name?: string };
  walkTo?: { lng: number; lat: number; name?: string };
};
import LinePanel from "./LinePanel";
import LinePicker from "./LinePicker";
import LiveTrainsPopup from "./LiveTrainsPopup";
import MoreSheet from "./MoreSheet";
import NearbyPanel from "./NearbyPanel";
import SearchSheet from "./SearchSheet";
import StationPanel from "./StationPanel";
import type { SelectedTrip } from "./MapView";

const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 bg-gray-950 flex items-center justify-center">
      <div className="text-gray-500 text-sm animate-pulse">Loading map…</div>
    </div>
  ),
});

export default function SubwayMap() {
  const [selectedLine, setSelectedLine] = useState<string | null>(null);
  const [focusStopId, setFocusStopId] = useState<string | undefined>();
  const [stationStopId, setStationStopId] = useState<string | null>(null);
  // Open on first load so nearby stations surface before any interaction.
  // Mounting the panel also subscribes to geolocation, which on iOS Safari
  // gives the permission prompt a cold-start path. Users can dismiss.
  const [nearbyOpen, setNearbyOpen] = useState(true);
  // SearchSheet state. Mutually exclusive with the other panels; the
  // handler below closes them when search opens. `searchInitialMode`
  // controls which pane the sheet lands in — the header Search button
  // opens it in "search" mode, while NearbyPanel's "See all routes"
  // CTA opens it directly in "directions" mode with home/work
  // auto-filled by SearchSheet's own effect.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInitialMode, setSearchInitialMode] = useState<
    "search" | "directions"
  >("search");
  // More menu — bell, Home/Work, About, etc. live here so the floating
  // header stays compact. Mutually exclusive with other sheets only at
  // the visual level; underneath, MoreSheet is its own modal Dialog.
  const [moreOpen, setMoreOpen] = useState(false);
  // System Pulse popup — surfaced from the live-feed pill in the
  // floating header. Independent dialog (not mutually exclusive with
  // panels) so a rider mid-trip can peek at fleet stats without
  // losing their context.
  const [livePulseOpen, setLivePulseOpen] = useState(false);
  // Anchor-pick mode for the SearchSheet — when set, tapping a
  // station/place row pins that as the chosen anchor instead of
  // opening directions. Set by MoreSheet's "Set Home" / "Set Work"
  // rows; cleared once the anchor is picked or the sheet closes.
  const [searchAnchorPick, setSearchAnchorPick] = useState<
    "home" | "work" | null
  >(null);
  // Preset trip endpoints for SearchSheet, set by NearbyPanel's
  // "See all routes" so the rider lands on a fresh "current
  // location → chosen destination" trip instead of inheriting
  // whatever they previously searched. Bumped to a new object on
  // each open so SearchSheet re-applies the preset cleanly.
  const [searchPresetTrip, setSearchPresetTrip] = useState<
    | {
        from:
          | { kind: "station"; stopId: string }
          | { kind: "address"; lng: number; lat: number; name: string };
        to:
          | { kind: "station"; stopId: string }
          | { kind: "address"; lng: number; lat: number; name: string };
      }
    | null
  >(null);
  // Selected trip from SearchSheet's directions mode or NearbyPanel's
  // Going-to-Work card. When set, the map renders the legs + station
  // markers + walking segments and fits the camera.
  const [selectedTripSelection, setSelectedTripSelection] =
    useState<TripSelection | null>(null);
  // Fly-to-user signal — increments each time the user taps Near-me so
  // MapView can fly the camera to their location (waiting for geo if it
  // isn't available yet). Counter, not a boolean, so successive taps
  // each register as fresh requests rather than no-ops.
  const [flyToUserSignal, setFlyToUserSignal] = useState(0);
  const data = useTrains();
  const lines = useLines();

  const handleLineSelect = (line: string | null, stopId?: string) => {
    setSelectedLine(line);
    setFocusStopId(stopId);
    // Panels are mutually exclusive — opening a line replaces nearby /
    // station / search views, not layered on top. Also drop any
    // active trip overlay so the rider isn't stuck looking at a
    // route from a previous directions session while inspecting a
    // line.
    if (line) {
      setNearbyOpen(false);
      setStationStopId(null);
      setSearchOpen(false);
      setSelectedTripSelection(null);
    }
  };

  const handleStationOpen = (id: string) => {
    setStationStopId(id);
    setSelectedLine(null);
    setFocusStopId(undefined);
    setNearbyOpen(false);
    setSearchOpen(false);
    // Tapping a station drops the trip overlay — the rider has moved
    // on from the directions context.
    setSelectedTripSelection(null);
  };

  const handleSearchToggle = () => {
    const next = !searchOpen;
    setSearchOpen(next);
    if (next) {
      // Header search button always opens in plain Search mode and
      // clears any leftover anchor-pick / preset state from prior
      // MoreSheet or "See all routes" entries — otherwise the rider
      // would see a stale "tap to set as Home" banner or a
      // pre-filled directions trip on a regular search.
      setSearchInitialMode("search");
      setSearchAnchorPick(null);
      setSearchPresetTrip(null);
      // Search takes the panel slot; close every other surface so the
      // sheet can claim the full bottom area without layering issues.
      setNearbyOpen(false);
      setSelectedLine(null);
      setFocusStopId(undefined);
      setStationStopId(null);
    }
  };

  // "See all routes" handoff from NearbyPanel — opens SearchSheet
  // straight into directions mode with current location → chosen
  // destination as the preset trip. The preset bypasses
  // SearchSheet's home→work auto-fill so the rider always sees the
  // trip the Going-to-Work card was showing, even after they've
  // previously searched something else.
  const handleSeeAllRoutes = (preset: NonNullable<typeof searchPresetTrip>) => {
    setSearchInitialMode("directions");
    setSearchPresetTrip(preset);
    setSearchOpen(true);
    setNearbyOpen(false);
    setSelectedLine(null);
    setFocusStopId(undefined);
    setStationStopId(null);
  };

  // Set Home / Set Work handoff from MoreSheet — opens SearchSheet in
  // focused anchor-pick mode. A banner makes the goal explicit and
  // every row tap pins that result as the named anchor + closes the
  // sheet, instead of the default open-station / start-directions
  // behavior.
  const handleSetAnchorFromMore = (anchor: "home" | "work") => {
    setSearchInitialMode("search");
    setSearchAnchorPick(anchor);
    setSearchOpen(true);
    setNearbyOpen(false);
    setSelectedLine(null);
    setFocusStopId(undefined);
    setStationStopId(null);
  };

  const handleNearbyToggle = () => {
    const next = !nearbyOpen;
    setNearbyOpen(next);
    if (next) {
      setSelectedLine(null);
      setFocusStopId(undefined);
      setStationStopId(null);
      setSearchOpen(false);
    }
    // Bump the signal both for open AND re-tap-while-open. Tapping
    // Near-me when the panel is already open is "find me again",
    // which should re-center the camera.
    setFlyToUserSignal((s) => s + 1);
  };

  const totalTrains = data?.trains.length ?? 0;
  const stale = data ? Date.now() - data.generatedAt > 60_000 : false;

  // Stable identifier for the selected plan, also passed to SearchSheet
  // so its TripPlanRow can show the right selected highlight without
  // having to compare plan objects by reference. Same string-key
  // recipe SearchSheet uses internally.
  const selectedTripKey = useMemo(() => {
    if (!selectedTripSelection) return null;
    const plan = selectedTripSelection.plan;
    return (
      plan.legs.map((l) => `${l.routeId}-${l.direction}`).join("|") +
      (plan.transferComplexId ? `:${plan.transferComplexId}` : "")
    );
  }, [selectedTripSelection]);

  // Resolve the selected TripPlan into the SelectedTrip DTO MapView
  // expects: per-leg coordinates from legGeometry + station coords
  // pulled from the merged station index, plus the rider's actual
  // walking endpoints (current location / address coords) so the map
  // can draw dashed pedestrian segments at the trip's start/end.
  const selectedTrip = useMemo<SelectedTrip | null>(() => {
    if (!selectedTripSelection || !lines) return null;
    const plan = selectedTripSelection.plan;
    const index = buildStationIndex(lines);
    const stationByComplexId = new Map<string, StationEntry>();
    for (const s of index) stationByComplexId.set(s.stopId, s);

    const lineByRouteId = new Map(
      Object.values(lines).map((line) => [line.routeId, line]),
    );

    const legDtos: SelectedTrip["legs"] = [];
    for (const leg of plan.legs) {
      const line = lineByRouteId.get(leg.routeId);
      if (!line) return null;
      const coords = legGeometry(line, leg.boardStopId, leg.alightStopId);
      if (!coords) return null;
      const board = stationByComplexId.get(leg.boardComplexId);
      const alight = stationByComplexId.get(leg.alightComplexId);
      if (!board || !alight) return null;
      legDtos.push({
        routeId: leg.routeId,
        color: line.color,
        coordinates: coords,
        boardStation: {
          stopId: board.stopId,
          name: board.name,
          lng: board.lng,
          lat: board.lat,
        },
        alightStation: {
          stopId: alight.stopId,
          name: alight.name,
          lng: alight.lng,
          lat: alight.lat,
        },
      });
    }

    const transferComplex = plan.transferComplexId
      ? stationByComplexId.get(plan.transferComplexId)
      : null;

    return {
      legs: legDtos,
      transferStation: transferComplex
        ? {
            stopId: transferComplex.stopId,
            name: transferComplex.name,
            lng: transferComplex.lng,
            lat: transferComplex.lat,
          }
        : undefined,
      walkFrom: selectedTripSelection.walkFrom,
      walkTo: selectedTripSelection.walkTo,
    };
  }, [selectedTripSelection, lines]);

  // Trip selection handler — called from SearchSheet / NearbyPanel
  // when a plan row is tapped. Receives the plan plus optional
  // walking endpoints (rider's actual coords vs. station coords) so
  // the map can draw dashed pedestrian legs at start/end. Pass null
  // to clear.
  const handleTripSelect = (selection: TripSelection | null) => {
    setSelectedTripSelection(selection);
  };

  return (
    <div className="relative flex flex-col h-full bg-gray-950 text-white">
      {/* ── Map fills the full viewport ── */}
      <div className="relative flex flex-1 min-h-0">
        <MapView
          selectedLine={selectedLine}
          stationStopId={stationStopId}
          onLineSelect={handleLineSelect}
          onStationOpen={handleStationOpen}
          flyToUserSignal={flyToUserSignal}
          // Camera padding for fly-to-user when a panel is covering
          // part of the screen, so the user's location lands in the
          // visible map area rather than behind the panel.
          panelOpen={
            (nearbyOpen && !stationStopId) ||
            !!stationStopId ||
            (!!selectedLine && !nearbyOpen && !stationStopId) ||
            searchOpen
          }
          selectedTrip={selectedTrip}
        />
        {selectedLine && !nearbyOpen && !stationStopId && (
          <LinePanel
            lineId={selectedLine}
            focusStopId={focusStopId}
            onClose={() => {
              setSelectedLine(null);
              setFocusStopId(undefined);
            }}
            onStationOpen={handleStationOpen}
          />
        )}
        {stationStopId && (
          <StationPanel
            stopId={stationStopId}
            onClose={() => setStationStopId(null)}
            onSelectLine={(routeId) => handleLineSelect(routeId, stationStopId)}
          />
        )}
        <NearbyPanel
          open={nearbyOpen && !stationStopId && !searchOpen}
          onClose={() => setNearbyOpen(false)}
          onStationOpen={handleStationOpen}
          onTripSelect={handleTripSelect}
          selectedTripKey={selectedTripKey}
          onSeeAllRoutes={handleSeeAllRoutes}
        />
        <MoreSheet
          open={moreOpen}
          onClose={() => setMoreOpen(false)}
          onSetHome={() => handleSetAnchorFromMore("home")}
          onSetWork={() => handleSetAnchorFromMore("work")}
        />
        <LiveTrainsPopup
          open={livePulseOpen}
          onClose={() => setLivePulseOpen(false)}
        />
        <SearchSheet
          initialMode={searchInitialMode}
          anchorPickMode={searchAnchorPick}
          onAnchorPicked={() => {
            setSearchAnchorPick(null);
            setSearchOpen(false);
          }}
          presetTrip={searchPresetTrip}
          open={searchOpen}
          onClose={() => {
            // Closing the directions sheet should restore the
            // default map: drop the trip overlay so the rider isn't
            // looking at a leftover route after they've moved on.
            // Tapping the same plan twice still toggles overlay
            // off without closing the sheet — this is the
            // "actually exit" path.
            setSearchOpen(false);
            setSelectedTripSelection(null);
            setSearchAnchorPick(null);
            setSearchPresetTrip(null);
          }}
          onStationOpen={handleStationOpen}
          onTripSelect={handleTripSelect}
          selectedTripKey={selectedTripKey}
        />
      </div>

      {/* ── Floating Liquid Glass control row, overlaid on the map ──
          The container itself is pointer-events-none so users can pan
          the map between buttons; each interactive child opts back in
          with pointer-events-auto. iOS-26-style frosted-glass tiles
          float independently rather than sharing a header bar — same
          spatial grouping as Apple Maps' top-row controls. */}
      <div
        className="absolute inset-x-0 top-0 z-30 flex items-center gap-2 px-3 pointer-events-none"
        style={{
          paddingTop: "calc(max(var(--safe-top), 0.5rem) + 0.5rem)",
        }}
      >
        {/* Logo — small floating tile, hidden on mobile to give the
            line picker more room. Identity cue only, not navigation. */}
        <div
          className="pointer-events-auto hidden sm:flex items-center justify-center w-11 h-11 rounded-full ios-glass border border-white/[0.10] shadow-[0_6px_20px_rgba(0,0,0,0.45)] text-[22px] flex-shrink-0 select-none"
          aria-label="SubwaySurfer"
        >
          🚇
        </div>

        {/* Line picker — primary nav. Already styles itself as a glass
            pill internally; the wrapping div just owns layout flex and
            pointer-events. */}
        <div className="flex-1 min-w-0 pointer-events-auto">
          <LinePicker
            lines={lines}
            selectedLine={selectedLine}
            onSelect={handleLineSelect}
          />
        </div>

        {/* Live-feed pill — pulsing dot + train count. The number
            communicates "system scale right now" at a glance, the
            color signals freshness (green = live, amber = stale,
            gray = connecting). Tap opens the System Pulse popup with
            direction split, status mix, and per-line breakdown. Pill
            shape (auto width) so it grows naturally with the count
            without ever clipping. */}
        <button
          type="button"
          onClick={() => setLivePulseOpen(true)}
          aria-label={
            !data
              ? "Connecting to live feed"
              : stale
                ? "Live feed is stale — tap for details"
                : `${totalTrains} trains live — tap for system pulse`
          }
          aria-pressed={livePulseOpen}
          title={
            !data
              ? "Connecting…"
              : stale
                ? "Stale — last refresh more than a minute ago"
                : `${totalTrains} trains live`
          }
          className="pointer-events-auto press flex items-center gap-1.5 h-9 px-2.5 flex-shrink-0 rounded-full ios-glass border border-white/[0.10] shadow-[0_6px_20px_rgba(0,0,0,0.45)] touch-manipulation"
        >
          <span className="relative flex w-2 h-2">
            <span
              className={`absolute inset-0 rounded-full ${
                !data ? "bg-gray-500" : stale ? "bg-amber-400" : "bg-emerald-400"
              } shadow-[0_0_8px_currentColor]`}
              style={{
                color: !data
                  ? "rgba(107,114,128,0.5)"
                  : stale
                    ? "rgba(251,191,36,0.6)"
                    : "rgba(52,211,153,0.7)",
              }}
            />
            {data && !stale && (
              <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-60" />
            )}
          </span>
          <span className="text-[12px] font-bold tabular-nums text-gray-100 leading-none">
            {data ? totalTrains : "…"}
          </span>
        </button>

        {/* Search & directions — Apple-Maps-style sheet for finding a
            station or planning a trip. Mutually exclusive with the
            other panels; opening it closes Near Me / Line / Station. */}
        <button
          onClick={handleSearchToggle}
          aria-label="Search stations and plan trips"
          aria-pressed={searchOpen}
          className={`pointer-events-auto press flex items-center justify-center w-11 h-11 rounded-full touch-manipulation flex-shrink-0 transition-colors border shadow-[0_6px_20px_rgba(0,0,0,0.45)] ${
            searchOpen
              ? "bg-white text-gray-950 border-white/30 shadow-[0_6px_20px_rgba(255,255,255,0.20)]"
              : "ios-glass text-gray-100 border-white/[0.10]"
          }`}
        >
          <Search className="w-[18px] h-[18px]" />
        </button>

        {/* Near-me — taps fly the map to the rider's location AND open
            the Near Me panel. When already centered + panel open, a
            re-tap re-centers (the signal counter increments either
            way). Active state mirrors the panel's open state. */}
        <button
          onClick={handleNearbyToggle}
          aria-label="Find nearby stations"
          aria-pressed={nearbyOpen}
          className={`pointer-events-auto press flex items-center justify-center w-11 h-11 rounded-full touch-manipulation flex-shrink-0 transition-colors border shadow-[0_6px_20px_rgba(0,0,0,0.45)] ${
            nearbyOpen
              ? "bg-white text-gray-950 border-white/30 shadow-[0_6px_20px_rgba(255,255,255,0.20)]"
              : "ios-glass text-gray-100 border-white/[0.10]"
          }`}
        >
          <MapPin className="w-[18px] h-[18px]" />
        </button>

        {/* More menu — service alerts, Home/Work address, About.
            Sits on the far right of the floating header, matching the
            iOS convention that "settings / overflow actions" live at
            the trailing edge. */}
        <button
          onClick={() => setMoreOpen(true)}
          aria-label="More options"
          aria-pressed={moreOpen}
          className="pointer-events-auto press flex items-center justify-center w-11 h-11 rounded-full touch-manipulation flex-shrink-0 transition-colors border shadow-[0_6px_20px_rgba(0,0,0,0.45)] ios-glass text-gray-100 border-white/[0.10]"
        >
          <MoreHorizontal className="w-[18px] h-[18px]" />
        </button>
      </div>

      {/* ── Floating "Clear route" chip ──
          Persistent dismiss affordance whenever a trip overlay is
          active. Positioned just below the floating header so it
          floats over the map but doesn't compete with the controls.
          Visible from any panel state — Search, Nearby, Line, Station,
          or no panel at all — so the rider always has an explicit
          way out of directions mode without hunting for the X in a
          covered sheet. iOS-26 styling: glass pill, route-color dots
          for visual anchor, small X cap for the dismiss action. */}
      {selectedTripSelection && (
        <div
          className="absolute inset-x-0 z-30 flex justify-center px-3 pointer-events-none"
          style={{
            top: "calc(max(var(--safe-top), 0.5rem) + 3.75rem)",
          }}
        >
          <button
            onClick={() => setSelectedTripSelection(null)}
            aria-label="Clear route from map"
            className="pointer-events-auto press inline-flex items-center gap-2 h-9 pl-2.5 pr-1.5 rounded-full ios-glass border border-white/[0.12] shadow-[0_8px_24px_rgba(0,0,0,0.5)] text-gray-100 touch-manipulation"
          >
            <span className="flex items-center -space-x-1">
              {selectedTripSelection.plan.legs.slice(0, 3).map((leg, i) => {
                const line = lines
                  ? Object.values(lines).find((l) => l.routeId === leg.routeId)
                  : null;
                const color = line?.color ?? "#6b7280";
                return (
                  <span
                    key={i}
                    className="nyc-bullet flex items-center justify-center w-5 h-5 rounded-full text-[10px] text-white border border-black/30"
                    style={{ backgroundColor: color }}
                  >
                    {leg.routeId}
                  </span>
                );
              })}
            </span>
            <span className="text-[12px] font-medium tracking-tight">
              Route shown
            </span>
            <span
              className="flex items-center justify-center w-6 h-6 rounded-full bg-white/[0.10] ml-0.5"
              aria-hidden
            >
              <X className="w-3.5 h-3.5" />
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
