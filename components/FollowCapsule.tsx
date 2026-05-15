"use client";

import { useMemo } from "react";
import { ArrowUp, ArrowDown, X } from "lucide-react";
import type { Lines } from "@/lib/subwayData";
import type { TrainsResponse } from "@/lib/useTrains";
import { trainStaleness } from "@/lib/trainStaleness";
import { formatEtaCountdown } from "@/lib/etaFormat";

interface Props {
  trainId: string;
  data: TrainsResponse | null;
  lines: Lines | null;
  now: number;
  onExit: () => void;
}

/**
 * Floating glass capsule shown at the top of the screen while the
 * map is in cinematic follow-my-train mode. Replaces the floating
 * header so the rider's eye lands on "what train is this and when's
 * its next stop" instead of the line picker / live-feed pill / etc.
 *
 *   ┌─────────────────────────────────────────────┐
 *   │  [F]↑   Next: 2nd Ave        2 min     [✕] │
 *   └─────────────────────────────────────────────┘
 *
 * The exit button drops the follow lock back to MapView, which
 * restores the flat top-down view and re-mounts the floating
 * header. Tapping anywhere on the capsule body (outside the X)
 * does nothing — riders don't need a "navigate" affordance here,
 * the capsule is purely informational. Pulled out of SubwayMap so
 * the data lookup logic stays compartmentalized.
 */
export default function FollowCapsule({
  trainId,
  data,
  lines,
  now,
  onExit,
}: Props) {
  const info = useMemo(() => {
    if (!data || !lines) return null;
    const train = data.trains.find((t) => t.id === trainId);
    if (!train) return null;
    const line = lines[train.routeId];
    if (!line) return null;
    // Stops are indexed in shape order; the live `direction` already
    // tells us whether we're moving toward higher or lower indices,
    // but the feed surfaces nextStopId directly so we just look it up.
    const nextStop = line.stops.find((s) => s.id === train.nextStopId);
    // Earliest matching arrival on this trip at the next stop. The
    // arrivals list is keyed by (tripId, stopId) so we match both —
    // a trip serving multiple platforms in a complex would otherwise
    // surface whichever showed up first in the feed.
    const arrival = data.arrivals.find(
      (a) => a.tripId === trainId && a.stopId === train.nextStopId,
    );
    return { train, line, nextStop, arrival };
  }, [trainId, data, lines]);

  // Per-train freshness — the textual companion to the marker fade in
  // useTrainMarkers. When the underlying VehiclePosition is older
  // than 90s the eyebrow row swaps from "NEXT STOP" to a small amber
  // "Updated Nm ago" so a rider committed to one specific train can
  // tell at a glance when the displayed position is staler than the
  // snapshot itself. Fresh data → null → no chrome change. Recomputed
  // each `now` tick so the label keeps counting up between polls.
  const stale = info && data
    ? trainStaleness(info.train.lastReportedAt, now, data.generatedAt / 1000)
    : null;

  if (!info) return null;
  const { train, line, nextStop, arrival } = info;

  return (
    <div
      className="
        absolute z-30 left-1/2 -translate-x-1/2
        flex items-center gap-2.5 px-2.5 h-12
        rounded-full ios-glass ios-glass--header border border-white/[0.10]
        shadow-[0_6px_24px_rgba(0,0,0,0.50)]
        max-w-[min(92vw,420px)] min-w-0
      "
      style={{
        top: "calc(max(var(--safe-top), 0.5rem) + 0.5rem)",
      }}
      role="status"
      aria-live="polite"
    >
      {/* Route bullet + direction arrow. Rider's eye anchors here
          first — "what am I following?" */}
      <span
        className="nyc-bullet inline-flex items-center justify-center w-7 h-7 rounded-full text-[14px] leading-none flex-shrink-0"
        style={{
          backgroundColor: line.color,
          color: line.textColor === "black" ? "#000" : "#fff",
        }}
      >
        {line.id}
      </span>
      {train.direction === "N" ? (
        <ArrowUp className="w-3.5 h-3.5 text-gray-300 flex-shrink-0 -ml-1" />
      ) : (
        <ArrowDown className="w-3.5 h-3.5 text-gray-300 flex-shrink-0 -ml-1" />
      )}

      {/* Next-stop block. Truncates with ellipsis on narrow screens
          so the ETA + close button always stay visible. */}
      <div className="flex-1 min-w-0 flex flex-col leading-tight">
        <span
          className={`text-[10px] uppercase tracking-wider ${
            stale?.label ? "text-amber-300" : "text-gray-400"
          }`}
        >
          {stale?.label
            ?? (train.status === "STOPPED_AT" ? "Stopped at" : "Next stop")}
        </span>
        <span className="text-[13px] font-semibold text-gray-50 truncate">
          {nextStop?.name ?? "—"}
        </span>
      </div>

      {/* Live ETA, only when the feed has one — STOPPED_AT trains
          have no future arrival to count down to, and trips that just
          left a feed (rare) similarly lack one. */}
      {arrival && train.status !== "STOPPED_AT" && (
        <span className="text-[13px] font-bold tabular-nums text-gray-100 flex-shrink-0">
          {formatEtaCountdown(arrival.eta, now)}
        </span>
      )}

      {/* 44px hit target (principle #3): this is the only control in
          cinematic follow-mode and the rider taps it on a moving
          train — the one place a sub-44px target bites hardest. The
          glyph stays 16px; the button grows to the HIG minimum. It
          fits the h-12 (48px) capsule with 2px of vertical clearance
          under `items-center`. */}
      <button
        type="button"
        onClick={onExit}
        aria-label="Stop following train"
        className="press w-11 h-11 flex items-center justify-center rounded-full bg-white/[0.10] hover:bg-white/[0.18] text-gray-100 touch-manipulation flex-shrink-0"
      >
        <X className="w-[16px] h-[16px]" strokeWidth={2.5} />
      </button>
    </div>
  );
}
