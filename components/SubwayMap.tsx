"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { MapPin } from "lucide-react";
import { useLines } from "@/lib/subwayData";
import { useTrains } from "@/lib/useTrains";
import LinePanel from "./LinePanel";
import LinePicker from "./LinePicker";
import NearbyPanel from "./NearbyPanel";
import StationPanel from "./StationPanel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

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
    }
  };
  const totalTrains = data?.trains.length ?? 0;
  const stale = data ? Date.now() - data.generatedAt > 60_000 : false;

  return (
    <div className="flex flex-col h-full bg-gray-950 text-white">
      {/* ── Header — iOS-style glass bar with safe-area top ── */}
      <header
        className="
          relative z-10 flex-shrink-0 flex items-center gap-2 sm:gap-3
          px-3 sm:px-4 pt-safe
          ios-glass
          border-b border-white/[0.06]
        "
        style={{
          paddingTop: "calc(max(var(--safe-top), 0.5rem) + 0.5rem)",
          paddingBottom: "0.625rem",
        }}
      >
        <h1 className="text-base sm:text-lg font-black tracking-tight text-white flex-shrink-0 select-none">
          <span className="hidden sm:inline">SubwaySurfer</span>
          <span className="sm:hidden text-[26px] leading-none" aria-label="SubwaySurfer">🚇</span>
        </h1>

        {/* Line picker */}
        <div className="flex-1 min-w-0">
          <LinePicker
            lines={lines}
            selectedLine={selectedLine}
            onSelect={handleLineSelect}
          />
        </div>

        {/* Status badge — subtle pill; count on mobile, full text on desktop */}
        <div
          className="flex items-center gap-1.5 text-[11px] text-gray-300/90 flex-shrink-0 px-2 h-7 rounded-full bg-white/[0.06] border border-white/[0.06]"
          title="MTA GTFS-Realtime feed"
        >
          <span className="relative flex w-2 h-2">
            <span
              className={`absolute inset-0 rounded-full ${
                !data ? "bg-gray-500" : stale ? "bg-amber-400" : "bg-emerald-400"
              }`}
            />
            {data && !stale && (
              <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-60" />
            )}
          </span>
          <span className="tabular-nums font-medium">
            {!data ? "Connecting…" : stale ? "Stale" : `${totalTrains} live`}
          </span>
        </div>

        {/* Near me */}
        <button
          onClick={handleNearbyToggle}
          aria-label="Find nearby stations"
          aria-pressed={nearbyOpen}
          className={`press flex items-center justify-center w-11 h-11 sm:w-9 sm:h-9 rounded-full touch-manipulation flex-shrink-0 transition-colors ${
            nearbyOpen
              ? "bg-white text-gray-950 shadow-[0_4px_16px_rgba(255,255,255,0.18)]"
              : "bg-white/[0.08] text-gray-100 hover:bg-white/[0.12] border border-white/[0.08]"
          }`}
        >
          <MapPin className="w-[18px] h-[18px]" />
        </button>

        {/* About */}
        <Dialog>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="press text-gray-300 hover:text-white hover:bg-white/[0.08] flex-shrink-0 px-3 h-11 sm:h-9 rounded-full touch-manipulation"
            >
              About
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-gray-900/90 backdrop-blur-xl border-white/10 text-white rounded-3xl">
            <DialogHeader>
              <DialogTitle className="text-white text-xl font-black tracking-tight">SubwaySurfer</DialogTitle>
              <DialogDescription className="text-gray-400">
                Real-time NYC subway visualization
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm text-gray-300">
              <p>
                SubwaySurfer shows live train positions across the NYC subway,
                pulled directly from the MTA&apos;s GTFS-Realtime feeds.
              </p>
              <ul className="list-disc list-inside space-y-1 text-gray-400">
                <li>Click any line button or line on the map to focus it</li>
                <li>Train positions interpolate between stops based on real arrival predictions</li>
                <li>The side panel shows live N/S arrival times at every stop</li>
                <li>Data refreshes every 8 seconds</li>
              </ul>
              <p className="text-gray-500 text-xs pt-2">
                Static map: GTFS shapes from MTA. Realtime: 8 NYCT GTFS-RT feeds (no API key required).
              </p>
            </div>
          </DialogContent>
        </Dialog>
      </header>

      {/* ── Map + Panel ── */}
      <div className="relative flex flex-1 min-h-0">
        <MapView selectedLine={selectedLine} onLineSelect={handleLineSelect} />
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
    </div>
  );
}
