"use client";

import { useEffect, type RefObject } from "react";
import type { TrainsResponse } from "@/app/api/trains/route";
import { type Lines, type SubwayLine } from "./subwayData";
import { buildStationIndex } from "./stopsIndex";
import {
  buildTrajectory,
  computeShapeMetrics,
  positionAt,
  shapePositionAtArc,
  type ShapeMetrics,
  type Trajectory,
} from "./trainTrajectory";
import { ringPulsePhase } from "./ringPulse";

// Minimal structural surface of the Mapbox map handle the hook touches —
// keeps the hook decoupled from the broader MapboxMap shape MapView
// uses for setup. If a method graduates from "MapView only" to "shared",
// add it here.
interface MapHandle {
  getSource: (id: string) => { setData: (d: unknown) => void } | undefined;
  getZoom: () => number;
  easeTo: (opts: {
    center?: [number, number];
    duration?: number;
    essential?: boolean;
  }) => void;
}

export interface UseTrainMarkersArgs {
  /** Lazy accessor for the Mapbox map. The hook calls this once
   *  inside its effect, after `mapLoaded` flips true — passing the
   *  map directly would force the parent to read `mapRef.current`
   *  during render, which is exactly what react-hooks/refs forbids. */
  getMap: () => MapHandle | null;
  /** Gates the rAF loop. The hook only attaches once the style + sources
   *  + layers are ready, mirroring the parent's setup-complete signal. */
  mapLoaded: boolean;
  /** Static GTFS line geometry, keyed by route. The rAF tick walks
   *  every line every frame, so a missing `lines` means "nothing to
   *  draw" and we no-op. */
  lines: Lines | null;
  /** Live trains/arrivals payload, kept in a ref so re-polls don't
   *  thrash this effect. The tick reads `.current` each frame and
   *  detects new polls by reference equality. */
  dataRef: RefObject<TrainsResponse | null>;
  /** Current followed train id, ref'd so the rAF loop sees the latest
   *  value without restarting on every prop change. The tick recenters
   *  on this train's marker each frame; clearing it releases the lock. */
  followedTrainIdRef: RefObject<string | null>;
  /** Setter the rAF tick calls back to when the followed train leaves
   *  the feed (e.g. trip completed) so the lock doesn't strand the
   *  rider on a frozen patch of map. */
  onFollowTrainRef: RefObject<((id: string | null) => void) | undefined>;
  /** When a StationPanel is open, the rAF tick also rebuilds the
   *  incoming-train-rings overlay from the per-tick rendered features.
   *  null/undefined → rings are cleared. */
  stationStopIdRef: RefObject<string | null | undefined>;
}

/**
 * Animate the live train markers (and the open-station "incoming"
 * rings) on a Mapbox map.
 *
 * Motion model: each train carries a `Trajectory` — a list of
 * `(arcLength along line shape, wall-clock time)` waypoints anchored
 * to the feed's current position plus the trip's predicted ETAs at
 * upcoming stops. Per-frame position is a linear interpolation
 * along that trajectory. This means motion is paced by the MTA's
 * actual ETAs (an express skipping stops naturally animates faster
 * than a local), continuous across segment boundaries, and works
 * for routes whose feeds only refresh at station boundaries — the
 * R, certain peak express trips, etc. Trajectories are rebuilt
 * on each poll; a small per-frame LERP smooths the visual when a
 * fresh trajectory's position-at-now differs from the previous
 * one (the rider sees a glide, not a jump).
 *
 * Owns:
 *   • per-train trajectory + smoothed render position
 *   • position-based stack-offset for collisions (4/5/6 at Union Sq,
 *     express overtaking local at a shared platform, etc.)
 *   • cinematic follow-my-train camera lock
 *   • the StationPanel "incoming" pulse rings
 *
 * Mutates the `subway-trains` and `station-incoming-rings` Mapbox
 * sources via `setData` once per ~30fps tick. The parent component
 * is responsible for adding those sources/layers (see MapView's
 * post-load setup); this hook only writes, never adds.
 */
