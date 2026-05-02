"use client";

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
      if (!res.ok) return null;
      const data = (await res.json()) as MapboxDirectionsResponse;
      const route = data.routes?.[0];
      if (!route) return null;
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
      if (
        err &&
        typeof err === "object" &&
        "name" in err &&
        (err as { name?: string }).name === "AbortError"
      ) {
        // Aborted requests are routine when the rider re-selects a
        // different plan mid-fetch. Don't poison the cache.
        cache.delete(key);
      }
      return null;
    });

  cache.set(key, promise);
  return promise;
}
