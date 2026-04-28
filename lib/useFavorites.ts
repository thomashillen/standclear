"use client";

import { useCallback, useEffect, useState } from "react";

// v1 stored only an array of favorite stopIds at a separate key. v2 unifies
// favorites with the commute anchors (Home/Work) so the whole "saved
// stations" surface lives in one place. We migrate v1 the first time we
// load, then leave the old key alone in case a user rolls back.
const KEY_V1 = "subwaysurfer:favorites:v1";
const KEY = "subwaysurfer:commute:v2";

export interface CommuteState {
  home: string | null;
  work: string | null;
  favorites: Set<string>;
}

// Module-level cache shared by every hook instance — useFavorites and
// useCommute read/write the same state object. Subscribers are notified
// on every change so two panels stay in sync regardless of which hook
// they used to read.
let cache: CommuteState | null = null;
const subscribers = new Set<(v: CommuteState) => void>();

function emptyState(): CommuteState {
  return { home: null, work: null, favorites: new Set() };
}

function load(): CommuteState {
  if (cache) return cache;
  if (typeof window === "undefined") return emptyState();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as {
        home?: string | null;
        work?: string | null;
        favorites?: string[];
      };
      cache = {
        home: parsed.home ?? null,
        work: parsed.work ?? null,
        favorites: new Set(parsed.favorites ?? []),
      };
      return cache;
    }
    // Migrate v1: lift the old array of favorite stopIds into the new
    // shape with empty home/work. Future writes go to KEY only.
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
  subscribers.forEach((cb) => cb(next));
}

function useStore(): CommuteState {
  const [state, setState] = useState<CommuteState>(() => load());
  useEffect(() => {
    subscribers.add(setState);
    setState(load());
    return () => {
      subscribers.delete(setState);
    };
  }, []);
  return state;
}

// ─── Favorites ────────────────────────────────────────────────────────
// Existing public API. Other components consume this shape directly so
// we keep it stable: `favorites` is the Set, `toggle` flips membership,
// `has` is a memoized predicate.

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

  const has = useCallback(
    (stopId: string) => (cache ?? load()).favorites.has(stopId),
    // Re-derive whenever the favorites set changes so consumers re-render
    // the right star state.
    [state.favorites],
  );

  return { favorites: state.favorites, toggle, has };
}

// ─── Commute (Home / Work) ────────────────────────────────────────────
// Two named anchors layered on top of favorites. A station can be the
// user's Home, Work, or just a favorite — but a station can only be one
// anchor at a time, so setting Home on a station that's currently Work
// clears Work. Setting an anchor also auto-favorites it so the station
// shows up everywhere "saved" is consulted (unsetting an anchor leaves
// the favorite intact — that's a separate intent).

export type CommuteAnchor = "home" | "work";

export interface CommuteHook {
  home: string | null;
  work: string | null;
  /** Set or clear an anchor directly. Pass null to clear. */
  setAnchor: (anchor: CommuteAnchor, stopId: string | null) => void;
  /** Set this station as the named anchor, clearing it from the *other*
   *  anchor if it was set there. Auto-adds to favorites. */
  assignAnchor: (anchor: CommuteAnchor, stopId: string) => void;
  /** What anchor (if any) is this stopId currently? */
  anchorOf: (stopId: string) => CommuteAnchor | null;
  isHome: (stopId: string) => boolean;
  isWork: (stopId: string) => boolean;
}

export function useCommute(): CommuteHook {
  const state = useStore();

  const setAnchor = useCallback(
    (anchor: CommuteAnchor, stopId: string | null) => {
      const cur = cache ?? load();
      commit({ ...cur, [anchor]: stopId });
    },
    [],
  );

  const assignAnchor = useCallback((anchor: CommuteAnchor, stopId: string) => {
    const cur = cache ?? load();
    const other: CommuteAnchor = anchor === "home" ? "work" : "home";
    const nextFavs = new Set(cur.favorites);
    nextFavs.add(stopId);
    // If this station was the *other* anchor, clear that side. Anchors
    // are mutually exclusive — your Home shouldn't double as your Work.
    const clearedOther = cur[other] === stopId ? null : cur[other];
    commit({
      ...cur,
      [anchor]: stopId,
      [other]: clearedOther,
      favorites: nextFavs,
    });
  }, []);

  const anchorOf = useCallback(
    (stopId: string): CommuteAnchor | null => {
      const c = cache ?? load();
      if (c.home === stopId) return "home";
      if (c.work === stopId) return "work";
      return null;
    },
    [state.home, state.work],
  );

  const isHome = useCallback(
    (stopId: string) => (cache ?? load()).home === stopId,
    [state.home],
  );
  const isWork = useCallback(
    (stopId: string) => (cache ?? load()).work === stopId,
    [state.work],
  );

  return {
    home: state.home,
    work: state.work,
    setAnchor,
    assignAnchor,
    anchorOf,
    isHome,
    isWork,
  };
}
