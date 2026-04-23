"use client";

import { useEffect, useRef, useState } from "react";
import { useLines, CORRIDOR, type Stop } from "@/lib/subwayData";
import { useTrains, trainLatLng, type Train } from "@/lib/useTrains";
import "mapbox-gl/dist/mapbox-gl.css";

interface MapViewProps {
  selectedLine: string | null; // routeId
  onLineSelect: (line: string | null, focusStopId?: string) => void;
}

function nearestStop(stops: Stop[], lng: number, lat: number): Stop | null {
  let best: Stop | null = null;
  let minD2 = Infinity;
  for (const s of stops) {
    const dx = s.lng - lng;
    const dy = s.lat - lat;
    const d2 = dx * dx + dy * dy;
    if (d2 < minD2) {
      minD2 = d2;
      best = s;
    }
  }
  return best;
}

type MapboxExpression = unknown;
type MapboxMap = {
  getSource: (id: string) => { setData: (d: unknown) => void } | undefined;
  setPaintProperty: (id: string, prop: string, val: MapboxExpression) => void;
  fitBounds: (bounds: unknown, opts: unknown) => void;
  remove: () => void;
  getCanvas: () => HTMLCanvasElement;
  on: (event: string, ...args: unknown[]) => void;
  addSource: (id: string, src: unknown) => void;
  addLayer: (layer: unknown, beforeId?: string) => void;
  addImage: (id: string, image: unknown, opts?: unknown) => void;
  hasImage: (id: string) => boolean;
  getZoom: () => number;
};

// Zoom-responsive baselines, shared between layer setup and the selection
// effect so "selected" paint values keep the same zoom curve as the base.
const LINE_WIDTH_BY_ZOOM: MapboxExpression = [
  "interpolate", ["linear"], ["zoom"],
  9, 3.5,
  11, 2.75,
  14, 4.5,
];
const STOP_OPACITY_BY_ZOOM: MapboxExpression = [
  "interpolate", ["linear"], ["zoom"],
  11.5, 0,
  12.5, 0.85,
];

// Rounded rear, pointed nose on the right. Drawn horizontal so a rotation
// of 0 = pointing east; icon-rotate = bearing - 90 aligns the nose with the
// direction of travel. Registered with sdf:true so Mapbox can tint via
// `icon-color`.
function makeTrainIcon(w: number, h: number, nosePx: number): ImageData {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  const r = h / 2;
  const bodyW = w - nosePx;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(bodyW, 0);
  ctx.lineTo(w, h / 2);
  ctx.lineTo(bodyW, h);
  ctx.lineTo(r, h);
  ctx.arcTo(0, h, 0, h - r, r);
  ctx.lineTo(0, r);
  ctx.arcTo(0, 0, r, 0, r);
  ctx.closePath();
  ctx.fill();
  return ctx.getImageData(0, 0, w, h);
}

