// Per-train data freshness, expressed as a textual indicator rather
// than a marker fade.
//
// `lib/useTrainMarkers.ts` already fades each train's icon opacity
// once its `lastReportedAt` slips past 90 s old, on a curve that
// floors at 0.4 by 6 minutes. That's the visual half of "trust this
// position less". This helper is the textual half: when a rider is
// committed to one specific train (cinematic follow-mode is the only
// surface today, but a station arrival row is the obvious next),
// they should be able to read *why* the marker is dim — i.e. how
// stale the underlying GTFS-RT VehiclePosition.timestamp is.
//
// Thresholds match the marker fade so the visual + textual signals
// agree:
//   < 90 s   → fresh, no indicator (calm default; principle #4)
//   90–360 s → "Updated Nm ago", warn tone
//   > 360 s  → "Stale · Nm", warn tone
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

const FRESH_BELOW_SEC = 90;
const HARD_STALE_AT_SEC = 360;

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
  if (ageSec < FRESH_BELOW_SEC) {
    return { stale: false, veryStale: false, label: null, ageSec };
  }
  if (ageSec >= HARD_STALE_AT_SEC) {
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
