"use client";

import { useSyncExternalStore } from "react";
import type { AlertsResponse, ServiceAlert } from "@/app/api/alerts/route";
import { isOnline, subscribeOnline } from "./useOnline";

export type { ServiceAlert };

// Alerts change on the order of minutes, not seconds. Poll slowly so we
// don't hammer the MTA feed for data that rarely moves.
const POLL_MS = 60_000;

// Persist the last successful response to localStorage so the alerts
// bell shows the right tone immediately on cold boot, instead of
// flashing "All clear" before the first network call lands.
const STORAGE_KEY = "standclear:alerts:v1";

let cache: { data: AlertsResponse | null; promise: Promise<void> | null } = {
  data: null,
  promise: null,
};

function hydrateFromStorage() {
  if (cache.data) return;
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { data?: AlertsResponse };
    if (parsed?.data && Array.isArray(parsed.data.alerts)) {
      cache = { data: parsed.data, promise: null };
    }
  } catch {
    // ignore
  }
}

function persistToStorage(data: AlertsResponse) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ data }));
  } catch {
    // ignore
  }
}
const subscribers = new Set<() => void>();
let intervalId: ReturnType<typeof setInterval> | null = null;

async function refresh() {
  if (cache.promise) return cache.promise;
  // Skip the poll when the device is offline — airplane mode or a
  // platform that's lost signal will fail every fetch otherwise. The
  // online-event listener below picks polling back up when signal
  // returns.
  if (!isOnline()) return;
  cache.promise = (async () => {
    try {
      const res = await fetch("/api/alerts", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as AlertsResponse;
      cache = { data, promise: null };
      persistToStorage(data);
      subscribers.forEach((cb) => cb());
    } catch (err) {
      console.warn("Failed to fetch /api/alerts", err);
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

// Resume / pause polling on connectivity flips. Same shape as the
// useTrains binding — the slower 60s cadence makes the savings less
// dramatic, but we still don't want to waste battery firing into
// airplane-mode void.
let onlineUnsub: (() => void) | null = null;
function bindOnline() {
  if (onlineUnsub || typeof window === "undefined") return;
  onlineUnsub = subscribeOnline(() => {
    if (isOnline()) {
      if (subscribers.size > 0 && !intervalId) {
        if (typeof document !== "undefined" && document.hidden) return;
        refresh();
        intervalId = setInterval(refresh, POLL_MS);
      }
    } else if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  });
}

function subscribe(cb: () => void): () => void {
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

function getSnapshot(): AlertsResponse | null {
  return cache.data;
}

// Server snapshot is `null` to match the SSR contract — see useTrains
// for the hydration-mismatch reasoning.
function getServerSnapshot(): AlertsResponse | null {
  return null;
}

export function useAlerts(): AlertsResponse | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// Filter active alerts to those affecting any of the given routeIds. Used by
// LinePanel to scope alerts to the selected corridor.
export function alertsForRoutes(
  data: AlertsResponse | null,
  routeIds: Iterable<string>,
): ServiceAlert[] {
  if (!data) return [];
  const set = new Set(routeIds);
  return data.alerts.filter((a: ServiceAlert) =>
    a.routeIds.some((r: string) => set.has(r)),
  );
}

// Filter active alerts to those affecting a specific station complex.
//
// The MTA tags many alerts with explicit `stopIds` ("No [R] at Cortlandt
// St this weekend") in addition to the affected routes. Filtering by
// route alone surfaces those station-scoped alerts at every other R
// station too — useless noise for a rider opening Times Sq when the
// outage is downtown. When the alert lists stopIds, treat it as
// station-scoped and include only when this complex is in the list.
// When the alert has no stopIds, fall back to route intersection so
// genuine line-wide notices ("F runs express in Brooklyn") still
// surface at every F station.
export function alertsForStation(
  data: AlertsResponse | null,
  stationStopIds: Iterable<string>,
  stationRouteIds: Iterable<string>,
): ServiceAlert[] {
  if (!data) return [];
  const stopSet = new Set(stationStopIds);
  const routeSet = new Set(stationRouteIds);
  return data.alerts.filter((a: ServiceAlert) => {
    if (a.stopIds.length > 0) {
      return a.stopIds.some((s) => stopSet.has(s));
    }
    return a.routeIds.some((r) => routeSet.has(r));
  });
}
