"use client";

import { captureWarning } from "./observability";

/**
 * Mapbox Directions API helper — walking profile. Resolves a pair of
 * lng/lat endpoints into a real pedestrian path that follows streets,
 * sidewalks, and crossings, plus turn-by-turn step instructions.
 *
 * Used by the trip overlay so the dashed walk segments at the start /
 * end of a directions session trace actual streets instead of a
 * straight crow-flies line, and by the expanded route detail view so
 * the rider gets readable A-to-Z steps ("Turn right onto Broadway").
 *
 * Results are cached in-memory keyed on a rounded coordinate pair so
 * repeated renders / mode flips hit the cache instead of slamming the
 * API. Failures (no token, non-2xx, network error) resolve to null so
 * callers can fall back to the straight-line behavior gracefully.
 */

export interface WalkingStep {
  /** Distance in meters for this step. */
  distance: number;
  /** Duration in seconds for this step. */
  duration: number;
  /** Human-readable instruction (e.g. "Turn right onto Main St"). */
  instruction: string;
  /** [lng, lat] coordinates traced by this single step. */
  coordinates: [number, number][];
  /** Street name when known; sometimes empty for path / pedestrian segments. */
  streetName?: string;
  /** Maneuver type (turn, depart, arrive, continue, etc.). */
  maneuver?: string;
  /** Modifier such as left / right / sharp left. */
  modifier?: string;
}

export interface WalkingRoute {
  /** All coordinates following the actual walking path along streets. */
  coordinates: [number, number][];
  /** Total distance in meters. */
  distance: number;
  /** Total duration in seconds. */
  duration: number;
  /** Step-by-step instructions in travel order. */
  steps: WalkingStep[];
}

const cache = new Map<string, Promise<WalkingRoute | null>>();

function cacheKey(
  from: { lng: number; lat: number },
  to: { lng: number; lat: number },
): string {
  // Round to ~1m precision so near-identical pairs collapse onto a
  // single cache entry (rerenders that recompute coords by a hair).
  const round = (n: number) => Math.round(n * 1e5) / 1e5;
  return `${round(from.lng)},${round(from.lat)};${round(to.lng)},${round(to.lat)}`;
}

// Haversine distance in meters. Inlined here so this module doesn't
// pull in stopsIndex.ts just for one call.
function crowFliesMeters(
  from: { lng: number; lat: number },
  to: { lng: number; lat: number },
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// At very short distances the street-snapped path is barely
// distinguishable from a straight line and the Directions API call
// is pure overhead. Below this threshold we synthesize a
// straight-line route locally; above it we hit Mapbox.
const SHORT_WALK_METERS = 80;
// Mapbox's walking profile defaults to ~1.4 m/s on flat terrain.
// We pad slightly (1.3) for traffic-light delay and curb cuts so the
// synthesized estimate doesn't undercut the real one.
const WALKING_SPEED_MPS = 1.3;

function syntheticShortWalk(
  from: { lng: number; lat: number },
  to: { lng: number; lat: number },
): WalkingRoute {
  const meters = crowFliesMeters(from, to);
  const seconds = meters / WALKING_SPEED_MPS;
  return {
    coordinates: [
      [from.lng, from.lat],
      [to.lng, to.lat],
    ],
    distance: meters,
    duration: seconds,
    steps: [
      {
        distance: meters,
        duration: seconds,
        instruction: "Walk to the entrance",
        coordinates: [
          [from.lng, from.lat],
          [to.lng, to.lat],
        ],
        maneuver: "depart",
      },
    ],
  };
}

interface MapboxDirectionsResponse {
  routes?: {
    distance: number;
    duration: number;
    geometry: { coordinates: [number, number][] };
    legs?: {
      steps?: {
        distance: number;
        duration: number;
        name?: string;
        geometry: { coordinates: [number, number][] };
        maneuver?: {
          instruction?: string;
          type?: string;
          modifier?: string;
        };
      }[];
    }[];
  }[];
}

export async function fetchWalkingRoute(
  from: { lng: number; lat: number },
  to: { lng: number; lat: number },
  options: { signal?: AbortSignal } = {},
): Promise<WalkingRoute | null> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return null;

  const key = cacheKey(from, to);
  const hit = cache.get(key);
  if (hit) return hit;

  // Short hops don't deviate enough from a straight line to justify a
  // Directions API call (and the round-trip frequently dwarfs the walk
  // itself). Synthesize a single-step route in-process and cache it
  // under the same key the streetwise call would use.
  if (crowFliesMeters(from, to) < SHORT_WALK_METERS) {
    const synthetic = Promise.resolve(syntheticShortWalk(from, to));
    cache.set(key, synthetic);
    return synthetic;
  }

  const url = new URL(
    `https://api.mapbox.com/directions/v5/mapbox/walking/${from.lng},${from.lat};${to.lng},${to.lat}`,
  );
  url.searchParams.set("access_token", token);
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("overview", "full");
  url.searchParams.set("steps", "true");
  url.searchParams.set("language", "en");

  const promise = fetch(url.toString(), { signal: options.signal })
    .then(async (res): Promise<WalkingRoute | null> => {
      if (!res.ok) {
        // HTTP error — drop the cache so a retry from the UI can hit
        // the network instead of silently returning the cached null.
        cache.delete(key);
        return null;
      }
      const data = (await res.json()) as MapboxDirectionsResponse;
      const route = data.routes?.[0];
      if (!route) {
        cache.delete(key);
        return null;
      }
      const steps: WalkingStep[] = [];
      for (const leg of route.legs ?? []) {
        for (const step of leg.steps ?? []) {
          const instruction =
            step.maneuver?.instruction ??
            (step.name ? `Continue on ${step.name}` : "Continue");
          steps.push({
            distance: step.distance,
            duration: step.duration,
            instruction,
            coordinates: step.geometry.coordinates,
            streetName: step.name && step.name.length > 0 ? step.name : undefined,
            maneuver: step.maneuver?.type,
            modifier: step.maneuver?.modifier,
          });
        }
      }
      return {
        coordinates: route.geometry.coordinates,
        distance: route.distance,
        duration: route.duration,
        steps,
      };
    })
    .catch((err: unknown) => {
      // Drop the cache on any failure — abort, network, or otherwise.
      // A cached `null` would shadow a healthy retry; better to refetch.
      cache.delete(key);
      if (
        err &&
        typeof err === "object" &&
        "name" in err &&
        (err as { name?: string }).name === "AbortError"
      ) {
        return null;
      }
      // Real failure (rate limit, network, 401) — surface it through
      // observability so the silent fallback to "crow-flies dashed
      // line" is at least visible to operators. Caller still sees
      // null and renders the fallback path.
      captureWarning("Mapbox walking directions failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    });

  cache.set(key, promise);
  return promise;
}

/**
 * Drop the cached entry (if any) for a from→to pair so the next call
 * goes to the network. Used by the directions panel's retry button
 * when a fetch failed and the rider asks for another try.
 */
export function clearWalkingRouteCache(
  from: { lng: number; lat: number },
  to: { lng: number; lat: number },
): void {
  cache.delete(cacheKey(from, to));
}
