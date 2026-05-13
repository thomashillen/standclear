"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import { X } from "lucide-react";
import { useLines, CORRIDOR } from "@/lib/subwayData";
import { useTrains, type Arrival } from "@/lib/useTrains";
import { useAlerts, alertsForRoutes } from "@/lib/useAlerts";
import { useNow } from "@/lib/useNow";
import { useSheetDrag } from "@/lib/useSheetDrag";
import { snapshotStaleLabel } from "@/lib/trainStaleness";
import { AlertsSection } from "./AlertsSection";
import { DragHandle } from "./DragHandle";

interface LinePanelProps {
  lineId: string; // routeId (e.g. "1", "A", "GS")
  focusStopId?: string;
  onClose: () => void;
  onStationOpen: (stopId: string) => void;
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
  onTap: (stopId: string) => void;
}

// ─── Inline subway-car glyph for "train at this stop" ───────────────
// Vertical orientation matches the line-panel layout — stops stack
// down the column with a vertical connector line between them, so a
// horizontal car at each stop reads tiny. A vertical car (long axis
// along the line) is twice as tall, much more recognizable, and
// visually says "this train is parked along this line." Headlights
// at the top represent the leading edge; the body color is the route
// color so the train reads as the same vehicle that appears on the
// map's top-down subway car icon.
function TrainGlyph({ color }: { color: string }) {
  return (
    <svg
      viewBox="0 0 12 22"
      width="14"
      height="26"
      role="img"
      aria-label="Train at this stop"
      className="flex-shrink-0 z-10 drop-shadow-[0_0_6px_rgba(255,255,255,0.4)]"
    >
      {/* Body — rounded rect with the long axis vertical */}
      <rect
        x="1.5"
        y="0.7"
        width="9"
        height="20.6"
        rx="2.5"
        ry="2.5"
        fill={color}
        stroke="rgba(255,255,255,0.92)"
        strokeWidth="0.8"
      />
      {/* Left-edge gradient highlight (same "light from above"
          shading the map markers use; rotated to match vertical
          orientation) */}
      <rect
        x="2"
        y="1.4"
        width="2.4"
        height="19"
        rx="1.2"
        ry="1.2"
        fill="rgba(255,255,255,0.16)"
      />
      {/* Two headlights at the top (leading edge) */}
      <circle cx="3.6" cy="2.6" r="0.85" fill="rgba(255,245,220,0.96)" />
      <circle cx="8.4" cy="2.6" r="0.85" fill="rgba(255,245,220,0.96)" />
      {/* Small dark windshield between the headlights — the cab
          interior visible through the front window */}
      <rect
        x="4.7"
        y="3.6"
        width="2.6"
        height="2.2"
        rx="0.5"
        ry="0.5"
        fill="rgba(0,0,0,0.32)"
      />
      {/* Two small marker squares at the rear (bottom) so the car
          reads as having a definite front and back even when the
          rider tilts the screen */}
      <rect x="3.6" y="18.8" width="1.2" height="1.2" fill="rgba(0,0,0,0.4)" />
      <rect x="7.2" y="18.8" width="1.2" height="1.2" fill="rgba(0,0,0,0.4)" />
    </svg>
  );
}

