"use client";

import { useEffect, useRef, useState } from "react";
import { useLines, CORRIDOR, type Stop, type SubwayLine } from "@/lib/subwayData";
import { useTrains, trainLatLng, type Train } from "@/lib/useTrains";
import { useGeolocationState } from "@/lib/useGeolocation";
import { buildStationIndex } from "@/lib/stopsIndex";
import "mapbox-gl/dist/mapbox-gl.css";

interface MapViewProps {
  selectedLine: string | null; // routeId
  stationStopId: string | null;
  onLineSelect: (line: string | null, focusStopId?: string) => void;
  onStationOpen: (stopId: string) => void;
  /** Increments each time the user taps Near-me. The map reacts by
   *  flying to the user's current location; if geolocation hasn't
   *  arrived yet, the fly stays pending and triggers as soon as a
   *  position is available. */
  flyToUserSignal?: number;
  /** Increments when the rider asks for a "Preview the map" reset
   *  (e.g. they're outside NYC and the Near-me panel is useless).
   *  The map flies to the canonical Manhattan overview that the map
   *  initializes with. */
  flyToDefaultSignal?: number;
  /** Whether any covering panel (NearbyPanel, LinePanel, StationPanel)
   *  is currently rendered. When true, fly-to-user applies camera
   *  padding so the user's location lands in the *visible* portion of
   *  the map rather than the geometric viewport center (which is
   *  hidden behind the panel on mobile). */
  panelOpen?: boolean;
  /** A trip plan from SearchSheet. When set, the map renders thick
   *  highlighted polylines for each leg + Board / Transfer / Alight
   *  markers, and flies the camera to fit the trip bounds. Null when
   *  nothing is selected (the trip layers render an empty FC). */
  selectedTrip?: SelectedTrip | null;
  /** When set, the camera fits to just this leg's bounds (plus its
   *  board/alight stations) instead of the full trip. Lets the
   *  expanded route detail zoom into a specific subway leg when the
   *  rider taps it. */
  focusedLegIndex?: number | null;
}

/** Lightweight DTO between SubwayMap (which holds the user's chosen
 *  TripPlan) and MapView (which only needs the per-leg geometry +
 *  station coordinates to render the overlay). The shape lets MapView
 *  stay decoupled from `commuteRouting.ts` types. */
