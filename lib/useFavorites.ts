"use client";

import { useCallback, useEffect, useState } from "react";

const KEY = "subwaysurfer:favorites:v1";

// Module-level cache shared by all hook instances. Reads hit memory after the
// first load; writes fan out to every subscriber so two panels stay in sync.
let cache: Set<string> | null = null;
const subscribers = new Set<(v: Set<string>) => void>();

function load(): Set<string> {
  if (cache) return cache;
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    cache = new Set();
  }
  return cache;
}

function save(next: Set<string>) {
  cache = next;
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(KEY, JSON.stringify([...next]));
    }
  } catch {
    // Private-mode Safari and quota errors fall through silently; the
    // in-memory set keeps the session consistent.
  }
  subscribers.forEach((cb) => cb(next));
}

export interface FavoritesHook {
  favorites: Set<string>;
  toggle: (stopId: string) => void;
  has: (stopId: string) => boolean;
}

export function useFavorites(): FavoritesHook {
  const [state, setState] = useState<Set<string>>(() => load());

  useEffect(() => {
    subscribers.add(setState);
    setState(load());
    return () => {
      subscribers.delete(setState);
    };
  }, []);

  const toggle = useCallback((stopId: string) => {
    const next = new Set(cache ?? load());
    if (next.has(stopId)) next.delete(stopId);
    else next.add(stopId);
    save(next);
  }, []);

  const has = useCallback(
    (stopId: string) => (cache ?? load()).has(stopId),
    // The returned function closes over the module cache, not `state`, so
    // it doesn't need to re-create on every render — but we still want
    // callers to re-render when the set changes, so we read `state` here.
    [state],
  );

  return { favorites: state, toggle, has };
}
