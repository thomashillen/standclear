"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { Place } from "./geocoding";

// ─── Recent searches ────────────────────────────────────────────────
// Lightweight localStorage-backed history of the rider's recent
// destination picks. Surfaced in the SearchSheet's empty state so
// repeat trips ("home from coffee shop") are one tap, not retyped.
//
// Storage shape (versioned). Bumping the version on schema change
// drops old entries cleanly rather than crashing on parse.

const STORAGE_KEY = "standclear.recents.v1";
// Pre-rename key. Read once on cold load so existing rider history
// survives the brand change; new writes go to STORAGE_KEY only.
const LEGACY_STORAGE_KEY = "subwaysurfer.recents.v1";
const CAP = 10;

export type RecentSearch =
  | {
      kind: "station";
      stopId: string;
      name: string;
      addedAt: number;
    }
  | {
      kind: "place";
      id: string;
      name: string;
      context: string;
      lng: number;
      lat: number;
      addedAt: number;
    };

interface Stored {
  v: 1;
  items: RecentSearch[];
}

function tryParse(raw: string | null): RecentSearch[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Stored;
    if (parsed.v !== 1 || !Array.isArray(parsed.items)) return null;
    return parsed.items;
  } catch {
    return null;
  }
}

function load(): RecentSearch[] {
  if (typeof window === "undefined") return [];
  try {
    // Parse each key independently so a corrupted new-key payload
    // doesn't drop an intact legacy record during the rename rollout.
    return (
      tryParse(localStorage.getItem(STORAGE_KEY)) ??
      tryParse(localStorage.getItem(LEGACY_STORAGE_KEY)) ??
      []
    );
  } catch {
    return [];
  }
}

function save(items: RecentSearch[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ v: 1, items } satisfies Stored),
    );
  } catch {
    // Quota exceeded or storage disabled — recents are nice-to-have,
    // not critical, so we silently swallow and move on.
  }
}

// Module-level cache so multiple components reading recents don't
// each round-trip to localStorage. Updated on every mutation.
let cache: RecentSearch[] | null = null;
const subscribers = new Set<() => void>();
// Stable empty list for SSR / pre-hydration. A fresh `[]` each call
// would fail useSyncExternalStore's reference check.
const SERVER_SNAPSHOT: RecentSearch[] = [];

// Cross-tab sync: a recent picked in one tab should appear in others
// without a reload. Module-lifetime singleton listener; bound once on
// first subscribe and never unbound (no per-tab leak — there's only
// one window).
let storageListenerBound = false;
function bindStorageListener() {
  if (storageListenerBound || typeof window === "undefined") return;
  storageListenerBound = true;
  window.addEventListener("storage", (e) => {
    if (e.key !== STORAGE_KEY && e.key !== LEGACY_STORAGE_KEY) return;
    cache = null;
    subscribers.forEach((cb) => cb());
  });
}

function subscribe(cb: () => void): () => void {
  if (subscribers.size === 0) bindStorageListener();
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

function getSnapshot(): RecentSearch[] {
  if (cache === null) cache = load();
  return cache;
}

function getServerSnapshot(): RecentSearch[] {
  return SERVER_SNAPSHOT;
}

function commit(next: RecentSearch[]) {
  cache = next;
  save(next);
  subscribers.forEach((cb) => cb());
}

export function useRecentSearches(): {
  recents: RecentSearch[];
  addStation: (stopId: string, name: string) => void;
  addPlace: (place: Place) => void;
  removeRecent: (key: string) => void;
  clear: () => void;
} {
  const recents = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const update = useCallback((next: RecentSearch[]) => {
    commit(next);
  }, []);

  // Add a station pick. Dedupe by stopId — repeat picks bubble to
  // the top with a fresh addedAt rather than appearing twice.
  const addStation = useCallback(
    (stopId: string, name: string) => {
      const now = Date.now();
      const current = cache ?? load();
      const filtered = current.filter(
        (r) => !(r.kind === "station" && r.stopId === stopId),
      );
      filtered.unshift({ kind: "station", stopId, name, addedAt: now });
      update(filtered.slice(0, CAP));
    },
    [update],
  );

  // Add a geocoded place. Dedupe by Mapbox feature id when present,
  // else by name + coords (covers the rare case of feature ids
  // changing across sessions).
  const addPlace = useCallback(
    (place: Place) => {
      const now = Date.now();
      const current = cache ?? load();
      const filtered = current.filter((r) => {
        if (r.kind !== "place") return true;
        if (place.id && r.id === place.id) return false;
        if (
          r.name === place.name &&
          Math.abs(r.lng - place.lng) < 1e-5 &&
          Math.abs(r.lat - place.lat) < 1e-5
        )
          return false;
        return true;
      });
      filtered.unshift({
        kind: "place",
        id: place.id,
        name: place.name,
        context: place.context,
        lng: place.lng,
        lat: place.lat,
        addedAt: now,
      });
      update(filtered.slice(0, CAP));
    },
    [update],
  );

  const removeRecent = useCallback(
    (key: string) => {
      const current = cache ?? load();
      const filtered = current.filter((r) =>
        r.kind === "station" ? r.stopId !== key : r.id !== key,
      );
      update(filtered);
    },
    [update],
  );

  const clear = useCallback(() => {
    update([]);
  }, [update]);

  return { recents, addStation, addPlace, removeRecent, clear };
}
