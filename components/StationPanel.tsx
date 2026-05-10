"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowUp, ArrowDown, Briefcase, Compass, Home, Star, X } from "lucide-react";
import { useLines } from "@/lib/subwayData";
import { useTrains, type Arrival, type Train } from "@/lib/useTrains";
import { useCommute, useFavorites } from "@/lib/useFavorites";
import { useNow } from "@/lib/useNow";
import { buildStationIndex } from "@/lib/stopsIndex";
import { useSheetDrag } from "@/lib/useSheetDrag";

interface Props {
  stopId: string;
  onClose: () => void;
  onSelectLine: (routeId: string) => void;
  /** Fired when the rider taps the Directions button. The parent
   *  opens SearchSheet in directions mode with this station preset
   *  as the destination, so the rider can pick a starting point and
   *  see ranked plans. */
  onStartDirections?: (stopId: string) => void;
}

// Arrival rows we synthesize for trains physically AT (or very recently at)
// the platform carry `live: true`. Their `eta` is set to the server's data
// timestamp at synthesis time and does NOT auto-refresh between polls — so
// they must be exempt from the time-expiry filter that drops feed-supplied
// arrivals once their eta is more than ~5 s in the past. The lifetime of a
// live arrival is governed by the STOPPED_AT memo's grace window, not by
// its eta.
type LiveArrival = Arrival & { live?: boolean };

// Live countdown for the station detail rows. Seconds in the final
// minute (urgency window), rounded minutes above that. The string
// re-renders every tick of the parent's now-clock.
function fmtEta(eta: number, now: number): string {
  const secs = Math.round(eta - now / 1000);
  if (secs <= 5) return "Now";
  if (secs < 60) return `${secs} sec`;
  return `${Math.round(secs / 60)} min`;
}

