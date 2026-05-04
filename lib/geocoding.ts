"use client";

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

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return [];

  const url = new URL("https://api.mapbox.com/search/searchbox/v1/suggest");
  url.searchParams.set("q", trimmed);
  url.searchParams.set("access_token", token);
  url.searchParams.set("session_token", sessionToken);
  url.searchParams.set("limit", String(Math.min(options.limit ?? 10, 10)));
  url.searchParams.set("bbox", NYC_BBOX);
  url.searchParams.set(
    "types",
    "poi,category,address,street,neighborhood,locality,place",
  );
  url.searchParams.set("country", "us");
  if (options.proximity) {
    url.searchParams.set(
      "proximity",
      `${options.proximity.lng},${options.proximity.lat}`,
    );
  }
  url.searchParams.set("language", "en");

  const res = await fetch(url.toString(), { signal: options.signal });
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
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return null;

  const url = new URL(
    `https://api.mapbox.com/search/searchbox/v1/retrieve/${encodeURIComponent(
      suggestion.mapboxId,
    )}`,
  );
  url.searchParams.set("access_token", token);
  url.searchParams.set("session_token", sessionToken);

  const res = await fetch(url.toString(), { signal: options.signal });
  if (!res.ok) {
    throw new Error(`Mapbox Search Box retrieve HTTP ${res.status}`);
  }
  const data = (await res.json()) as { features?: RetrieveFeature[] };
  // Rotate token regardless of result — the suggest/retrieve pair
  // is billed as one session whether or not the feature resolved.
  sessionToken = newSessionToken();

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
 * cancel and replace the in-flight request. Errors (other than
 * AbortError) surface as an empty result so autocomplete UIs handle
 * "no results" gracefully.
 */
export function makeDebouncedSuggester(
  delayMs: number = 250,
): (
  query: string,
  options: Parameters<typeof suggestPlaces>[1] | undefined,
  onResult: (results: Suggestion[]) => void,
) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let abort: AbortController | null = null;
  return (query, options, onResult) => {
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
          onResult([]);
        });
    }, delayMs);
  };
}
