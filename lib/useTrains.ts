"use client";

import { useSyncExternalStore } from "react";
import type { TrainsResponse, Train, Arrival } from "@/app/api/trains/route";
import { isOnline, subscribeOnline } from "./useOnline";
import type { SubwayLine } from "./subwayData";
import { captureException } from "./observability";
import { bearingDeg } from "./trainTrajectory";

export type { Train, Arrival, TrainsResponse };

// MTA GTFS-RT feeds refresh roughly every 10–15s upstream. Polling faster
// than ~8s mostly returns identical data; slower and the on-map positions
// jump when a stale snapshot finally refreshes.
const POLL_MS = 8_000;
// Maximum backoff on consecutive failures so a long outage doesn't
// hammer /api/trains every 8s — 60s feels alive without burning
// battery + bandwidth at the same rate as the steady-state poll.
const MAX_POLL_MS = 60_000;

// Persist the last successful response to localStorage so a cold boot
// surfaces the last-known state immediately instead of a "Connecting…"
// pulse. The poll loop replaces it with fresh data on first success.
const STORAGE_KEY = "standclear:trains:v1";

// ─── Feed health ─────────────────────────────────────────────────────
// Exposed alongside the train snapshot via useFeedHealth(). The
// SubwayMap pill reads this to surface a "Feed degraded" banner when
// the API has been failing recently — distinct from "stale" (last
// success > 60s ago) and "offline" (the device itself dropped its
// connection). This lets a rider tell apart "I'm in a tunnel" from
// "MTA's having a moment."
export interface FeedHealth {
  online: boolean;
  /** Number of consecutive failed /api/trains polls. Reset on success. */
  consecutiveFailures: number;
  /** Wall-clock ms of the last successful response. Null on cold boot. */
  lastSuccessAt: number | null;
  /** Wall-clock ms of the last failure. Null until first failure. */
  lastFailureAt: number | null;
  /** Short reason from the last failure (HTTP status / network error). */
  lastError: string | null;
  /** True once we've crossed the threshold for visible degradation. */
  degraded: boolean;
}

const DEGRADED_THRESHOLD = 2;

let cache: { data: TrainsResponse | null; ts: number; promise: Promise<void> | null } = {
  data: null,
  ts: 0,
  promise: null,
};
let health: FeedHealth = {
  online: true,
  consecutiveFailures: 0,
  lastSuccessAt: null,
  lastFailureAt: null,
  lastError: null,
  degraded: false,
};
const subscribers = new Set<() => void>();
let timeoutId: ReturnType<typeof setTimeout> | null = null;

function hydrateFromStorage() {
  if (cache.data) return;
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { data?: TrainsResponse; ts?: number };
    if (parsed?.data && typeof parsed.data.generatedAt === "number") {
      // Run the cached payload through dedup too — earlier sessions
      // before the API gained dedup may have stored duplicate trains.
      const data = dedupeResponse(parsed.data);
      cache = { data, ts: parsed.ts ?? data.generatedAt, promise: null };
    }
  } catch {
    // Corrupted storage just falls back to network. Don't throw.
  }
}

function persistToStorage(data: TrainsResponse) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ data, ts: Date.now() }));
  } catch {
    // Quota / private mode — best-effort only.
  }
}

// Backstop dedup. Mirrors the API: tripId-only, last-wins. We do
// NOT dedup STOPPED_AT trains by (routeId|direction|stopId) — at
// terminus stations the MTA queues multiple trains STOPPED_AT
// awaiting departure, and that's not a phantom, that's the schedule.
function dedupeResponse(data: TrainsResponse): TrainsResponse {
  const byId = new Map<string, Train>();
  for (const t of data.trains) byId.set(t.id, t);
  return { ...data, trains: Array.from(byId.values()) };
}

function notify() {
  subscribers.forEach((cb) => cb());
}

function setHealth(next: Partial<FeedHealth>) {
  health = {
    ...health,
    ...next,
    degraded:
      ("consecutiveFailures" in next
        ? next.consecutiveFailures!
        : health.consecutiveFailures) >= DEGRADED_THRESHOLD,
  };
  notify();
}

