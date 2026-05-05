"use client";

import { useSyncExternalStore } from "react";

export interface Stop {
  id: string;
  name: string;
  lat: number;
  lng: number;
  shapeIdx: number;
}

export interface SubwayLine {
  id: string;          // Display id ("1", "A", "S", "SI")
  routeId: string;     // GTFS route_id ("1", "A", "GS", "FS", "H", "SI")
  name: string;
  color: string;
  textColor: "white" | "black";
  stops: Stop[];
  shape: [number, number][]; // [lng, lat] coordinates following actual track
}

export type Lines = Record<string, SubwayLine>;

// The 429KB GTFS blob is served as a static asset from /public and fetched at
// runtime instead of imported as a module. Bundling it through Turbopack (or
// letting TS infer literal types for it) balloons dev-server memory — see the
// commit history for the 65GB tsserver incident.
let cache: Lines | null = null;
let loadPromise: Promise<Lines> | null = null;
const subscribers = new Set<() => void>();

function loadLines(): Promise<Lines> {
  if (cache) return Promise.resolve(cache);
  if (!loadPromise) {
    loadPromise = fetch("/gtfsData.json")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ lines: Lines }>;
      })
      .then((j) => {
        cache = j.lines;
        subscribers.forEach((cb) => cb());
        return cache;
      })
      .catch((err) => {
        console.error("Failed to load /gtfsData.json", err);
        loadPromise = null;
        throw err;
      });
  }
  return loadPromise;
}

function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  if (!cache) loadLines().catch(() => {});
  return () => {
    subscribers.delete(cb);
  };
}

function getSnapshot(): Lines | null {
  return cache;
}

function getServerSnapshot(): Lines | null {
  return null;
}

export function useLines(): Lines | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// Order matches the official MTA "Lines" panel: numbered (IRT), 8 Av (ACE),
// 6 Av (BDFM), Crosstown (G), Nassau (JZ), Canarsie (L), Broadway (NQRW),
// Shuttles, Staten Island.
export const LINE_GROUPS: { label: string; lines: string[] }[] = [
  { label: "IRT", lines: ["1", "2", "3", "4", "5", "6", "7"] },
  { label: "IND", lines: ["A", "C", "E", "B", "D", "F", "M", "G"] },
  { label: "BMT", lines: ["J", "Z", "L", "N", "Q", "R", "W"] },
  { label: "S",   lines: ["GS", "FS", "H"] },
  { label: "SI",  lines: ["SI"] },
];

// Shared-track corridors: picking one bullet highlights every train sharing
// that trunk. This mirrors how NYC subway trunk colors actually map to
// infrastructure, except for the shuttle-gray collision (L vs GS/FS/H),
// which we break out into singletons.
export const CORRIDOR: Record<string, string[]> = {
  "1": ["1", "2", "3"], "2": ["1", "2", "3"], "3": ["1", "2", "3"],
  "4": ["4", "5", "6"], "5": ["4", "5", "6"], "6": ["4", "5", "6"],
  "7": ["7"],
  A: ["A", "C", "E"], C: ["A", "C", "E"], E: ["A", "C", "E"],
  B: ["B", "D", "F", "M"], D: ["B", "D", "F", "M"],
  F: ["B", "D", "F", "M"], M: ["B", "D", "F", "M"],
  G: ["G"],
  J: ["J", "Z"], Z: ["J", "Z"],
  L: ["L"],
  N: ["N", "Q", "R", "W"], Q: ["N", "Q", "R", "W"],
  R: ["N", "Q", "R", "W"], W: ["N", "Q", "R", "W"],
  GS: ["GS"], FS: ["FS"], H: ["H"],
  SI: ["SI"],
};