function Bullet({ badge }: { badge: RouteBadge }) {
  return (
    <span
      className="nyc-bullet inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-[9px] leading-none mr-1 align-[-1px]"
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
  onTap,
}: StopRowProps) {
  return (
    <button
      type="button"
      data-stop-id={stopId}
      onClick={() => onTap(stopId)}
      className={`w-full text-left flex items-start gap-3 px-4 py-2 transition-colors touch-manipulation ${
        trainHere ? "bg-white/[0.09]" : "hover:bg-white/[0.04] active:bg-white/[0.06]"
      }`}
      aria-label={`See all trains at ${stopName}`}
    >
      <div className="flex flex-col items-center mt-1.5">
        {trainHere ? (
          <TrainGlyph color={lineColor} />
        ) : (
          <div
            className="w-3 h-3 rounded-full border-2 border-white/90 flex-shrink-0 z-10"
            style={{ backgroundColor: lineColor }}
          />
        )}
        {showConnector && (
          <div
            className="w-0.5 mt-0.5"
            style={{ height: 28, backgroundColor: lineColor, opacity: 0.4 }}
          />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-medium leading-tight text-gray-50 break-words">
          {stopName}
        </p>
        <div className="flex gap-3 text-[11px] text-gray-400 mt-1">
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
    </button>
  );
});

export default function LinePanel({ lineId, focusStopId, onClose, onStationOpen }: LinePanelProps) {
  const lines = useLines();
  const line = lines?.[lineId];
  const data = useTrains();
  const alertsData = useAlerts();
  // Tick once per second so ETAs and the staleness banner update on
  // their own without waiting for the next /api/trains poll. Reading
  // Date.now() in render directly trips React 19's purity rule.
  const wallNow = useNow();
  const now = data?.generatedAt ?? wallNow;
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

  const corridorAlerts = useMemo(
    () => (corridorSet ? alertsForRoutes(alertsData, corridorSet) : []),
    [alertsData, corridorSet],
  );

  const scrollRef = useRef<HTMLDivElement>(null);

  // Three-detent bottom sheet: half (default), full, and dismissed. The
  // sheet DOM is always `full` tall — detent switches just animate a
  // translateY. Tap the handle to toggle; swipe down from half to dismiss.
  const { detent, sheetStyle, handlers, contentHandlers, onHandleTap, isDragging } = useSheetDrag({
    halfRestingY: "calc(100dvh - var(--panel-top-rest) - 50dvh)",
    open: true,
    onDismiss: onClose,
  });

  // Scroll the tapped stop's row to sit near the top of the scroll
  // container's visible area — this matches iOS Maps, where tapping a pin
  // surfaces that pin's info at the top of the sheet. Anchoring to the
  // bottom of the viewport (our previous approach) pushed the focused row
  // off the bottom of the visible sheet when the stop was near the end of
  // the list (e.g. Rector St on the 1 train), since scrolling can't put
  // content below the end of the scrollable area. Result: the user saw a
  // dozen stations above their tap and only found the tapped one by
  // scrolling.
  //
  // Use the container's top as the anchor so we don't depend on
  // window.innerHeight vs. dvh quirks on iOS Safari. Double rAF so the
  // sheet's isMobile-driven translateY has committed and painted first —
  // otherwise the row's rect is read pre-transform.
  useEffect(() => {
    if (!focusStopId) return;
    let cancelled = false;
    requestAnimationFrame(() => {
      if (cancelled) return;
      requestAnimationFrame(() => {
        if (cancelled) return;
        const container = scrollRef.current;
        if (!container) return;
        const row = container.querySelector<HTMLElement>(
          `[data-stop-id="${CSS.escape(focusStopId)}"]`,
        );
        if (!row) return;
        const containerTop = container.getBoundingClientRect().top;
        const rowTop = row.getBoundingClientRect().top;
        const delta = rowTop - containerTop - 8;
        container.scrollTop = Math.max(0, container.scrollTop + delta);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [focusStopId, lineId, detent]);

  if (!line) return null;

  const numStops = line.stops.length;
  const textClass = line.textColor === "black" ? "text-black" : "text-white";
  // Snapshot age in the header eyebrow. Threshold (60 s) + numeric
  // age match the SubwayMap live-pill and LiveTrainsPopup "System
  // Pulse" indicator so every snapshot-age affordance flips
  // simultaneously rather than each surface using its own cutoff.
  const staleLabel = data
    ? snapshotStaleLabel((wallNow - data.generatedAt) / 1000)
    : null;

  return (
    // Landmark for AT users — see StationPanel for the role/aria-label
    // rationale (region, not dialog: non-modal, no focus trap).
    <div
      role="region"
      aria-label={`${line.id} line`}
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
      {/* Drag handle — tap to toggle half ↔ full, drag to resize or
          dismiss. Hit area is h-11 (44px, the iOS minimum tap target) so a
          finger landing anywhere near the top of the sheet catches the
          gesture, not just the 5px pill. */}
      <DragHandle
        onTap={onHandleTap}
        ariaLabel={detent === "half" ? "Expand panel" : "Collapse panel"}
      />

      <div
        className={`flex items-center justify-between px-4 py-3 flex-shrink-0 ${textClass} relative sm:cursor-auto cursor-grab active:cursor-grabbing touch-none`}
        style={{ backgroundColor: line.color }}
        onPointerDown={handlers.onPointerDown}
        onPointerMove={handlers.onPointerMove}
        onPointerUp={handlers.onPointerUp}
        onPointerCancel={handlers.onPointerCancel}
      >
        {/* subtle top highlight like iOS cards */}
        <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/20" />
        <div className="flex items-center gap-3">
          <span className="text-[26px] font-black leading-none tracking-tight">{line.id}</span>
          <span className="text-[13px] font-medium opacity-90 tabular-nums">
            {trainCount} train{trainCount !== 1 ? "s" : ""}
            {staleLabel && <span className="opacity-70"> · {staleLabel}</span>}
          </span>
        </div>
        <button
          onClick={onClose}
          className={`${textClass} press opacity-85 hover:opacity-100 w-11 h-11 -mr-1 flex items-center justify-center rounded-full bg-black/15 touch-manipulation`}
          aria-label="Close panel"
        >
          <X className="w-[18px] h-[18px]" strokeWidth={2.5} />
        </button>
      </div>

      <div className="flex items-center text-[11px] font-medium text-gray-400 px-4 py-2 border-b border-white/[0.06]">
        <span className="flex-1 truncate">{line.stops[0]?.name}</span>
        <span className="opacity-40 mx-2 text-[10px]">↕</span>
        <span className="flex-1 text-right truncate">{line.stops[numStops - 1]?.name}</span>
      </div>

      {corridorAlerts.length > 0 && (
        <AlertsSection key={lineId} alerts={corridorAlerts} />
      )}

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto py-1 ios-scroll"
        // At half detent the sheet's bottom extends below the viewport, so
        // the tail of the list falls into the container's below-fold zone
        // and can't be scrolled into the visible area. Pad the content by
        // the below-fold height (38dvh = 88dvh − 50dvh) to make every row
        // reachable. At full detent the padding is 0.
        style={{
          paddingBottom: detent === "half" ? "calc(88dvh - 50dvh)" : undefined,
        }}
        onTouchStart={contentHandlers.onTouchStart}
        onTouchMove={contentHandlers.onTouchMove}
        onTouchEnd={contentHandlers.onTouchEnd}
        onTouchCancel={contentHandlers.onTouchCancel}
      >
        {!data && (
          <div className="text-center text-xs text-gray-500 py-8 motion-safe:animate-pulse">
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
              onTap={onStationOpen}
            />
          );
        })}
      </div>
    </div>
  );
}