async function refresh() {
  if (cache.promise) return cache.promise;
  // Don't fire into the void when the device says it's offline. The
  // visibility check handles backgrounding; this handles airplane mode
  // and platforms that have lost LTE entirely. We still allow refresh()
  // to resolve so callers awaiting it don't hang — they just see no
  // state change.
  if (!isOnline()) {
    setHealth({ online: false });
    return;
  }
  cache.promise = (async () => {
    try {
      const res = await fetch("/api/trains", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = (await res.json()) as TrainsResponse;
      const data = dedupeResponse(raw);
      cache = { data, ts: Date.now(), promise: null };
      persistToStorage(data);
      // Reset the failure counter on every successful poll. Keep
      // `lastFailureAt` and `lastError` for diagnostics — they
      // describe history, not current state.
      setHealth({
        online: true,
        consecutiveFailures: 0,
        lastSuccessAt: cache.ts,
      });
      // setHealth already notified — no double-fire.
    } catch (err) {
      cache.promise = null;
      const message = err instanceof Error ? err.message : String(err);
      const failures = health.consecutiveFailures + 1;
      setHealth({
        consecutiveFailures: failures,
        lastFailureAt: Date.now(),
        lastError: message,
      });
      // Only log once per N failures to avoid swamping the console
      // (and any wired-up Sentry quota) during a sustained outage.
      // First failure + every 5th after.
      if (failures === 1 || failures % 5 === 0) {
        captureException(err, {
          what: "useTrains: /api/trains poll failed",
          consecutiveFailures: failures,
        });
      }
    }
  })();
  return cache.promise;
}

// Backoff schedule. Steady state: POLL_MS. After consecutive
// failures, exponentially back off (16s, 32s, 60s, …) up to MAX_POLL_MS.
function nextDelayMs(): number {
  const failures = health.consecutiveFailures;
  if (failures === 0) return POLL_MS;
  const delay = POLL_MS * 2 ** Math.min(failures, 4);
  return Math.min(delay, MAX_POLL_MS);
}

function clearScheduled() {
  if (timeoutId) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
}

function scheduleNext() {
  clearScheduled();
  timeoutId = setTimeout(async () => {
    timeoutId = null;
    if (subscribers.size === 0) return;
    if (typeof document !== "undefined" && document.hidden) return;
    if (!isOnline()) {
      setHealth({ online: false });
      return;
    }
    await refresh();
    if (subscribers.size > 0) scheduleNext();
  }, nextDelayMs());
}

function startPolling() {
  if (timeoutId) return;
  if (typeof document !== "undefined" && document.hidden) return;
  refresh().then(() => {
    if (subscribers.size > 0) scheduleNext();
  });
}

// Resume / pause polling when connectivity flips. Goes through the
// same gate as the visibility listener — schedule is cancelled when
// offline so we don't waste battery on guaranteed-failure ticks, and
// kicked back to life on the `online` event with an immediate refresh
// to surface fresh data the moment signal returns.
let onlineUnsub: (() => void) | null = null;
function bindOnline() {
  if (onlineUnsub || typeof window === "undefined") return;
  onlineUnsub = subscribeOnline(() => {
    if (isOnline()) {
      setHealth({ online: true });
      if (subscribers.size > 0 && !timeoutId) {
        if (typeof document !== "undefined" && document.hidden) return;
        startPolling();
      }
    } else {
      setHealth({ online: false });
      clearScheduled();
    }
  });
}

function stopPolling() {
  if (subscribers.size === 0) clearScheduled();
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
      clearScheduled();
    } else if (subscribers.size > 0 && !timeoutId) {
      startPolling();
    }
  });
}

/** Manually trigger a fetch of /api/trains. Used by the directions
 *  panel's refresh button so a rider can pull fresh next-train ETAs
 *  on demand without waiting for the next poll tick. Coalesces with
 *  the auto-poll's in-flight promise via the cache.promise gate. */
export function refreshTrains(): Promise<void> {
  return refresh();
}

function subscribe(cb: () => void): () => void {
  // First subscriber on a given runtime warms the in-memory cache from
  // localStorage and arms the visibility/poll lifecycle. Subsequent
  // subscribers just attach to the existing stream.
  if (subscribers.size === 0) {
    hydrateFromStorage();
    bindVisibility();
    bindOnline();
    startPolling();
  }
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
    stopPolling();
  };
}

function getSnapshot(): TrainsResponse | null {
  return cache.data;
}

// Server snapshot must be `null` to match the client's first render.
// `useSyncExternalStore` uses this for the SSR pass and for the
// hydration tree, then swaps to the live snapshot — preserving the
// "no in-memory data on first paint" contract that avoids hydration
// mismatches on cold boot.
function getServerSnapshot(): TrainsResponse | null {
  return null;
}

export function useTrains(): TrainsResponse | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// Health snapshot for the live-feed pill. Returns the same `health`
// reference until something changes (every change builds a fresh
// object via setHealth), so useSyncExternalStore can dedupe renders
// on identity. Kept on the same subscriber list as useTrains so a
// single store powers both consumers.
const SERVER_HEALTH: FeedHealth = Object.freeze({
  online: true,
  consecutiveFailures: 0,
  lastSuccessAt: null,
  lastFailureAt: null,
  lastError: null,
  degraded: false,
});

export function useFeedHealth(): FeedHealth {
  return useSyncExternalStore(
    subscribe,
    () => health,
    () => SERVER_HEALTH,
  );
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

