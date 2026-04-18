"use client";

import { memo, useMemo } from "react";
import { useLines } from "@/lib/subwayData";
import { useTrains, type Arrival } from "@/lib/useTrains";

interface LinePanelProps {
  lineId: string; // routeId (e.g. "1", "A", "GS")
  onClose: () => void;
}

function fmtEta(eta: number, now: number): string {
  const secs = eta - now / 1000;
  if (secs < 30) return "Now";
  const mins = Math.round(secs / 60);
  if (mins < 1) return "<1 min";
  return `${mins} min`;
}

interface StopRowProps {
  stopName: string;
  lineColor: string;
  nEtaStr?: string;
  sEtaStr?: string;
  trainHere: boolean;
  hasData: boolean;
  showConnector: boolean;
}

const StopRow = memo(function StopRow({
  stopName,
  lineColor,
  nEtaStr,
  sEtaStr,
  trainHere,
  hasData,
  showConnector,
}: StopRowProps) {
  return (
    <div
      className={`flex items-start gap-3 px-4 py-2 transition-colors ${
        trainHere ? "bg-gray-800/60" : "hover:bg-gray-900"
      }`}
    >
      <div className="flex flex-col items-center mt-1.5">
        <div
          className="w-3 h-3 rounded-full border-2 border-white flex-shrink-0 z-10"
          style={{ backgroundColor: trainHere ? "#fff" : lineColor }}
        />
        {showConnector && (
          <div
            className="w-0.5 mt-0.5"
            style={{ height: 28, backgroundColor: lineColor, opacity: 0.4 }}
          />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-tight text-gray-100 truncate">
          {stopName}
        </p>
        <div className="flex gap-3 text-[11px] text-gray-400 mt-0.5">
          {nEtaStr && (
            <span>
              <span className="opacity-60">N:</span>{" "}
              <span className="text-gray-200 font-medium">{nEtaStr}</span>
            </span>
          )}
          {sEtaStr && (
            <span>
              <span className="opacity-60">S:</span>{" "}
              <span className="text-gray-200 font-medium">{sEtaStr}</span>
            </span>
          )}
          {!nEtaStr && !sEtaStr && hasData && (
            <span className="text-gray-600">No upcoming trains</span>
          )}
        </div>
      </div>
    </div>
  );
});

export default function LinePanel({ lineId, onClose }: LinePanelProps) {
  const lines = useLines();
  const line = lines?.[lineId];
  const data = useTrains();
  const now = data?.generatedAt ?? Date.now();
  const routeId = line?.routeId;

  // One pass over arrivals/trains per poll, instead of O(stops × arrivals)
  // filters per render. Arrivals are already sorted by eta, so the first
  // entry per (stopId, direction) is the next arrival.
  const arrivalsByStop = useMemo(() => {
    const m = new Map<string, { n?: Arrival; s?: Arrival }>();
    if (!data || !routeId) return m;
    for (const a of data.arrivals) {
      if (a.routeId !== routeId) continue;
      const entry = m.get(a.stopId) ?? {};
      if (a.direction === "N") { if (!entry.n) entry.n = a; }
      else if (!entry.s) entry.s = a;
      m.set(a.stopId, entry);
    }
    return m;
  }, [data, routeId]);

  const trainsAtStop = useMemo(() => {
    const s = new Set<string>();
    if (!data || !routeId) return s;
    for (const t of data.trains) {
      if (t.routeId !== routeId) continue;
      if (t.progress > 0.85) s.add(t.nextStopId);
      if (t.progress < 0.15) s.add(t.prevStopId);
    }
    return s;
  }, [data, routeId]);

  const trainCount = useMemo(() => {
    if (!data || !routeId) return 0;
    let n = 0;
    for (const t of data.trains) if (t.routeId === routeId) n++;
    return n;
  }, [data, routeId]);

  if (!line) return null;

  const numStops = line.stops.length;
  const textClass = line.textColor === "black" ? "text-black" : "text-white";
  const stale = data ? Date.now() - data.generatedAt > 30_000 : false;

  return (
    <div
      className="
        flex flex-col bg-gray-950 overflow-hidden
        absolute inset-x-0 bottom-0 max-h-[65vh] z-20 rounded-t-2xl border-t border-gray-800 shadow-2xl
        sm:static sm:max-h-none sm:rounded-none sm:border-t-0 sm:border-l sm:shadow-none sm:w-72 sm:flex-shrink-0 sm:z-auto
      "
    >
      {/* Drag handle (mobile only) */}
      <div className="sm:hidden flex justify-center pt-2 pb-1 flex-shrink-0" style={{ backgroundColor: line.color }}>
        <div className="w-10 h-1 rounded-full bg-white/40" />
      </div>

      <div
        className={`flex items-center justify-between px-4 py-2.5 sm:py-3 flex-shrink-0 ${textClass}`}
        style={{ backgroundColor: line.color }}
      >
        <div className="flex items-center gap-2">
          <span className="text-2xl font-black">{line.id}</span>
          <span className="text-sm font-medium opacity-90">
            {trainCount} train{trainCount !== 1 ? "s" : ""}
          </span>
        </div>
        <button
          onClick={onClose}
          className={`${textClass} opacity-70 hover:opacity-100 text-2xl leading-none font-bold w-9 h-9 flex items-center justify-center -mr-2 touch-manipulation`}
          aria-label="Close panel"
        >
          ×
        </button>
      </div>

      <div className="flex text-xs font-semibold text-gray-400 bg-gray-900 border-b border-gray-800 px-4 py-2">
        <span className="flex-1 truncate">{line.stops[0]?.name}</span>
        <span className="opacity-40 mx-2">↕</span>
        <span className="flex-1 text-right truncate">{line.stops[numStops - 1]?.name}</span>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {!data && (
          <div className="text-center text-xs text-gray-500 py-8 animate-pulse">
            Loading live arrivals…
          </div>
        )}
        {line.stops.map((stop, idx) => {
          const arr = arrivalsByStop.get(stop.id);
          return (
            <StopRow
              key={stop.id}
              stopName={stop.name}
              lineColor={line.color}
              nEtaStr={arr?.n ? fmtEta(arr.n.eta, now) : undefined}
              sEtaStr={arr?.s ? fmtEta(arr.s.eta, now) : undefined}
              trainHere={trainsAtStop.has(stop.id)}
              hasData={!!data}
              showConnector={idx < numStops - 1}
            />
          );
        })}
      </div>

      <div className="px-4 py-2.5 border-t border-gray-800 bg-gray-950">
        <p className="text-[11px] text-gray-500 text-center">
          {stale ? "⚠ data may be stale" : "Live · MTA GTFS-RT · refreshes 15s"}
        </p>
      </div>
    </div>
  );
}
