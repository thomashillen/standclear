"use client";

import { captureWarning } from "./observability";

/**
 * Mapbox Search Box autocomplete helpers. Two-step flow:
 *
 *   1. `suggestPlaces(query)` hits `/suggest`, returning lightweight
 *      `Suggestion`s (mapbox_id + display text, no coordinates).
 *      `/suggest` is purpose-built for live typeahead — it ranks
 *      partial inputs ("550 madis") sensibly, where `/forward`
 *      treats them as completed queries and falls back to fuzzy
 *      matches on the POI corpus (returning e.g. "Mavis Place" in
 *      New Jersey for "550 madis").
 *
 *   2. `retrievePlace(suggestion)` hits `/retrieve` to fetch the
 *      coordinates for the suggestion the rider tapped. Only fires
 *      on selection, so we pay the second round-trip once per pick
 *      instead of once per keystroke.
 *
 * Bounded to NYC and proximity-biased to the rider's current
 * location so a search for "Broadway" in Brooklyn surfaces the
 * right Broadway, not Manhattan's.
 *
 * A `session_token` UUID groups suggest+retrieve calls for
 * Mapbox's per-session billing and is rotated after each retrieve.
 */

export interface Suggestion {
  /** Stable Mapbox identifier — pass to `retrievePlace` to resolve. */
  mapboxId: string;
  name: string;
  /** Subtitle — neighborhood, borough, or zip context. May be empty. */
  context: string;
  /** "poi", "address", "street", etc. Optional — UI may use it for icons. */
  featureType?: string;
}

export interface Place {
  id: string;
  name: string;
  /** Subtitle — neighborhood, borough, or zip context. May be empty. */
  context: string;
  lng: number;
  lat: number;
}

// Roughly: Liberty State Park (SW) → Riverdale / LaGuardia (NE).
const NYC_BBOX = "-74.20,40.55,-73.70,40.92";

