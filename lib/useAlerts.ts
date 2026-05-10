"use client";

import { useSyncExternalStore } from "react";
import type { AlertsResponse, ServiceAlert } from "@/app/api/alerts/route";
import { captureException } from "./observability";
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
      // Route through observability so a failing alerts poll lands in
      // /api/log alongside other client errors. The previous
      // console.warn left these failures invisible to the operator —
      // a sustained MTA feed outage at the alerts source would only
      // show up as a stale `data` snapshot in localStorage.
      captureException(err, { source: "useAlerts" });
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
// The MTA tags many alerts with explicit stop scope ("No [R] at
// Cortlandt St this weekend"). Filtering by route alone surfaces those
// at every other R station too — useless noise for a rider opening
// Times Sq when the outage is downtown.
//
// We evaluate each per-entity GTFS-RT selector independently because
// its fields are an AND ({route:R, stop:R23} = "R route AT R23") and
// multiple selectors are an OR. A first cut that flattened selectors
// into independent route/stop sets would mis-scope mixed alerts: an
// alert pairing one route-wide selector with one stop-specific
// selector would appear only at the listed stop, hiding the line-wide
// disruption at every other station. Codex flagged that as P1 on
// PR #71; preserving per-selector evaluation here is the fix.
export function alertsForStation(
  data: AlertsResponse | null,
  stationStopIds: Iterable<string>,
  stationRouteIds: Iterable<string>,
): ServiceAlert[] {
  if (!data) return [];
  const stopSet = new Set(stationStopIds);
  const routeSet = new Set(stationRouteIds);
  return data.alerts.filter((a: ServiceAlert) => {
    // Legacy path for cached responses written before `selectors` was
    // added — fall back to the old route-or-stop union so the panel
    // doesn't go silent during a stale-while-revalidate window after
    // a deploy.
    if (!a.selectors || a.selectors.length === 0) {
      if (a.stopIds.length > 0 && a.stopIds.some((s) => stopSet.has(s))) return true;
      return a.routeIds.some((r) => routeSet.has(r));
    }
    return a.selectors.some((sel) => {
      const routeMatch = sel.routeId !== undefined && routeSet.has(sel.routeId);
      const stopMatch = sel.stopId !== undefined && stopSet.has(sel.stopId);
      // Selector is an AND of its present fields. A {route, stop}
      // selector means "this route AT this stop" — both must match.
      if (sel.routeId !== undefined && sel.stopId !== undefined) {
        return routeMatch && stopMatch;
      }
      return routeMatch || stopMatch;
    });
  });
}
