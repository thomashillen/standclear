"use client";

import { useEffect, useRef, useState } from "react";
import { useLines } from "@/lib/subwayData";
import { useTrains, trainLatLng, type Train } from "@/lib/useTrains";
import "mapbox-gl/dist/mapbox-gl.css";

interface MapViewProps {
  selectedLine: string | null; // routeId
  onLineSelect: (line: string | null) => void;
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
  addLayer: (layer: unknown) => void;
  addImage: (id: string, image: unknown, opts?: unknown) => void;
  hasImage: (id: string) => boolean;
};

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
            "line-width": 2.5,
            "line-opacity": 0.7,
          },
        });

        map.addLayer({
          id: "subway-stops",
          type: "circle",
          source: "subway-stops",
          paint: {
            "circle-radius": 3.5,
            "circle-color": "#0a0a0a",
            "circle-stroke-width": 1.5,
            "circle-stroke-color": ["get", "color"],
            "circle-opacity": 0.85,
          },
        });

        // Capsule image is drawn with its long axis horizontal. Bearing is
        // compass degrees (0=N, 90=E). We want the capsule long axis to
        // align with the direction of travel, so rotate by (bearing - 90).
        const capsuleRotate: MapboxExpression = ["-", ["get", "bearing"], 90];

        map.addLayer({
          id: "subway-trains-icon",
          type: "symbol",
          source: "subway-trains",
          layout: {
            "icon-image": "train-capsule",
            "icon-rotate": capsuleRotate,
            "icon-rotation-alignment": "map",
            "icon-pitch-alignment": "map",
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
          paint: {
            "icon-color": ["get", "color"],
            "icon-halo-color": "#ffffff",
            "icon-halo-width": 1.5,
          },
        });
        map.addLayer({
          id: "subway-trains-text",
          type: "symbol",
          source: "subway-trains",
          layout: {
            "text-field": ["get", "letter"],
            "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
            "text-size": 11,
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          },
          paint: {
            "text-color": [
              "case",
              ["==", ["get", "textColor"], "black"], "#000000",
              "#ffffff",
            ],
          },
        });

        // ── Interactions (one handler each, not one per route)
        map.on("click", "subway-lines", (e: unknown) => {
          const ev = e as {
            features?: { properties?: { routeId?: string } }[];
            lngLat?: { lng: number; lat: number };
          };
          const clicked = ev.features?.[0]?.properties?.routeId;
          if (!clicked) return;
          if (selectedLineRef.current === clicked) {
            clickLngLatRef.current = null;
            onLineSelect(null);
            return;
          }
          clickLngLatRef.current = ev.lngLat
            ? [ev.lngLat.lng, ev.lngLat.lat]
            : null;
          onLineSelect(clicked);
        });
        map.on("mouseenter", "subway-lines", () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "subway-lines", () => {
          map.getCanvas().style.cursor = "";
        });

        const popup = new mapboxgl.default.Popup({
          closeButton: false,
          closeOnClick: false,
          className: "subway-popup",
          offset: 10,
        });
        map.on("mouseenter", "subway-stops", (e: unknown) => {
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
        });
        map.on("mouseleave", "subway-stops", () => popup.remove());

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

  // Push live train positions. rAF schedules; a 100ms gate caps actual work
  // to ~10Hz. The halo consolidation (one symbol layer instead of two)
  // cut per-tick GPU upload in half, which gives us headroom to redraw
  // often enough for visibly live motion.
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || !lines) return;
    const map = mapRef.current;

    const TICK_MS = 100;
    let frame = 0;
    let lastTickTime = 0;
    let lastData: typeof dataRef.current = null;
    let trainsByRoute: Map<string, Train[]> = new Map();

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - lastTickTime < TICK_MS) return;
      lastTickTime = now;

      const d = dataRef.current;
      if (!d) return;

      // Re-bucket only when the upstream data object changes (every 8s poll).
      if (d !== lastData) {
        lastData = d;
        trainsByRoute = new Map();
        for (const t of d.trains) {
          const arr = trainsByRoute.get(t.routeId) || [];
          arr.push(t);
          trainsByRoute.set(t.routeId, arr);
        }
      }

      const ageSec = (Date.now() - d.generatedAt) / 1000;
      const features: GeoJSON.Feature[] = [];
      for (const line of Object.values(lines)) {
        const trains = trainsByRoute.get(line.routeId);
        if (!trains) continue;
        for (const t of trains) {
          const interp = { ...t, progress: Math.min(1, t.progress + ageSec / 120) };
          const pos = trainLatLng(line, interp);
          if (!pos) continue;
          features.push({
            type: "Feature",
            properties: {
              id: t.id,
              direction: t.direction,
              bearing: pos.bearing,
              routeId: line.routeId,
              color: line.color,
              letter: line.id,
              textColor: line.textColor,
            },
            geometry: { type: "Point", coordinates: [pos.lng, pos.lat] },
          });
        }
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

    const matchSel = (whenSelected: unknown, whenDimmed: unknown, whenNone: unknown) =>
      sel === null
        ? whenNone
        : ["case", ["==", ["get", "routeId"], sel], whenSelected, whenDimmed];

    map.setPaintProperty("subway-lines", "line-opacity", matchSel(1, 0.1, 0.7));
    map.setPaintProperty("subway-lines", "line-width", matchSel(5, 2.5, 2.5));
    map.setPaintProperty("subway-stops", "circle-opacity", matchSel(0.85, 0.05, 0.85));
    map.setPaintProperty("subway-trains-icon", "icon-opacity", matchSel(1, 0, 1));
    map.setPaintProperty("subway-trains-text", "text-opacity", matchSel(1, 0, 1));

    if (sel) {
      import("mapbox-gl").then((mapboxgl) => {
        const line = lines[sel];
        if (!line || line.shape.length === 0) return;
        // On mobile the LinePanel overlays the bottom of the map as a
        // 45vh bottom sheet. Pad the fit so the frame lands above it.
        const isMobile = window.matchMedia("(max-width: 639px)").matches;
        const bottomPad = isMobile
          ? Math.round(window.innerHeight * 0.45) + 16
          : 40;

        // If selection came from a click on the line, zoom to the nearest
        // stop instead of the default downtown frame.
        const clickAt = clickLngLatRef.current;
        clickLngLatRef.current = null;
        if (clickAt) {
          let nearest = line.stops[0];
          let minD2 = Infinity;
          for (const s of line.stops) {
            const dx = s.lng - clickAt[0];
            const dy = s.lat - clickAt[1];
            const d2 = dx * dx + dy * dy;
            if (d2 < minD2) {
              minD2 = d2;
              nearest = s;
            }
          }
          // ~0.006° ≈ 550m on lat; padding handles the bottom sheet.
          const H = 0.006;
          map.fitBounds(
            new mapboxgl.default.LngLatBounds(
              [nearest.lng - H, nearest.lat - H],
              [nearest.lng + H, nearest.lat + H],
            ),
            {
              padding: { top: 40, right: 40, bottom: bottomPad, left: 40 },
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
            padding: { top: 40, right: 40, bottom: bottomPad, left: 40 },
            duration: 800,
          });
        } else {
          const bounds = new mapboxgl.default.LngLatBounds();
          line.shape.forEach((c) => bounds.extend(c as [number, number]));
          map.fitBounds(bounds, {
            padding: { top: 80, right: 80, bottom: bottomPad, left: 80 },
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
