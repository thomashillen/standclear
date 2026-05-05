"use client";

import { useCallback, useSyncExternalStore } from "react";

// v1 stored only an array of favorite stopIds at a separate key.
// v2 unified favorites with the commute anchors (Home/Work) so the whole
// "saved stations" surface lives in one place; Home/Work were raw
// stopIds.
// v3 widens Home/Work to a discriminated union so the rider can pin an
// ADDRESS as their commute anchor (not just a station). Routing still
// targets a real station — the address endpoint carries coords + name
// for the walk leg, while the underlying nearest station is resolved
// at read time from the live station index.
//
// The brand renamed from "subwaysurfer" to "standclear", so the live
// key now sits under the standclear namespace at the same v3 schema.
// Old subwaysurfer:* keys are read once on cold load and forwarded
// into the new key.
const KEY_V1 = "subwaysurfer:favorites:v1";
const KEY_V2 = "subwaysurfer:commute:v2";
const KEY_V3_LEGACY = "subwaysurfer:commute:v3";
const KEY = "standclear:commute:v3";

/**
 * A commute anchor is either a station pin (just the stopId, station
 * name resolved at render time) or an address pin (coords + label,
 * with the routing engine resolving the nearest station on the fly
 * — so even if a new station opens between the user's two visits,
 * the trip plan re-uses the now-closer station automatically).
 */
export type CommuteEndpoint =
  | { kind: "station"; stopId: string }
  | { kind: "address"; name: string; lng: number; lat: number };

export interface CommuteState {
  home: CommuteEndpoint | null;
  work: CommuteEndpoint | null;
  favorites: Set<string>;
}

let cache: CommuteState | null = null;
const subscribers = new Set<() => void>();
// Stable empty snapshot for the SSR / pre-hydration tree. Returning a
// fresh emptyState() per call would trip useSyncExternalStore's
// reference-equality check and cause infinite render loops.
const SERVER_SNAPSHOT: CommuteState = {
  home: null,
  work: null,
  favorites: new Set(),
};

function emptyState(): CommuteState {
  return { home: null, work: null, favorites: new Set() };
}

// Coerce a v2 (string) or v3 (object) endpoint shape into the v3
// discriminated union. Defensive against stale storage written by
// older versions of the app or by partial migrations.
function normalizeEndpoint(value: unknown): CommuteEndpoint | null {
  if (value == null) return null;
  if (typeof value === "string") {
    return { kind: "station", stopId: value };
  }
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (v.kind === "station" && typeof v.stopId === "string") {
      return { kind: "station", stopId: v.stopId };
    }
    if (
      v.kind === "address" &&
      typeof v.name === "string" &&
      typeof v.lng === "number" &&
      typeof v.lat === "number"
    ) {
      return { kind: "address", name: v.name, lng: v.lng, lat: v.lat };
    }
  }
  return null;
}

function tryParseV3(raw: string | null): CommuteState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      home?: unknown;
      work?: unknown;
      favorites?: string[];
    };
    return {
      home: normalizeEndpoint(parsed.home),
      work: normalizeEndpoint(parsed.work),
      favorites: new Set(parsed.favorites ?? []),
    };
  } catch {
    return null;
  }
}

function load(): CommuteState {
  if (cache) return cache;
  if (typeof window === "undefined") return emptyState();
  try {
    // Prefer the current key; fall back to the pre-rename v3 key so
    // riders coming from a SubwaySurfer-branded install keep their
    // pinned Home/Work and favorites across the rename. Parse each
    // key independently so a corrupted new key doesn't shadow an
    // intact legacy record during the rollout.
    const v3 =
      tryParseV3(window.localStorage.getItem(KEY)) ??
      tryParseV3(window.localStorage.getItem(KEY_V3_LEGACY));
    if (v3) {
      cache = v3;
      // Re-write under the new key so subsequent loads short-circuit
      // and we can stop reading the legacy key once it's empty.
      saveRaw(cache);
      return cache;
    }
    // Migrate v2 → v3: wrap raw stopIds as { kind: "station", stopId }.
    const rawV2 = window.localStorage.getItem(KEY_V2);
    if (rawV2) {
      const parsed = JSON.parse(rawV2) as {
        home?: string | null;
        work?: string | null;
        favorites?: string[];
      };
      cache = {
        home: parsed.home ? { kind: "station", stopId: parsed.home } : null,
        work: parsed.work ? { kind: "station", stopId: parsed.work } : null,
        favorites: new Set(parsed.favorites ?? []),
      };
      saveRaw(cache);
      return cache;
    }
    // Migrate v1: lift the old array of favorite stopIds into the new
    // shape with empty home/work.
    const legacy = window.localStorage.getItem(KEY_V1);
    if (legacy) {
      const arr = JSON.parse(legacy) as string[];
      cache = { home: null, work: null, favorites: new Set(arr) };
      saveRaw(cache);
      return cache;
    }
  } catch {
    // fall through to empty state on parse / quota errors
  }
  cache = emptyState();
  return cache;
}

function saveRaw(state: CommuteState) {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        KEY,
        JSON.stringify({
          home: state.home,
          work: state.work,
          favorites: [...state.favorites],
        }),
      );
    }
  } catch {
    // Private-mode Safari and quota errors fall through silently.
  }
}

function commit(next: CommuteState) {
  cache = next;
  saveRaw(next);
  subscribers.forEach((cb) => cb());
}

function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

function getSnapshot(): CommuteState {
  if (!cache) cache = load();
  return cache;
}

function getServerSnapshot(): CommuteState {
  return SERVER_SNAPSHOT;
}

