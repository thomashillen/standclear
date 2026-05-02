"use client";

import { useCallback, useEffect, useState } from "react";
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

function load(): RecentSearch[] {
  if (typeof window === "undefined") return [];
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ??
      localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Stored;
    if (parsed.v !== 1 || !Array.isArray(parsed.items)) return [];
    return parsed.items;
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

export function useRecentSearches(): {
  recents: RecentSearch[];
  addStation: (stopId: string, name: string) => void;
  addPlace: (place: Place) => void;
  removeRecent: (key: string) => void;
  clear: () => void;
} {
  const [recents, setRecents] = useState<RecentSearch[]>([]);

  // Hydrate from storage after mount to avoid SSR/client mismatch.
  // Same lazy pattern useFavorites uses.
  useEffect(() => {
    if (cache === null) cache = load();
    setRecents(cache);
  }, []);

  const update = useCallback((next: RecentSearch[]) => {
    cache = next;
    setRecents(next);
    save(next);
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
