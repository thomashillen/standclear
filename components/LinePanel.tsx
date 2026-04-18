"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useLines, CORRIDOR } from "@/lib/subwayData";
import { useTrains, type Arrival } from "@/lib/useTrains";

interface LinePanelProps {
  lineId: string; // routeId (e.g. "1", "A", "GS")
  focusStopId?: string;
  onClose: () => void;
}

function fmtEta(eta: number, now: number): string {
  const secs = eta - now / 1000;
  if (secs < 30) return "Now";
  const mins = Math.round(secs / 60);
  if (mins < 1) return "<1 min";
  return `${mins} min`;
}

interface RouteBadge {
  id: string;
  color: string;
  textColor: "white" | "black";
}

interface StopRowProps {
  stopId: string;
  stopName: string;
  lineColor: string;
  nEtaStr?: string;
  sEtaStr?: string;
  nBadge?: RouteBadge;
  sBadge?: RouteBadge;
  trainHere: boolean;
  hasData: boolean;
  showConnector: boolean;
}

function Bullet({ badge }: { badge: RouteBadge }) {
  return (
    <span
      className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-[9px] font-black leading-none mr-1 align-[-1px]"
      style={{ backgroundColor: badge.color, color: badge.textColor === "black" ? "#000" : "#fff" }}
    >
      {badge.id}
    </span>
  );
}

