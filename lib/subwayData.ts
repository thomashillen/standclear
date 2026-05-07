"use client";

import { useSyncExternalStore } from "react";

export interface Stop {
  id: string;
  name: string;
  lat: number;
  lng: number;
  shapeIdx: number;
}

export interface SubwayLine {
  id: string;          // Display id ("1", "A", "S", "SI")
  routeId: string;     // GTFS route_id ("1", "A", "GS", "FS", "H", "SI")
  name: string;
  color: string;
  textColor: "white" | "black";
  stops: Stop[];
  shape: [number, number][]; // [lng, lat] coordinates following actual track
}

export type Lines = Record<string, SubwayLine>;

// The 429KB GTFS blob is served as a static asset from /public and fetched at
// runtime instead of imported as a module. Bundling it through Turbopack (or
// letting TS infer literal types for it) balloons dev-server memory — see the
// commit history for the 65GB tsserver incident.
let cache: Lines | null = null;
let loadPromise: Promise<Lines> | null = null;
const subscribers = new Set<() => void>();

// Failure surface. The previous shape silently rejected and reset the
// promise on failure — line picker bullets pulsed forever with no way
// for the rider to recover. The store now tracks an explicit error
// flag so consumers can render a retry affordance, and auto-retries
// with capped exponential backoff so transient flakes (single dropped
// packet on a station's WiFi-only network) recover without the rider
// noticing.
type LoadStatus = { error: boolean; attempt: number };
let status: LoadStatus = { error: false, attempt: 0 };
const statusSubscribers = new Set<() => void>();
let retryTimer: ReturnType<typeof setTimeout> | null = null;

const MAX_RETRY_DELAY_MS = 30_000;
const MAX_AUTO_RETRIES = 4;

function publishStatus(next: LoadStatus) {
  status = next;
  statusSubscribers.forEach((cb) => cb());
}

function scheduleAutoRetry() {
  if (retryTimer) return;
  if (status.attempt >= MAX_AUTO_RETRIES) return;
  // 1s, 2s, 4s, 8s, capped at 30s. Adds ±20% jitter so a thundering
  // herd of devices waking up on a platform's WiFi don't all retry
  // simultaneously.
  const base = Math.min(1000 * Math.pow(2, status.attempt), MAX_RETRY_DELAY_MS);
  const jitter = base * (Math.random() * 0.4 - 0.2);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    loadLines().catch(() => {});
  }, base + jitter);
}

function loadLines(): Promise<Lines> {
  if (cache) return Promise.resolve(cache);
  if (!loadPromise) {
    if (status.error) publishStatus({ error: false, attempt: status.attempt });
    loadPromise = fetch("/gtfsData.json")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ lines: Lines }>;
      })
      .then((j) => {
        cache = j.lines;
        publishStatus({ error: false, attempt: 0 });
        subscribers.forEach((cb) => cb());
        return cache;
      })
      .catch((err) => {
        console.error("Failed to load /gtfsData.json", err);
        loadPromise = null;
        publishStatus({ error: true, attempt: status.attempt + 1 });
        scheduleAutoRetry();
        throw err;
      });
  }
  return loadPromise;
}

/**
 * Manually retry the GTFS load. Cancels any pending auto-retry so the
 * rider's tap takes effect immediately. Resets the attempt counter so
 * future auto-retries restart from a fresh backoff schedule.
 */
export function retryLoadLines(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  publishStatus({ error: false, attempt: 0 });
  loadLines().catch(() => {});
}

function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  if (!cache && !loadPromise) loadLines().catch(() => {});
  return () => {
    subscribers.delete(cb);
  };
}

function getSnapshot(): Lines | null {
  return cache;
}

function getServerSnapshot(): Lines | null {
  return null;
}

export function useLines(): Lines | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function subscribeStatus(cb: () => void): () => void {
  statusSubscribers.add(cb);
  return () => {
    statusSubscribers.delete(cb);
  };
}

function getStatusSnapshot(): LoadStatus {
  return status;
}

// Stable initial status for the SSR pass — useSyncExternalStore needs
// a stable reference here to avoid hydration loops.
const SERVER_STATUS: LoadStatus = { error: false, attempt: 0 };
function getStatusServerSnapshot(): LoadStatus {
  return SERVER_STATUS;
}

/**
 * Reactive view of the GTFS load lifecycle. `error` flips true when a
 * fetch fails; auto-retries continue in the background up to a cap,
 * so a transient flake will usually flip it back to false on its own.
 * Consumers render a retry affordance keyed off `error`.
 */
export function useSubwayDataStatus(): LoadStatus {
  return useSyncExternalStore(
    subscribeStatus,
    getStatusSnapshot,
    getStatusServerSnapshot,
  );
}

// Order matches the official MTA "Lines" panel: numbered (IRT), 8 Av (ACE),
// 6 Av (BDFM), Crosstown (G), Nassau (JZ), Canarsie (L), Broadway (NQRW),
// Shuttles, Staten Island.
export const LINE_GROUPS: { label: string; lines: string[] }[] = [
  { label: "IRT", lines: ["1", "2", "3", "4", "5", "6", "7"] },
  { label: "IND", lines: ["A", "C", "E", "B", "D", "F", "M", "G"] },
  { label: "BMT", lines: ["J", "Z", "L", "N", "Q", "R", "W"] },
  { label: "S",   lines: ["GS", "FS", "H"] },
  { label: "SI",  lines: ["SI"] },
];

// Shared-track corridors: picking one bullet highlights every train sharing
// that trunk. This mirrors how NYC subway trunk colors actually map to
// infrastructure, except for the shuttle-gray collision (L vs GS/FS/H),
// which we break out into singletons.
export const CORRIDOR: Record<string, string[]> = {
  "1": ["1", "2", "3"], "2": ["1", "2", "3"], "3": ["1", "2", "3"],
  "4": ["4", "5", "6"], "5": ["4", "5", "6"], "6": ["4", "5", "6"],
  "7": ["7"],
  A: ["A", "C", "E"], C: ["A", "C", "E"], E: ["A", "C", "E"],
  B: ["B", "D", "F", "M"], D: ["B", "D", "F", "M"],
  F: ["B", "D", "F", "M"], M: ["B", "D", "F", "M"],
  G: ["G"],
  J: ["J", "Z"], Z: ["J", "Z"],
  L: ["L"],
  N: ["N", "Q", "R", "W"], Q: ["N", "Q", "R", "W"],
  R: ["N", "Q", "R", "W"], W: ["N", "Q", "R", "W"],
  GS: ["GS"], FS: ["FS"], H: ["H"],
  SI: ["SI"],
};
