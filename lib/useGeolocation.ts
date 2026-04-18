"use client";

import { useEffect, useState } from "react";

export type GeoStatus =
  | "idle"        // nothing requested yet
  | "prompting"   // waiting for user permission / first fix
  | "granted"     // actively streaming positions
  | "denied"      // user said no
  | "unavailable" // no Geolocation API
  | "error";      // position unavailable, timeout, etc.

export interface GeoState {
  status: GeoStatus;
  lng: number | null;
  lat: number | null;
  accuracy: number | null; // meters
  error: string | null;
  updatedAt: number | null;
}

// Shared module-level singleton: we only hold one active watchPosition for the
// whole app, regardless of how many components call the hook. Mirrors the
// approach in useTrains so polling/watch lifecycles are driven by subscriber
// count instead of component render order.
const initial: GeoState = {
  status: "idle",
  lng: null,
  lat: null,
  accuracy: null,
  error: null,
  updatedAt: null,
};

const subscribers = new Set<(s: GeoState) => void>();
let current: GeoState = initial;
let watchId: number | null = null;

function publish(patch: Partial<GeoState>) {
  current = { ...current, ...patch, updatedAt: Date.now() };
  subscribers.forEach((cb) => cb(current));
}

function startWatch() {
  if (watchId !== null) return;
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    publish({ status: "unavailable" });
    return;
  }
  // Only flip to prompting on first activation; if we already have a fix
  // don't regress status while a new watch spins up.
  if (current.status === "idle" || current.status === "error") {
    publish({ status: "prompting" });
  }
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      publish({
        status: "granted",
        lng: pos.coords.longitude,
        lat: pos.coords.latitude,
        accuracy: pos.coords.accuracy,
        error: null,
      });
    },
    (err) => {
      const denied = err.code === err.PERMISSION_DENIED;
      publish({ status: denied ? "denied" : "error", error: err.message });
      if (denied && watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
    },
    {
      // High accuracy matters: at normal accuracy (~100m+) the "nearest
      // stop" sort flips between adjacent stations as the fix wanders,
      // which looks broken. Battery cost is acceptable for an app that's
      // only open while the user is commuting.
      enableHighAccuracy: true,
      maximumAge: 10_000,
      timeout: 30_000,
    },
  );
}

function stopWatch() {
  if (watchId !== null && typeof navigator !== "undefined") {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

// Subscribe to the shared geo stream. Pass `active=false` to unsubscribe
// without tearing down the watch for other subscribers.
export function useGeolocation(active: boolean): GeoState {
  const [state, setState] = useState<GeoState>(current);

  useEffect(() => {
    if (!active) return;
    subscribers.add(setState);
    setState(current);
    startWatch();
    return () => {
      subscribers.delete(setState);
      if (subscribers.size === 0) stopWatch();
    };
  }, [active]);

  return state;
}
