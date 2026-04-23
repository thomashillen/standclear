"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Info, ChevronDown, X } from "lucide-react";
import { useLines, CORRIDOR } from "@/lib/subwayData";
import { useTrains, type Arrival } from "@/lib/useTrains";
import { useAlerts, alertsForRoutes, type ServiceAlert } from "@/lib/useAlerts";
import { useSheetDrag } from "@/lib/useSheetDrag";

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
        <div
          className={`w-3 h-3 rounded-full border-2 border-white/90 flex-shrink-0 z-10 ${
            trainHere ? "ring-2 ring-white/30 shadow-[0_0_12px_rgba(255,255,255,0.4)]" : ""
          }`}
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

const SEVERITY_STYLE: Record<
  ServiceAlert["severity"],
  { bg: string; text: string; icon: typeof AlertTriangle }
> = {
  severe: { bg: "bg-rose-500/15 border-rose-500/30", text: "text-rose-200", icon: AlertTriangle },
  warning: { bg: "bg-amber-500/15 border-amber-500/30", text: "text-amber-200", icon: AlertTriangle },
  info: { bg: "bg-sky-500/10 border-sky-500/25", text: "text-sky-200", icon: Info },
};

function AlertItem({ alert }: { alert: ServiceAlert }) {
  const [expanded, setExpanded] = useState(false);
  const s = SEVERITY_STYLE[alert.severity];
  const Icon = s.icon;
  const hasBody = alert.description && alert.description !== alert.header;
  return (
    <div className={`border rounded-lg px-3 py-2 ${s.bg}`}>
      <button
        type="button"
        onClick={() => hasBody && setExpanded((x) => !x)}
        className="w-full flex items-start gap-2 text-left"
      >
        <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${s.text}`} />
        <div className="flex-1 min-w-0">
          <p className={`text-[12px] font-semibold ${s.text} leading-snug`}>
            {alert.header || alert.effect.replace(/_/g, " ").toLowerCase()}
          </p>
        </div>
        {hasBody && (
          <ChevronDown
            className={`w-4 h-4 flex-shrink-0 transition-transform ${s.text} ${expanded ? "rotate-180" : ""}`}
          />
        )}
      </button>
      {hasBody && expanded && (
        <p className="mt-1.5 text-[11px] leading-snug text-gray-300 whitespace-pre-line">
          {alert.description}
        </p>
      )}
    </div>
  );
}

// Alerts are collapsed by default for every line — even one "station is exit
// only during weekday nights" warning eats enough vertical space to push
// live arrivals off-screen on a 50dvh bottom sheet. The summary bar shows
// count + top severity so riders can decide whether it's worth expanding;
// a line switch always recollapses.
function AlertsSection({ alerts, lineId }: { alerts: ServiceAlert[]; lineId: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [lineId]);

  // Highest-severity alert drives the summary-bar color so riders can
  // tell at a glance whether the corridor has a suspension vs. a routine
  // elevator-out notice.
  const topSeverity: ServiceAlert["severity"] =
    alerts.some((a) => a.severity === "severe")
      ? "severe"
      : alerts.some((a) => a.severity === "warning")
        ? "warning"
        : "info";
  const s = SEVERITY_STYLE[topSeverity];
  const Icon = s.icon;
  const n = alerts.length;

  return (
    <div className="flex-shrink-0 border-b border-white/[0.06]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`press w-full flex items-center gap-2 px-4 h-11 text-left transition-colors touch-manipulation ${s.bg}`}
        aria-expanded={open}
        aria-label={open ? "Hide service alerts" : "Show service alerts"}
      >
        <Icon className={`w-4 h-4 flex-shrink-0 ${s.text}`} />
        <span className={`text-[12px] font-semibold ${s.text}`}>
          {n} service alert{n !== 1 ? "s" : ""}
        </span>
        <span className={`text-[11px] ml-1 ${s.text} opacity-70`}>
          {open ? "Hide" : "Show"}
        </span>
        <ChevronDown
          className={`w-4 h-4 ml-auto flex-shrink-0 transition-transform ${s.text} ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="px-3 pb-2 pt-1 space-y-1.5 max-h-[28dvh] sm:max-h-[220px] overflow-y-auto ios-scroll">
          {alerts.slice(0, 8).map((a) => (
            <AlertItem key={a.id} alert={a} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function LinePanel({ lineId, focusStopId, onClose, onStationOpen }: LinePanelProps) {
  const lines = useLines();
  const line = lines?.[lineId];
  const data = useTrains();
  const alertsData = useAlerts();
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

  const corridorAlerts = useMemo(
    () => (corridorSet ? alertsForRoutes(alertsData, corridorSet) : []),
    [alertsData, corridorSet],
  );

  const scrollRef = useRef<HTMLDivElement>(null);

  // Three-detent bottom sheet: half (default), full, and dismissed. The
  // sheet DOM is always `full` tall — detent switches just animate a
  // translateY. Tap the handle to toggle; swipe down from half to dismiss.
  const { detent, sheetStyle, handlers, onHandleTap } = useSheetDrag({
    halfRestingY: "calc(88dvh - 50dvh)",
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
  const stale = data ? Date.now() - data.generatedAt > 30_000 : false;

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
      {/* Drag handle — tap to toggle half ↔ full, drag to resize or
          dismiss. Hit area is h-11 (44px, the iOS minimum tap target) so a
          finger landing anywhere near the top of the sheet catches the
          gesture, not just the 5px pill. */}
      <button
        type="button"
        className="sm:hidden flex items-center justify-center h-5 pt-1.5 flex-shrink-0 touch-none w-full"
        onClick={onHandleTap}
        aria-label={detent === "half" ? "Expand panel" : "Collapse panel"}
      >
        <div className="w-9 h-[5px] rounded-full bg-white/25" />
      </button>

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
            {stale && <span className="opacity-70"> · stale</span>}
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
        <AlertsSection alerts={corridorAlerts} lineId={lineId} />
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
      >
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
              onTap={onStationOpen}
            />
          );
        })}
      </div>
    </div>
  );
}
