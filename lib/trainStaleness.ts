// Per-train data freshness — both the visual half (marker opacity
// fade) and the textual half (glanceable "Updated Nm ago" / "Stale
// · Nm" label) live here so the two signals can't drift.
//
// `lib/useTrainMarkers.ts` imports `markerOpacityMul` to fade each
// train's icon opacity once its `lastReportedAt` slips past 90 s old,
// on a curve that floors at 0.4 by 6 minutes. `trainStaleness` is
// the textual counterpart: when a rider is committed to one specific
// train (cinematic follow-mode, the StationPanel arrival rows, the
// LinePanel arrivals — every surface where a single trip is named)
// they should be able to read *why* the marker is dim, i.e. how
// stale the underlying GTFS-RT VehiclePosition.timestamp is.
//
// Both halves share the same boundaries so the visual + textual
// signals agree at the boundary — the marker keeps full opacity
// through `ageSec <= 90`, so the label also stays null until just
// past 90 s:
//   ageSec <= 90 s  → fresh, no indicator (calm default; principle #4)
//   90 < age <= 360 → "Updated Nm ago", warn tone
//   ageSec > 360 s  → "Stale · Nm", warn tone
// The 90 s lead-in matches typical NYCT vehicle-report cadence
// (every 30–60 s); anything tighter would flag healthy trains in
// steady state. 360 s ≈ two missed report windows + tunnel buffer;
// past that, the position is genuinely unreliable.
//
// Falls back to the snapshot's `generatedAt` when the feed omits the
// per-vehicle timestamp — preserves outage detection on routes whose
// VehiclePosition messages don't carry `timestamp` at all.
export interface TrainStaleness {
  stale: boolean;
  veryStale: boolean;
  label: string | null;
  ariaLabel: string | null;
  ageSec: number;
}

const FRESH_AT_OR_BELOW_SEC = 90;
const HARD_STALE_ABOVE_SEC = 360;
const MARKER_OPACITY_FLOOR = 0.4;

/**
 * Compute the staleness indicator for a single train.
 *
 * @param lastReportedAtSec  GTFS-RT VehiclePosition.timestamp in
 *   epoch seconds. Pass `undefined` when the feed omits it; the
 *   helper falls back to `fallbackSec`.
 * @param nowMs              Current wall-clock time in ms (typically
 *   `Date.now()` or the value from `useNow`).
 * @param fallbackSec        The snapshot's `generatedAt` in epoch
 *   seconds. Used when the per-vehicle timestamp is absent so a
 *   silent-feed outage still surfaces as stale.
 */
export function trainStaleness(
  lastReportedAtSec: number | undefined,
  nowMs: number,
  fallbackSec: number,
): TrainStaleness {
  const tsSec = lastReportedAtSec ?? fallbackSec;
  const ageSec = Math.max(0, nowMs / 1000 - tsSec);
  if (ageSec <= FRESH_AT_OR_BELOW_SEC) {
    return { stale: false, veryStale: false, label: null, ariaLabel: null, ageSec };
  }
  const minutes = Math.round(ageSec / 60);
  const ariaLabel = `position last updated ${minutes} ${
    minutes === 1 ? "minute" : "minutes"
  } ago`;
  if (ageSec > HARD_STALE_ABOVE_SEC) {
    return {
      stale: true,
      veryStale: true,
      label: `Stale · ${minutes}m`,
      ariaLabel,
      ageSec,
    };
  }
  return {
    stale: true,
    veryStale: false,
    label: `Updated ${minutes}m ago`,
    ariaLabel,
    ageSec,
  };
}

export interface FleetStalenessSummary {
  stale: number;
  veryStale: number;
}

/**
 * Aggregate per-vehicle staleness across the live fleet so System
 * Pulse can show "12 trains haven't reported in 90 s+" alongside the
 * total count. Reuses {@link trainStaleness}'s thresholds so the
 * fleet-level summary lines up with the per-marker fade and the
 * arrival-row sub-line riders see elsewhere.
 *
 * `fallbackSec` is documented as epoch seconds. For resilience at UI
 * boundaries, this aggregator also accepts a millisecond snapshot
 * timestamp (the shape returned by `useTrains`) and normalizes it.
 * That prevents a missing per-vehicle timestamp from turning a stale
 * snapshot into an apparent age of zero because of an ms/sec mismatch.
 */
export function summarizeFleetStaleness(
  trains: ReadonlyArray<{ lastReportedAt?: number }>,
  nowMs: number,
  fallbackSec: number,
): FleetStalenessSummary {
  const normalizedFallbackSec =
    fallbackSec > 10_000_000_000 ? fallbackSec / 1000 : fallbackSec;
  let stale = 0;
  let veryStale = 0;
  for (const t of trains) {
    const r = trainStaleness(t.lastReportedAt, nowMs, normalizedFallbackSec);
    if (r.stale) stale++;
    if (r.veryStale) veryStale++;
  }
  return { stale, veryStale };
}

// ─── Marker opacity curve ───────────────────────────────────────────
export function markerOpacityMul(ageSec: number): number {
  if (!Number.isFinite(ageSec) || ageSec <= FRESH_AT_OR_BELOW_SEC) return 1;
  if (ageSec >= HARD_STALE_ABOVE_SEC) return MARKER_OPACITY_FLOOR;
  const t =
    (ageSec - FRESH_AT_OR_BELOW_SEC) /
    (HARD_STALE_ABOVE_SEC - FRESH_AT_OR_BELOW_SEC);
  return 1 - (1 - MARKER_OPACITY_FLOOR) * t;
}

// ─── Snapshot staleness ─────────────────────────────────────────────
const SNAPSHOT_STALE_AT_OR_ABOVE_SEC = 60;
const SNAPSHOT_MINUTES_AT_OR_ABOVE_SEC = 120;

export function snapshotStaleLabel(ageSec: number): string | null {
  if (!Number.isFinite(ageSec) || ageSec < SNAPSHOT_STALE_AT_OR_ABOVE_SEC) {
    return null;
  }
  if (ageSec < SNAPSHOT_MINUTES_AT_OR_ABOVE_SEC) {
    const rounded = Math.floor(ageSec / 10) * 10;
    return `Stale · ${rounded}s`;
  }
  const minutes = Math.round(ageSec / 60);
  return `Stale · ${minutes}m`;
}
