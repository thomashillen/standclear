"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { MapPin } from "lucide-react";
import { useLines } from "@/lib/subwayData";
import { useTrains } from "@/lib/useTrains";
import AlertsButton from "./AlertsButton";
import LinePanel from "./LinePanel";
import LinePicker from "./LinePicker";
import NearbyPanel from "./NearbyPanel";
import StationPanel from "./StationPanel";

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
    // station views, not layered on top.
    if (line) {
      setNearbyOpen(false);
      setStationStopId(null);
    }
  };

  const handleStationOpen = (id: string) => {
    setStationStopId(id);
    setSelectedLine(null);
    setFocusStopId(undefined);
    setNearbyOpen(false);
  };

  const handleNearbyToggle = () => {
    const next = !nearbyOpen;
    setNearbyOpen(next);
    if (next) {
      setSelectedLine(null);
      setFocusStopId(undefined);
      setStationStopId(null);
      // Always fly on tap, even if the panel was already open — the
      // user is asking to be re-centered. Counter increments either
      // way (open or re-open), but we only signal on "open" since
      // closing the panel doesn't imply a camera move.
    }
    // Bump the signal both for open AND re-tap-while-open. Tapping
    // Near-me when the panel is already open is "find me again",
    // which should re-center the camera.
    setFlyToUserSignal((s) => s + 1);
  };

  const totalTrains = data?.trains.length ?? 0;
  const stale = data ? Date.now() - data.generatedAt > 60_000 : false;

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
            (!!selectedLine && !nearbyOpen && !stationStopId)
          }
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
          open={nearbyOpen && !stationStopId}
          onClose={() => setNearbyOpen(false)}
          onStationOpen={handleStationOpen}
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

        {/* Live-status indicator — compact circle with a glowing dot.
            No count text per design feedback; the dot alone signals
            "feed is alive" with its pulse. Slightly smaller than the
            buttons (w-9 vs w-11) so it visually reads as a status
            light rather than another tap target. The aria-label and
            title carry the actual numbers for accessibility/hover. */}
        <div
          className="pointer-events-auto flex items-center justify-center w-9 h-9 flex-shrink-0 rounded-full ios-glass border border-white/[0.10] shadow-[0_6px_20px_rgba(0,0,0,0.45)]"
          role="status"
          aria-live="polite"
          aria-label={
            !data
              ? "Connecting to live feed"
              : stale
                ? "Live feed is stale"
                : `${totalTrains} trains live`
          }
          title={
            !data
              ? "Connecting…"
              : stale
                ? "Stale — last refresh more than a minute ago"
                : `${totalTrains} trains live`
          }
        >
          <span className="relative flex w-2.5 h-2.5">
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
        </div>

        {/* Service alerts — bell with severity-tinted background and a
            count badge. Already self-styling; sits as its own floating
            tile in the row. */}
        <AlertsButton />

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
      </div>
    </div>
  );
}