const StopRow = memo(function StopRow({
  stopId,
  stopName,
  lineColor,
  nEtaStr,
  sEtaStr,
  nBadge,
  sBadge,
  trainHere,
  hasData,
  showConnector,
}: StopRowProps) {
  return (
    <div
      data-stop-id={stopId}
      className={`flex items-start gap-3 px-4 py-2 transition-colors ${
        trainHere ? "bg-white/10" : "hover:bg-white/5"
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
            <span className="inline-flex items-center">
              {nBadge && <Bullet badge={nBadge} />}
              <span className="opacity-60">N</span>
              <span className="text-gray-200 font-medium ml-1">{nEtaStr}</span>
            </span>
          )}
          {sEtaStr && (
            <span className="inline-flex items-center">
              {sBadge && <Bullet badge={sBadge} />}
              <span className="opacity-60">S</span>
              <span className="text-gray-200 font-medium ml-1">{sEtaStr}</span>
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

export default function LinePanel({ lineId, focusStopId, onClose }: LinePanelProps) {
  const lines = useLines();
  const line = lines?.[lineId];
  const data = useTrains();
  const now = data?.generatedAt ?? Date.now();
  const routeId = line?.routeId;

  // Map selection highlights every route on the shared trunk (e.g. 1/2/3
  // for red). The panel should match: counting only the selected route
  // would under-report what the user sees on the map.
  const corridorSet = useMemo(() => {
    if (!routeId) return null;
    return new Set(CORRIDOR[routeId] ?? [routeId]);
  }, [routeId]);

  // One pass over arrivals/trains per poll, instead of O(stops × arrivals)
  // filters per render. Arrivals are already sorted by eta, so the first
  // entry per (stopId, direction) is the next arrival.
  const arrivalsByStop = useMemo(() => {
    const m = new Map<string, { n?: Arrival; s?: Arrival }>();
    if (!data || !corridorSet) return m;
    for (const a of data.arrivals) {
      if (!corridorSet.has(a.routeId)) continue;
      const entry = m.get(a.stopId) ?? {};
      if (a.direction === "N") { if (!entry.n) entry.n = a; }
      else if (!entry.s) entry.s = a;
      m.set(a.stopId, entry);
    }
    return m;
  }, [data, corridorSet]);

  const trainsAtStop = useMemo(() => {
    const s = new Set<string>();
    if (!data || !corridorSet) return s;
    for (const t of data.trains) {
      if (!corridorSet.has(t.routeId)) continue;
      if (t.progress > 0.85) s.add(t.nextStopId);
      if (t.progress < 0.15) s.add(t.prevStopId);
    }
    return s;
  }, [data, corridorSet]);

  const trainCount = useMemo(() => {
    if (!data || !corridorSet) return 0;
    let n = 0;
    for (const t of data.trains) if (corridorSet.has(t.routeId)) n++;
    return n;
  }, [data, corridorSet]);

  // Scroll the tapped stop's row into view when the user opens the panel
  // via a line tap. The row is tagged with data-stop-id; a querySelector
  // inside the scroll container keeps the lookup local to this panel.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusStopId || !scrollRef.current) return;
    const row = scrollRef.current.querySelector<HTMLElement>(
      `[data-stop-id="${CSS.escape(focusStopId)}"]`,
    );
    row?.scrollIntoView({ block: "center" });
  }, [focusStopId, lineId]);

  // Swipe-to-dismiss on mobile. Pointer events unify touch + mouse so the
  // same gesture works for a phone drag and a desktop trackpad flick on the
  // small bottom sheet. Desktop (sm+) is a fixed side card — dragging is
  // disabled there.
  const [dragY, setDragY] = useState(0);
  const dragStartY = useRef<number | null>(null);
  const pointerId = useRef<number | null>(null);

  const isDraggable = () =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches;

  const onDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggable()) return;
    dragStartY.current = e.clientY;
    pointerId.current = e.pointerId;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartY.current === null) return;
    const dy = e.clientY - dragStartY.current;
    // Only track downward drag; let upward pulls snap back.
    setDragY(Math.max(0, dy));
  };
  const onDragEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartY.current === null) return;
    const dy = e.clientY - dragStartY.current;
    dragStartY.current = null;
    pointerId.current = null;
    // Past ~1/3 of the sheet height, treat as a dismiss gesture.
    if (dy > 120) {
      onClose();
    } else {
      setDragY(0);
    }
  };

  if (!line) return null;

  const numStops = line.stops.length;
  const textClass = line.textColor === "black" ? "text-black" : "text-white";
  const stale = data ? Date.now() - data.generatedAt > 30_000 : false;

  return (
    <div
      className="
        absolute z-20 overflow-hidden flex flex-col shadow-2xl
        inset-x-0 bottom-0 max-h-[45vh] rounded-t-3xl border-t border-white/10
        sm:inset-auto sm:right-3 sm:top-3 sm:bottom-3 sm:w-80 sm:max-h-none sm:rounded-2xl sm:border sm:border-white/10
        bg-gray-950/80 supports-[backdrop-filter]:bg-gray-950/55
        backdrop-blur-2xl backdrop-saturate-150
        pb-[env(safe-area-inset-bottom)]
      "
      style={{
        transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
        transition: dragStartY.current === null ? "transform 200ms ease-out" : undefined,
      }}
    >
      {/* Drag handle + grab region (mobile only). The pill is 4px tall but the
          region is padded to ~32px so fingers don't need to land on the pill
          itself to start a dismiss swipe. */}
      <div
        className="sm:hidden flex items-center justify-center pt-3 pb-2 flex-shrink-0 cursor-grab active:cursor-grabbing touch-none"
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        aria-label="Drag to dismiss"
        role="button"
      >
        <div className="w-10 h-1.5 rounded-full bg-white/30" />
      </div>

      <div
        className={`flex items-center justify-between px-4 py-3 flex-shrink-0 ${textClass}`}
        style={{ backgroundColor: line.color }}
      >
        <div className="flex items-center gap-2.5">
          <span className="text-2xl font-black leading-none">{line.id}</span>
          <span className="text-sm font-medium opacity-90">
            {trainCount} train{trainCount !== 1 ? "s" : ""}
            {stale && <span className="opacity-70"> · stale</span>}
          </span>
        </div>
        <button
          onClick={onClose}
          className={`${textClass} opacity-80 hover:opacity-100 active:opacity-60 text-2xl leading-none font-bold w-11 h-11 flex items-center justify-center -mr-2 touch-manipulation`}
          aria-label="Close panel"
        >
          ×
        </button>
      </div>

      <div className="flex text-[11px] font-medium text-gray-400 px-4 py-2 border-b border-white/5">
        <span className="flex-1 truncate">{line.stops[0]?.name}</span>
        <span className="opacity-40 mx-2">↕</span>
        <span className="flex-1 text-right truncate">{line.stops[numStops - 1]?.name}</span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto py-1 overscroll-contain">
        {!data && (
          <div className="text-center text-xs text-gray-500 py-8 animate-pulse">
            Loading live arrivals…
          </div>
        )}
        {line.stops.map((stop, idx) => {
          const arr = arrivalsByStop.get(stop.id);
          // Only badge when the corridor has more than one route — for a
          // single-route line like G or L the bullet would be redundant.
          const multi = (corridorSet?.size ?? 0) > 1;
          const badgeFor = (rid?: string): RouteBadge | undefined => {
            if (!multi || !rid) return undefined;
            const l = lines?.[rid];
            if (!l) return undefined;
            return { id: l.id, color: l.color, textColor: l.textColor };
          };
          return (
            <StopRow
              key={stop.id}
              stopId={stop.id}
              stopName={stop.name}
              lineColor={line.color}
              nEtaStr={arr?.n ? fmtEta(arr.n.eta, now) : undefined}
              sEtaStr={arr?.s ? fmtEta(arr.s.eta, now) : undefined}
              nBadge={badgeFor(arr?.n?.routeId)}
              sBadge={badgeFor(arr?.s?.routeId)}
              trainHere={trainsAtStop.has(stop.id)}
              hasData={!!data}
              showConnector={idx < numStops - 1}
            />
          );
        })}
      </div>
    </div>
  );
}
