"use client";

import { useEffect, useRef, useState } from "react";
import { LINES } from "@/lib/subwayData";
import { useTrains, trainLatLng } from "@/lib/useTrains";
import "mapbox-gl/dist/mapbox-gl.css";

interface MapViewProps {
  selectedLine: string | null; // routeId
  onLineSelect: (line: string | null) => void;
}

export default function MapView({ selectedLine, onLineSelect }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<unknown>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [noToken, setNoToken] = useState(false);
  const selectedLineRef = useRef(selectedLine);
  const data = useTrains();
  const dataRef = useRef(data);

  useEffect(() => {
    selectedLineRef.current = selectedLine;
  }, [selectedLine]);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) { setNoToken(true); return; }
    if (!containerRef.current) return;

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
        maxZoom: 16,
      });

      mapRef.current = map;

      map.on("load", () => {
        if (cancelled) return;

        Object.values(LINES).forEach((line) => {
          // Real track-following shape
          map.addSource(`line-${line.routeId}`, {
            type: "geojson",
            data: {
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates: line.shape },
            },
          });
          map.addLayer({
            id: `line-${line.routeId}`,
            type: "line",
            source: `line-${line.routeId}`,
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": line.color,
              "line-width": 2.5,
              "line-opacity": 0.7,
            },
          });

          // Stations
          map.addSource(`stops-${line.routeId}`, {
            type: "geojson",
            data: {
              type: "FeatureCollection",
              features: line.stops.map((stop) => ({
                type: "Feature",
                properties: { name: stop.name, routeId: line.routeId, color: line.color },
                geometry: { type: "Point", coordinates: [stop.lng, stop.lat] },
              })),
            },
          });
          map.addLayer({
            id: `stops-${line.routeId}`,
            type: "circle",
            source: `stops-${line.routeId}`,
            paint: {
              "circle-radius": 3.5,
              "circle-color": "#0a0a0a",
              "circle-stroke-width": 1.5,
              "circle-stroke-color": line.color,
              "circle-opacity": 0.85,
            },
          });

          // Trains (subway-bullet style: colored circle + line letter)
          map.addSource(`trains-${line.routeId}`, {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });
          map.addLayer({
            id: `trains-bg-${line.routeId}`,
            type: "circle",
            source: `trains-${line.routeId}`,
            paint: {
              "circle-radius": 11,
              "circle-color": line.color,
              "circle-stroke-width": 2,
              "circle-stroke-color": "#ffffff",
            },
          });
          // Directional arrow on the leading edge, rotated to track bearing
          map.addLayer({
            id: `trains-arrow-${line.routeId}`,
            type: "symbol",
            source: `trains-${line.routeId}`,
            layout: {
              "text-field": "▲",
              "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
              "text-size": 12,
              "text-rotate": ["get", "bearing"],
              "text-rotation-alignment": "map",
              "text-pitch-alignment": "map",
              "text-offset": [0, -1.6],
              "text-allow-overlap": true,
              "text-ignore-placement": true,
            },
            paint: {
              "text-color": "#ffffff",
              "text-halo-color": line.color,
              "text-halo-width": 1.5,
            },
          });
          map.addLayer({
            id: `trains-${line.routeId}`,
            type: "symbol",
            source: `trains-${line.routeId}`,
            layout: {
              "text-field": line.id,
              "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
              "text-size": 12,
              "text-allow-overlap": true,
              "text-ignore-placement": true,
            },
            paint: {
              "text-color": line.textColor === "black" ? "#000000" : "#ffffff",
            },
          });

          // Click line to select
          map.on("click", `line-${line.routeId}`, () => {
            onLineSelect(selectedLineRef.current === line.routeId ? null : line.routeId);
          });
          map.on("mouseenter", `line-${line.routeId}`, () => {
            map.getCanvas().style.cursor = "pointer";
          });
          map.on("mouseleave", `line-${line.routeId}`, () => {
            map.getCanvas().style.cursor = "";
          });
        });

        // Station name popup
        const popup = new mapboxgl.default.Popup({
          closeButton: false,
          closeOnClick: false,
          className: "subway-popup",
          offset: 10,
        });

        Object.values(LINES).forEach((line) => {
          map.on("mouseenter", `stops-${line.routeId}`, (e) => {
            const feat = e.features?.[0];
            if (!feat) return;
            const coords = (feat.geometry as GeoJSON.Point).coordinates as [number, number];
            popup.setLngLat(coords)
              .setHTML(
                `<span style="color:${line.color};font-weight:700">${line.id}</span> ${feat.properties?.name}`,
              )
              .addTo(map);
          });
          map.on("mouseleave", `stops-${line.routeId}`, () => popup.remove());
        });

        setMapLoaded(true);
      });
    });

    return () => {
      cancelled = true;
      if (mapRef.current) {
        (mapRef.current as { remove: () => void }).remove();
        mapRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push live train positions to the map. Re-runs when new data arrives;
  // a small rAF loop interpolates progress between polls so trains glide.
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current as {
      getSource: (id: string) => { setData: (d: unknown) => void } | undefined;
    };

    let frame = 0;
    const tick = () => {
      const d = dataRef.current;
      if (d) {
        const ageSec = (Date.now() - d.generatedAt) / 1000;
        // smooth: assume ~2 min between stops; advance progress by elapsed/120s
        const trainsByRoute = new Map<string, typeof d.trains>();
        for (const t of d.trains) {
          const arr = trainsByRoute.get(t.routeId) || [];
          arr.push(t);
          trainsByRoute.set(t.routeId, arr);
        }

        Object.values(LINES).forEach((line) => {
          const src = map.getSource(`trains-${line.routeId}`);
          if (!src) return;
          const trains = trainsByRoute.get(line.routeId) || [];
          const features = trains.flatMap((t) => {
            const interp = { ...t, progress: Math.min(1, t.progress + ageSec / 120) };
            const pos = trainLatLng(line, interp);
            if (!pos) return [];
            return [{
              type: "Feature" as const,
              properties: { id: t.id, direction: t.direction, bearing: pos.bearing },
              geometry: { type: "Point" as const, coordinates: [pos.lng, pos.lat] },
            }];
          });
          src.setData({ type: "FeatureCollection", features });
        });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [mapLoaded]);

  // Highlight selected line
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current as {
      setPaintProperty: (id: string, prop: string, val: unknown) => void;
      fitBounds: (bounds: unknown, opts: unknown) => void;
    };

    import("mapbox-gl").then((mapboxgl) => {
      Object.values(LINES).forEach((line) => {
        const sel = selectedLine;
        const isThis = line.routeId === sel;
        const dim = sel !== null && !isThis;

        map.setPaintProperty(`line-${line.routeId}`, "line-opacity", dim ? 0.1 : isThis ? 1 : 0.7);
        map.setPaintProperty(`line-${line.routeId}`, "line-width", isThis ? 5 : 2.5);
        map.setPaintProperty(`stops-${line.routeId}`, "circle-opacity", dim ? 0.05 : 0.85);
        map.setPaintProperty(`trains-bg-${line.routeId}`, "circle-opacity", dim ? 0 : 1);
        map.setPaintProperty(`trains-bg-${line.routeId}`, "circle-stroke-opacity", dim ? 0 : 1);
        map.setPaintProperty(`trains-arrow-${line.routeId}`, "text-opacity", dim ? 0 : 1);
        map.setPaintProperty(`trains-${line.routeId}`, "text-opacity", dim ? 0 : 1);
      });

      if (selectedLine) {
        const line = LINES[selectedLine];
        if (line && line.shape.length > 0) {
          const bounds = new mapboxgl.default.LngLatBounds();
          line.shape.forEach((c) => bounds.extend(c as [number, number]));
          map.fitBounds(bounds, { padding: 80, duration: 800 });
        }
      }
    });
  }, [selectedLine, mapLoaded]);

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
