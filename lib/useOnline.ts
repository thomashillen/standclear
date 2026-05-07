"use client";

import { useSyncExternalStore } from "react";

// Reactive view of `navigator.onLine`. Subscribes to the browser's
// `online` / `offline` events; the polling hooks (useTrains,
// useAlerts) read this to skip ticks while the device is offline so
// we don't burn battery firing into the void, and the floating
// header surfaces an "Offline" badge so the rider knows why the
// app feels frozen.
//
// `navigator.onLine` is a heuristic — it tells you the device has a
// network interface, not that the internet is reachable. So treat
// `false` as "definitely offline" (skip polling, show badge) and
// `true` as "probably online, attempt as usual." Per-poll fetch
// failures are still the source of truth for "fetch didn't work."

const subscribers = new Set<() => void>();
let bound = false;
let cachedOnline = true;

function publish() {
  subscribers.forEach((cb) => cb());
}

function bindIfNeeded() {
  if (bound || typeof window === "undefined") return;
  bound = true;
  cachedOnline = window.navigator.onLine;
  window.addEventListener("online", () => {
    cachedOnline = true;
    publish();
  });
  window.addEventListener("offline", () => {
    cachedOnline = false;
    publish();
  });
}

function subscribe(cb: () => void): () => void {
  bindIfNeeded();
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

function getSnapshot(): boolean {
  // Re-read on every snapshot — the cached flag is updated by the
  // event listeners, but on first call (pre-event) we want the live
  // value. SSR returns true (the optimistic default).
  if (typeof window === "undefined") return true;
  return cachedOnline;
}

function getServerSnapshot(): boolean {
  return true;
}

/**
 * `true` when the device is online (per `navigator.onLine`), `false`
 * during a known-offline window. Listens for `online`/`offline`
 * events so consumers re-render when connectivity flips.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Module-level read for non-hook contexts (e.g. polling code). Same
 * underlying source as `useOnline()`. Returns `true` on the server.
 */
export function isOnline(): boolean {
  bindIfNeeded();
  if (typeof window === "undefined") return true;
  return cachedOnline;
}

/**
 * Subscribe to online/offline transitions imperatively. Returns an
 * unsubscribe function. Used by useTrains / useAlerts to resume
 * polling on the `online` event without re-reading every tick.
 */
export function subscribeOnline(cb: () => void): () => void {
  return subscribe(cb);
}
