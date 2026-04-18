"use client";

import { useEffect, useState } from "react";
import type { TrainsResponse, Train, Arrival } from "@/app/api/trains/route";
import type { SubwayLine } from "./subwayData";

export type { Train, Arrival };

// MTA GTFS-RT feeds refresh roughly every 10–15s upstream. Polling faster
// than ~8s mostly returns identical data; slower and the on-map positions
// jump when a stale snapshot finally refreshes.
const POLL_MS = 8_000;

let cache: { data: TrainsResponse | null; ts: number; promise: Promise<void> | null } = {
  data: null,
  ts: 0,
  promise: null,
};
const subscribers = new Set<(d: TrainsResponse) => void>();
let intervalId: ReturnType<typeof setInterval> | null = null;

async function refresh() {
  if (cache.promise) return cache.promise;
  cache.promise = (async () => {
    try {
      const res = await fetch("/api/trains", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as TrainsResponse;
      cache = { data, ts: Date.now(), promise: null };
      subscribers.forEach((cb) => cb(data));
    } catch (err) {
      console.error("Failed to fetch /api/trains", err);
      cache.promise = null;
    }
  })();
  return cache.promise;
}

function startPolling() {
  if (intervalId) return;
  if (typeof document !== "undefined" && document.hidden) return;
  refresh();
  intervalId = setInterval(refresh, POLL_MS);
}

function stopPolling() {
  if (intervalId && subscribers.size === 0) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

// Pause polling when the tab is backgrounded. On mobile Safari this matters:
// locking the phone or swiping away the tab otherwise keeps pulling feeds
// every 8s, burning battery and data for data the user can't see. On resume,
// fetch immediately so on-screen positions are fresh before the next tick.
let visibilityBound = false;
function bindVisibility() {
  if (visibilityBound || typeof document === "undefined") return;
  visibilityBound = true;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    } else if (subscribers.size > 0 && !intervalId) {
      refresh();
      intervalId = setInterval(refresh, POLL_MS);
    }
  });
}

export function useTrains(): TrainsResponse | null {
  const [data, setData] = useState<TrainsResponse | null>(cache.data);

  useEffect(() => {
    subscribers.add(setData);
    bindVisibility();
    startPolling();
    if (cache.data) setData(cache.data);
    return () => {
      subscribers.delete(setData);
      stopPolling();
    };
  }, []);

  return data;
}

// Compass bearing (0=N, 90=E, 180=S, 270=W) from a→b, accounting for lat
// distortion of longitude. Good enough for drawing arrowheads at NYC scale.
function bearingDeg(a: [number, number], b: [number, number]): number {
  const dLng = (b[0] - a[0]) * Math.cos(((a[1] + b[1]) * Math.PI) / 360);
  const dLat = b[1] - a[1];
  if (dLng === 0 && dLat === 0) return 0;
  return ((Math.atan2(dLng, dLat) * 180) / Math.PI + 360) % 360;
}

// Linear-distance interpolation along the line's shape between two stops.
// Walks the shape from prevStop's shape index to nextStop's shape index
// (handles either direction), then finds the point at fractional distance
// and the local bearing at that point.
export function trainLatLng(
  line: SubwayLine,
  train: Train,
): { lng: number; lat: number; bearing: number } | null {
  const prev = line.stops.find((s) => s.id === train.prevStopId);
  const next = line.stops.find((s) => s.id === train.nextStopId);
  if (!prev || !next) return null;

  if (prev.id === next.id) {
    // Train is dwelling at a stop — use the track's local tangent through
    // the stop instead of a naive 0/180 (which made most capsules point
    // vertically regardless of the actual track direction). Walk a few
    // shape points on either side of the stop for a stable chord.
    const shape = line.shape;
    let bearing = 0;
    if (shape.length >= 2) {
      const idx = prev.shapeIdx;
      const a = shape[Math.max(0, idx - 2)];
      const b = shape[Math.min(shape.length - 1, idx + 2)];
      bearing = bearingDeg(a, b);
      // The shape tangent has no inherent direction. Flip it if it
      // disagrees with the train's compass direction.
      const pointsNorthish = bearing < 90 || bearing > 270;
      if (train.direction === "N" && !pointsNorthish) bearing = (bearing + 180) % 360;
      if (train.direction === "S" && pointsNorthish) bearing = (bearing + 180) % 360;
    } else {
      bearing = train.direction === "S" ? 180 : 0;
    }
    return { lng: prev.lng, lat: prev.lat, bearing };
  }

  const shape = line.shape;
  const a = prev.shapeIdx;
  const b = next.shapeIdx;
  if (a === b || shape.length === 0) {
    const lng = prev.lng + (next.lng - prev.lng) * train.progress;
    const lat = prev.lat + (next.lat - prev.lat) * train.progress;
    return {
      lng,
      lat,
      bearing: bearingDeg([prev.lng, prev.lat], [next.lng, next.lat]),
    };
  }

  // Build segment of shape from a → b in travel direction
  const step = a < b ? 1 : -1;
  const seg: [number, number][] = [];
  for (let i = a; i !== b + step; i += step) seg.push(shape[i]);

  // Cumulative chord-length distances along seg
  const dists: number[] = [0];
  let total = 0;
  for (let i = 1; i < seg.length; i++) {
    const dx = seg[i][0] - seg[i - 1][0];
    const dy = seg[i][1] - seg[i - 1][1];
    total += Math.hypot(dx, dy);
    dists.push(total);
  }
  if (total === 0) {
    return { lng: seg[0][0], lat: seg[0][1], bearing: 0 };
  }

  const target = total * Math.max(0, Math.min(1, train.progress));
  for (let i = 1; i < dists.length; i++) {
    if (dists[i] >= target) {
      const f = (target - dists[i - 1]) / (dists[i] - dists[i - 1] || 1);
      return {
        lng: seg[i - 1][0] + (seg[i][0] - seg[i - 1][0]) * f,
        lat: seg[i - 1][1] + (seg[i][1] - seg[i - 1][1]) * f,
        bearing: bearingDeg(seg[i - 1], seg[i]),
      };
    }
  }
  const last = seg[seg.length - 1];
  const prevPt = seg[seg.length - 2] || last;
  return { lng: last[0], lat: last[1], bearing: bearingDeg(prevPt, last) };
}

// Filter trains for a given line (by routeId)
export function trainsForLine(data: TrainsResponse | null, routeId: string): Train[] {
  if (!data) return [];
  return data.trains.filter((t) => t.routeId === routeId);
}

// Next arrivals at a given stop on a given route, optionally filtered by direction
export function nextArrivals(
  data: TrainsResponse | null,
  routeId: string,
  stopId: string,
  direction?: "N" | "S",
  limit = 3,
): Arrival[] {
  if (!data) return [];
  return data.arrivals
    .filter(
      (a) =>
        a.routeId === routeId &&
        a.stopId === stopId &&
        (!direction || a.direction === direction),
    )
    .slice(0, limit);
}

