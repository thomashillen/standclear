"use client";

import { useEffect, type RefObject } from "react";
import type { TrainsResponse } from "@/app/api/trains/route";
import { type Lines, type SubwayLine } from "./subwayData";
import { trainLatLng, type Train } from "./useTrains";
import { buildStationIndex } from "./stopsIndex";

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
 * Owns:
 *   • per-train motion state (predicted progress + learned velocity +
 *     LP-filtered render position)
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

    const TICK_MS = 33;
    // Per-frame lerp factor for the displayed position. With accurate
    // per-train velocity, target ≈ display each frame, so the lerp only
    // absorbs micro-corrections at poll boundaries.
    const LERP = 0.08;
    // Default segment traversal time in seconds, used before we've
    // observed any motion for a train. NYC interstation average ~90s.
    const DEFAULT_TRAVERSAL_SEC = 90;
    // Upper clamp on observed velocity so a single noisy poll (e.g. a
    // GTFS-RT snapshot that jumped the train forward) can't project it
    // off the end of the segment on the next frame. 30s corresponds to
    // the fastest plausible express hop.
    const MIN_TRAVERSAL_SEC = 30;
    const DEFAULT_VELOCITY = 1 / DEFAULT_TRAVERSAL_SEC;
    const MAX_VELOCITY = 1 / MIN_TRAVERSAL_SEC;

    // Position-based stacking. Trains sit ON their line by default — no
    // perpendicular offset for a single train at a position. When two or
    // more trains land within STACK_BUCKET_DEG of each other (which
    // happens when a 4 / 5 / 6 are all stopped at Union Sq, or when
    // express overtakes local at a shared platform), we fan them out
    // perpendicular to travel direction so each is individually visible.
    //
    // The previous LANE_INDEX scheme always offset every train by its
    // route's position within its CORRIDOR group, which produced a
    // visible gap between e.g. an E train and its blue line even when
    // no other lines were nearby. Position-based stacking only spends
    // visual space when there's actually a collision to resolve.
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
    let trainsByRoute: Map<string, Train[]> = new Map();

    // Latest rendered (post-stack-offset) position per train, captured
    // each tick where the marker feature is pushed. Used by follow-mode
    // to recenter on the same point the rider sees on screen.
    const lastRenderById = new Map<string, [number, number]>();
    // Per-train motion state. baseProgress/baseTime is the last point we
    // trust from the server; velocity is learned from poll-to-poll deltas.
    // prevStopId/nextStopId pin the segment — if the train crosses a stop,
    // we snap (lerping across segments cuts a chord through the void off
    // the tracks).
    const trainState = new Map<
      string,
      {
        baseProgress: number;
        baseTime: number;
        velocity: number;
        lng: number;
        lat: number;
        bearing: number;
        prevStopId: string;
        nextStopId: string;
      }
    >();

    // Lerp an angle along the shorter arc — naive linear lerp across the
    // 0/360 boundary snaps 358°→2° the long way around, flashing a spin.
    const lerpAngle = (a: number, b: number, t: number) => {
      const d = ((b - a + 540) % 360) - 180;
      return (a + d * t + 360) % 360;
    };

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - lastTickTime < TICK_MS) return;
      lastTickTime = now;

      const d = dataRef.current;
      if (!d) return;

      // Re-bucket only when the upstream data object changes (every 8s poll).
      const newPoll = d !== lastData;
      if (newPoll) {
        lastData = d;
        trainsByRoute = new Map();
        for (const t of d.trains) {
          const arr = trainsByRoute.get(t.routeId) || [];
          arr.push(t);
          trainsByRoute.set(t.routeId, arr);
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
        train: Train;
        lng: number;
        lat: number;
        bearing: number;
        direction: "N" | "S";
      };
      const computed: Computed[] = [];
      const seen = new Set<string>();
      for (const line of Object.values(lines)) {
        const trains = trainsByRoute.get(line.routeId);
        if (!trains) continue;
        for (const t of trains) {
          let state = trainState.get(t.id);
          const segmentChanged =
            state !== undefined &&
            (state.prevStopId !== t.prevStopId ||
              state.nextStopId !== t.nextStopId);

          if (!state || segmentChanged) {
            // New train OR crossed into a new segment. We reset the
            // motion baseline (baseProgress/baseTime/velocity) so
            // prediction tracks the new segment, but we DELIBERATELY
            // keep the previously rendered lng/lat/bearing (when we
            // have one) so the LERP step below can glide the marker
            // from the old position to the new segment over ~1–2 s.
            //
            // This is what makes routes whose feeds only update at
            // station boundaries (R, certain express trips) animate
            // consistently with routes that report continuous
            // progress: a STOPPED_AT-A → STOPPED_AT-B transition
            // glides between the two platforms instead of teleporting.
            // The chord cuts through space (we're not walking the
            // shape across segments), but at NYC interstation
            // distances the chord ≈ the track and the LERP only
            // owns the visual for ~2 seconds.
            //
            // First-mount case (no prior state) snaps to the raw
            // position because there's nothing to animate from.
            const pos = trainLatLng(line, t);
            if (!pos) continue;
            // Floor velocity to DEFAULT for in-motion trains so a
            // feed that's not updating mid-segment progress still
            // produces visible forward motion. STOPPED_AT keeps the
            // learned (often near-zero) velocity — those trains
            // *should* sit at their platform.
            const inMotion =
              t.status === "IN_TRANSIT_TO" || t.status === "INCOMING_AT";
            const carriedVelocity = state?.velocity ?? DEFAULT_VELOCITY;
            const seedVelocity = inMotion
              ? Math.max(carriedVelocity, DEFAULT_VELOCITY)
              : carriedVelocity;
            state = {
              baseProgress: t.progress,
              baseTime: d.generatedAt,
              velocity: seedVelocity,
              lng: state?.lng ?? pos.lng,
              lat: state?.lat ?? pos.lat,
              bearing: state?.bearing ?? pos.bearing,
              prevStopId: t.prevStopId,
              nextStopId: t.nextStopId,
            };
            trainState.set(t.id, state);
          } else if (newPoll) {
            // Same segment, fresh poll — learn the observed velocity from
            // the actual progress delta. Zero or negative deltas (train
            // holding at a signal, ETA recalculation walking progress
            // back) decay velocity via the LP filter so prediction
            // stays close to the feed's reality.
            const dtSec = (d.generatedAt - state.baseTime) / 1000;
            if (dtSec > 0.5) {
              const observed = (t.progress - state.baseProgress) / dtSec;
              const clamped = Math.max(0, Math.min(MAX_VELOCITY, observed));
              state.velocity = 0.5 * state.velocity + 0.5 * clamped;
            }
            // Floor velocity for IN_TRANSIT_TO / INCOMING_AT trains so
            // routes whose feeds report 0 mid-segment progress (the R
            // is a frequent offender) still produce visible motion.
            // STOPPED_AT keeps whatever velocity it had — those trains
            // are visually pinned to a platform regardless.
            const inMotion =
              t.status === "IN_TRANSIT_TO" || t.status === "INCOMING_AT";
            if (inMotion && state.velocity < DEFAULT_VELOCITY) {
              state.velocity = DEFAULT_VELOCITY;
            }
            state.baseProgress = t.progress;
            state.baseTime = d.generatedAt;
          }

          // Predict progress as baseline + velocity × elapsed. This is what
          // makes motion look continuous: every frame advances by a tiny
          // fraction instead of sitting still until the next poll.
          const elapsedSec = (nowMs - state.baseTime) / 1000;
          const predictedProgress = Math.max(
            0,
            Math.min(1, state.baseProgress + state.velocity * elapsedSec),
          );
          const target = trainLatLng(line, { ...t, progress: predictedProgress });
          if (!target) continue;

          // Lerp display toward predicted. In steady state the per-frame
          // delta is ~velocity × TICK_MS, so this is a small, invisible
          // correction rather than a visible catch-up glide.
          state.lng += (target.lng - state.lng) * LERP;
          state.lat += (target.lat - state.lat) * LERP;
          state.bearing = lerpAngle(state.bearing, target.bearing, LERP);
          seen.add(t.id);

          computed.push({
            trainId: t.id,
            line,
            train: t,
            lng: state.lng,
            lat: state.lat,
            bearing: state.bearing,
            direction: t.direction,
          });
        }
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
            const r = a.line.routeId.localeCompare(b.line.routeId);
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
          const groupKey = `${c.line.routeId}-${c.direction}`;
          if (dedupSeen.has(groupKey)) continue;
          dedupSeen.add(groupKey);
          deduped.push(c);
        }
        buckets.set(key, deduped);
      }

      // Cache zoom-dependent meters/pixel scaling once per tick.
      const zoomScale = iconScaleAtZoom(currentZoom);

      const features: GeoJSON.Feature[] = [];
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
            // travel" naturally encodes that:
            //   • Northbound train: right = east (right of map)
            //   • Southbound train: right = west (left of map)
            // So a 2-train bucket with one N and one S splits cleanly
            // to opposite sides without any direction-specific casing.
            //
            // Spacing is asymmetric between groups:
            //   • The FIRST train in each direction sits at 0.5 lanes
            //     off-center, so a single N + single S split cleanly
            //     across the line.
            //   • SAME-direction siblings are tightened to 0.55 of a
            //     lane apart (vs. the 1.0 used for the cross-direction
            //     gap). Trains on the same track aren't separated by
            //     a track gap in real life — they're inches apart at
            //     a platform — so collapsing them visually closer
            //     reads better than fanning them out as if they were
            //     on opposite sides.
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

          features.push({
            type: "Feature",
            properties: {
              id: c.trainId,
              direction: c.direction,
              bearing: c.bearing,
              routeId: c.line.routeId,
              color: c.line.color,
              letter: c.line.id,
              textColor: c.line.textColor,
            },
            geometry: { type: "Point", coordinates: [renderLng, renderLat] },
          });
          lastRenderById.set(c.trainId, [renderLng, renderLat]);
        }
      }

      // Drop state for trains that vanished (e.g. completed trip) so the
      // map doesn't leak memory over long sessions.
      if (seen.size !== trainState.size) {
        for (const id of trainState.keys()) if (!seen.has(id)) trainState.delete(id);
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
      const followId = followedTrainIdRef.current;
      if (followId) {
        const head = lastRenderById.get(followId);
        if (head) {
          const [followLng, followLat] = head;
          map.easeTo({
            center: [followLng, followLat],
            duration: 250,
            essential: true,
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
          const phase = (Math.sin((nowMs / 700) * Math.PI * 2) + 1) / 2;

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

            ringFeatures.push({
              type: "Feature" as const,
              properties: {
                bearing: f.properties?.bearing ?? 90,
                pulseSize: baseSize + sizeRange * phase,
                pulseOpacity: baseOpacity + opacityRange * phase,
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
    return () => cancelAnimationFrame(frame);
    // getMap is intentionally captured at effect-mount; the parent
    // passes a stable closure over its mapRef so we don't need to
    // re-attach when the function identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapLoaded, lines, dataRef, followedTrainIdRef, onFollowTrainRef, stationStopIdRef]);
}