export default function MapView({ selectedLine, onLineSelect }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [noToken, setNoToken] = useState(false);
  const selectedLineRef = useRef(selectedLine);
  // Set by the map line-click handler; read + cleared by the selection
  // effect so a click-initiated selection zooms to the nearest stop rather
  // than to the default downtown frame.
  const clickLngLatRef = useRef<[number, number] | null>(null);
  const data = useTrains();
  const dataRef = useRef(data);
  const lines = useLines();

  useEffect(() => { selectedLineRef.current = selectedLine; }, [selectedLine]);
  useEffect(() => { dataRef.current = data; }, [data]);

  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) { setNoToken(true); return; }
    if (!containerRef.current) return;
    if (!lines) return;

    let cancelled = false;

    import("mapbox-gl").then((mapboxgl) => {
      if (cancelled || !containerRef.current) return;

      mapboxgl.default.accessToken = token;

      const map = new mapboxgl.default.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/dark-v11",
        center: [-73.9857, 40.7484],
        zoom: 11,
        minZoom: 9,
        maxZoom: 15,
        // Mobile Safari aggressively kills tabs under memory pressure.
        // Trim Mapbox's defaults to stay well below that ceiling.
        fadeDuration: 0,
        maxTileCacheSize: 40,
        antialias: false,
      }) as unknown as MapboxMap;

      mapRef.current = map;

      map.on("load", () => {
        if (cancelled) return;

        // ── One source per layer-type, not per route. Feature properties carry
        // routeId/color/letter so a single layer can render all 25+ lines.
        const lineFeatures = Object.values(lines).map((line) => ({
          type: "Feature" as const,
          properties: { routeId: line.routeId, color: line.color },
          geometry: { type: "LineString" as const, coordinates: line.shape },
        }));
        const stopFeatures = Object.values(lines).flatMap((line) =>
          line.stops.map((stop) => ({
            type: "Feature" as const,
            properties: {
              routeId: line.routeId,
              color: line.color,
              name: stop.name,
              letter: line.id,
            },
            geometry: { type: "Point" as const, coordinates: [stop.lng, stop.lat] },
          })),
        );

        map.addSource("subway-lines", {
          type: "geojson",
          data: { type: "FeatureCollection", features: lineFeatures },
        });
        map.addSource("subway-stops", {
          type: "geojson",
          data: { type: "FeatureCollection", features: stopFeatures },
        });
        map.addSource("subway-trains", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });

        // Single SDF icon, tinted per-feature by icon-color. The white
        // border is drawn by Mapbox via icon-halo-* — one symbol layer
        // instead of two, which halves GPU upload on mobile.
        const icon = makeTrainIcon(56, 24, 10);
        map.addImage(
          "train-capsule",
          { width: icon.width, height: icon.height, data: icon.data },
          { sdf: true, pixelRatio: 2 },
        );

        map.addLayer({
          id: "subway-lines",
          type: "line",
          source: "subway-lines",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": ["get", "color"],
            "line-width": LINE_WIDTH_BY_ZOOM,
            "line-opacity": 0.7,
          },
        });

        // Invisible wide sibling of subway-lines used purely as a touch target.
        // Visible stroke stays thin for a clean map; click/tap hits this
        // ~18px-wide ribbon instead, so fingers don't have to land on a 2.5px
        // line. Sits below the visible layer so it never occludes it.
        map.addLayer({
          id: "subway-lines-hit",
          type: "line",
          source: "subway-lines",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": "#000",
            "line-opacity": 0,
            "line-width": 18,
          },
        }, "subway-lines");

        map.addLayer({
          id: "subway-stops",
          type: "circle",
          source: "subway-stops",
          paint: {
            "circle-radius": 3.5,
            "circle-color": "#0a0a0a",
            "circle-stroke-width": 1.5,
            "circle-stroke-color": ["get", "color"],
            "circle-opacity": STOP_OPACITY_BY_ZOOM,
            "circle-stroke-opacity": STOP_OPACITY_BY_ZOOM,
          },
        });

        // Invisible wider circle for tap targets on stops. Same story as
        // subway-lines-hit: keep the dot small visually, expand the hit area.
        map.addLayer({
          id: "subway-stops-hit",
          type: "circle",
          source: "subway-stops",
          paint: {
            "circle-radius": 14,
            "circle-color": "#000",
            "circle-opacity": 0,
          },
        });

        // Capsule image is drawn with its long axis horizontal. Bearing is
        // compass degrees (0=N, 90=E). We want the capsule long axis to
        // align with the direction of travel, so rotate by (bearing - 90).
        const capsuleRotate: MapboxExpression = ["-", ["get", "bearing"], 90];

        // Scale the capsule with zoom. At z=11 (default downtown frame) the
        // raw 56px icon dwarfs the 2.5px tracks and piles overlap into a
        // visual mess, so we shrink to ~0.35 there and ease up to full size
        // on closer zooms where detail actually reads.
        const iconSizeByZoom: MapboxExpression = [
          "interpolate", ["linear"], ["zoom"],
          10, 0.3,
          11.5, 0.45,
          13, 0.8,
          14, 1.0,
        ];

        map.addLayer({
          id: "subway-trains-icon",
          type: "symbol",
          source: "subway-trains",
          layout: {
            "icon-image": "train-capsule",
            "icon-rotate": capsuleRotate,
            "icon-rotation-alignment": "map",
            "icon-pitch-alignment": "map",
            "icon-size": iconSizeByZoom,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
          paint: {
            "icon-color": ["get", "color"],
            // Halo matches the dark map background so overlapping capsules
            // blend into quiet dark seams instead of the jagged white
            // streaks a white halo produced at zoom-out density.
            "icon-halo-color": "#0a0a0a",
            "icon-halo-width": 1,
            "icon-halo-blur": 0.5,
          },
        });
        map.addLayer({
          id: "subway-trains-text",
          type: "symbol",
          source: "subway-trains",
          layout: {
            "text-field": ["get", "letter"],
            "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
            "text-size": [
              "interpolate", ["linear"], ["zoom"],
              12, 8,
              14, 11,
            ],
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          },
          paint: {
            "text-color": [
              "case",
              ["==", ["get", "textColor"], "black"], "#000000",
              "#ffffff",
            ],
            // Letters are unreadable at low zoom — fade them in around z=12.
            "text-opacity": [
              "interpolate", ["linear"], ["zoom"],
              11.5, 0,
              12.5, 1,
            ],
          },
        });

        // ── Interactions (one handler each, not one per route)
        // Bind click to the fat invisible hit layer so thin lines are still
        // easy to tap on touchscreens.
        map.on("click", "subway-lines-hit", (e: unknown) => {
          const ev = e as {
            features?: { properties?: { routeId?: string } }[];
            lngLat?: { lng: number; lat: number };
          };
          const hitRoutes = (ev.features ?? [])
            .map((f) => f.properties?.routeId)
            .filter((r): r is string => !!r);
          if (hitRoutes.length === 0) return;
          // Normalize to a canonical route for shared trunks (Lex, 8 Ave,
          // Broadway, 6 Ave) so the same corridor always opens with the
          // same representative. If the user already picked a route in
          // that corridor (e.g. "5" via the picker), keep their choice —
          // at a dense junction (Union Sq: 456 + NQRW + L), if ANY hit
          // feature is on the current corridor, stay on it rather than
          // jumping to whichever route Mapbox returned first.
          const current = selectedLineRef.current;
          const currentCorridor = current
            ? CORRIDOR[current] ?? [current]
            : null;
          const keepCurrent =
            !!current &&
            !!currentCorridor &&
            hitRoutes.some((r) => currentCorridor.includes(r));
          const pick = keepCurrent
            ? current
            : hitRoutes[0];
          const clickedCorridor = CORRIDOR[pick!] ?? [pick!];
          const target = keepCurrent ? current! : clickedCorridor[0];
          if (!keepCurrent && current === target) {
            clickLngLatRef.current = null;
            onLineSelect(null);
            return;
          }
          clickLngLatRef.current = ev.lngLat
            ? [ev.lngLat.lng, ev.lngLat.lat]
            : null;
          // Find the nearest stop on the target line to the tapped
          // point so the panel can scroll to it and the user lands on
          // where they tapped, not at the top of the stop list.
          let focusStopId: string | undefined;
          const targetLine = lines[target];
          if (targetLine && ev.lngLat) {
            focusStopId = nearestStop(targetLine.stops, ev.lngLat.lng, ev.lngLat.lat)?.id;
          }
          onLineSelect(target, focusStopId);
        });
        map.on("mouseenter", "subway-lines-hit", () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "subway-lines-hit", () => {
          map.getCanvas().style.cursor = "";
        });

        const popup = new mapboxgl.default.Popup({
          closeButton: false,
          closeOnClick: true,
          className: "subway-popup",
          offset: 10,
        });
        const showStopPopup = (e: unknown) => {
          const ev = e as {
            features?: {
              geometry: GeoJSON.Point;
              properties?: { name?: string; letter?: string; color?: string };
            }[];
          };
          const feat = ev.features?.[0];
          if (!feat) return;
          const coords = feat.geometry.coordinates as [number, number];
          popup
            .setLngLat(coords)
            .setHTML(
              `<span style="color:${feat.properties?.color};font-weight:700">${feat.properties?.letter}</span> ${feat.properties?.name}`,
            )
            .addTo(map as unknown as mapboxgl.Map);
        };
        map.on("mouseenter", "subway-stops-hit", showStopPopup);
        map.on("mouseleave", "subway-stops-hit", () => popup.remove());
        // Touch: hover doesn't fire, so bind click too. Tapping elsewhere
        // dismisses via closeOnClick: true.
        map.on("click", "subway-stops-hit", showStopPopup);

        setMapLoaded(true);
      });
    });

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines]);

  // Push live train positions. rAF schedules; a ~33ms gate caps actual work
  // to ~30Hz — enough headroom for the render loop on mobile Safari while
  // still feeling continuously live.
  //
  // Each train carries its own observed velocity (progress fraction per
  // second). Between polls, we advance progress at that rate so motion
  // matches what the MTA feed is actually reporting. When a new poll
  // arrives we refresh the velocity estimate and reset the baseline; any
  // residual correction is lerped in so there's no visible catch-up jump.
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || !lines) return;
    const map = mapRef.current;

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

    // Perpendicular offset in pixels, per routeId, so trains on a shared
    // trunk (4+6 at Union Sq, N+R at 42 St) stack side-by-side instead of
    // collapsing into a single unreadable pixel. Centered routes (5, D, F,
    // Q, R) get 0 so most stops still read dead-on-track; outer routes
    // fan out symmetrically. This offset is pixel-space at the icon scale;
    // it's converted to lng/lat per-frame so both the capsule and the
    // letter move together.
    const PERP_OFFSET_PX: Record<string, number> = {
      "1": -4, "3": 4,
      "4": -4, "6": 4,
      A: -4, E: 4,
      B: -5, D: -2, F: 2, M: 5,
      N: -5, Q: -2, R: 2, W: 5,
      J: -3, Z: 3,
    };

    let frame = 0;
    let lastTickTime = 0;
    let lastData: typeof dataRef.current = null;
    let trainsByRoute: Map<string, Train[]> = new Map();
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
      const features: GeoJSON.Feature[] = [];
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
            // New train or crossed into a new segment — snap to the raw
            // position and start fresh. Velocity carries over so the next
            // segment starts with a reasonable prediction instead of the
            // generic 90s default.
            const pos = trainLatLng(line, t);
            if (!pos) continue;
            state = {
              baseProgress: t.progress,
              baseTime: d.generatedAt,
              velocity: state?.velocity ?? DEFAULT_VELOCITY,
              lng: pos.lng,
              lat: pos.lat,
              bearing: pos.bearing,
              prevStopId: t.prevStopId,
              nextStopId: t.nextStopId,
            };
            trainState.set(t.id, state);
          } else if (newPoll) {
            // Same segment, fresh poll — learn the observed velocity from
            // the actual progress delta. Zero or negative deltas (train
            // holding at a signal, ETA recalculation walking progress
            // back) decay velocity toward 0 via the LP filter, so we
            // stop predicting forward motion the MTA feed isn't seeing.
            const dtSec = (d.generatedAt - state.baseTime) / 1000;
            if (dtSec > 0.5) {
              const observed = (t.progress - state.baseProgress) / dtSec;
              const clamped = Math.max(0, Math.min(MAX_VELOCITY, observed));
              state.velocity = 0.5 * state.velocity + 0.5 * clamped;
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

          // Apply the per-route perpendicular nudge. Convert the pixel
          // offset to lng/lat based on the current zoom so the visual
          // gap between stacked trains stays consistent as the user
          // zooms. Web-Mercator meters-per-pixel formula; 111320 m per
          // degree of latitude (and per deg lng scaled by cos(lat)).
          const perpPx = PERP_OFFSET_PX[line.routeId] ?? 0;
          let renderLng = state.lng;
          let renderLat = state.lat;
          if (perpPx !== 0) {
            const latRad = (state.lat * Math.PI) / 180;
            const mPerPx =
              (156543.03392 * Math.cos(latRad)) / Math.pow(2, currentZoom);
            const perpM = perpPx * mPerPx;
            const perpRad = ((state.bearing + 90) * Math.PI) / 180;
            renderLat += (perpM * Math.cos(perpRad)) / 111320;
            renderLng +=
              (perpM * Math.sin(perpRad)) / (111320 * Math.cos(latRad));
          }

          features.push({
            type: "Feature",
            properties: {
              id: t.id,
              direction: t.direction,
              bearing: state.bearing,
              routeId: line.routeId,
              color: line.color,
              letter: line.id,
              textColor: line.textColor,
            },
            geometry: { type: "Point", coordinates: [renderLng, renderLat] },
          });
        }
      }
      // Drop state for trains that vanished (e.g. completed trip) so the
      // map doesn't leak memory over long sessions.
      if (seen.size !== trainState.size) {
        for (const id of trainState.keys()) if (!seen.has(id)) trainState.delete(id);
      }
      const src = map.getSource("subway-trains");
      src?.setData({ type: "FeatureCollection", features });
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [mapLoaded, lines]);

  // Selection: dim non-selected via expressions on the consolidated layers.
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || !lines) return;
    const map = mapRef.current;
    const sel = selectedLine;

    // Match all routes on the same shared-track corridor, not just the
    // single routeId. Picking "1" lights up 1/2/3; picking "A" lights up
    // A/C/E; etc.
    const corridor = sel ? CORRIDOR[sel] ?? [sel] : null;
    // For constants-only properties, a plain case expression is fine.
    const matchSel = (whenSelected: unknown, whenDimmed: unknown, whenNone: unknown) =>
      corridor === null
        ? whenNone
        : [
            "case",
            ["in", ["get", "routeId"], ["literal", corridor]],
            whenSelected,
            whenDimmed,
          ];
    // Mapbox requires "zoom" to live at the TOP of an interpolate/step — it
    // cannot sit inside a `case`. So when we need a zoom-responsive value
    // that also varies by selection, we push the `case` to the per-stop
    // values of the interpolate instead of wrapping the whole interpolate.
    const inCorridor = corridor
      ? ["in", ["get", "routeId"], ["literal", corridor]]
      : null;
    const widthExpr = inCorridor
      ? [
          "interpolate", ["linear"], ["zoom"],
          9, ["case", inCorridor, 6, 3.5],
          11, ["case", inCorridor, 5, 2.75],
          14, ["case", inCorridor, 7, 4.5],
        ]
      : LINE_WIDTH_BY_ZOOM;

    map.setPaintProperty("subway-lines", "line-opacity", matchSel(1, 0.1, 0.7));
    map.setPaintProperty("subway-lines", "line-width", widthExpr);
    // Selected corridor's stops stay fully visible at any zoom so the user
    // can trace the route; unselected stops keep their zoom-based fade.
    // Selection values are constants, so a simple case is legal here.
    map.setPaintProperty(
      "subway-stops",
      "circle-opacity",
      inCorridor ? ["case", inCorridor, 0.85, 0.05] : STOP_OPACITY_BY_ZOOM,
    );
    map.setPaintProperty(
      "subway-stops",
      "circle-stroke-opacity",
      inCorridor ? ["case", inCorridor, 1, 0.1] : STOP_OPACITY_BY_ZOOM,
    );
    map.setPaintProperty("subway-trains-icon", "icon-opacity", matchSel(1, 0, 1));
    map.setPaintProperty("subway-trains-text", "text-opacity", matchSel(1, 0, 1));

    if (sel) {
      import("mapbox-gl").then((mapboxgl) => {
        const line = lines[sel];
        if (!line || line.shape.length === 0) return;
        // LinePanel floats over the map — as a 45vh bottom sheet on mobile,
        // or as a ~320px right-side card on desktop. Pad fitBounds so the
        // frame lands in the visible area, not under the panel.
        const isMobile = window.matchMedia("(max-width: 639px)").matches;
        const bottomPad = isMobile
          ? Math.round(window.innerHeight * 0.45) + 16
          : 40;
        const rightPad = isMobile ? 40 : 340;

        // If selection came from a click on the line, zoom to the nearest
        // stop instead of the default downtown frame.
        const clickAt = clickLngLatRef.current;
        clickLngLatRef.current = null;
        if (clickAt) {
          const nearest = nearestStop(line.stops, clickAt[0], clickAt[1]) ?? line.stops[0];
          // ~0.006° ≈ 550m on lat; padding handles the bottom sheet.
          const H = 0.006;
          map.fitBounds(
            new mapboxgl.default.LngLatBounds(
              [nearest.lng - H, nearest.lat - H],
              [nearest.lng + H, nearest.lat + H],
            ),
            {
              padding: { top: 40, right: rightPad, bottom: bottomPad, left: 40 },
              duration: 800,
            },
          );
          return;
        }

        // Downtown-ish Manhattan frame: Battery → ~86th St, Hudson → East
        // River. If the selected line has any stops in this window, we use
        // this fixed rectangle (predictable framing). Otherwise (Staten
        // Island, Rockaway shuttle) fall back to the line's full extent.
        const DT_SW: [number, number] = [-74.020, 40.700];
        const DT_NE: [number, number] = [-73.945, 40.790];
        const touchesDowntown = line.stops.some(
          (s) =>
            s.lng >= DT_SW[0] &&
            s.lng <= DT_NE[0] &&
            s.lat >= DT_SW[1] &&
            s.lat <= DT_NE[1],
        );
        if (touchesDowntown) {
          map.fitBounds(new mapboxgl.default.LngLatBounds(DT_SW, DT_NE), {
            padding: { top: 40, right: rightPad, bottom: bottomPad, left: 40 },
            duration: 800,
          });
        } else {
          const bounds = new mapboxgl.default.LngLatBounds();
          line.shape.forEach((c) => bounds.extend(c as [number, number]));
          map.fitBounds(bounds, {
            padding: { top: 80, right: rightPad, bottom: bottomPad, left: 80 },
            duration: 800,
          });
        }
      });
    }
  }, [selectedLine, mapLoaded, lines]);

  if (noToken) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-950 text-white p-8">
        <div className="text-center max-w-md">
          <div className="text-5xl mb-4">🗺️</div>
          <h3 className="text-xl font-bold mb-2">Add a Mapbox token to see the map</h3>
          <p className="text-gray-400 mb-4 text-sm">
            Create a free token at{" "}
            <span className="text-blue-400 font-medium">mapbox.com</span>, then add it to{" "}
            <code className="bg-gray-800 px-1.5 py-0.5 rounded text-xs">.env.local</code>:
          </p>
          <div className="bg-gray-800 rounded-lg p-4 text-left text-sm font-mono text-green-400 select-all">
            NEXT_PUBLIC_MAPBOX_TOKEN=pk.eyJ1...
          </div>
          <p className="text-gray-500 text-xs mt-3">Restart the dev server after adding the token.</p>
        </div>
      </div>
    );
  }

  return <div ref={containerRef} className="flex-1 w-full h-full" />;
}
