"use client";

import { useEffect, useState } from "react";
import type { AlertsResponse, ServiceAlert } from "@/app/api/alerts/route";

export type { ServiceAlert };

// Alerts change on the order of minutes, not seconds. Poll slowly so we
// don't hammer the MTA feed for data that rarely moves.
const POLL_MS = 60_000;

let cache: { data: AlertsResponse | null; promise: Promise<void> | null } = {
  data: null,
  promise: null,
};
const subscribers = new Set<(d: AlertsResponse) => void>();
let intervalId: ReturnType<typeof setInterval> | null = null;

async function refresh() {
  if (cache.promise) return cache.promise;
  cache.promise = (async () => {
    try {
      const res = await fetch("/api/alerts", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as AlertsResponse;
      cache = { data, promise: null };
      subscribers.forEach((cb) => cb(data));
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

export function useAlerts(): AlertsResponse | null {
  const [data, setData] = useState<AlertsResponse | null>(cache.data);

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
