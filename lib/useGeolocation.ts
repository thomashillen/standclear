"use client";

import { useCallback, useEffect, useState } from "react";

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
let fastFixRequested = false;

function publish(patch: Partial<GeoState>) {
  current = { ...current, ...patch, updatedAt: Date.now() };
  subscribers.forEach((cb) => cb(current));
}

function applyPosition(pos: GeolocationPosition) {
  publish({
    status: "granted",
    lng: pos.coords.longitude,
    lat: pos.coords.latitude,
    accuracy: pos.coords.accuracy,
    error: null,
  });
}

function applyError(err: GeolocationPositionError, fromWatch: boolean) {
  const denied = err.code === err.PERMISSION_DENIED;
  // Only the watch and explicit denials should drive status. The fast
  // low-accuracy fix is a best-effort kickstart — its timeouts and
  // POSITION_UNAVAILABLE errors aren't meaningful while the high-accuracy
  // watch is still running, and surfacing them flipped the UI to "error"
  // (with a Try Again button) even for users who had granted permission
  // and were seconds away from a real fix.
  if (!denied && !fromWatch) return;
  publish({ status: denied ? "denied" : "error", error: err.message });
  if (denied && watchId !== null && typeof navigator !== "undefined") {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

function startWatch() {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    publish({ status: "unavailable" });
    return;
  }

  // Only flip to prompting on first activation; if we already have a fix
  // don't regress status while a new watch spins up.
  if (current.status === "idle" || current.status === "error") {
    publish({ status: "prompting" });
  }

  // Kick off a fast low-accuracy fix in parallel with the high-accuracy
  // watch. iOS Safari's high-accuracy pipeline can take 10-30s indoors
  // before the first callback fires, leaving the UI stuck on "Finding
  // your location…" long enough for users to give up. A coarse fix
  // resolves in seconds and is good enough to populate nearby stations
  // while the precise watch catches up.
  if (!fastFixRequested) {
    fastFixRequested = true;
    navigator.geolocation.getCurrentPosition(
      applyPosition,
      (err) => applyError(err, false),
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 },
    );
  }

  if (watchId !== null) return;
  watchId = navigator.geolocation.watchPosition(
    applyPosition,
    (err) => applyError(err, true),
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
  fastFixRequested = false;
}

// Explicit re-request, callable from a user-gesture handler. iOS Safari
// sometimes swallows the permission prompt when geolocation is invoked from
// an async effect on mount — a direct user-gesture call reliably surfaces
// the prompt. Also used to retry after a transient error.
export function requestGeolocation() {
  if (current.status === "denied" || current.status === "unavailable") return;
  if (current.status === "error") {
    publish({ status: "prompting", error: null });
    fastFixRequested = false;
  }
  startWatch();
}

// Subscribe to the shared geo stream. Pass `active=false` to unsubscribe
// without tearing down the watch for other subscribers.
export function useGeolocation(active: boolean): GeoState & { request: () => void } {
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

  const request = useCallback(() => requestGeolocation(), []);
  return { ...state, request };
}

// Passive subscription: read the shared geo state without starting the
// watch or triggering a permission prompt. Use this in long-lived
// components (e.g. the background map) that want to display the user's
// position whenever someone else has opted in via useGeolocation(true)
// — the map doesn't prompt, but it lights up once Near Me has.
export function useGeolocationState(): GeoState {
  const [state, setState] = useState<GeoState>(current);
  useEffect(() => {
    subscribers.add(setState);
    setState(current);
    return () => {
      subscribers.delete(setState);
      if (subscribers.size === 0) stopWatch();
    };
  }, []);
  return state;
}