export function useTrainMarkers({
  getMap,
  mapLoaded,
  lines,
  dataRef,
  followedTrainIdRef,
  onFollowTrainRef,
  stationStopIdRef,
}: UseTrainMarkersArgs): void {
  useEffect(() => {
    if (!mapLoaded || !lines) return;
    const map = getMap();
    if (!map) return;

    // Build the station index once per `lines` version. Used by the ring
    // animation to resolve which platform stop IDs belong to the open station
    // complex (so arrivals at any of its platforms count as "incoming here").
    const stationIndex = buildStationIndex(lines);

    // Cache shape metrics (cumulative arc length per shape vertex) per
    // route. Computed once per `lines` version and reused across every
    // poll/frame.
    const metricsByRoute = new Map<string, ShapeMetrics>();
    // Per-route { stopId → stop } lookup, used to snap STOPPED_AT trains to
    // the parent station's lat/lng. Each route's shape has its nearest-vertex
    // to a given station at slightly different coordinates, so two trains on
    // different routes (1/2/3 at 72nd St, 4/5/6 at Union Sq) parked at the
    // same physical platform end up at slightly different lng/lat and can
    // fall into different stack buckets — losing the perpendicular fan-out
    // and leaving visible gaps. The build script writes `lat: parent.lat,
    // lng: parent.lng` for every stop, so snapping to the stop entry is
    // identical across routes for the same parent station.
    const stopsByRoute = new Map<string, Map<string, { lat: number; lng: number }>>();
    for (const line of Object.values(lines)) {
      metricsByRoute.set(line.routeId, computeShapeMetrics(line));
      const m = new Map<string, { lat: number; lng: number }>();
      for (const s of line.stops) m.set(s.id, { lat: s.lat, lng: s.lng });
      stopsByRoute.set(line.routeId, m);
    }

    const TICK_MS = 33;
    // Per-frame lerp factor for the displayed position. With trajectories
    // giving us continuous accurate positions, this only needs to absorb
    // re-anchor jumps when a fresh poll's trajectory moves the predicted
    // position-at-now compared to the previous trajectory.
    const LERP = 0.12;
    // Cap on how fast the marker can advance along the line shape per
    // second of wall-clock time. Without this, the LERP closes ~50% of
    // any gap in ~5 frames — which means a poll that suddenly reports
    // a train 3 stations farther along (a long missing-data gap, or a
    // STOPPED_AT-A → STOPPED_AT-D jump on a feed that updates only at
    // station boundaries) would burst the marker through 3 stations
    // in a fraction of a second. With the cap, the marker walks the
    // track at a realistic-looking speed and may temporarily lag
    // behind reality during catch-up — that visual debt is preferable
    // to a teleport.
    //
    // 0.002 deg/s is roughly 8× a real subway's top speed at NYC's
    // latitude (1° ≈ 95 km). That gives single-station catch-up in
    // ~3.5 s and three-station catch-up in ~11 s — fast enough that
    // sustained catch-up doesn't compound, slow enough that the
    // motion clearly follows the rail rather than skipping across it.
    const MAX_VISUAL_SPEED_DEG_PER_SEC = 0.002;
    const MAX_ARC_STEP_PER_TICK = MAX_VISUAL_SPEED_DEG_PER_SEC * (TICK_MS / 1000);

    // Snap (don't lerp) when the re-anchor gap between the rendered
    // position and the trajectory's ideal exceeds this many degrees of
    // arc. ~0.005° ≈ 500 m at NYC's latitude — roughly half a station,
    // which is far larger than any normal 8 s poll's per-tick correction
    // (those land in the tens of meters) but smaller than the multi-
    // station gaps produced when:
    //   • the cold-boot localStorage hydrate seeded the marker from a
    //     stale snapshot whose trains have since advanced several stops,
    //   • the tab was backgrounded long enough for the cached frame to
    //     fall many stops behind reality before the wake-fetch lands,
    //   • a long network blip dropped enough polls that the next one
    //     reports the train far past where the last visible position was.
    // Without this, the per-frame LERP — capped at MAX_VISUAL_SPEED for
    // anti-teleport reasons — would visibly walk the marker through every
    // intervening station to catch up, which is exactly the "trains
    // travelling 10 stops to reach their actual position on load"
    // symptom. Snapping is correct here: the rider has no prior visual
    // anchor to honor, so a jump to truth is the truthful update.
    const SNAP_GAP_THRESHOLD_DEG = 0.005;

    // Position-based stacking. Trains sit ON their line by default — no
    // perpendicular offset for a single train at a position. When two or
    // more trains land within STACK_BUCKET_DEG of each other (which
    // happens when a 4 / 5 / 6 are all stopped at Union Sq, or when
    // express overtakes local at a shared platform), we fan them out
    // perpendicular to travel direction so each is individually visible.
    const STACK_BUCKET_DEG = 0.0002; // ≈ 22 m at NYC latitude
    const STACK_SPACING_PX = 14;

    // Mirrors the iconSizeByZoom Mapbox expression so perpendicular
    // stack offsets scale with rendered icon size — keeps the visual
    // gap between stacked trains consistent at every zoom.
    const iconScaleAtZoom = (z: number): number => {
      if (z <= 10) return 0.29;
      if (z <= 11.5) return 0.29 + ((z - 10) / 1.5) * 0.21;
      if (z <= 13) return 0.50 + ((z - 11.5) / 1.5) * 0.24;
      if (z <= 14) return 0.74 + (z - 13) * 0.29;
      return 1.03;
    };

    let frame = 0;
    let lastTickTime = 0;
    let lastData: TrainsResponse | null = null;

    // Tracked here (rather than on each tick) so toggling the OS-level
    // reduced-motion preference takes effect on the next frame without
    // any hook re-mount. The breathing pulse on the open-station
    // incoming rings is decorative — riders with `prefers-reduced-motion`
    // see the rings held at their visual midpoint instead of oscillating.
    // The marker LERP itself is informational (real motion of moving
    // trains) and intentionally NOT gated on this flag.
    const motionQuery =
      typeof window !== "undefined"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    let prefersReducedMotion = motionQuery?.matches ?? false;
    const onMotionChange = (e: MediaQueryListEvent) => {
      prefersReducedMotion = e.matches;
    };
    motionQuery?.addEventListener?.("change", onMotionChange);

    // Latest rendered (post-stack-offset) position per train, captured
    // each tick where the marker feature is pushed. Used by follow-mode
    // to recenter on the same point the rider sees on screen.
    const lastRenderById = new Map<string, [number, number]>();

    // Trajectory + smoothed render state per train. Trajectory is
    // rebuilt every poll; renderState tracks the marker's current
    // arcLength along the line shape (LERPed toward the trajectory's
    // ideal each frame, with a forward-only constraint so the marker
    // never rubber-bands backward when a poll re-anchors). The
    // displayed lng/lat/bearing are derived from arcLength via the
    // shape metrics, so the marker walks the actual track curve.
    const trajectories = new Map<string, Trajectory>();
    const renderState = new Map<
      string,
      {
        arcLength: number;
        lng: number;
        lat: number;
        bearing: number;
      }
    >();

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - lastTickTime < TICK_MS) return;
      lastTickTime = now;

      const d = dataRef.current;
      if (!d || !lines) return;

      // Rebuild trajectories on each fresh poll. Bucketing arrivals by
      // tripId once amortizes the per-train arrival lookup across the
      // whole pass; without it, each train would re-scan the global
      // arrivals array (O(trains × arrivals)).
      const newPoll = d !== lastData;
      if (newPoll) {
        lastData = d;
        const arrivalsByTrip = new Map<string, typeof d.arrivals>();
        for (const a of d.arrivals) {
          const arr = arrivalsByTrip.get(a.tripId) ?? [];
          arr.push(a);
          arrivalsByTrip.set(a.tripId, arr);
        }
        for (const t of d.trains) {
          const line = lines[t.routeId];
          if (!line) continue;
          const metrics = metricsByRoute.get(t.routeId);
          if (!metrics) continue;
          const traj = buildTrajectory(
            t,
            arrivalsByTrip.get(t.id) ?? [],
            line,
            metrics,
            d.generatedAt,
          );
          if (traj) trajectories.set(t.id, traj);
        }
      }

      const nowMs = Date.now();
      const currentZoom = map.getZoom();
      // Two-pass build: first compute every train's base position on the
      // line (no perpendicular offset), then bucket-group by position and
      // apply stacking offsets only where there's a collision. Single
      // trains end up exactly on the line; stacks fan out perpendicular.
      type Computed = {
        trainId: string;
        line: SubwayLine;
        lng: number;
        lat: number;
        bearing: number;
        direction: "N" | "S";
        routeId: string;
        letter: string;
        color: string;
        textColor: "white" | "black";
        /** Per-train freshness (epoch seconds) carried from the API
         *  payload — see Train.lastReportedAt. Optional: when the
         *  feed omits it, the staleness pass falls back to the
         *  snapshot's generatedAt. */
        lastReportedAt?: number;
      };
      const computed: Computed[] = [];
      const seen = new Set<string>();
      for (const t of d.trains) {
        const line = lines[t.routeId];
        if (!line) continue;
        const metrics = metricsByRoute.get(t.routeId);
        if (!metrics) continue;
        const traj = trajectories.get(t.id);
        if (!traj) continue;
        const ideal = positionAt(traj, line, metrics, nowMs);
        if (!ideal) continue;

        // First sighting of this train: seed renderState directly at
        // the trajectory's current position so we don't lerp in from
        // (0, 0) or wherever the previous Map default would land.
        let render = renderState.get(t.id);
        if (!render) {
          render = {
            arcLength: ideal.arcLength,
            lng: ideal.lng,
            lat: ideal.lat,
            bearing: ideal.bearing,
          };
          renderState.set(t.id, render);
        } else if (
          Math.abs(ideal.arcLength - render.arcLength) > SNAP_GAP_THRESHOLD_DEG
        ) {
          // Re-anchor gap is too big to lerp through gracefully — see
          // SNAP_GAP_THRESHOLD_DEG. Snap directly to the ideal so the
          // marker reaches truth this frame instead of crawling for
          // ~10 s. We bypass the forward-only clamp here because the
          // gap is large enough that the rider's visual memory has
          // already lost continuity (cold boot, post-wake, network
          // recovery); freezing in place "to honor" a stale render
          // would hide the snap behind silence rather than fix it.
          render.arcLength = ideal.arcLength;
          const pos = shapePositionAtArc(
            line,
            metrics,
            render.arcLength,
            traj.motionDir,
          );
          render.lng = pos.lng;
          render.lat = pos.lat;
          render.bearing = pos.bearing;
        } else {
          // FORWARD-ONLY CONSTRAINT. The marker may only move along
          // its travel direction (motionDir) — never backward. A poll
          // that re-anchors the trajectory behind the rendered
          // position (e.g. the L feed flip-flopping IN_TRANSIT_TO →
          // STOPPED_AT mid-segment) used to rubber-band: the LERP
          // would smooth the marker BACK toward the platform and the
          // bearing would flip. With this clamp the marker simply
          // holds in place until the trajectory advances to where
          // the rider already saw it.
          const targetArc =
            traj.motionDir > 0
              ? Math.max(render.arcLength, ideal.arcLength)
              : Math.min(render.arcLength, ideal.arcLength);
          // LERP for smooth deceleration into the target, then cap
          // the per-frame step so big catch-up gaps don't burst the
          // marker across multiple stations in a fraction of a
          // second — see MAX_VISUAL_SPEED_DEG_PER_SEC above.
          let step = (targetArc - render.arcLength) * LERP;
          if (step > MAX_ARC_STEP_PER_TICK) step = MAX_ARC_STEP_PER_TICK;
          else if (step < -MAX_ARC_STEP_PER_TICK) step = -MAX_ARC_STEP_PER_TICK;
          render.arcLength += step;
          // Re-derive lng/lat/bearing from the LERPed arcLength so
          // the marker walks the actual line shape (curves and all)
          // instead of cutting chord paths through space.
          const pos = shapePositionAtArc(
            line,
            metrics,
            render.arcLength,
            traj.motionDir,
          );
          render.lng = pos.lng;
          render.lat = pos.lat;
          render.bearing = pos.bearing;
        }

        seen.add(t.id);

        // STOPPED_AT trains snap to the parent station's lat/lng (shared
        // across all routes that serve the station) instead of their own
        // shape's nearest vertex — so a 1, 2, and 3 all parked at 72nd St
        // share one bucket and fan out perpendicularly together. Without
        // this, the small per-route shape divergence at express stations
        // can put them in adjacent buckets, breaking the fan-out and
        // leaving an obvious "missing slot" gap between markers. The
        // bearing still comes from the route's own shape so the icon
        // points the right way. Skipped for in-motion trains so segment
        // animation continues to track each route's actual track curve.
        let stackLng = render.lng;
        let stackLat = render.lat;
        if (t.status === "STOPPED_AT") {
          const stop = stopsByRoute.get(t.routeId)?.get(t.prevStopId);
          if (stop) {
            stackLng = stop.lng;
            stackLat = stop.lat;
          }
        }
        computed.push({
          trainId: t.id,
          line,
          lng: stackLng,
          lat: stackLat,
          bearing: render.bearing,
          direction: t.direction,
          routeId: line.routeId,
          letter: line.id,
          color: line.color,
          textColor: line.textColor,
          lastReportedAt: t.lastReportedAt,
        });
      }

      // Bucket trains by rounded lat/lng. Anything within ~22m of each
      // other lands in the same bucket. Same-direction trains at the
      // same stop (4/5/6 at Union Sq), express-overtaking-local pairs
      // at shared platforms, opposite-direction trains at the same
      // station — all caught here. Solo trains stay alone in their
      // bucket and don't get any offset.
      const buckets = new Map<string, Computed[]>();
      for (const c of computed) {
        const key = `${Math.round(c.lng / STACK_BUCKET_DEG)},${Math.round(c.lat / STACK_BUCKET_DEG)}`;
        const arr = buckets.get(key);
        if (arr) arr.push(c);
        else buckets.set(key, [c]);
      }

      // Stable ordering inside each bucket so trains don't shuffle
      // between renders — sort by routeId, then trainId. Otherwise an
      // 8-second feed re-poll could swap two trains' stack positions
      // and produce a visible jump. Sort first so the dedup pass
      // below picks a deterministic representative per group.
      for (const arr of buckets.values()) {
        if (arr.length > 1) {
          arr.sort((a, b) => {
            const r = a.routeId.localeCompare(b.routeId);
            return r !== 0 ? r : a.trainId.localeCompare(b.trainId);
          });
        }
      }

      // Within each bucket, dedupe trains that share BOTH route AND
      // direction. Riders don't care that there are 4 N-bound J
      // trains stacked at Broad St (terminus layover queue) or 3
      // N-bound 4 trains queued behind a delay — visually it's "the
      // J is here, northbound." Keeping the first occurrence per
      // (routeId, direction) is far simpler than the previous
      // cluster + ×N badge logic, and naturally handles both cases.
      // Cross-direction siblings (N-bound + S-bound 4) and cross-
      // route siblings (4 + 5 sharing track at Lex) survive the
      // dedup so the perpendicular fan-out below still splits them.
      for (const [key, arr] of buckets) {
        if (arr.length <= 1) continue;
        const dedupSeen = new Set<string>();
        const deduped: Computed[] = [];
        for (const c of arr) {
          const groupKey = `${c.routeId}-${c.direction}`;
          if (dedupSeen.has(groupKey)) continue;
          dedupSeen.add(groupKey);
          deduped.push(c);
        }
        buckets.set(key, deduped);
      }

      // Cache zoom-dependent meters/pixel scaling once per tick.
      const zoomScale = iconScaleAtZoom(currentZoom);

      // Staleness multiplier — fed into the icon/text opacity
      // expressions so markers visibly fade as the data ages.
      //
      // We compute this PER TRAIN from `lastReportedAt` (the GTFS-RT
      // VehiclePosition.timestamp surfaced by the API) so the rider
      // sees the truth: the snapshot can be 2 seconds old while a
      // particular vehicle hasn't reported in 4 minutes (NYCT trains
      // typically only report at platforms; tunnels are silent). The
      // old per-snapshot model only faded when the API itself was
      // failing — useful for outages, useless for the rider whose
      // train is stuck on a 4-minute-old position right now.
      //
      // Curve, applied to per-train age:
      //   < 90s old:    full opacity (1.0)
      //   90–360s:     linear fade to 0.4
      //   > 360s:      floor at 0.4
      // 90s lead-in matches typical NYCT vehicle-report cadence
      // (most cars report every 30–60s, so anything tighter would
      // dim healthy trains in steady state). 360s ≈ two missed
      // report windows + tunnel buffer; past that, the rendered
      // position is genuinely unreliable.
      //
      // Falls back to the snapshot's generatedAt when a feed omits
      // both per-vehicle and header timestamps — preserves the
      // outage-detection floor.
      const generatedAtSec = d.generatedAt / 1000;
      const staleMulFor = (lastReportedAt: number | undefined): number => {
        const tsSec = lastReportedAt ?? generatedAtSec;
        const ageSec = Math.max(0, (nowMs / 1000) - tsSec);
        if (ageSec <= 90) return 1;
        const t = Math.min(1, (ageSec - 90) / 270);
        return 1 - 0.6 * t;
      };

      const features: GeoJSON.Feature[] = [];
      // Side-channel for per-train staleness keyed by tripId. The
      // station-incoming-rings pass downstream needs the same
      // multiplier per train (so stale incoming-now rings stop
      // shouting urgency) but doesn't see the Computed list.
      const staleMulById = new Map<string, number>();
      for (const arr of buckets.values()) {
        const n = arr.length;

        // Track per-direction indices so each direction's sub-group fans
        // out independently. The bucket's iteration order is already
        // stabilized by the routeId+trainId sort above, so the indices
        // assigned here are consistent across renders.
        const dirCounts: Record<"N" | "S", number> = { N: 0, S: 0 };

        for (let i = 0; i < n; i++) {
          const c = arr[i];
          let renderLng = c.lng;
          let renderLat = c.lat;

          if (n > 1) {
            // Each train shifts perpendicular to its OWN bearing on the
            // RIGHT side of travel direction. By NYC convention (and
            // because trains drive on the right), uptown trains are on
            // the east track and downtown on the west — and "right of
            // travel" naturally encodes that.
            //
            // Spacing is asymmetric: same-direction siblings stack
            // tighter (0.55 lanes) than cross-direction (1.0).
            const idxInDir = dirCounts[c.direction]++;
            const SAME_SIDE_STEP = 0.55;
            const stackOffset = 0.5 + idxInDir * SAME_SIDE_STEP;
            const perpPx = stackOffset * STACK_SPACING_PX * zoomScale;
            const latRad = (c.lat * Math.PI) / 180;
            const mPerPx =
              (156543.03392 * Math.cos(latRad)) / Math.pow(2, currentZoom);
            const perpM = perpPx * mPerPx;
            const perpRad = ((c.bearing + 90) * Math.PI) / 180;
            renderLat += (perpM * Math.cos(perpRad)) / 111320;
            renderLng +=
              (perpM * Math.sin(perpRad)) / (111320 * Math.cos(latRad));
          }

          const staleMul = staleMulFor(c.lastReportedAt);
          staleMulById.set(c.trainId, staleMul);
          features.push({
            type: "Feature",
            properties: {
              id: c.trainId,
              direction: c.direction,
              bearing: c.bearing,
              routeId: c.routeId,
              color: c.color,
              letter: c.letter,
              textColor: c.textColor,
              staleMul,
            },
            geometry: { type: "Point", coordinates: [renderLng, renderLat] },
          });
          lastRenderById.set(c.trainId, [renderLng, renderLat]);
        }
      }

      // Drop state for trains that vanished (e.g. completed trip) so the
      // map doesn't leak memory over long sessions.
      if (seen.size !== trajectories.size) {
        for (const id of trajectories.keys())
          if (!seen.has(id)) trajectories.delete(id);
      }
      if (seen.size !== renderState.size) {
        for (const id of renderState.keys())
          if (!seen.has(id)) renderState.delete(id);
      }
      if (seen.size !== lastRenderById.size) {
        for (const id of lastRenderById.keys())
          if (!seen.has(id)) lastRenderById.delete(id);
      }
      const src = map.getSource("subway-trains");
      src?.setData({ type: "FeatureCollection", features });

      // ── Cinematic follow-my-train ──────────────────────────────────────
      // While a follow lock is active, recenter the camera on the
      // followed train every tick using the same post-stack-offset
      // position the marker was just rendered at. easeTo with a
      // short 250ms duration smooths the per-tick jitter without
      // lagging behind real motion. Pitch + zoom only get applied
      // once at lock-on so subsequent ticks don't fight the rider's
      // pinch-zoom — see the dragstart/zoomstart handlers below for
      // exit behavior.
      //
      // `essential: true` is intentionally omitted: with
      // `prefers-reduced-motion` Mapbox collapses the 250ms ease into
      // an instant recenter, which is the right behavior — the
      // camera still tracks the train precisely each tick, just
      // without smoothing. Tracking is preserved; only the
      // smoothing is dropped.
      const followId = followedTrainIdRef.current;
      if (followId) {
        const head = lastRenderById.get(followId);
        if (head) {
          const [followLng, followLat] = head;
          map.easeTo({
            center: [followLng, followLat],
            duration: 250,
          });
        } else {
          // Train left the feed (completed trip / went out of service).
          // Drop the lock so the rider isn't left staring at a frozen
          // empty patch of map.
          onFollowTrainRef.current?.(null);
        }
      }

      // When a StationPanel is open, find which trains are headed to that
      // station and animate a glowing ring beneath each one. The ring's
      // radius and opacity oscillate ~0.9 Hz so it reads as "live" even
      // when trains aren't visibly moving; the ETA text above each capsule
      // lets riders see at a glance which one to run for.
      const ringStation = stationStopIdRef.current;
      const ringSrc = map.getSource("station-incoming-rings");

      if (ringStation && ringSrc && d) {
        const station = stationIndex.find((s) => s.stopIds.includes(ringStation));
        const stationIds = station ? new Set(station.stopIds) : null;

        if (stationIds) {
          const nowSec = nowMs / 1000;
          // Horizon: only show arrivals within the next 10 minutes. Beyond
          // that the ETA is noisy and the ring would clutter the whole line.
          const HORIZON_SEC = 600;

          // Build tripId → earliest ETA at this station from the arrivals
          // list. We keep the earliest per trip because a complex with
          // multiple platforms may have the same trip listed twice.
          const incomingEtas = new Map<string, number>();
          for (const a of d.arrivals) {
            if (!stationIds.has(a.stopId)) continue;
            const etaSec = a.eta - nowSec;
            if (etaSec < -30 || etaSec > HORIZON_SEC) continue;
            const prev = incomingEtas.get(a.tripId);
            if (prev === undefined || etaSec < prev) incomingEtas.set(a.tripId, etaSec);
          }
          // Trains currently STOPPED_AT a platform here aren't in the
          // arrivals list (that arrival already happened from the feed's
          // perspective), but they ARE still physically present and very
          // much worth highlighting.
          for (const t of d.trains) {
            if (t.status !== "STOPPED_AT") continue;
            if (!stationIds.has(t.prevStopId)) continue;
            if (!incomingEtas.has(t.id)) incomingEtas.set(t.id, 0);
          }

          // Phase: 0→1→0 at ~0.9 Hz — roughly "one breath" per second.
          // Held at 0.5 (the wave's mean) when the rider has set
          // prefers-reduced-motion: see ringPulsePhase for the rationale.
          const phase = ringPulsePhase(nowMs, prefersReducedMotion);

          const ringFeatures: GeoJSON.Feature[] = [];
          for (const f of features) {
            const tripId = f.properties?.id as string | undefined;
            if (!tripId) continue;
            const etaSec = incomingEtas.get(tripId);
            if (etaSec === undefined) continue;

            // Urgency threshold: < 90 s (mirrors the panel's amber rule).
            const isImminent = etaSec < 90;

            // ETA label text — same formatting as fmtEta in StationPanel.
            let etaText: string;
            if (etaSec <= 5) etaText = "Now";
            else if (etaSec < 60) etaText = `${Math.round(etaSec)}s`;
            else etaText = `${Math.round(etaSec / 60)} min`;

            // Amber when imminent, near-white otherwise — matches the
            // arrival row color in the panel so the language is consistent.
            const labelColor = isImminent ? "#fbbf24" : "#f9fafb";

            // Glow pulse: a subtle "breathing" of the outline. Imminent
            // trains get a brighter, slightly larger halo to scream "this
            // is the one." pulseSize multiplies the train's per-zoom icon
            // size so the glow tracks the capsule at every zoom.
            const baseSize = isImminent ? 1.10 : 1.00;
            const sizeRange = isImminent ? 0.18 : 0.12;
            const baseOpacity = isImminent ? 0.70 : 0.50;
            const opacityRange = isImminent ? 0.25 : 0.18;

            const ringStaleMul = staleMulById.get(tripId) ?? 1;
            ringFeatures.push({
              type: "Feature" as const,
              properties: {
                bearing: f.properties?.bearing ?? 90,
                pulseSize: baseSize + sizeRange * phase,
                // Fold per-train staleness into the ring opacity so
                // an "incoming in 30s" ring stops shouting urgency
                // when this specific train's last position report is
                // minutes old.
                pulseOpacity: (baseOpacity + opacityRange * phase) * ringStaleMul,
                etaText,
                labelColor,
              },
              geometry: f.geometry as GeoJSON.Geometry,
            });
          }

          ringSrc.setData({ type: "FeatureCollection", features: ringFeatures });
        } else {
          ringSrc.setData({ type: "FeatureCollection", features: [] });
        }
      } else if (ringSrc) {
        // No station open — clear the rings immediately.
        ringSrc.setData({ type: "FeatureCollection", features: [] });
      }
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      motionQuery?.removeEventListener?.("change", onMotionChange);
    };
    // getMap is intentionally captured at effect-mount; the parent
    // passes a stable closure over its mapRef so we don't need to
    // re-attach when the function identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapLoaded, lines, dataRef, followedTrainIdRef, onFollowTrainRef, stationStopIdRef]);
}
