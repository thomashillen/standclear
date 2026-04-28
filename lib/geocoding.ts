"use client";

/**
 * Mapbox Forward Geocoding helper. Resolves a free-text query
 * (address, neighborhood, place name) into one or more `Place`
 * results with lat/lng. The trip planner uses these to let riders
 * search for "123 Main St" or "Williamsburg" instead of only known
 * subway station names — the picked place is then mapped to its
 * nearest station for the actual subway routing leg, with a walk
 * step from the address to that station.
 *
 * Bounded to NYC (rough bbox covering the five boroughs + a buffer
 * for nearby commuter destinations) so we don't get geocoding noise
 * from the rest of the country. Proximity-biased to the rider's
 * current location when known, so a search for "Broadway" in
 * Brooklyn surfaces the right Broadway, not Manhattan's.
 */

export interface Place {
  id: string;
  name: string;
  /** Subtitle — neighborhood, borough, or zip context. May be empty. */
  context: string;
  lng: number;
  lat: number;
}

// Roughly: Liberty State Park (SW) → Riverdale / LaGuardia (NE).
// Tuned to keep autocomplete results in the NYC subway-relevant
// region without clipping legitimate matches at the edges.
const NYC_BBOX = "-74.20,40.55,-73.70,40.92";

/**
 * Forward-geocode a query string. Returns up to `limit` ranked
 * places. Throws on network errors so the caller can debounce / show
 * a fallback. Returns [] for queries shorter than 2 characters
 * (Mapbox requires a minimum length).
 */
export async function geocodePlaces(
  query: string,
  options: {
    limit?: number;
    proximity?: { lng: number; lat: number };
    signal?: AbortSignal;
  } = {},
): Promise<Place[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return [];

  const url = new URL(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(trimmed)}.json`,
  );
  url.searchParams.set("access_token", token);
  // Bumped from 5 → 10 so business / POI results surface alongside
  // address matches. Mapbox can return a mix per query; with only 5
  // slots and addresses ranking high for ambiguous queries, named
  // places like restaurants, shops, and landmarks were getting
  // squeezed out. 10 gives the ranker enough room to include both.
  url.searchParams.set("limit", String(options.limit ?? 10));
  url.searchParams.set("bbox", NYC_BBOX);
  // POI listed first to nudge Mapbox's relevance ranker toward
  // returning businesses + landmarks alongside addresses. Order
  // doesn't strictly affect ranking but the documented hint helps
  // for ambiguous queries like "starbucks" vs "550 madison".
  url.searchParams.set(
    "types",
    "poi,address,neighborhood,locality,place",
  );
  if (options.proximity) {
    url.searchParams.set(
      "proximity",
      `${options.proximity.lng},${options.proximity.lat}`,
    );
  }
  url.searchParams.set("autocomplete", "true");
  // English-language POI names — without this Mapbox occasionally
  // returns translated names for international chains (e.g. Cyrillic
  // for a Russian-named cafe), which is jarring in a NYC transit app.
  url.searchParams.set("language", "en");

  const res = await fetch(url.toString(), { signal: options.signal });
  if (!res.ok) {
    // Surface non-2xx so the caller can decide whether to ignore
    // (e.g., 429 rate limits) vs. retry. Body is small JSON; we
    // don't bother parsing it for the caller.
    throw new Error(`Mapbox geocoding HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    features?: {
      id: string;
      text: string;
      place_name?: string;
      center: [number, number];
      context?: { text: string }[];
    }[];
  };

  if (!data.features) return [];

  return data.features.map((f) => {
    // For address features Mapbox stores the house number in `address`
    // and the street name in `text`. The full street address ("550
    // Madison Avenue") only appears in `place_name`. Using `text`
    // alone drops the number — wrong for a transit picker where the
    // exact building matters. Take the first comma-separated part of
    // `place_name`, which is "550 Madison Avenue" for addresses,
    // "Empire State Building" for POIs, "Williamsburg" for
    // neighborhoods. Cleanest single source for the display title.
    const fullName = f.place_name ?? f.text;
    const parts = fullName.split(",").map((s) => s.trim()).filter(Boolean);
    const title = parts[0] ?? f.text;
    // Drop the country tail if present — every result is in NYC.
    const ctx = parts
      .slice(1)
      .filter((p) => p !== "United States" && p !== "USA");
    return {
      id: f.id,
      name: title,
      context: ctx.join(", "),
      lng: f.center[0],
      lat: f.center[1],
    } satisfies Place;
  });
}

/**
 * Debounced wrapper. Holds a single pending request internally;
 * subsequent calls within the debounce window cancel and replace
 * the in-flight request. Matches the pattern useEffect-based
 * autocomplete callers expect.
 *
 * Returns a function the caller can invoke; the result is delivered
 * to the `onResult` callback (rather than returned directly) so the
 * caller doesn't need to await every keystroke. Errors are
 * swallowed except for AbortError, which is silent.
 */
export function makeDebouncedGeocoder(
  delayMs: number = 250,
): (
  query: string,
  options: Parameters<typeof geocodePlaces>[1] | undefined,
  onResult: (results: Place[]) => void,
) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let abort: AbortController | null = null;
  return (query, options, onResult) => {
    if (timer) clearTimeout(timer);
    if (abort) abort.abort();
    timer = setTimeout(() => {
      abort = new AbortController();
      const opts = { ...(options ?? {}), signal: abort.signal };
      geocodePlaces(query, opts)
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
          // Surface other failures via empty result rather than
          // throwing — autocomplete UIs handle "no results" gracefully.
          onResult([]);
        });
    }, delayMs);
  };
}