function useStore(): CommuteState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// ─── Favorites ────────────────────────────────────────────────────────

export interface FavoritesHook {
  favorites: Set<string>;
  toggle: (stopId: string) => void;
  has: (stopId: string) => boolean;
}

export function useFavorites(): FavoritesHook {
  const state = useStore();

  const toggle = useCallback((stopId: string) => {
    const cur = cache ?? load();
    const nextFavs = new Set(cur.favorites);
    if (nextFavs.has(stopId)) nextFavs.delete(stopId);
    else nextFavs.add(stopId);
    commit({ ...cur, favorites: nextFavs });
  }, []);

  // `has` reads through the module cache rather than the closed-over
  // `state.favorites`, so the dep list is empty on purpose — the
  // useSyncExternalStore-driven re-render keeps the closure fresh.
  void state;
  const has = useCallback(
    (stopId: string) => (cache ?? load()).favorites.has(stopId),
    [],
  );

  return { favorites: state.favorites, toggle, has };
}

// ─── Commute (Home / Work) ────────────────────────────────────────────
// A station can be the user's Home, Work, or just a favorite — but a
// station can only be one anchor at a time, so setting Home on a
// station currently held as Work clears the Work side. The same rule
// applies to addresses: if the same address is set as Work, picking
// it as Home clears Work. Identity for an address is name + coords;
// for a station it's stopId.

export type CommuteAnchor = "home" | "work";

function endpointStopId(e: CommuteEndpoint | null): string | null {
  return e && e.kind === "station" ? e.stopId : null;
}

function endpointsEqual(
  a: CommuteEndpoint | null,
  b: CommuteEndpoint | null,
): boolean {
  if (!a || !b) return false;
  if (a.kind === "station" && b.kind === "station") return a.stopId === b.stopId;
  if (a.kind === "address" && b.kind === "address") {
    return a.name === b.name && a.lng === b.lng && a.lat === b.lat;
  }
  return false;
}

export interface CommuteHook {
  home: CommuteEndpoint | null;
  work: CommuteEndpoint | null;
  /** Direct setter — pass null to clear. */
  setAnchor: (anchor: CommuteAnchor, value: CommuteEndpoint | null) => void;
  /** Pin a station as the named anchor. Clears the other anchor if it
   *  held the same station, and auto-favorites the stopId so it
   *  shows up everywhere "saved" is consulted. */
  assignAnchor: (anchor: CommuteAnchor, stopId: string) => void;
  /** Pin an address as the named anchor. Clears the other anchor if it
   *  held the same address. Addresses don't sit in favorites because
   *  the favorites set is keyed on station stopIds. */
  assignAnchorAddress: (
    anchor: CommuteAnchor,
    address: { name: string; lng: number; lat: number },
  ) => void;
  /** Convenience: what anchor (if any) does this station stopId hold?
   *  Returns null for stations not pinned, and never matches address
   *  anchors. */
  anchorOf: (stopId: string) => CommuteAnchor | null;
  /** Compatibility predicate — true when stopId is the underlying
   *  station for the named anchor (station anchors only). */
  isHome: (stopId: string) => boolean;
  isWork: (stopId: string) => boolean;
}

export function useCommute(): CommuteHook {
  const state = useStore();

  const setAnchor = useCallback(
    (anchor: CommuteAnchor, value: CommuteEndpoint | null) => {
      const cur = cache ?? load();
      commit({ ...cur, [anchor]: value });
    },
    [],
  );

  const assignAnchor = useCallback((anchor: CommuteAnchor, stopId: string) => {
    const cur = cache ?? load();
    const other: CommuteAnchor = anchor === "home" ? "work" : "home";
    const nextFavs = new Set(cur.favorites);
    nextFavs.add(stopId);
    const wantedEndpoint: CommuteEndpoint = { kind: "station", stopId };
    const clearedOther = endpointsEqual(cur[other], wantedEndpoint)
      ? null
      : cur[other];
    commit({
      ...cur,
      [anchor]: wantedEndpoint,
      [other]: clearedOther,
      favorites: nextFavs,
    });
  }, []);

  const assignAnchorAddress = useCallback(
    (
      anchor: CommuteAnchor,
      address: { name: string; lng: number; lat: number },
    ) => {
      const cur = cache ?? load();
      const other: CommuteAnchor = anchor === "home" ? "work" : "home";
      const wanted: CommuteEndpoint = {
        kind: "address",
        name: address.name,
        lng: address.lng,
        lat: address.lat,
      };
      const clearedOther = endpointsEqual(cur[other], wanted)
        ? null
        : cur[other];
      commit({
        ...cur,
        [anchor]: wanted,
        [other]: clearedOther,
      });
    },
    [],
  );

  // Same as `has` above — callbacks read through the module cache and
  // the external-store subscription drives re-renders, so we don't
  // need state.home / state.work in the dep arrays.
  void state;
  const anchorOf = useCallback((stopId: string): CommuteAnchor | null => {
    const c = cache ?? load();
    if (endpointStopId(c.home) === stopId) return "home";
    if (endpointStopId(c.work) === stopId) return "work";
    return null;
  }, []);

  const isHome = useCallback(
    (stopId: string) => endpointStopId((cache ?? load()).home) === stopId,
    [],
  );
  const isWork = useCallback(
    (stopId: string) => endpointStopId((cache ?? load()).work) === stopId,
    [],
  );

  return {
    home: state.home,
    work: state.work,
    setAnchor,
    assignAnchor,
    assignAnchorAddress,
    anchorOf,
    isHome,
    isWork,
  };
}
