"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { useLines } from "@/lib/subwayData";
import { useTrains } from "@/lib/useTrains";
import LinePanel from "./LinePanel";
import LinePicker from "./LinePicker";
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
  const data = useTrains();
  const lines = useLines();

  const handleLineSelect = (line: string | null, stopId?: string) => {
    setSelectedLine(line);
    setFocusStopId(stopId);
  };
  const totalTrains = data?.trains.length ?? 0;
  const stale = data ? Date.now() - data.generatedAt > 60_000 : false;

  return (
    <div className="flex flex-col h-full bg-gray-950 text-white">
      {/* ── Header ── */}
      <header className="flex items-center gap-2 sm:gap-4 px-2 sm:px-4 py-2.5 sm:py-3 bg-gray-950 border-b border-gray-800 z-10 flex-shrink-0">
        <h1 className="text-base sm:text-lg font-black tracking-tight text-white sm:mr-2 flex-shrink-0">
          <span className="hidden sm:inline">SubwaySurfer</span>
          <span className="sm:hidden text-3xl leading-none" aria-label="SubwaySurfer">🚇</span>
        </h1>

        {/* Line picker */}
        <div className="flex-1 min-w-0">
          <LinePicker
            lines={lines}
            selectedLine={selectedLine}
            onSelect={handleLineSelect}
          />
        </div>

        {/* Status badge — compact on mobile (count only), full text on desktop */}
        <div className="flex items-center gap-1.5 text-xs text-gray-400 flex-shrink-0" title="MTA GTFS-Realtime feed">
          <span
            className={`w-2 h-2 rounded-full ${
              !data ? "bg-gray-500 animate-pulse" : stale ? "bg-amber-400" : "bg-green-400 animate-pulse"
            }`}
          />
          <span className="md:hidden tabular-nums">
            {!data ? "…" : stale ? "stale" : `${totalTrains} live`}
          </span>
          <span className="hidden md:inline">
            {!data ? "Connecting…" : stale ? "Stale" : `Live · ${totalTrains} trains`}
          </span>
        </div>

        {/* About */}
        <Dialog>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="text-gray-400 hover:text-white flex-shrink-0 px-3 min-h-11 sm:min-h-0 sm:h-8 touch-manipulation"
            >
              About
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-gray-900 border-gray-700 text-white">
            <DialogHeader>
              <DialogTitle className="text-white text-xl font-black">SubwaySurfer</DialogTitle>
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
        {selectedLine && (
          <LinePanel
            lineId={selectedLine}
            focusStopId={focusStopId}
            onClose={() => {
              setSelectedLine(null);
              setFocusStopId(undefined);
            }}
          />
        )}
      </div>
    </div>
  );
}