let sessionToken = newSessionToken();
function newSessionToken(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `s-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

interface SuggestFeature {
  mapbox_id?: string;
  name?: string;
  name_preferred?: string;
  place_formatted?: string;
  full_address?: string;
  feature_type?: string;
}

function trimSubtitle(raw: string | undefined): string {
  if (!raw) return "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && s !== "United States" && s !== "USA")
    .join(", ");
}

// Session-scoped LRU cache for /suggest results. The same query +
// proximity + limit fans out to identical Mapbox responses for the
// session_token's lifetime, and a rider's typing flow ("br" → "broad"
// → "broad" via backspace+retype, or two fields that share the same
// proximity) repeats the same prefix often enough to make caching
// pay off. We key on the query+proximity+limit tuple AND the active
// session_token, so a token rotation invalidates entries (since
// Mapbox's billing groups suggest+retrieve under a session, mixing
// cached results from a closed session into a new one would let a
// pick fall outside its session and break the retrieve). LRU bound
// of 64 covers a typical typing flow without unbounded growth.
const SUGGEST_CACHE_LIMIT = 64;
const suggestCache = new Map<string, Suggestion[]>();

function suggestCacheKey(
  query: string,
  options: { limit?: number; proximity?: { lng: number; lat: number } },
): string {
  const limit = String(Math.min(options.limit ?? 10, 10));
  const prox = options.proximity
    ? // Round proximity to ~1km so a fresh GPS sample one meter off
      // doesn't bust the cache for an otherwise-identical query.
      `${Math.round(options.proximity.lng * 100) / 100},${
        Math.round(options.proximity.lat * 100) / 100
      }`
    : "";
  return `${sessionToken}|${query}|${prox}|${limit}`;
}

function cacheSuggestResult(key: string, value: Suggestion[]) {
  // LRU touch: delete + re-set moves the entry to the tail, so the
  // oldest entry is at the head when we evict.
  if (suggestCache.has(key)) suggestCache.delete(key);
  suggestCache.set(key, value);
  if (suggestCache.size > SUGGEST_CACHE_LIMIT) {
    const firstKey = suggestCache.keys().next().value;
    if (firstKey !== undefined) suggestCache.delete(firstKey);
  }
}

/**
 * Live-typeahead suggestions for a partial query. Returns up to
 * `limit` ranked entries without coordinates — call `retrievePlace`
 * to resolve the one the rider taps. Returns [] for queries shorter
 * than 2 characters (Mapbox's minimum).
 */
export async function suggestPlaces(
  query: string,
  options: {
    limit?: number;
    proximity?: { lng: number; lat: number };
    signal?: AbortSignal;
  } = {},
): Promise<Suggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const cacheKey = suggestCacheKey(trimmed, options);
  const cached = suggestCache.get(cacheKey);
  if (cached) {
    // LRU touch on read so frequently re-typed prefixes survive.
    suggestCache.delete(cacheKey);
    suggestCache.set(cacheKey, cached);
    return cached;
  }

  // Route through the server proxy so MAPBOX_TOKEN never touches the client.
  const params = new URLSearchParams();
  params.set("action", "suggest");
  params.set("q", trimmed);
  params.set("session_token", sessionToken);
  params.set("limit", String(Math.min(options.limit ?? 10, 10)));
  params.set("bbox", NYC_BBOX);
  params.set("types", "poi,category,address,street,neighborhood,locality,place");
  params.set("country", "us");
  if (options.proximity) {
    params.set("proximity", `${options.proximity.lng},${options.proximity.lat}`);
  }
  params.set("language", "en");

  const res = await fetch(`/api/geocode?${params}`, { signal: options.signal });
  if (!res.ok) {
    throw new Error(`Mapbox Search Box suggest HTTP ${res.status}`);
  }
  const data = (await res.json()) as { suggestions?: SuggestFeature[] };
  if (!data.suggestions) return [];

  const out: Suggestion[] = [];
  for (const s of data.suggestions) {
    const id = s.mapbox_id;
    if (!id) continue;
    const title = s.name_preferred ?? s.name ?? "";
    if (!title) continue;
    out.push({
      mapboxId: id,
      name: title,
      context: trimSubtitle(s.place_formatted ?? s.full_address),
      featureType: s.feature_type,
    });
  }
  cacheSuggestResult(cacheKey, out);
  return out;
}

interface RetrieveFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    mapbox_id?: string;
    name?: string;
    name_preferred?: string;
    place_formatted?: string;
    full_address?: string;
  };
}

/**
 * Resolve a `Suggestion` to a `Place` with coordinates. Rotates the
 * session token afterward so the next typing session starts a new
 * billing group. Returns null if Mapbox returns no feature.
 */
export async function retrievePlace(
  suggestion: Suggestion,
  options: { signal?: AbortSignal } = {},
): Promise<Place | null> {
  // Route through the server proxy so MAPBOX_TOKEN never touches the client.
  const params = new URLSearchParams();
  params.set("action", "retrieve");
  params.set("mapbox_id", suggestion.mapboxId);
  params.set("session_token", sessionToken);

  const res = await fetch(`/api/geocode?${params}`, { signal: options.signal });
  if (!res.ok) {
    throw new Error(`Mapbox Search Box retrieve HTTP ${res.status}`);
  }
  const data = (await res.json()) as { features?: RetrieveFeature[] };
  // Rotate token regardless of result — the suggest/retrieve pair
  // is billed as one session whether or not the feature resolved.
  // Drop the suggest cache too: keys embed the old token, and reusing
  // an old session's suggestions across the token rotation would let
  // the next retrieve land outside its session.
  sessionToken = newSessionToken();
  suggestCache.clear();

  const feat = data.features?.[0];
  if (!feat) return null;
  const coords = feat.geometry?.coordinates;
  if (!coords || coords.length < 2) return null;
  const props = feat.properties ?? {};
  return {
    id: props.mapbox_id ?? suggestion.mapboxId,
    name: props.name_preferred ?? props.name ?? suggestion.name,
    context: trimSubtitle(props.place_formatted) || suggestion.context,
    lng: coords[0],
    lat: coords[1],
  };
}

/**
 * Debounced wrapper around `suggestPlaces`. Holds a single pending
 * request internally; subsequent calls within the debounce window
 * cancel and replace the in-flight request.
 *
 * Errors (other than AbortError) surface to the caller two ways:
 *   • `onResult([])` is still called so the UI can clear stale rows.
 *   • `onError` (optional) is called so the UI can distinguish
 *     "no matches" from "service unavailable" and render a notice.
 *
 * The split exists because riders previously saw a generic "No
 * matches" empty state when the proxy returned 503 (e.g. missing
 * `MAPBOX_TOKEN` on deploy), giving no signal that address search
 * itself was broken — see PR description for the incident.
 */
export function makeDebouncedSuggester(
  delayMs: number = 250,
): (
  query: string,
  options: Parameters<typeof suggestPlaces>[1] | undefined,
  onResult: (results: Suggestion[]) => void,
  onError?: () => void,
) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let abort: AbortController | null = null;
  return (query, options, onResult, onError) => {
    if (timer) clearTimeout(timer);
    if (abort) abort.abort();
    timer = setTimeout(() => {
      abort = new AbortController();
      const opts = { ...(options ?? {}), signal: abort.signal };
      suggestPlaces(query, opts)
        .then(onResult)
        .catch((err: unknown) => {
          if (
            err &&
            typeof err === "object" &&
            "name" in err &&
            (err as { name?: string }).name === "AbortError"
          ) {
            return;
          }
          // Surface real failures (missing token, 401, 429, network)
          // through the observability shim — autocomplete still
          // degrades to "no results" so the rider isn't stuck, but a
          // silent miss has historically hidden config errors during
          // deploy rollouts.
          captureWarning("Mapbox suggest failed", {
            error: err instanceof Error ? err.message : String(err),
          });
          onResult([]);
          onError?.();
        });
    }, delayMs);
  };
}
