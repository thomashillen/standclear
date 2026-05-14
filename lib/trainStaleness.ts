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
  /** Marker-fade threshold (90 s). Use to gate UI affordances that
   *  should only fire for genuinely stale trains. */
  stale: boolean;
  /** Hard-stale threshold (360 s) — position is unreliable. */
  veryStale: boolean;
  /** Glanceable label: `null` when fresh; `"Updated 2m ago"` for the
   *  90–360 s band; `"Stale · 6m"` past the floor. Designed to read
   *  at a glance in a single small line of text. */
  label: string | null;
  /** Age in seconds of the latest position report. Always non-negative
   *  (clock skew is clamped to 0). */
  ageSec: number;
}

const FRESH_AT_OR_BELOW_SEC = 90;
const HARD_STALE_ABOVE_SEC = 360;
// Floor for `markerOpacityMul`. At or past `HARD_STALE_ABOVE_SEC`,
// the marker can't fade further — it stays visible (so the rider
// can still tap into the trip detail) but at this opacity it reads
// as "trust me less than the rest of the fleet." 0.4 is below the
// "dim but legible" threshold; tested against the Mapbox dark style.
const MARKER_OPACITY_FLOOR = 0.4;

function fmtAge(ageSec: number): string {
  // Below the fresh threshold the helper returns `null`, so we don't
  // need a sub-minute branch — every callsite that hits fmtAge has
  // ageSec ≥ 90.
  const minutes = Math.round(ageSec / 60);
  return `${minutes}m`;
}

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
  // Inclusive bounds at both ends so a train sitting exactly on the
  // marker-fade boundary doesn't briefly flash an amber label while
  // the icon is still fully bright.
  if (ageSec <= FRESH_AT_OR_BELOW_SEC) {
    return { stale: false, veryStale: false, label: null, ageSec };
  }
  if (ageSec > HARD_STALE_ABOVE_SEC) {
    return {
      stale: true,
      veryStale: true,
      label: `Stale · ${fmtAge(ageSec)}`,
      ageSec,
    };
  }
  return {
    stale: true,
    veryStale: false,
    label: `Updated ${fmtAge(ageSec)} ago`,
    ageSec,
  };
}

export interface FleetStalenessSummary {
  /** Trains whose latest report is older than the fresh threshold
   *  (90 s). Includes the `veryStale` subset. */
  stale: number;
  /** Trains whose latest report is past the hard-stale floor (360 s)
   *  — positions on these vehicles are unreliable. */
  veryStale: number;
}

/**
 * Aggregate per-vehicle staleness across the live fleet so System
 * Pulse can show "12 trains haven't reported in 90 s+" alongside the
 * total count. Reuses {@link trainStaleness}'s thresholds so the
 * fleet-level summary lines up with the per-marker fade and the
 * arrival-row sub-line riders see elsewhere.
 *
 * The snapshot's `generatedAt` is the fallback for vehicles whose
 * feed entry omits `lastReportedAt` — same behaviour as the per-train
 * helper, so a silent-feed outage doesn't hide behind missing
 * per-vehicle timestamps.
 */
export function summarizeFleetStaleness(
  trains: ReadonlyArray<{ lastReportedAt?: number }>,
  nowMs: number,
  fallbackSec: number,
): FleetStalenessSummary {
  let stale = 0;
  let veryStale = 0;
  for (const t of trains) {
    const r = trainStaleness(t.lastReportedAt, nowMs, fallbackSec);
    if (r.stale) stale++;
    if (r.veryStale) veryStale++;
  }
  return { stale, veryStale };
}

// ─── Marker opacity curve ───────────────────────────────────────────
// Per-marker icon-opacity multiplier shared between `useTrainMarkers`
// (which feeds it into the Mapbox icon/text opacity expression) and
// the open-station "incoming" rings (which fold it into the pulse
// opacity so an "incoming in 30s" ring stops shouting urgency when
// the underlying vehicle hasn't reported in minutes).
//
// Boundaries deliberately mirror `trainStaleness`'s thresholds — the
// visual fade kicks in at exactly the same age the textual indicator
// flips to "Updated Nm ago", so a rider seeing a dim marker can read
// the corresponding label and the two signals agree:
//   ageSec <= 90  → 1.0  (fresh; calm default)
//   90 < age < 360 → linear ramp 1.0 → MARKER_OPACITY_FLOOR
//   ageSec >= 360 → MARKER_OPACITY_FLOOR
//
// Caller passes raw `ageSec` (already clamped against clock skew) so
// the curve stays a pure scalar function — useful in the rAF hot
// path, where allocating a `TrainStaleness` object per train per
// frame would create real GC pressure at 30fps × hundreds of trains.
export function markerOpacityMul(ageSec: number): number {
  if (!Number.isFinite(ageSec) || ageSec <= FRESH_AT_OR_BELOW_SEC) return 1;
  if (ageSec >= HARD_STALE_ABOVE_SEC) return MARKER_OPACITY_FLOOR;
  const t =
    (ageSec - FRESH_AT_OR_BELOW_SEC) /
    (HARD_STALE_ABOVE_SEC - FRESH_AT_OR_BELOW_SEC);
  return 1 - (1 - MARKER_OPACITY_FLOOR) * t;
}

// ─── Snapshot staleness ─────────────────────────────────────────────
// Per-train staleness above is keyed off VehiclePosition.timestamp.
// `snapshotStaleLabel` is the *snapshot-level* counterpart: how long
// ago the GTFS-RT aggregate (`data.generatedAt`) itself was assembled.
//
// The /api/trains poll cadence is 8 s in healthy steady state, so 30 s
// is too aggressive a threshold — a single recoverable hiccup
// would flag every panel as stale for ~10 s and then quietly clear.
// 60 s matches the SubwayMap live-pill banner and the LiveTrainsPopup
// "System Pulse" indicator so every snapshot-age affordance crosses
// the threshold simultaneously, and avoids the false-positive band.
//
// Below the threshold we return `null` (calm default, principle #4).
// At 60–119 s we show whole seconds rounded down to the nearest 10 so
// the label updates roughly twice a minute rather than jittering each
// `useNow` tick; past 120 s we switch to rounded minutes — at that
// scale, second-level precision reads as more confident than the feed
// warrants.
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