// MTA signage uses circles for local service and diamonds for express
// variants — the "<6>", "<7>", and peak-only <F>, <Q>, etc. The realtime
// feed surfaces these as routeIds with a trailing "X" (6X, 7X). We render
// a diamond by rotating a square 45° and counter-rotating the label so
// the letter stays upright. Diamond side = circle_diameter / √2 so both
// variants share the same outer bounding box and align in a row.
function RouteBullet({
  id,
  color,
  textColor,
  size = "md",
  variant = "circle",
  onClick,
}: {
  id: string;
  color: string;
  textColor: "white" | "black";
  size?: "sm" | "md";
  variant?: "circle" | "diamond";
  onClick?: () => void;
}) {
  const fg = textColor === "black" ? "#000" : "#fff";

  if (variant === "diamond") {
    // Bounding box matches the circle size so bullets line up in a row.
    // Inner rotated square is sized so its diagonal ≈ circle diameter.
    const boxDim = size === "sm" ? "w-5 h-5 text-[11px]" : "w-7 h-7 text-[14px]";
    const diamondSize = size === "sm" ? 14 : 20;
    const outer = `nyc-bullet inline-flex items-center justify-center flex-shrink-0 relative ${boxDim}`;
    const diamondStyle: React.CSSProperties = {
      width: diamondSize,
      height: diamondSize,
      backgroundColor: color,
      transform: "rotate(45deg)",
      borderRadius: 2,
    };
    const labelStyle: React.CSSProperties = { color: fg };
    const labelClass = `relative leading-none ${size === "sm" ? "text-[11px]" : "text-[14px]"}`;
    const inner = (
      <>
        <span className="absolute inset-0 flex items-center justify-center">
          <span style={diamondStyle} />
        </span>
        <span className={labelClass} style={labelStyle}>
          {id}
        </span>
      </>
    );
    if (onClick) {
      return (
        <button
          type="button"
          onClick={onClick}
          className={`${outer} press touch-manipulation hover:scale-105 active:scale-95 transition-transform`}
          aria-label={`View ${id} express line`}
        >
          {inner}
        </button>
      );
    }
    return <span className={outer}>{inner}</span>;
  }

  const dim = size === "sm" ? "w-5 h-5 text-[12px]" : "w-7 h-7 text-[16px]";
  const base = `nyc-bullet inline-flex items-center justify-center rounded-full leading-none flex-shrink-0 ${dim}`;
  const style = { backgroundColor: color, color: fg };
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${base} press touch-manipulation hover:scale-105 active:scale-95 transition-transform`}
        style={style}
        aria-label={`View ${id} line`}
      >
        {id}
      </button>
    );
  }
  return (
    <span className={base} style={style}>
      {id}
    </span>
  );
}

// Express variants in the GTFS realtime feed use a trailing "X" suffix
// (6X = <6> Pelham Bay express, 7X = <7> Flushing express). The base
// route's color, terminus, and line entry all apply; only the badge
// shape changes.
function parseExpress(routeId: string): { baseRouteId: string; isExpress: boolean } {
  if (routeId.length > 1 && routeId.endsWith("X")) {
    return { baseRouteId: routeId.slice(0, -1), isExpress: true };
  }
  return { baseRouteId: routeId, isExpress: false };
}

interface ArrivalRowProps {
  arrival: Arrival;
  now: number;
  badge: { id: string; color: string; textColor: "white" | "black" } | undefined;
  isExpress: boolean;
  terminusName: string | undefined;
  onTapRoute: () => void;
}

function ArrivalRow({ arrival, now, badge, isExpress, terminusName, onTapRoute }: ArrivalRowProps) {
  const etaStr = fmtEta(arrival.eta, now);
  const isImminent = arrival.eta - now / 1000 < 90;
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.04] last:border-b-0">
      {badge ? (
        <RouteBullet
          id={badge.id}
          color={badge.color}
          textColor={badge.textColor}
          variant={isExpress ? "diamond" : "circle"}
          onClick={onTapRoute}
        />
      ) : (
        <span className="w-7 h-7 flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-gray-100 leading-tight truncate">
          {terminusName ? `to ${terminusName}` : badge?.id ?? arrival.routeId}
          {isExpress && (
            <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300/90">
              Express
            </span>
          )}
        </p>
      </div>
      <span
        className={`text-[14px] font-semibold tabular-nums flex-shrink-0 ${
          isImminent ? "text-amber-300" : "text-gray-50"
        }`}
      >
        {etaStr}
      </span>
    </div>
  );
}

// Station-centric view: all upcoming trains at a single station, grouped by
// direction and sorted by ETA. Complements the line-centric LinePanel —
// you pick a station (by tapping it on any list or the map) and see every
// train coming, not just the first per route. Bullets are tappable to
// jump into that line's view.
export default function StationPanel({ stopId, onClose, onSelectLine, onStartDirections }: Props) {
  const lines = useLines();
  const data = useTrains();
  const { has, toggle } = useFavorites();
  const { isHome, isWork, assignAnchor, setAnchor } = useCommute();
  // Live wall-clock so countdowns tick every second AND so the
  // STOPPED_AT recency window can be evaluated during render without
  // a bare Date.now() call (React 19 flags impure-during-render).
  const now = useNow(true);

  const index = useMemo(() => (lines ? buildStationIndex(lines) : []), [lines]);
  // A tapped stopId may be any platform in a complex (e.g. tapping the
  // L03 dot at Union Sq should surface the merged complex whose canonical
  // id is 635). Match against every member id, not just the canonical.
  const station = useMemo(
    () => index.find((s) => s.stopIds.includes(stopId)),
    [index, stopId],
  );

  // Split arrivals by direction. `data.arrivals` is already sorted by eta
  // ascending, so the per-direction slices inherit that order. We accept
  // arrivals at ANY stop id belonging to this complex so transfers show
  // up as one unified list.
  const stationIds = useMemo(
    () => (station ? new Set(station.stopIds) : null),
    [station],
  );

  // Stabilize "Now" trains across feed polls. The MTA feed
  // occasionally oscillates a train's currentStatus between
  // STOPPED_AT and IN_TRANSIT_TO across consecutive 8-second polls
  // (route-specific + base feeds disagree, or the field is briefly
  // absent and falls back to the IN_TRANSIT_TO default). Without
  // smoothing, a train that's actually sitting on the platform
  // flickers in and out of the "Now" group on every other poll.
  //
  // Strategy: remember the last time we saw each tripId STOPPED_AT,
  // keyed by parent stopId. Treat a train as "Now" if it's currently
  // STOPPED_AT here OR was STOPPED_AT here within the last GRACE_MS.
  // When the feed shows the train at a different stopId, the entry
  // is implicitly stale (the new stopId won't match the old one) and
  // gets cleaned up.
  const STOPPED_AT_GRACE_MS = 25_000;
  type StoppedAtMemo = Map<
    string,
    { stopId: string; lastSeenMs: number; train: Train }
  >;
  // Held in state (not a ref) so the useMemo below can read it without
  // tripping react-hooks/refs. Functional updates preserve the
  // "outlives the current data snapshot" property the memo relied on.
  const [stoppedAtMemo, setStoppedAtMemo] = useState<StoppedAtMemo>(
    () => new Map(),
  );

  // Update the memo on every fresh data tick. The lint rule warns
  // about setState-in-effect, but this is a "data-keyed accumulator"
  // — we genuinely need the prior tick's map carried forward, and
  // a ref-based cache trips react-hooks/refs (no read-during-render).
  useEffect(() => {
    if (!data) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStoppedAtMemo((prev) => {
      const next: StoppedAtMemo = new Map(prev);
      const nowMs = Date.now();
      // Record currently STOPPED_AT trains. Existing entries get their
      // timestamp refreshed; new ones get added.
      for (const t of data.trains) {
        if (t.status !== "STOPPED_AT") continue;
        next.set(t.id, {
          stopId: t.prevStopId,
          lastSeenMs: nowMs,
          train: t,
        });
      }
      // GC: drop entries that are clearly stale.
      //
      //   1. Time expiry — past the grace window, no recent confirmation.
      //
      //   2. Train CONFIRMED at a different stop — but only when that
      //      confirmation comes from another STOPPED_AT report. We do
      //      NOT trust a status-change-to-IN_TRANSIT_TO as evidence
      //      the train moved: the API's prevStopId field is computed
      //      differently for IT vs. STOPPED_AT (one uses the feed's
      //      stop_time_updates index, the other defaults to the
      //      vehicle's current stopId), so a mere status flip can
      //      flip prevStopId even when the train hasn't moved. Using
      //      that as a deletion signal is exactly the bug that caused
      //      the original flicker, where a STOPPED_AT → IT
      //      oscillation immediately blew away the memo entry.
      //
      //      A FRESH STOPPED_AT at a different parent stopId is a
      //      strong signal — the train is now physically at another
      //      platform. Only that drops the entry early.
      const liveByTrip = new Map<string, Train>();
      for (const t of data.trains) liveByTrip.set(t.id, t);
      for (const [tripId, entry] of next) {
        if (nowMs - entry.lastSeenMs > STOPPED_AT_GRACE_MS) {
          next.delete(tripId);
          continue;
        }
        const live = liveByTrip.get(tripId);
        if (
          live &&
          live.status === "STOPPED_AT" &&
          live.prevStopId !== entry.stopId
        ) {
          next.delete(tripId);
        }
      }
      return next;
    });
  }, [data]);

  const { north, south } = useMemo(() => {
    const n: LiveArrival[] = [];
    const s: LiveArrival[] = [];
    if (!data || !stationIds) return { north: n, south: s };
    const nowSec = data.generatedAt / 1000;
    const CUTOFF = 45 * 60;

    // Synthesize "Now" arrivals from trains currently OR RECENTLY
    // STOPPED_AT a platform in this complex. The MTA feed does NOT
    // include the current stop in the trip's future
    // stop_time_updates (that arrival has already happened from the
    // server's perspective), so without this synthesis a train
    // clearly sitting at the station never shows up in the list.
    // The recency window (STOPPED_AT_GRACE_MS) absorbs feed status
    // oscillation that would otherwise flicker the row.
    const seen = new Set<string>();
    const nowMs = now;
    const memo = stoppedAtMemo;
    const considered = new Set<string>();
    for (const t of data.trains) {
      if (t.status !== "STOPPED_AT") continue;
      if (!stationIds.has(t.prevStopId)) continue;
      considered.add(t.id);
      const arr: LiveArrival = {
        routeId: t.routeId,
        stopId: t.prevStopId,
        direction: t.direction,
        eta: nowSec,
        tripId: t.id,
        live: true,
      };
      seen.add(`${t.id}|${t.prevStopId}`);
      if (arr.direction === "N") n.push(arr);
      else s.push(arr);
    }
    // Recently-STOPPED_AT (within grace window) — anything in the memo
    // whose stopId belongs to this complex and that we didn't already
    // include from the current snapshot.
    for (const [tripId, entry] of memo) {
      if (considered.has(tripId)) continue;
      if (!stationIds.has(entry.stopId)) continue;
      if (nowMs - entry.lastSeenMs > STOPPED_AT_GRACE_MS) continue;
      const t = entry.train;
      const arr: LiveArrival = {
        routeId: t.routeId,
        stopId: entry.stopId,
        direction: t.direction,
        eta: nowSec,
        tripId,
        live: true,
      };
      seen.add(`${tripId}|${entry.stopId}`);
      if (arr.direction === "N") n.push(arr);
      else s.push(arr);
    }

    for (const a of data.arrivals) {
      if (!stationIds.has(a.stopId)) continue;
      if (a.eta - nowSec > CUTOFF) continue;
      if (seen.has(`${a.tripId}|${a.stopId}`)) continue;
      if (a.direction === "N") n.push(a);
      else s.push(a);
    }

    // Re-sort each list — synthetic Nows are pushed before the rest
    // but the API list's natural order is by eta, not interleaved
    // with the synthetics. A single sort restores eta-ascending.
    n.sort((x, y) => x.eta - y.eta);
    s.sort((x, y) => x.eta - y.eta);

    return { north: n, south: s };
    // `now` drives the STOPPED_AT recency window — recompute on each
    // tick so trains drop out of "Now" once the grace window expires.
  }, [data, stationIds, stoppedAtMemo, now]);

  // For each route serving the station, figure out which terminus matches
  // each direction by checking which end of the stop list has a higher
  // lat (that end is "north"). MTA GTFS orders line.stops consistently
  // from one terminus to the other, so stops[0] vs stops[last] works.
  const terminusByRouteAndDir = useMemo(() => {
    const m = new Map<string, { N: string; S: string }>();
    if (!lines) return m;
    for (const line of Object.values(lines)) {
      if (line.stops.length < 2) continue;
      const first = line.stops[0];
      const last = line.stops[line.stops.length - 1];
      const firstIsNorth = first.lat > last.lat;
      m.set(line.routeId, {
        N: firstIsNorth ? first.name : last.name,
        S: firstIsNorth ? last.name : first.name,
      });
    }
    return m;
  }, [lines]);

  const routeInfo = useMemo(() => {
    const m = new Map<string, { id: string; color: string; textColor: "white" | "black" }>();
    if (!lines) return m;
    for (const line of Object.values(lines)) {
      m.set(line.routeId, {
        id: line.id,
        color: line.color,
        textColor: line.textColor,
      });
    }
    return m;
  }, [lines]);

  const { detent, sheetStyle, handlers, contentHandlers, onHandleTap, isDragging } = useSheetDrag({
    halfRestingY: "calc(100dvh - var(--panel-top-rest) - 55dvh)",
    open: true,
    onDismiss: onClose,
  });

  if (!station) return null;

  // Favorites key on the canonical stopId so a complex stays "favorited"
  // regardless of which platform the user tapped first.
  const favId = station.stopId;
  const isFav = has(favId);
  // Inline commute-anchor state. The previous design routed Home/Work
  // setup exclusively through MoreSheet → SearchSheet, which made
  // pinning a station you'd already opened a 3-tap detour. Toggling
  // here mirrors the Save chip's tap-toggles-self pattern: tap to set,
  // tap again to clear. assignAnchor() handles "this stop is already
  // your Work, switch it to Home" by clearing the other anchor.
  const isPinnedHome = isHome(favId);
  const isPinnedWork = isWork(favId);

  return (
    <div
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
      <button
        type="button"
        className="sm:hidden flex items-start justify-center h-7 pt-1.5 flex-shrink-0 touch-none w-full"
        onClick={onHandleTap}
        aria-label={detent === "half" ? "Expand panel" : "Collapse panel"}
      >
        <div className="w-9 h-[5px] rounded-full bg-white/25" />
      </button>

      <div
        className="flex flex-col gap-3 px-4 pt-2 pb-3 flex-shrink-0 border-b border-white/[0.06] sm:cursor-auto cursor-grab active:cursor-grabbing touch-none"
        onPointerDown={handlers.onPointerDown}
        onPointerMove={handlers.onPointerMove}
        onPointerUp={handlers.onPointerUp}
        onPointerCancel={handlers.onPointerCancel}
      >
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-[18px] font-black tracking-tight text-white leading-tight">
              {station.name}
            </h2>
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              {station.routes.map((r) => {
                const info = routeInfo.get(r.routeId);
                if (!info) return null;
                return (
                  <RouteBullet
                    key={r.routeId}
                    id={info.id}
                    color={info.color}
                    textColor={info.textColor}
                    size="sm"
                    onClick={() => onSelectLine(r.routeId)}
                  />
                );
              })}
            </div>
          </div>
          <button
            onClick={onClose}
            className="press text-white opacity-85 hover:opacity-100 w-11 h-11 -mt-0.5 flex items-center justify-center rounded-full bg-white/[0.08] hover:bg-white/[0.12] touch-manipulation flex-shrink-0"
            aria-label="Close panel"
          >
            <X className="w-[18px] h-[18px]" strokeWidth={2.5} />
          </button>
        </div>

        {/* Action row — Directions, Save (favorite), Home, Work.
            The Directions button is the primary action: tapping it
            hands the station off to SearchSheet in directions mode
            with this stop preset as the destination, so a rider who
            opened the panel via map tap or search can plan a trip
            in one tap instead of retyping the destination. The
            remaining chips use tap-toggles-self semantics: when
            active, tapping clears that anchor; when inactive,
            tapping assigns it. MoreSheet still owns address-based
            anchors. */}
        <div className="flex items-center gap-2 flex-wrap">
          {onStartDirections && (
            <button
              type="button"
              onClick={() => onStartDirections(favId)}
              className="press inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full text-[12px] font-semibold touch-manipulation transition-colors bg-blue-500/90 text-white hover:bg-blue-500 ring-1 ring-blue-400/40"
              aria-label={`Get directions to ${station.name}`}
            >
              <Compass className="w-[15px] h-[15px]" />
              <span>Directions</span>
            </button>
          )}
          <AnchorChip
            label={isFav ? "Saved" : "Save"}
            icon={<Star className={`w-[15px] h-[15px] ${isFav ? "fill-amber-300 text-amber-300" : ""}`} />}
            active={isFav}
            activeRing="ring-amber-300/40"
            activeBg="bg-amber-300/15 text-amber-100"
            onClick={() => toggle(favId)}
            aria-label={isFav ? "Remove from favorites" : "Add to favorites"}
          />
          <AnchorChip
            label={isPinnedHome ? "Home" : "Set as Home"}
            icon={<Home className={`w-[15px] h-[15px] ${isPinnedHome ? "fill-emerald-300/30 text-emerald-200" : ""}`} />}
            active={isPinnedHome}
            activeRing="ring-emerald-400/40"
            activeBg="bg-emerald-400/15 text-emerald-100"
            onClick={() =>
              isPinnedHome
                ? setAnchor("home", null)
                : assignAnchor("home", favId)
            }
            aria-label={
              isPinnedHome ? "Remove home pin" : "Pin as home station"
            }
          />
          <AnchorChip
            label={isPinnedWork ? "Work" : "Set as Work"}
            icon={<Briefcase className={`w-[15px] h-[15px] ${isPinnedWork ? "fill-sky-300/30 text-sky-200" : ""}`} />}
            active={isPinnedWork}
            activeRing="ring-sky-400/40"
            activeBg="bg-sky-400/15 text-sky-100"
            onClick={() =>
              isPinnedWork
                ? setAnchor("work", null)
                : assignAnchor("work", favId)
            }
            aria-label={
              isPinnedWork ? "Remove work pin" : "Pin as work station"
            }
          />
        </div>
      </div>

      <div
        className="flex-1 overflow-y-auto ios-scroll"
        // At half detent the sheet's bottom extends below the viewport, so
        // content past the visible area becomes unreachable — flex-1 sizes
        // the scroller to the sheet's full 88dvh, but only ~55dvh is on
        // screen, and overflow doesn't trigger when the container thinks
        // its content fits. Pad by the below-fold height (33dvh = 88dvh
        // − 55dvh) at half detent so every row can be scrolled into the
        // visible area. Mirrors LinePanel's fix.
        style={{
          paddingBottom: detent === "half" ? "calc(88dvh - 55dvh)" : undefined,
        }}
        onTouchStart={contentHandlers.onTouchStart}
        onTouchMove={contentHandlers.onTouchMove}
        onTouchEnd={contentHandlers.onTouchEnd}
        onTouchCancel={contentHandlers.onTouchCancel}
      >
        {!data && (
          <div className="text-center text-xs text-gray-500 py-8 animate-pulse">
            Loading live arrivals…
          </div>
        )}

        <DirectionSection
          label="Northbound"
          icon={<ArrowUp className="w-4 h-4" />}
          arrivals={north}
          now={now}
          routeInfo={routeInfo}
          terminusByRoute={terminusByRouteAndDir}
          direction="N"
          onSelectLine={onSelectLine}
        />

        <DirectionSection
          label="Southbound"
          icon={<ArrowDown className="w-4 h-4" />}
          arrivals={south}
          now={now}
          routeInfo={routeInfo}
          terminusByRoute={terminusByRouteAndDir}
          direction="S"
          onSelectLine={onSelectLine}
        />
      </div>
    </div>
  );
}

// Pill-shaped toggle used in the StationPanel action row. Inactive state
// is a quiet white-on-glass chip; active state lights up with a tinted
// background + ring matching the anchor's color (amber/emerald/sky).
// Keeps tap target ≥ 36px so it stays comfortable on mobile.
function AnchorChip({
  label,
  icon,
  active,
  activeRing,
  activeBg,
  onClick,
  "aria-label": ariaLabel,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  activeRing: string;
  activeBg: string;
  onClick: () => void;
  "aria-label": string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={ariaLabel}
      className={`press inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-[12px] font-semibold touch-manipulation transition-colors ${
        active
          ? `${activeBg} ring-1 ${activeRing}`
          : "bg-white/[0.06] text-gray-200 hover:bg-white/[0.10] border border-white/[0.06]"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

// Cap the default visible arrivals per direction so both N and S
// fit on screen without scrolling. Riders who want more tap "Show
// all" — anything beyond the next handful is rarely actionable
// without expand intent anyway.
const DEFAULT_ARRIVALS_PER_DIRECTION = 4;

function DirectionSection({
  label,
  icon,
  arrivals,
  now,
  routeInfo,
  terminusByRoute,
  direction,
  onSelectLine,
}: {
  label: string;
  icon: React.ReactNode;
  arrivals: LiveArrival[];
  now: number;
  routeInfo: Map<string, { id: string; color: string; textColor: "white" | "black" }>;
  terminusByRoute: Map<string, { N: string; S: string }>;
  direction: "N" | "S";
  onSelectLine: (routeId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  // Drop arrivals whose eta has already passed (5s grace for trains
  // pulling in). Re-runs each tick of `now` so departed trains drop
  // out the moment they leave, not when the feed next polls. Live
  // arrivals (synthesized from STOPPED_AT/recently-STOPPED_AT) are
  // exempt: their eta is frozen at the data's generatedAt and would
  // otherwise drop out between polls even though the train is still
  // physically at the platform. Their lifetime is bounded by the
  // STOPPED_AT memo's grace window upstream.
  const visible = arrivals.filter(
    (a) => a.live || a.eta - now / 1000 > -5,
  );
  const shown = expanded
    ? visible
    : visible.slice(0, DEFAULT_ARRIVALS_PER_DIRECTION);
  const overflow = visible.length - shown.length;

  return (
    <section>
      <div className="flex items-center gap-2 px-4 pt-3 pb-2 text-gray-400">
        <span className="flex-shrink-0">{icon}</span>
        <span className="text-[11px] font-semibold uppercase tracking-wider">
          {label}
        </span>
        <span className="text-[11px] text-gray-600 ml-auto tabular-nums">
          {visible.length > 0 ? `${visible.length} upcoming` : "—"}
        </span>
      </div>
      {visible.length === 0 ? (
        <div className="px-4 pb-3 text-[12px] text-gray-600">
          No upcoming trains in the next 45 min.
        </div>
      ) : (
        <div>
          {shown.map((a, i) => {
            // Resolve express variants (6X, 7X) to their base line so the
            // badge picks up the familiar color and the row can show the
            // terminus. `isExpress` then switches the bullet to a diamond
            // and flags the row "Express".
            const { baseRouteId, isExpress } = parseExpress(a.routeId);
            return (
              <ArrivalRow
                key={`${a.tripId}-${a.stopId}-${i}`}
                arrival={a}
                now={now}
                badge={routeInfo.get(baseRouteId)}
                isExpress={isExpress}
                terminusName={terminusByRoute.get(baseRouteId)?.[direction]}
                onTapRoute={() => onSelectLine(baseRouteId)}
              />
            );
          })}
          {(overflow > 0 || expanded) && (
            <button
              type="button"
              onClick={() => setExpanded((x) => !x)}
              className="press w-full px-4 py-2.5 text-[12px] font-semibold text-gray-300 hover:text-white hover:bg-white/[0.04] active:bg-white/[0.06] border-t border-white/[0.04] touch-manipulation"
            >
              {expanded ? "Show less" : `Show all (${overflow} more)`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