export interface SelectedTrip {
  legs: {
    routeId: string;
    color: string;
    coordinates: [number, number][];
    boardStation: { stopId: string; name: string; lng: number; lat: number };
    alightStation: { stopId: string; name: string; lng: number; lat: number };
  }[];
  /** Canonical complex stopId of the transfer point, or undefined for
   *  a direct trip. Resolved into a station by the parent. */
  transferStation?: { stopId: string; name: string; lng: number; lat: number };
  /** Optional walk-leg endpoint at the start of the trip — the rider's
   *  actual origin (current location or saved address). When set,
   *  MapView draws a dashed walking line from this coord to the first
   *  leg's boarding station. Undefined when the rider is starting at
   *  a station-pinned origin (no walk needed). */
  walkFrom?: { lng: number; lat: number; name?: string };
  /** Same idea for the destination side — walks from the last leg's
   *  alighting station to this coord (a saved address or geocoded
   *  destination). Undefined for station-only destinations. */
  walkTo?: { lng: number; lat: number; name?: string };
  /** Resolved street-following pedestrian path for the start walk leg
   *  (rider's origin → boarding station). When present the dashed
   *  walking line traces this geometry instead of a straight crow's
   *  flies segment. Falls back to a straight line until the API
   *  resolves (or if the fetch fails). [lng, lat] coordinate order. */
  walkFromCoords?: [number, number][];
  /** Same idea for the destination walk leg (alighting station →
   *  destination). */
  walkToCoords?: [number, number][];
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
  flyTo: (opts: {
    center: [number, number];
    zoom?: number;
    duration?: number;
    padding?: { top?: number; right?: number; bottom?: number; left?: number };
  }) => void;
  easeTo: (opts: {
    center: [number, number];
    zoom?: number;
    duration?: number;
    padding?: { top: number; right: number; bottom: number; left: number };
  }) => void;
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

// Clean subway-car silhouette: softly rounded rear, long sharp nose on
// the right. Drawn horizontal so a rotation of 0 = pointing east;
// icon-rotate = bearing - 90 aligns the nose with direction of travel.
//
// Pre-baked per route as a full RGBA bitmap (not SDF). SDF sprites are
// single-channel and rely on Mapbox's halo shader for the white outline,
// which gets aliased at map zooms where the sprite is downscaled heavily.
// Train marker — top-down skeumorphic subway car, rendered in the style
// of Apple Maps' simplified 3D polygon vehicles.
//
// Anatomy of the icon:
//   • Body: rounded rectangle in the route color, with corner radius
//     matching a real R211/R142 subway car silhouette (gentle round,
//     not pill-shaped). Inset from the canvas edges to leave room for
//     drop shadow and headlight beam.
//   • 3D shading: a vertical gradient (lighter top edge, darker bottom
//     edge) plus a thin specular gleam along the top, so the body
//     reads as a slightly raised polygon viewed from above with light
//     coming from "north" — the same trick Apple Maps uses on its
//     building polygons.
//   • Front (right end after rotation): two warm-white headlight bulbs
//     with soft halos at the front corners, plus a small dark
//     windshield rectangle between them — the operator's cab.
//   • Headlight beam: a tapered warm-white cone fading forward into
//     the map, simulating the headlights' projection.
//   • Rear (left end): two small dark marker squares — subtle visual
//     cue that this end is the back, without competing with the
//     headlights' brightness.
//   • Outer ring: a thin subtle white stroke for separation from
//     similarly-colored map tiles.
//
// The route letter / number is rendered on top by a separate Mapbox
// text symbol layer (see subway-trains-text), so it can stay
// viewport-aligned (always upright) while the body rotates with the
// map.
//
// One image per route — Mapbox picks the right one per feature via
// `["concat", "train-", ["get", "routeId"]]`.
const TRAIN_ICON_W = 92;
const TRAIN_ICON_H = 40;
const BODY_W = 70;
const BODY_H = 30;

function makeTrainIcon(color: string): ImageData {
  const W = TRAIN_ICON_W;
  const H = TRAIN_ICON_H;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;

  // Body geometry — centered on canvas so Mapbox's default
  // icon-anchor (bitmap center) lands the train's lat/lng on the
  // body's geometric center. Travel direction extends rightward.
  const bodyX = (W - BODY_W) / 2;
  const bodyY = (H - BODY_H) / 2;
  const bodyR = 6;
  const bodyRight = bodyX + BODY_W;
  const bodyMidY = bodyY + BODY_H / 2;

  const bodyPath = () => {
    ctx.beginPath();
    ctx.moveTo(bodyX + bodyR, bodyY);
    ctx.lineTo(bodyRight - bodyR, bodyY);
    ctx.arcTo(bodyRight, bodyY, bodyRight, bodyY + bodyR, bodyR);
    ctx.lineTo(bodyRight, bodyY + BODY_H - bodyR);
    ctx.arcTo(bodyRight, bodyY + BODY_H, bodyRight - bodyR, bodyY + BODY_H, bodyR);
    ctx.lineTo(bodyX + bodyR, bodyY + BODY_H);
    ctx.arcTo(bodyX, bodyY + BODY_H, bodyX, bodyY + BODY_H - bodyR, bodyR);
    ctx.lineTo(bodyX, bodyY + bodyR);
    ctx.arcTo(bodyX, bodyY, bodyX + bodyR, bodyY, bodyR);
    ctx.closePath();
  };

  // 1) Headlight cones — drawn FIRST, behind everything, so the body's
  //    drop shadow occludes the cone origins and they read as light
  //    streaming out from beneath the bulbs. Two distinct cones (one
  //    per headlight) rather than a single wide beam, so the rider
  //    can clearly see where each bulb is pointing. Each cone starts
  //    narrow at the headlight, widens slightly outward (cones diverge
  //    a touch as they project), and fades from semi-transparent at
  //    the source to fully transparent at the tip.
  const coneStartX = bodyRight;
  const coneTipX = W - 1;
  // Headlight Y positions match the bulbs drawn later in step 7.
  const coneTopY = bodyY + 6;
  const coneBotY = bodyY + BODY_H - 6;
  const drawCone = (centerY: number, divergeY: number) => {
    const grad = ctx.createLinearGradient(coneStartX, 0, coneTipX, 0);
    grad.addColorStop(0, "rgba(255, 245, 200, 0.60)");
    grad.addColorStop(0.55, "rgba(255, 245, 200, 0.20)");
    grad.addColorStop(1, "rgba(255, 245, 200, 0)");
    ctx.fillStyle = grad;
    const startHalfW = 1.5;
    const tipHalfW = 4;
    ctx.beginPath();
    ctx.moveTo(coneStartX, centerY - startHalfW);
    ctx.lineTo(coneTipX, centerY + divergeY - tipHalfW);
    ctx.lineTo(coneTipX, centerY + divergeY + tipHalfW);
    ctx.lineTo(coneStartX, centerY + startHalfW);
    ctx.closePath();
    ctx.fill();
  };
  // Top cone diverges slightly upward, bottom cone slightly downward —
  // the two beams visually splay outward like real train headlights.
  drawCone(coneTopY, -1.5);
  drawCone(coneBotY, 1.5);

  // 2) Drop shadow — soft dark blur under the body for the "polygon
  //    floating slightly above the map" Apple Maps look.
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 2;
  bodyPath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();

  // 3) Solid body fill — covers the shadowed silhouette with the route
  //    color in full saturation.
  bodyPath();
  ctx.fillStyle = color;
  ctx.fill();

  // 4) 3D shading — vertical gradient simulates light from "above" so
  //    the top edge brightens and the bottom edge falls into shadow.
  //    Same trick Apple Maps uses on building polygons.
  ctx.save();
  bodyPath();
  ctx.clip();
  const shading = ctx.createLinearGradient(0, bodyY, 0, bodyY + BODY_H);
  shading.addColorStop(0, "rgba(255, 255, 255, 0.30)");
  shading.addColorStop(0.5, "rgba(255, 255, 255, 0)");
  shading.addColorStop(1, "rgba(0, 0, 0, 0.30)");
  ctx.fillStyle = shading;
  ctx.fillRect(0, 0, W, H);

  // 5) Top-edge specular highlight — thin elongated near-white ellipse
  //    just inside the top edge, length-matched to the body. Reads as
  //    sun glinting off the roof of the car.
  ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
  ctx.beginPath();
  ctx.ellipse(bodyX + BODY_W / 2, bodyY + 2, BODY_W / 2 - 8, 1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 6) Subtle outer outline — thin and not bright, for separation from
  //    map tiles of similar color without looking like a sign sticker.
  bodyPath();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.65)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // 7) Headlights — two warm-white bulbs at the front corners. A
  //    larger, lower-alpha halo behind each bulb gives them that
  //    "glowing" feel and ties them visually to the beam.
  const headlightX = bodyRight - 5;
  const headlightTopY = bodyY + 6;
  const headlightBotY = bodyY + BODY_H - 6;
  ctx.fillStyle = "rgba(255, 240, 200, 0.40)";
  ctx.beginPath();
  ctx.arc(headlightX, headlightTopY, 2.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(headlightX, headlightBotY, 2.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255, 245, 220, 0.98)";
  ctx.beginPath();
  ctx.arc(headlightX, headlightTopY, 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(headlightX, headlightBotY, 1.6, 0, Math.PI * 2);
  ctx.fill();

  // 8) Windshield — small dark rounded rectangle between the
  //    headlights, slightly inset from the front edge so it reads as
  //    the driver's cab interior visible through the front window.
  const wsX = bodyRight - 9;
  const wsY = bodyY + 11;
  const wsW = 6;
  const wsH = 8;
  ctx.fillStyle = "rgba(0, 0, 0, 0.32)";
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(wsX, wsY, wsW, wsH, 1.5);
    ctx.fill();
  } else {
    ctx.fillRect(wsX, wsY, wsW, wsH);
  }

  // 9) Rear marker squares — small dark unlit indicators at the back
  //    corners. Quiet visual cue that this end is the rear so the
  //    train's direction stays unambiguous even at low zooms where the
  //    headlights and beam may be hard to see.
  ctx.fillStyle = "rgba(0, 0, 0, 0.40)";
  ctx.fillRect(bodyX + 4, bodyY + 6, 2, 2);
  ctx.fillRect(bodyX + 4, bodyY + BODY_H - 8, 2, 2);

  return ctx.getImageData(0, 0, W, H);
}

export default function MapView({ selectedLine, stationStopId, onLineSelect, onStationOpen, flyToUserSignal, flyToDefaultSignal, panelOpen, selectedTrip, focusedLegIndex }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [noToken, setNoToken] = useState(false);
  const selectedLineRef = useRef(selectedLine);
  const onStationOpenRef = useRef(onStationOpen);
  useEffect(() => { onStationOpenRef.current = onStationOpen; }, [onStationOpen]);
  // Set by the map line-click handler; read + cleared by the selection
  // effect so a click-initiated selection zooms to the nearest stop rather
  // than to the default downtown frame.
  const clickLngLatRef = useRef<[number, number] | null>(null);
  const data = useTrains();
  const dataRef = useRef(data);
  const lines = useLines();
  const geo = useGeolocationState();


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
              stopId: stop.id,
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

        // Single-point source for the user's current location. Driven by
        // `useGeolocationState` — populated only when Near Me (or any
        // other opted-in consumer) has the watch running, so the map
        // never triggers its own permission prompt.
        map.addSource("user-location", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });

        // Focused-station marker: the station the StationPanel is currently
        // showing. Rendered as a highlighted dot plus a persistent name
        // label so the user always knows which station the panel refers to,
        // even after panning the map. Driven by stationStopId — a 0-feature
        // collection when no panel is open.
        map.addSource("focused-station", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });

        // Trip overlay — renders the legs of a selected TripPlan as
        // bright thick polylines on top of the dimmed line network,
        // plus distinctive Board / Transfer / Alight station markers.
        // Driven by `selectedTrip` from the parent; an empty feature
        // collection when no trip is selected. Two separate sources
        // keep line geometry and station markers cleanly separated so
        // their layers can use different paint expressions.
        map.addSource("subway-trip-legs", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addSource("subway-trip-stations", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        // Walk legs: dashed lines connecting the rider's actual origin
        // to the boarding station, and the alighting station to the
        // destination address. Empty FC when the trip's endpoints are
        // already stations (no walk to draw).
        map.addSource("subway-trip-walks", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });

        // One pre-baked RGBA icon per route, registered as "train-<routeId>".
        // Colors + outlines are painted into the bitmap — no SDF, no halo
        // shader, so the outline stays crisp under Mapbox's downsampling at
        // low zooms. Feature rendering picks the right image via a concat
        // expression on routeId below.
        for (const line of Object.values(lines)) {
          const img = makeTrainIcon(line.color);
          const imgId = `train-${line.routeId}`;
          if (!map.hasImage(imgId)) {
            map.addImage(
              imgId,
              { width: img.width, height: img.height, data: img.data },
              { pixelRatio: 2 },
            );
          }
        }

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

        // ── Trip overlay (selected trip plan from SearchSheet) ──
        // Walking legs render UNDER the subway segment so where they
        // meet at a station the subway color reads cleanly on top.
        // Apple Maps style: short white dashes ("dotted line" feel)
        // with a soft halo for legibility on dark tiles. The dashes
        // shrink slightly at low zoom so they don't smear into a
        // solid line when viewing the whole city.
        map.addLayer({
          id: "subway-trip-walks-halo",
          type: "line",
          source: "subway-trip-walks",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": "#000000",
            "line-opacity": 0.45,
            "line-width": [
              "interpolate", ["linear"], ["zoom"],
              10, 4,
              14, 8,
            ],
            "line-blur": 1.5,
          },
        });
        map.addLayer({
          id: "subway-trip-walks",
          type: "line",
          source: "subway-trip-walks",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": "#ffffff",
            "line-opacity": 0.95,
            "line-width": [
              "interpolate", ["linear"], ["zoom"],
              10, 2,
              14, 4,
            ],
            // Mapbox scales the dasharray by line-width, so these
            // values give roughly square dot-gap pairs at every zoom.
            "line-dasharray": [0.1, 1.6],
          },
        });

        // Bright thick polyline per leg in the leg's route color, with
        // a soft white halo underneath so the segment pops on the
        // dimmed line network. Placed above subway-stops so the
        // selected segment overdraws station dots on its path.
        map.addLayer({
          id: "subway-trip-legs-halo",
          type: "line",
          source: "subway-trip-legs",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": "#ffffff",
            "line-opacity": 0.55,
            "line-width": [
              "interpolate", ["linear"], ["zoom"],
              10, 6,
              14, 14,
            ],
            "line-blur": 1.5,
          },
        });
        map.addLayer({
          id: "subway-trip-legs",
          type: "line",
          source: "subway-trip-legs",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": ["get", "color"],
            "line-opacity": 1,
            "line-width": [
              "interpolate", ["linear"], ["zoom"],
              10, 3.5,
              14, 8,
            ],
          },
        });

        // Trip stations: distinctive circle markers at boarding,
        // transfer, and alighting points. Color encodes role so a
        // glance reads the journey: emerald = start, amber = transfer,
        // sky = destination. White stroke + soft halo lift them off
        // any tile color.
        map.addLayer({
          id: "subway-trip-stations-halo",
          type: "circle",
          source: "subway-trip-stations",
          paint: {
            "circle-color": ["get", "tint"],
            "circle-opacity": 0.32,
            "circle-radius": [
              "interpolate", ["linear"], ["zoom"],
              10, 8,
              14, 18,
            ],
          },
        });
        map.addLayer({
          id: "subway-trip-stations-dot",
          type: "circle",
          source: "subway-trip-stations",
          paint: {
            "circle-color": ["get", "tint"],
            "circle-radius": [
              "interpolate", ["linear"], ["zoom"],
              10, 4,
              14, 8,
            ],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2.2,
          },
        });
        map.addLayer({
          id: "subway-trip-stations-label",
          type: "symbol",
          source: "subway-trip-stations",
          layout: {
            "text-field": ["get", "name"],
            "text-font": ["DIN Pro Bold", "Open Sans Bold", "Arial Unicode MS Bold"],
            "text-size": 12,
            "text-offset": [0, 1.2],
            "text-anchor": "top",
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          },
          paint: {
            "text-color": "#ffffff",
            "text-halo-color": "#0a0a0a",
            "text-halo-width": 2.2,
            "text-halo-blur": 0.2,
          },
        });

        // The car body's long axis is horizontal in the bitmap and the
        // headlights/beam emit at the +x end. Bearing is compass degrees
        // (0=N, 90=E), so rotating by (bearing − 90) aligns the long
        // axis with the direction of travel and points the headlights
        // forward.
        const capsuleRotate: MapboxExpression = ["-", ["get", "bearing"], 90];

        // Scale with zoom. Canvas is 92×40 at 2× pixel ratio → 46×20
        // base display, of which the body is 70/92 ≈ 76% wide.
        // Multipliers below give a target visible BODY size of:
        //   z=10   ~10×4 px   — abstract dot, headlight bulbs visible
        //   z=12   ~18×8 px   — body shape recognizable, beam visible
        //   z=13   ~26×11 px  — windshield + headlights + letter all read
        //   z=14   ~36×16 px  — full skeumorphic detail, comfortable
        //                       letter inside the body
        // Slightly larger than the prior pill so the windshield and
        // rear markers don't disappear into pixel noise.
        const iconSizeByZoom: MapboxExpression = [
          "interpolate", ["linear"], ["zoom"],
          10, 0.29,
          11.5, 0.50,
          13, 0.74,
          14, 1.03,
        ];

        map.addLayer({
          id: "subway-trains-icon",
          type: "symbol",
          source: "subway-trains",
          layout: {
            // Per-route baked bitmap selected by feature.routeId. Names
            // line up with the addImage calls above.
            "icon-image": ["concat", "train-", ["get", "routeId"]],
            "icon-rotate": capsuleRotate,
            "icon-rotation-alignment": "map",
            "icon-pitch-alignment": "map",
            "icon-size": iconSizeByZoom,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
          paint: {
            // Fade train capsules in as the rider zooms into a
            // neighborhood. At the default cold-start zoom (~11) the
            // map shows 300+ trains across the whole system — visually
            // overwhelming and the route letters are unreadable that
            // small anyway. By z=12.5 the icons are fully visible.
            // Runtime selection logic in the line-selection effect
            // wraps this expression so dimming-by-corridor still works.
            "icon-opacity": [
              "interpolate", ["linear"], ["zoom"],
              10.5, 0,
              11.5, 0.55,
              12.5, 1,
            ],
          },
        });
        map.addLayer({
          id: "subway-trains-text",
          type: "symbol",
          source: "subway-trains",
          layout: {
            "text-field": ["get", "letter"],
            // DIN Pro Bold first (chunky, NYC subway feel) — falls back
            // to Open Sans Bold if the dark-v11 style doesn't include
            // DIN glyphs. Either way the letter renders with weight.
            "text-font": ["DIN Pro Bold", "Open Sans Bold", "Arial Unicode MS Bold"],
            // Sized to fill ~80% of the body's vertical height at each
            // zoom — at z=14 the body is ~16 px tall and the letter is
            // 13 px, leaving comfortable padding without looking lost.
            "text-size": [
              "interpolate", ["linear"], ["zoom"],
              12, 7,
              13, 10,
              14, 13,
            ],
            "text-letter-spacing": -0.02,
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

        // (No cluster ×N badge — replaced by a simpler dedup-by-route-
        // direction pass during feature generation. Multiple same-route
        // same-direction trains in one bucket collapse to a single
        // representative icon, so a "queue" indicator is unnecessary.)

        // Focused-station halo + dot. The larger translucent ring draws
        // attention to the station independent of the tiny base dot; the
        // inner white pill with a dark rim keeps it legible on any tile
        // color. Text label sits below so it doesn't overlap the panel
        // on mobile.
        map.addLayer({
          id: "focused-station-halo",
          type: "circle",
          source: "focused-station",
          paint: {
            "circle-color": "#ffffff",
            "circle-opacity": 0.18,
            "circle-radius": [
              "interpolate", ["linear"], ["zoom"],
              11, 10,
              14, 22,
            ],
          },
        });
        map.addLayer({
          id: "focused-station-dot",
          type: "circle",
          source: "focused-station",
          paint: {
            "circle-color": "#ffffff",
            "circle-radius": [
              "interpolate", ["linear"], ["zoom"],
              11, 4,
              14, 7,
            ],
            "circle-stroke-color": "#0f172a",
            "circle-stroke-width": 2,
          },
        });
        map.addLayer({
          id: "focused-station-label",
          type: "symbol",
          source: "focused-station",
          layout: {
            "text-field": ["get", "name"],
            "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
            "text-size": 13,
            "text-offset": [0, 1.1],
            "text-anchor": "top",
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          },
          paint: {
            "text-color": "#ffffff",
            "text-halo-color": "#0f172a",
            "text-halo-width": 2.2,
            "text-halo-blur": 0.2,
          },
        });

        // User-location dot: soft blue halo + opaque core with a white
        // ring. iOS-style "you are here" marker — sits above trains so
        // the user can find themselves on a busy map.
        map.addLayer({
          id: "user-location-halo",
          type: "circle",
          source: "user-location",
          paint: {
            "circle-color": "#3b82f6",
            "circle-opacity": 0.22,
            "circle-radius": 14,
          },
        });
        map.addLayer({
          id: "user-location-dot",
          type: "circle",
          source: "user-location",
          paint: {
            "circle-color": "#3b82f6",
            "circle-radius": 6,
            "circle-stroke-width": 2.5,
            "circle-stroke-color": "#ffffff",
          },
        });

        // ── Interactions (one handler each, not one per route)
        // Clicking a train capsule jumps to the station it's at (or the
        // closer of its two segment endpoints if mid-hop). Runs before
        // the line handler via a guard below — otherwise a click on a
        // train that happens to sit over its track would also trigger
        // the generic line-tap flow.
        map.on("click", "subway-trains-icon", (e: unknown) => {
          const ev = e as {
            features?: {
              properties?: { routeId?: string };
              geometry?: GeoJSON.Point;
            }[];
          };
          const feat = ev.features?.[0];
          const routeId = feat?.properties?.routeId;
          const coords = feat?.geometry?.coordinates as [number, number] | undefined;
          if (!routeId || !coords) return;
          const targetCorridor = CORRIDOR[routeId] ?? [routeId];
          const target = targetCorridor[0];
          const targetLine = lines[target];
          const focusStopId = targetLine
            ? nearestStop(targetLine.stops, coords[0], coords[1])?.id
            : undefined;
          clickLngLatRef.current = coords;
          onLineSelect(target, focusStopId);
        });
        map.on("mouseenter", "subway-trains-icon", () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "subway-trains-icon", () => {
          map.getCanvas().style.cursor = "";
        });

        // Bind click to the fat invisible hit layer so thin lines are still
        // easy to tap on touchscreens.
        map.on("click", "subway-lines-hit", (e: unknown) => {
          const ev = e as {
            features?: { properties?: { routeId?: string } }[];
            lngLat?: { lng: number; lat: number };
            point?: { x: number; y: number };
          };
          // Defer to the train/stop handlers if one of them also owns the
          // click point — otherwise a tap on a train or station sitting
          // on its own line triggers both flows and the second one
          // overwrites the first's flyTo.
          if (ev.point) {
            const priorityHit = (map as unknown as {
              queryRenderedFeatures: (p: unknown, o: unknown) => unknown[];
            }).queryRenderedFeatures(ev.point, {
              layers: ["subway-trains-icon", "subway-stops-hit"],
            });
            if (priorityHit.length > 0) return;
          }
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
              properties?: { name?: string; letter?: string; color?: string; stopId?: string };
            }[];
          };
          const feat = ev.features?.[0];
          if (!feat) return;
          const coords = feat.geometry.coordinates as [number, number];
          const stopId = feat.properties?.stopId;
          // Tappable popup: the station name itself is the affordance to
          // open the StationPanel, so users who see the hover tooltip on
          // desktop (or a touch-and-release on mobile) have an obvious
          // path into the station view. data-stopid is read by the
          // delegated click listener below.
          popup
            .setLngLat(coords)
            .setHTML(
              `<button type="button" class="subway-popup-btn" data-stopid="${stopId ?? ""}"><span style="color:${feat.properties?.color};font-weight:700">${feat.properties?.letter}</span> ${feat.properties?.name}</button>`,
            )
            .addTo(map as unknown as mapboxgl.Map);
        };
        map.on("mouseenter", "subway-stops-hit", showStopPopup);
        map.on("mouseleave", "subway-stops-hit", () => popup.remove());
        // Tapping a station opens the StationPanel (all lines serving
        // this stop, with live arrivals), not a single-line panel. A
        // station like Union Sq serves 4/5/6, N/Q/R/W, and L — the
        // station view lets the user see every incoming train and pick
        // a line from there, instead of being dropped into whichever
        // route's dot Mapbox happened to return first.
        map.on("click", "subway-stops-hit", (e: unknown) => {
          showStopPopup(e);
          const ev = e as {
            features?: {
              geometry: GeoJSON.Point;
              properties?: { stopId?: string };
            }[];
          };
          const feat = ev.features?.[0];
          const stopId = feat?.properties?.stopId;
          if (!stopId) return;
          // Map zoom is handled by the stationStopId effect so every
          // entry point (map tap, Near Me row, LinePanel stop tap)
          // animates the same way — don't duplicate that here.
          onStationOpenRef.current(stopId);
        });

        // Delegated click handler for the popup button. The popup node
        // is re-created on every hover/tap, so we can't bind directly —
        // instead we listen on the map container and fire when the tap
        // lands on the .subway-popup-btn element.
        containerRef.current?.addEventListener("click", (ev) => {
          const target = ev.target as HTMLElement | null;
          const btn = target?.closest?.(".subway-popup-btn") as HTMLElement | null;
          if (!btn) return;
          const stopId = btn.dataset.stopid;
          if (!stopId) return;
          ev.stopPropagation();
          popup.remove();
          onStationOpenRef.current(stopId);
        });

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
        const seen = new Set<string>();
        const deduped: Computed[] = [];
        for (const c of arr) {
          const groupKey = `${c.line.routeId}-${c.direction}`;
          if (seen.has(groupKey)) continue;
          seen.add(groupKey);
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

  // Sync user-location source with geolocation state. The dot only appears
  // once the user has granted location permission via the Near Me panel.
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current;
    const src = map.getSource("user-location") as { setData: (d: unknown) => void } | undefined;
    if (!src) return;
    if (geo.status === "granted" && geo.lat != null && geo.lng != null) {
      src.setData({
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: [geo.lng, geo.lat] },
        }],
      });
    } else {
      src.setData({ type: "FeatureCollection", features: [] });
    }
  }, [mapLoaded, geo.status, geo.lat, geo.lng]);

  // Fly-to-user, driven by the parent's flyToUserSignal counter. Each
  // increment of the prop becomes a "pending fly" that consumes the
  // first geolocation reading available — so a tap on Near-me works
  // whether geo is already known (instant fly) or still being granted
  // (fly fires the moment the position lands). State, not a ref, so
  // both signal-change and geo-arrival can trigger consumption.
  const lastFlySignalRef = useRef(0);
  const [pendingFly, setPendingFly] = useState(false);

  // Latest panelOpen value mirrored in a ref so the fly effect can
  // read it without adding it to its dep array (which would re-run
  // the effect on panel toggles). The fly should respect whatever
  // the panel state IS at the moment the camera moves.
  const panelOpenRef = useRef(!!panelOpen);
  useEffect(() => {
    panelOpenRef.current = !!panelOpen;
  }, [panelOpen]);

  useEffect(() => {
    const sig = flyToUserSignal ?? 0;
    if (sig === 0 || sig === lastFlySignalRef.current) return;
    lastFlySignalRef.current = sig;
    setPendingFly(true);
  }, [flyToUserSignal]);

  // Reset-to-Manhattan fly. Driven by flyToDefaultSignal — the Near-me
  // panel bumps it when an out-of-NYC rider taps "Preview the map" so
  // the camera lands somewhere useful regardless of where the user
  // happens to be. Mirrors the map's initial center/zoom so the
  // viewport returns to the same canonical frame the page first paints.
  const lastDefaultSignalRef = useRef(0);
  useEffect(() => {
    const sig = flyToDefaultSignal ?? 0;
    if (sig === 0 || sig === lastDefaultSignalRef.current) return;
    lastDefaultSignalRef.current = sig;
    if (!mapLoaded || !mapRef.current) return;
    mapRef.current.flyTo({
      center: [-73.9857, 40.7484],
      zoom: 11,
      duration: 900,
    });
  }, [flyToDefaultSignal, mapLoaded]);
  useEffect(() => {
    if (!pendingFly) return;
    if (!mapLoaded || !mapRef.current) return;
    if (geo.lat == null || geo.lng == null) return;
    const map = mapRef.current;
    const currentZoom = map.getZoom();

    // When a panel covers part of the viewport, declare that area as
    // padding so Mapbox aims the center at the visible map region
    // rather than the geometric viewport center (which is hidden
    // behind the panel on mobile). Mobile = bottom sheet, desktop =
    // right rail. Without this, the user's blue dot lands behind
    // the panel and the rider thinks "nothing happened".
    const vw = typeof window !== "undefined" ? window.innerWidth : 0;
    const vh = typeof window !== "undefined" ? window.innerHeight : 0;
    const isSmallScreen = vw < 640;
    const padding = panelOpenRef.current
      ? isSmallScreen
        ? { bottom: Math.round(vh * 0.55) }
        : { right: 360 }
      : undefined;

    map.flyTo({
      center: [geo.lng, geo.lat],
      // Don't zoom out if user is already in close — only zoom IN when
      // they're farther out than ~13. Avoids a jarring jump from a
      // close inspection back to neighborhood scale.
      zoom: currentZoom < 13 ? 14 : currentZoom,
      duration: 1100,
      padding,
    });
    setPendingFly(false);
  }, [pendingFly, mapLoaded, geo.lat, geo.lng]);

  // One-shot initial auto-fly. When the map first loads and the
  // user's location lands for the first time, frame their position
  // in the visible map area (above the open NearbyPanel) without
  // requiring them to tap Near-me. Only fires ONCE per page load —
  // a ref-based guard so the rider's subsequent panning isn't
  // interrupted on every geo update. If the user has already
  // initiated a manual fly via flyToUserSignal, that took
  // precedence and we skip this entirely.
  const initialFlyDoneRef = useRef(false);
  useEffect(() => {
    if (initialFlyDoneRef.current) return;
    if (lastFlySignalRef.current !== 0) {
      // User already triggered a manual fly; treat that as having
      // satisfied the initial frame.
      initialFlyDoneRef.current = true;
      return;
    }
    if (!mapLoaded || !mapRef.current) return;
    if (geo.lat == null || geo.lng == null) return;
    const map = mapRef.current;
    const vw = typeof window !== "undefined" ? window.innerWidth : 0;
    const vh = typeof window !== "undefined" ? window.innerHeight : 0;
    const isSmallScreen = vw < 640;
    const padding = panelOpenRef.current
      ? isSmallScreen
        ? { bottom: Math.round(vh * 0.55) }
        : { right: 360 }
      : undefined;
    map.flyTo({
      center: [geo.lng, geo.lat],
      zoom: 14,
      duration: 1100,
      padding,
    });
    initialFlyDoneRef.current = true;
  }, [mapLoaded, geo.lat, geo.lng]);

  // Selection: dim non-selected via expressions on the consolidated layers.
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || !lines) return;
    const map = mapRef.current;
    const sel = selectedLine;

    // Match all routes on the same shared-track corridor, not just the
    // single routeId. Picking "1" lights up 1/2/3; picking "A" lights up
    // A/C/E; etc.
    //
    // When a TRIP is selected (no specific line), we go further: dim
    // EVERY line in the network — including the ones the trip uses.
    // The trip-overlay layer (`subway-trip-legs`) renders the actual
    // ridden segments as bright thick polylines on top, so the rider
    // sees only the segment they're traveling on, not the whole 4
    // line from Bronx to Brooklyn. An empty corridor satisfies "no
    // route is selected" for the line-paint expressions while still
    // applying the dim treatment.
    let corridor: string[] | null = null;
    if (sel) {
      corridor = CORRIDOR[sel] ?? [sel];
    } else if (selectedTrip && selectedTrip.legs.length > 0) {
      // Empty corridor → all lines fall through to the "dimmed" path
      // of matchSel, since no line's routeId matches an empty list.
      corridor = [];
    }
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
    // Train icon/text opacity must stay zoom-faded (so cold-start at
    // z≈11 isn't a wall of capsules) AND respect line-selection
    // dimming. Per the comment above, `zoom` has to live at the top of
    // an interpolate, so we push the selection `case` into each stop's
    // value rather than wrapping the whole interpolate.
    const trainIconOpacity = inCorridor
      ? [
          "interpolate", ["linear"], ["zoom"],
          10.5, 0,
          11.5, ["case", inCorridor, 0.55, 0],
          12.5, ["case", inCorridor, 1, 0],
        ]
      : [
          "interpolate", ["linear"], ["zoom"],
          10.5, 0,
          11.5, 0.55,
          12.5, 1,
        ];
    const trainTextOpacity = inCorridor
      ? [
          "interpolate", ["linear"], ["zoom"],
          11.5, 0,
          12.5, ["case", inCorridor, 1, 0],
        ]
      : [
          "interpolate", ["linear"], ["zoom"],
          11.5, 0,
          12.5, 1,
        ];
    map.setPaintProperty("subway-trains-icon", "icon-opacity", trainIconOpacity);
    map.setPaintProperty("subway-trains-text", "text-opacity", trainTextOpacity);

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
  }, [selectedLine, selectedTrip, mapLoaded, lines]);

  // Fly to the station when a StationPanel opens — regardless of entry
  // point (map tap, Near Me panel row, LinePanel stop tap). The map click
  // handler can zoom directly because it has the coords in hand, but taps
  // from a panel only know a stopId, so we look coords up from the merged
  // station index and animate here. Pad for the 55dvh bottom sheet on
  // mobile and the ~340px right-side card on desktop. Also populates the
  // focused-station source so a highlighted pin + name stay on the map
  // as long as the panel is open.
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || !lines) return;
    const map = mapRef.current;
    const src = map.getSource("focused-station") as
      | { setData: (d: unknown) => void }
      | undefined;
    if (!stationStopId) {
      src?.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    const index = buildStationIndex(lines);
    const station = index.find((s) => s.stopIds.includes(stationStopId));
    if (!station) return;
    src?.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { name: station.name },
          geometry: { type: "Point", coordinates: [station.lng, station.lat] },
        },
      ],
    });
    const isMobile = window.matchMedia("(max-width: 639px)").matches;
    const bottomPad = isMobile
      ? Math.round(window.innerHeight * 0.55) + 16
      : 40;
    const rightPad = isMobile ? 40 : 360;
    map.easeTo({
      center: [station.lng, station.lat],
      zoom: Math.max(map.getZoom(), 14),
      padding: { top: 40, right: rightPad, bottom: bottomPad, left: 40 },
      duration: 700,
    });
  }, [stationStopId, mapLoaded, lines]);

  // Trip overlay sync. Push the leg LineStrings into the trip-legs
  // source and the role-tagged stations into trip-stations. When the
  // trip is cleared (null), both sources go to empty FCs and the
  // dedicated layers render nothing. After updating data, fit the
  // camera to the union of all leg coords with padding accounting
  // for any open panel.
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current;
    const legSrc = map.getSource("subway-trip-legs") as
      | { setData: (d: unknown) => void }
      | undefined;
    const stationSrc = map.getSource("subway-trip-stations") as
      | { setData: (d: unknown) => void }
      | undefined;
    const walkSrc = map.getSource("subway-trip-walks") as
      | { setData: (d: unknown) => void }
      | undefined;
    if (!legSrc || !stationSrc || !walkSrc) return;

    if (!selectedTrip || selectedTrip.legs.length === 0) {
      legSrc.setData({ type: "FeatureCollection", features: [] });
      stationSrc.setData({ type: "FeatureCollection", features: [] });
      walkSrc.setData({ type: "FeatureCollection", features: [] });
      return;
    }

    // Leg lines — one Feature per leg with route color carried in
    // properties so the paint expression picks it up.
    legSrc.setData({
      type: "FeatureCollection",
      features: selectedTrip.legs.map((leg, i) => ({
        type: "Feature",
        properties: { color: leg.color, leg: i },
        geometry: { type: "LineString", coordinates: leg.coordinates },
      })),
    });

    // Station markers — three roles, distinct tints. Board comes
    // from leg 1's boardStation, alight from the last leg's
    // alightStation, transfer is the explicit transferStation if a
    // 2-leg trip. Names are baked in for label rendering.
    const stationFeatures: GeoJSON.Feature[] = [];
    const start = selectedTrip.legs[0].boardStation;
    stationFeatures.push({
      type: "Feature",
      properties: { name: start.name, kind: "board", tint: "#34d399" },
      geometry: { type: "Point", coordinates: [start.lng, start.lat] },
    });
    if (selectedTrip.transferStation) {
      const t = selectedTrip.transferStation;
      stationFeatures.push({
        type: "Feature",
        properties: { name: t.name, kind: "transfer", tint: "#fbbf24" },
        geometry: { type: "Point", coordinates: [t.lng, t.lat] },
      });
    }
    const end = selectedTrip.legs[selectedTrip.legs.length - 1].alightStation;
    stationFeatures.push({
      type: "Feature",
      properties: { name: end.name, kind: "alight", tint: "#38bdf8" },
      geometry: { type: "Point", coordinates: [end.lng, end.lat] },
    });
    // Walk endpoints — rider's actual origin (current location pin or
    // saved address) and destination address. Same source as the
    // station markers so they all share zoom-responsive sizing and
    // labels. White tint differentiates them from station roles
    // (which use route-coded colors); the labels carry the address
    // text so the rider sees "550 Madison Ave" at the destination
    // dot, not just the station name.
    if (selectedTrip.walkFrom) {
      stationFeatures.push({
        type: "Feature",
        properties: {
          name: selectedTrip.walkFrom.name ?? "You",
          kind: "origin",
          tint: "#ffffff",
        },
        geometry: {
          type: "Point",
          coordinates: [selectedTrip.walkFrom.lng, selectedTrip.walkFrom.lat],
        },
      });
    }
    if (selectedTrip.walkTo) {
      stationFeatures.push({
        type: "Feature",
        properties: {
          name: selectedTrip.walkTo.name ?? "Destination",
          kind: "destination",
          tint: "#ffffff",
        },
        geometry: {
          type: "Point",
          coordinates: [selectedTrip.walkTo.lng, selectedTrip.walkTo.lat],
        },
      });
    }
    stationSrc.setData({ type: "FeatureCollection", features: stationFeatures });

    // Walk legs — pedestrian path from the rider's actual origin to
    // the boarding station, and from the alighting station to the
    // destination address. When the parent has resolved the walk via
    // Mapbox Directions (walkFromCoords / walkToCoords), use that
    // street-following geometry; otherwise fall back to a straight
    // crow-flies segment so the dashed line still appears while the
    // API request is in flight (or if it failed entirely).
    const walkFeatures: GeoJSON.Feature[] = [];
    if (selectedTrip.walkFrom) {
      const coords =
        selectedTrip.walkFromCoords && selectedTrip.walkFromCoords.length >= 2
          ? selectedTrip.walkFromCoords
          : [
              [selectedTrip.walkFrom.lng, selectedTrip.walkFrom.lat] as [number, number],
              [start.lng, start.lat] as [number, number],
            ];
      walkFeatures.push({
        type: "Feature",
        properties: { kind: "from" },
        geometry: { type: "LineString", coordinates: coords },
      });
    }
    if (selectedTrip.walkTo) {
      const coords =
        selectedTrip.walkToCoords && selectedTrip.walkToCoords.length >= 2
          ? selectedTrip.walkToCoords
          : [
              [end.lng, end.lat] as [number, number],
              [selectedTrip.walkTo.lng, selectedTrip.walkTo.lat] as [number, number],
            ];
      walkFeatures.push({
        type: "Feature",
        properties: { kind: "to" },
        geometry: { type: "LineString", coordinates: coords },
      });
    }
    walkSrc.setData({ type: "FeatureCollection", features: walkFeatures });

    // Fit camera to the bounding box of all leg coords. Padding
    // accounts for the SearchSheet (still open) on the bottom (mobile)
    // or right (desktop) so the trip lands in the visible map area.
    let minLng = Infinity,
      minLat = Infinity,
      maxLng = -Infinity,
      maxLat = -Infinity;
    const expand = (lng: number, lat: number) => {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    };
    // When the rider has tapped a specific leg in the expanded route
    // detail, fit to just that leg's coords + its terminal stations.
    // Otherwise frame the whole trip including walks. Negative or
    // out-of-range indices are treated as "no focus".
    const focusLeg =
      typeof focusedLegIndex === "number" &&
      focusedLegIndex >= 0 &&
      focusedLegIndex < selectedTrip.legs.length
        ? selectedTrip.legs[focusedLegIndex]
        : null;
    if (focusLeg) {
      for (const [lng, lat] of focusLeg.coordinates) expand(lng, lat);
      expand(focusLeg.boardStation.lng, focusLeg.boardStation.lat);
      expand(focusLeg.alightStation.lng, focusLeg.alightStation.lat);
    } else {
      for (const leg of selectedTrip.legs) {
        for (const [lng, lat] of leg.coordinates) expand(lng, lat);
      }
      // Walking endpoints participate in the bounds too — otherwise
      // the dashed walks disappear off-screen at the start/end of
      // the animation when they extend past the subway segment.
      // When a street-following walk path is resolved, fold every
      // vertex into the bounds so a curved walk that sweeps past
      // the endpoint stays visible (e.g. routing around a one-way
      // street).
      if (selectedTrip.walkFrom) {
        expand(selectedTrip.walkFrom.lng, selectedTrip.walkFrom.lat);
      }
      if (selectedTrip.walkTo) {
        expand(selectedTrip.walkTo.lng, selectedTrip.walkTo.lat);
      }
      if (selectedTrip.walkFromCoords) {
        for (const [lng, lat] of selectedTrip.walkFromCoords) expand(lng, lat);
      }
      if (selectedTrip.walkToCoords) {
        for (const [lng, lat] of selectedTrip.walkToCoords) expand(lng, lat);
      }
    }
    if (
      Number.isFinite(minLng) &&
      Number.isFinite(minLat) &&
      Number.isFinite(maxLng) &&
      Number.isFinite(maxLat)
    ) {
      const isMobile = window.matchMedia("(max-width: 639px)").matches;
      // Half-detent sheet covers the bottom ~60% of the viewport
      // (sheet is 88dvh tall, translated down 28dvh, so its top edge
      // sits at 40% from the top). Bottom padding has to exceed that
      // coverage or the route's southern edge ends up clipped under
      // the panel. 65% leaves a small visible buffer above the sheet
      // edge so the rider sees the full route, not just the parts
      // not covered by chrome.
      const bottomPad = isMobile
        ? Math.round(window.innerHeight * 0.65) + 24
        : 60;
      const rightPad = isMobile ? 40 : 360;
      map.fitBounds(
        [
          [minLng, minLat],
          [maxLng, maxLat],
        ],
        {
          padding: { top: 80, right: rightPad, bottom: bottomPad, left: 40 },
          duration: 800,
          maxZoom: 14,
        },
      );
    }
  }, [selectedTrip, mapLoaded, focusedLegIndex]);

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
