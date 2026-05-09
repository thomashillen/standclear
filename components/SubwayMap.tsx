"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MapPin, MoreHorizontal, Search, TrainFront } from "lucide-react";
import { useLines } from "@/lib/subwayData";
import { useFeedHealth, useTrains } from "@/lib/useTrains";
import { useOnline } from "@/lib/useOnline";
import { legGeometry, type TripPlan } from "@/lib/commuteRouting";
import { pickDismissTarget } from "@/lib/escDismiss";
import { buildStationIndex, type StationEntry } from "@/lib/stopsIndex";
import {
  clearWalkingRouteCache,
  fetchWalkingRoute,
  type WalkingRoute,
} from "@/lib/walkingDirections";

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
import FollowCapsule from "./FollowCapsule";
import InstallPrompt from "./InstallPrompt";
import LinePanel from "./LinePanel";
import LinePicker from "./LinePicker";
import LiveTrainsPopup from "./LiveTrainsPopup";
import MoreSheet from "./MoreSheet";
import NearbyPanel from "./NearbyPanel";
import SearchSheet from "./SearchSheet";
import StationPanel from "./StationPanel";
import type { SelectedTrip } from "./MapView";
import { useNow } from "@/lib/useNow";

// Convert "#abcdef" → "171 205 239" so the value can be plugged into
// `rgb(var(--glass-tint) / α)`. Tolerates 3- and 6-digit hex; returns
// null on anything unparseable so callers can leave the tint at its
// neutral default rather than rendering a random color.
function hexToRgbTriplet(hex: string): string | null {
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  const expanded =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  if (expanded.length !== 6) return null;
  const r = parseInt(expanded.slice(0, 2), 16);
  const g = parseInt(expanded.slice(2, 4), 16);
  const b = parseInt(expanded.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return `${r} ${g} ${b}`;
}

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
  // Cinematic follow-my-train mode. When set, MapView locks the
  // camera onto the train (tracking its live position with pitch +
  // tighter zoom) and the floating header is replaced by a compact
  // glass capsule showing the train's next stop and ETA. Cleared by
  // tapping the capsule's exit affordance OR by dragging/zooming
  // the map (handled inside MapView so the lock can release on any
  // explicit camera move).
  const [followedTrainId, setFollowedTrainIdState] = useState<string | null>(null);
  // Index of the leg the rider has zoomed in on from the expanded
  // route detail. Null means "frame the whole trip" (default).
  // Cleared whenever the trip selection changes so a new plan opens
  // at full extent.
  const [focusedLegIndex, setFocusedLegIndex] = useState<number | null>(
    null,
  );
  // Resolved street-following walking routes for the trip's start
  // and end walk segments. Fetched from Mapbox Directions (walking
  // profile) when a selection has address endpoints. The map renders
  // the resolved geometry as the dashed walk line; the SearchSheet
  // expanded view renders the per-step instructions.
  const [walkFromRoute, setWalkFromRoute] = useState<WalkingRoute | null>(null);
  const [walkToRoute, setWalkToRoute] = useState<WalkingRoute | null>(null);
  // Failure flags for the two walking-route fetches above. Set when a
  // fetchWalkingRoute call resolves to null (HTTP error, malformed
  // response, or network failure on a flaky platform) so the route
  // detail card can surface a retry affordance instead of leaving
  // the rider with the silent crow-flies fallback. Cleared whenever
  // endpoints change or the rider taps Retry.
  const [walkFromError, setWalkFromError] = useState(false);
  const [walkToError, setWalkToError] = useState(false);
  // Bumping this re-runs the walking-route fetch effect even when the
  // endpoint deps are unchanged. Wired to the Retry button in the
  // route detail card.
  const [walkRetryToken, setWalkRetryToken] = useState(0);
  // Stand-alone walking-faster overlay. Set by SearchSheet when the
  // direct walk between the two endpoints is at least as fast as any
  // subway plan — MapView renders a dashed walking line on its own
  // (no subway-trip rendering) and fits the camera to the walk.
  const [walkOnlyOverlay, setWalkOnlyOverlay] = useState<{
    from: { lng: number; lat: number };
    to: { lng: number; lat: number };
    coords?: [number, number][];
  } | null>(null);
  // Whether the SearchSheet is currently inside a plan's detail view
  // (panel ≈38dvh) vs the plan-list view (panel ≈60dvh). MapView uses
  // it to pick the right bottom padding when fitting the trip — so a
  // route's southern end doesn't hide behind the taller plan-list
  // panel.
  const [tripDetailExpanded, setTripDetailExpanded] = useState(false);

  // Drop every piece of trip-overlay state in one shot. The overlay
  // belongs to whichever sheet sourced it (SearchSheet / NearbyPanel
  // commute card); switching to a different context — opening Near-me,
  // tapping a line, opening a station, entering follow mode, etc. —
  // should put the map back into all-trains mode that matches the new
  // panel. Previously each handler cleared a different subset of these
  // four fields, so e.g. a leftover `walkOnlyOverlay` would keep a
  // dashed walk path painted under the next view. Declared *after*
  // every state field it touches so the linter's no-use-before-defined
  // rule sees the declarations in the right order — runtime works
  // either way (callbacks resolve free vars at call time, not at
  // creation time) but the static check would otherwise fail CI.
  const clearTripOverlay = useCallback(() => {
    setSelectedTripSelection(null);
    setFocusedLegIndex(null);
    setWalkOnlyOverlay(null);
    setTripDetailExpanded(false);
  }, []);
  // Wrap the follow setter so entering follow mode also closes any
  // sheet covering the map — a panel would defeat the cinematic
  // shot, and every panel's open-state machine already expects
  // mutual exclusion with the other entry points.
  const setFollowedTrainId = useCallback((id: string | null) => {
    setFollowedTrainIdState(id);
    if (id) {
      setNearbyOpen(false);
      setSearchOpen(false);
      setMoreOpen(false);
      setSelectedLine(null);
      setFocusStopId(undefined);
      setStationStopId(null);
      // Drop the trip overlay too — a highlighted route under the
      // cinematic frame would split the rider's attention between
      // "that train I'm following" and "this trip I planned earlier."
      clearTripOverlay();
    }
  }, [clearTripOverlay]);

  // Bottom-padding fraction MapView reserves when fitting the
  // selected trip's bounds. Depends on which panel actually sourced
  // the selection — SearchSheet's plan-list view occupies ~62dvh
  // (full list scroll), NearbyPanel's half-detent commute card
  // covers ~50dvh (see halfRestingY in NearbyPanel.tsx), and the
  // SearchSheet detail view sits at ~38dvh. Using one fraction for
  // every non-Search source previously cropped the bottom of routes
  // tapped from NearbyPanel because 0.42 underestimates the half
  // detent's true coverage by ~8dvh. Computing it here keeps MapView
  // ignorant of which sheet drove the selection.
  const tripFitBottomDvh = useMemo(() => {
    if (searchOpen && !tripDetailExpanded) return 0.62;
    if (nearbyOpen) return 0.52;
    return 0.42;
  }, [searchOpen, tripDetailExpanded, nearbyOpen]);
  // Fly-to-user signal — increments each time the user taps Near-me so
  // MapView can fly the camera to their location (waiting for geo if it
  // isn't available yet). Counter, not a boolean, so successive taps
  // each register as fresh requests rather than no-ops.
  const [flyToUserSignal, setFlyToUserSignal] = useState(0);
  // Counter the Near-me panel bumps when an out-of-NYC rider taps
  // "Preview the map". Treated identically to flyToUserSignal but
  // routes to a different camera move (canonical Manhattan overview
  // instead of the rider's geolocation).
  const [flyToDefaultSignal, setFlyToDefaultSignal] = useState(0);
  const data = useTrains();
  const lines = useLines();
  // Live wall-clock for the follow capsule's countdown. Tied to a
  // 1Hz tick so the ETA refreshes second by second; gated by an
  // active follow lock so we don't run a global timer when nothing
  // is consuming it.
  const now = useNow(!!followedTrainId);

  // Drive the global liquid-glass tint from the currently selected
  // line. Every `.ios-glass` surface picks up `--glass-tint` /
  // `--glass-tint-strength` automatically, so when the rider focuses
  // a line every floating button, sheet, and modal subtly washes
  // toward that line's color — a non-modal way to confirm the
  // selection. Cleared when nothing is selected so the chrome
  // returns to neutral.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const line = selectedLine && lines ? lines[selectedLine] : null;
    if (!line) {
      root.style.setProperty("--glass-tint-strength", "0");
      return;
    }
    const rgb = hexToRgbTriplet(line.color);
    if (rgb) {
      root.style.setProperty("--glass-tint", rgb);
      root.style.setProperty("--glass-tint-strength", "1");
    }
  }, [selectedLine, lines]);

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
      clearTripOverlay();
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
    clearTripOverlay();
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
      setMoreOpen(false);
      // Drop any trip overlay sourced from the panel we just
      // displaced (e.g. a commute route NearbyPanel had highlighted) —
      // entering a fresh search is a new context and the rider
      // expects the map to start clean.
      clearTripOverlay();
    } else {
      // Closing via the header button — drop the trip overlay so a
      // dashed walking path or highlighted route doesn't outlive the
      // panel that owned it. SearchSheet's own dialog-close path
      // already clears these; the toggle button skips that callback,
      // so without this the overlay would persist on the map after
      // the sheet animated out.
      clearTripOverlay();
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
      setMoreOpen(false);
      // Drop any active trip overlay too. Near-me is "what's around
      // me right now"; a leftover highlighted route + walking legs
      // would make the panel and the map disagree about context.
      clearTripOverlay();
    } else {
      // Toggling Near-me off via the floating button is also an
      // exit from the commute-route context the panel may have
      // shown — clear the overlay so the map returns to the
      // default all-trains view rather than stranding a
      // highlighted route with no panel to back it.
      clearTripOverlay();
    }
    // Bump the signal both for open AND re-tap-while-open. Tapping
    // Near-me when the panel is already open is "find me again",
    // which should re-center the camera.
    setFlyToUserSignal((s) => s + 1);
  };

  // ── ESC dismisses the topmost open surface ─────────────────────────
  // Bottom-sheet panels in this app are custom (not Radix), so they
  // don't get the Dialog primitive's free escape-to-close. Wire one
  // window-level listener here that consults pickDismissTarget for
  // the priority order.
  //
  // Radix-managed dialogs (LiveTrainsPopup, MoreSheet's nested
  // AlertsDialog / AboutDialog, the LinePicker popover) attach their
  // own ESC listener on the document in capture phase; when that
  // dismisses the topmost layer it calls event.preventDefault() but
  // *not* event.stopPropagation() (see
  // @radix-ui/react-dismissable-layer). Without an explicit guard,
  // this bubble-phase listener would still fire on the same keypress
  // and dismiss whichever custom panel is open underneath, breaking
  // stacked-dismissal semantics. The defaultPrevented short-circuit
  // is the fix — exactly one layer should respond per ESC.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // A Radix layer (or any other inner ESC handler) already
      // claimed this keypress — don't fire a second dismiss on the
      // panel underneath.
      if (e.defaultPrevented) return;
      // IME composition swallows ESC for input candidates; let the
      // input handle it before we treat ESC as a dismiss.
      if (e.isComposing) return;
      const target = pickDismissTarget({
        searchOpen,
        stationOpen: !!stationStopId,
        lineOpen: !!selectedLine,
        nearbyOpen,
        moreOpen,
        followActive: !!followedTrainId,
      });
      if (!target) return;
      e.preventDefault();
      switch (target) {
        case "search":
          setSearchOpen(false);
          // Mirror SearchSheet's own onClose contract — anchor-pick
          // mode and the preset trip belong to a single open session.
          setSearchAnchorPick(null);
          setSearchPresetTrip(null);
          clearTripOverlay();
          return;
        case "station":
          setStationStopId(null);
          return;
        case "line":
          setSelectedLine(null);
          setFocusStopId(undefined);
          return;
        case "nearby":
          setNearbyOpen(false);
          // Same overlay-cleanup as the Near-me toggle button.
          clearTripOverlay();
          return;
        case "more":
          setMoreOpen(false);
          return;
        case "follow":
          setFollowedTrainId(null);
          return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    searchOpen,
    stationStopId,
    selectedLine,
    nearbyOpen,
    moreOpen,
    followedTrainId,
    setFollowedTrainId,
    clearTripOverlay,
  ]);

  const totalTrains = data?.trains.length ?? 0;
  // Slow tick (10s) just for the stale banner — reading Date.now() in
  // render trips React 19's purity rule, and the existing follow-mode
  // useNow above is gated on followedTrainId so it can't be reused.
  const staleTick = useNow(true, 10_000);
  const stale = data ? staleTick - data.generatedAt > 60_000 : false;
  // Folded into the live-feed pill so the rider knows the app feels
  // frozen because *they* are offline, not because the MTA feed is
  // down. Drives a distinct red dot + "Offline" copy on the pill.
  const online = useOnline();
  // Feed health from useTrains — surfaces a "Feed degraded" state on
  // the live pill when /api/trains has failed N consecutive polls,
  // distinct from "stale" (last success > 60s ago) and "offline"
  // (the device dropped its own connection).
  const feedHealth = useFeedHealth();
  const feedDegraded = online && feedHealth.degraded;

  // ─── Deep-link bootstrap ──────────────────────────────────────────
  // Per-station SEO pages link back here as `/?station=<stopId>`,
  // and the marketing surface uses `?line=<id>` for line landings.
  // Read once on mount and apply — we don't keep the URL in sync
  // afterward (the in-app navigation is its own state machine; a
  // deep link is an entry point, not a continuous binding). The
  // set-state-in-effect linter flag is suppressed for this block:
  // we're intentionally seeding initial state from the URL on mount,
  // which is the documented "external system → React state" pattern.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const stationParam = params.get("station");
    const lineParam = params.get("line");
    /* eslint-disable react-hooks/set-state-in-effect */
    if (stationParam) {
      setStationStopId(stationParam);
      setNearbyOpen(false);
      // Clear the param so a refresh doesn't re-apply forever after
      // the rider closes the panel.
      const url = new URL(window.location.href);
      url.searchParams.delete("station");
      window.history.replaceState({}, "", url.toString());
    } else if (lineParam) {
      setSelectedLine(lineParam);
      setNearbyOpen(false);
      const url = new URL(window.location.href);
      url.searchParams.delete("line");
      window.history.replaceState({}, "", url.toString());
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

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

  // Reset cached walk routes whenever the underlying selection
  // (or its endpoints) changes — otherwise a switch from plan A to
  // plan B would briefly render plan A's resolved walk path against
  // plan B's stations. Deriving from props in render would race the
  // async fetch that populates these states; clearing in an effect
  // keyed on the endpoints is the cleanest correct shape.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setWalkFromRoute(null);
    setWalkToRoute(null);
    setWalkFromError(false);
    setWalkToError(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [
    selectedTripSelection?.walkFrom?.lng,
    selectedTripSelection?.walkFrom?.lat,
    selectedTripSelection?.walkTo?.lng,
    selectedTripSelection?.walkTo?.lat,
    selectedTripSelection?.plan,
  ]);

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
      walkFromCoords: walkFromRoute?.coordinates,
      walkToCoords: walkToRoute?.coordinates,
    };
  }, [selectedTripSelection, lines, walkFromRoute, walkToRoute]);

  // Fetch real pedestrian routes from Mapbox Directions (walking
  // profile) once we know both the rider's walk endpoint and the
  // resolved boarding / alighting station for the selected plan.
  // Without this the dashed walk segment would just be a straight
  // crow-flies line and the rider would have no idea which streets
  // to actually take.
  //
  // Dep list is the four endpoint coordinates explicitly. `selectedTrip`
  // would be the natural object dep, but it's a useMemo whose own
  // dep list includes walkFromRoute/walkToRoute — so when one fetch
  // resolves and sets the route, selectedTrip recomputes a new ref
  // and re-fires this effect, triggering a redundant
  // (cache-hitting) second fetchWalkingRoute call. Keying on
  // primitives sidesteps that and keeps the fetch firing exactly
  // once per real endpoint change.
  const walkBoard = selectedTrip?.legs[0]?.boardStation;
  const walkAlight = selectedTrip?.legs[selectedTrip.legs.length - 1]?.alightStation;
  const walkFromCoords = selectedTrip?.walkFrom;
  const walkToCoords = selectedTrip?.walkTo;
  useEffect(() => {
    if (!walkFromCoords && !walkToCoords) return;
    let cancelled = false;
    if (walkFromCoords && walkBoard) {
      fetchWalkingRoute(
        { lng: walkFromCoords.lng, lat: walkFromCoords.lat },
        { lng: walkBoard.lng, lat: walkBoard.lat },
      ).then((route) => {
        if (cancelled) return;
        if (route) setWalkFromRoute(route);
        else setWalkFromError(true);
      });
    }
    if (walkToCoords && walkAlight) {
      fetchWalkingRoute(
        { lng: walkAlight.lng, lat: walkAlight.lat },
        { lng: walkToCoords.lng, lat: walkToCoords.lat },
      ).then((route) => {
        if (cancelled) return;
        if (route) setWalkToRoute(route);
        else setWalkToError(true);
      });
    }
    return () => {
      cancelled = true;
    };
    // The four primitive coord/id deps capture full identity of the
    // four endpoints; depending on the parent objects would re-fire
    // the effect when an unrelated property updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    walkFromCoords?.lng,
    walkFromCoords?.lat,
    walkToCoords?.lng,
    walkToCoords?.lat,
    walkBoard?.stopId,
    walkAlight?.stopId,
    walkBoard?.lng,
    walkBoard?.lat,
    walkAlight?.lng,
    walkAlight?.lat,
    walkRetryToken,
  ]);

  // Retry handler for failed walking-route fetches. Drops the cached
  // null entries that the failed fetches left behind, clears the
  // error flags, and bumps the retry token so the fetch effect re-runs
  // even though the endpoint deps haven't changed. Wired to the route
  // detail card's Retry button.
  const retryWalkRoutes = useCallback(() => {
    if (walkFromCoords && walkBoard) {
      clearWalkingRouteCache(
        { lng: walkFromCoords.lng, lat: walkFromCoords.lat },
        { lng: walkBoard.lng, lat: walkBoard.lat },
      );
    }
    if (walkToCoords && walkAlight) {
      clearWalkingRouteCache(
        { lng: walkAlight.lng, lat: walkAlight.lat },
        { lng: walkToCoords.lng, lat: walkToCoords.lat },
      );
    }
    setWalkFromError(false);
    setWalkToError(false);
    setWalkRetryToken((t) => t + 1);
  }, [walkFromCoords, walkToCoords, walkBoard, walkAlight]);

  // Trip selection handler — called from SearchSheet / NearbyPanel
  // when a plan row is tapped. Receives the plan plus optional
  // walking endpoints (rider's actual coords vs. station coords) so
  // the map can draw dashed pedestrian legs at start/end. Pass null
  // to clear. Resets any per-leg focus so the new plan opens framed
  // at full extent rather than zoomed into a leg from the previous
  // plan.
  const handleTripSelect = (selection: TripSelection | null) => {
    setSelectedTripSelection(selection);
    setFocusedLegIndex(null);
  };

  // True when any of the z-20 bottom-sheet panels is rendered (Nearby,
  // Station, Line, Search, More). Drives MapView's camera-padding
  // offset. The Route-shown pill stays visible when a panel is open
  // — instead, the panel-top-rest is bumped down so the pill clears
  // the panel header (see the inline --panel-top-rest override
  // below).
  const panelOpen =
    (nearbyOpen && !stationStopId) ||
    !!stationStopId ||
    (!!selectedLine && !nearbyOpen && !stationStopId) ||
    searchOpen ||
    moreOpen;

  return (
    <div
      className="relative flex flex-col h-full bg-gray-950 text-white"
      style={{
        // Panel top resting edge — shared CSS variable consumed by
        // every bottom-sheet panel so they all start at the same
        // distance from the top of the screen, clearing the floating
        // control row (h-11 ≈ 2.75rem) plus safe-area and a small gap.
        ["--panel-top-rest" as string]:
          "calc(max(var(--safe-top), 0.5rem) + 4rem)",
      }}
    >
      {/* ── Map fills the full viewport ── */}
      <div className="relative flex flex-1 min-h-0">
        <MapView
          selectedLine={selectedLine}
          stationStopId={stationStopId}
          onLineSelect={handleLineSelect}
          onStationOpen={handleStationOpen}
          flyToUserSignal={flyToUserSignal}
          flyToDefaultSignal={flyToDefaultSignal}
          // Camera padding for fly-to-user when a panel is covering
          // part of the screen, so the user's location lands in the
          // visible map area rather than behind the panel.
          panelOpen={panelOpen}
          selectedTrip={selectedTrip}
          focusedLegIndex={focusedLegIndex}
          walkOnlyOverlay={walkOnlyOverlay}
          tripFitBottomDvh={tripFitBottomDvh}
          followedTrainId={followedTrainId}
          onFollowTrain={setFollowedTrainId}
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
          onClose={() => {
            setNearbyOpen(false);
            // The commute-route overlay belongs to NearbyPanel; the
            // X / backdrop dismissal is "exit this context", so the
            // overlay has to go too. Without this, a highlighted
            // route + dashed walk legs persisted on the map after
            // the panel animated away — same bug SearchSheet's
            // onClose already handles for its own overlays.
            clearTripOverlay();
          }}
          onStationOpen={handleStationOpen}
          onTripSelect={handleTripSelect}
          selectedTripKey={selectedTripKey}
          onSeeAllRoutes={handleSeeAllRoutes}
          onPreviewMap={() => {
            setNearbyOpen(false);
            clearTripOverlay();
            setFlyToDefaultSignal((s) => s + 1);
          }}
          onOpenMore={() => {
            setNearbyOpen(false);
            clearTripOverlay();
            setMoreOpen(true);
          }}
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
            setFocusedLegIndex(null);
            setSearchAnchorPick(null);
            setSearchPresetTrip(null);
            setWalkOnlyOverlay(null);
          }}
          onStationOpen={handleStationOpen}
          onTripSelect={handleTripSelect}
          selectedTripKey={selectedTripKey}
          walkFromRoute={walkFromRoute}
          walkToRoute={walkToRoute}
          walkRouteError={walkFromError || walkToError}
          onRetryWalkRoutes={retryWalkRoutes}
          focusedLegIndex={focusedLegIndex}
          onFocusLeg={setFocusedLegIndex}
          onWalkOnlyChange={setWalkOnlyOverlay}
          onExpandedPlanChange={setTripDetailExpanded}
        />
      </div>

      {/* Cinematic follow-my-train capsule — replaces the floating
          header while a follow lock is active. Same vertical position
          as the header so the rider's eye doesn't have to relocate
          between the two modes. */}
      {followedTrainId && (
        <FollowCapsule
          trainId={followedTrainId}
          data={data}
          lines={lines}
          now={now}
          onExit={() => setFollowedTrainId(null)}
        />
      )}

      {/* ── Floating Liquid Glass control row, overlaid on the map ──
          The container itself is pointer-events-none so users can pan
          the map between buttons; each interactive child opts back in
          with pointer-events-auto. iOS-26-style frosted-glass tiles
          float independently rather than sharing a header bar — same
          spatial grouping as Apple Maps' top-row controls.

          Unmounted entirely while following a train so the cinematic
          frame isn't fighting the line picker / live pulse / search
          controls for screen real estate. The earlier `opacity-0 +
          pointer-events-none` approach left ghost taps hitting the
          invisible buttons because each child opts back into pointer
          events with `pointer-events-auto`. */}
      {!followedTrainId && (
      <div
        className="absolute inset-x-0 top-0 z-30 flex items-center gap-2 px-3 pointer-events-none transition-opacity duration-200 opacity-100"
        style={{
          paddingTop: "calc(max(var(--safe-top), 0.5rem) + 0.5rem)",
        }}
      >
        {/* Brand pill — wordmark + tagline above the fold. Hidden on
            mobile (the floating row gets crowded by the line picker
            and 4 buttons; the iOS standalone status-bar carries the
            brand there). On desktop it doubles as identity AND a
            home affordance — a same-page link to "/" reloads the
            map shell, which is the closest thing to a "back to
            top" we have. */}
        <Link
          href="/"
          aria-label="StandClear — live NYC subway"
          className="pointer-events-auto hidden sm:flex items-center gap-2 h-11 pl-3 pr-4 rounded-full ios-glass ios-glass--header border border-white/[0.10] shadow-[0_6px_20px_rgba(0,0,0,0.45)] flex-shrink-0 select-none touch-manipulation hover:border-white/[0.18] transition-colors"
        >
          <span className="text-[20px] leading-none" aria-hidden>
            🚇
          </span>
          <span className="leading-tight">
            <span className="block text-[13px] font-black tracking-tight text-white">
              StandClear
            </span>
            <span className="block text-[10px] font-medium tracking-wide text-gray-400">
              Live NYC subway
            </span>
          </span>
        </Link>

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
            !online
              ? "Offline — tap for details"
              : !data
                ? "Connecting to live feed"
                : feedDegraded
                  ? `Feed degraded after ${feedHealth.consecutiveFailures} retries — tap for details`
                  : stale
                    ? "Live feed is stale — tap for details"
                    : `${totalTrains} trains live — tap for system pulse`
          }
          aria-pressed={livePulseOpen}
          title={
            !online
              ? "Offline — showing last-known data"
              : !data
                ? "Connecting…"
                : feedDegraded
                  ? `Feed degraded — ${feedHealth.consecutiveFailures} failed polls (${feedHealth.lastError ?? "network error"})`
                  : stale
                    ? "Stale — last refresh more than a minute ago"
                    : `${totalTrains} trains live`
          }
          className="pointer-events-auto press flex items-center gap-1.5 h-9 px-2.5 flex-shrink-0 rounded-full ios-glass ios-glass--header border border-white/[0.10] shadow-[0_6px_20px_rgba(0,0,0,0.45)] touch-manipulation"
        >
          <span className="relative flex w-2 h-2">
            <span
              className={`absolute inset-0 rounded-full ${
                !online
                  ? "bg-rose-400"
                  : !data
                    ? "bg-gray-500"
                    : feedDegraded
                      ? "bg-rose-400"
                      : stale
                        ? "bg-amber-400"
                        : "bg-emerald-400"
              } shadow-[0_0_8px_currentColor]`}
              style={{
                color: !online
                  ? "rgba(251,113,133,0.65)"
                  : !data
                    ? "rgba(107,114,128,0.5)"
                    : feedDegraded
                      ? "rgba(251,113,133,0.65)"
                      : stale
                        ? "rgba(251,191,36,0.6)"
                        : "rgba(52,211,153,0.7)",
              }}
            />
            {online && data && !stale && !feedDegraded && (
              <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-60" />
            )}
          </span>
          {/* Train glyph next to the count so a first-time visitor
              reads "live trains" rather than just an unlabeled number.
              Subtle gray so the pulsing dot stays the visual anchor.
              When offline we show "Offline" copy instead of a count
              that would be a stale lie. */}
          {!online ? (
            <span className="text-[11px] font-semibold uppercase tracking-wide text-rose-200 leading-none">
              Offline
            </span>
          ) : feedDegraded ? (
            <span className="text-[11px] font-semibold uppercase tracking-wide text-rose-200 leading-none">
              Feed
            </span>
          ) : (
            <>
              <TrainFront className="w-3 h-3 text-gray-400 flex-shrink-0" />
              <span className="text-[12px] font-bold tabular-nums text-gray-100 leading-none">
                {data ? totalTrains : "…"}
              </span>
            </>
          )}
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
              : "ios-glass ios-glass--header text-gray-100 border-white/[0.10]"
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
              : "ios-glass ios-glass--header text-gray-100 border-white/[0.10]"
          }`}
        >
          <MapPin className="w-[18px] h-[18px]" />
        </button>

        {/* More menu — service alerts, Home/Work address, About.
            Sits on the far right of the floating header, matching the
            iOS convention that "settings / overflow actions" live at
            the trailing edge. */}
        <button
          onClick={() => {
            // Close any other panel that's currently covering the
            // map slot — More is mutually exclusive with Search /
            // NearbyPanel / LinePanel / StationPanel, same as the
            // other floating-button entry points. In particular,
            // when the rider is mid-anchor-pick (MoreSheet opened
            // SearchSheet to grab a Home/Work address), tapping
            // the dots again should bounce back to More instead
            // of leaving the search panel layered behind it.
            setSearchOpen(false);
            setNearbyOpen(false);
            setSelectedLine(null);
            setFocusStopId(undefined);
            setStationStopId(null);
            setSearchAnchorPick(null);
            setSearchPresetTrip(null);
            // Drop any trip overlay from the panel being displaced
            // — same rationale as the other floating-button entry
            // points: opening More is a context switch, and a
            // leftover commute route would contradict the panel.
            clearTripOverlay();
            setMoreOpen(true);
          }}
          aria-label="More options"
          aria-pressed={moreOpen}
          className="pointer-events-auto press flex items-center justify-center w-11 h-11 rounded-full touch-manipulation flex-shrink-0 transition-colors border shadow-[0_6px_20px_rgba(0,0,0,0.45)] ios-glass ios-glass--header text-gray-100 border-white/[0.10]"
        >
          <MoreHorizontal className="w-[18px] h-[18px]" />
        </button>
      </div>
      )}

      {/* One-shot Add-to-Home-Screen nudge. Hides itself on standalone
          PWAs, on desktop, and after a one-time dismiss — so the
          steady-state UI is unaffected. Mounted as a sibling of the
          floating header so the prompt sits above the bottom-sheet
          stacking context. */}
      <InstallPrompt />
    </div>
  );
}
