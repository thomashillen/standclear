"use client";

/**
 * Mapbox Search Box `/forward` helper. Resolves a free-text query
 * (address, neighborhood, restaurant, business, landmark) into one
 * or more `Place` results with lat/lng. The trip planner uses these
 * to let riders search for "shake shack" or "123 Main St" instead
 * of only known subway station names — the picked place is then
 * mapped to its nearest station for the actual subway routing leg,
 * with a walk step from the address to that station.
 *
 * Uses the Search Box `/forward` single-call endpoint (not the
 * legacy v5 geocoder, which had thin POI/business coverage —
 * "shake shack", "joe's pizza", and most local restaurants didn't
 * resolve). Search Box ships Mapbox's full POI dataset, including
 * restaurants, cafes, bars, shops, and chain brands, while still
 * returning coordinates inline so we don't need a two-step
 * suggest+retrieve flow.
 *
 * Bounded to NYC (rough bbox covering the five boroughs + a buffer
 * for nearby commuter destinations) so we don't get noise from the
 * rest of the country. Proximity-biased to the rider's current
 * location when known, so a search for "Broadway" in Brooklyn
 * surfaces the right Broadway, not Manhattan's.
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

interface SearchBoxFeature {
  type?: "Feature";
  geometry?: { coordinates?: [number, number] };
  properties?: {
    mapbox_id?: string;
    name?: string;
    name_preferred?: string;
    place_formatted?: string;
    full_address?: string;
    address?: string;
    feature_type?: string;
  };
}

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

  const url = new URL("https://api.mapbox.com/search/searchbox/v1/forward");
  url.searchParams.set("q", trimmed);
  url.searchParams.set("access_token", token);
  // Search Box /forward caps `limit` at 10. Same ceiling as the v5
  // path — gives the ranker enough room to mix POIs and addresses.
  url.searchParams.set("limit", String(Math.min(options.limit ?? 10, 10)));
  url.searchParams.set("bbox", NYC_BBOX);
  // Include POI (restaurants, shops, landmarks) alongside the
  // geographic types riders also need. `category` lets queries like
  // "coffee" match POI categories rather than only literal names.
  url.searchParams.set(
    "types",
    "poi,category,address,street,neighborhood,locality,place",
  );
  // Constrain to US so a query like "broadway" doesn't bleed into
  // global namesakes. The bbox already restricts to NYC, but the
  // country hint also informs ranking.
  url.searchParams.set("country", "us");
  if (options.proximity) {
    url.searchParams.set(
      "proximity",
      `${options.proximity.lng},${options.proximity.lat}`,
    );
  }
  // English-language POI names — without this Mapbox occasionally
  // returns translated names for international chains (e.g. Cyrillic
  // for a Russian-named cafe), which is jarring in a NYC transit app.
  url.searchParams.set("language", "en");

  const res = await fetch(url.toString(), { signal: options.signal });
  if (!res.ok) {
    // Surface non-2xx so the caller can decide whether to ignore
    // (e.g., 429 rate limits) vs. retry. Body is small JSON; we
    // don't bother parsing it for the caller.
    throw new Error(`Mapbox Search Box HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    features?: SearchBoxFeature[];
  };

  if (!data.features) return [];

  const places: Place[] = [];
  for (const f of data.features) {
    const coords = f.geometry?.coordinates;
    if (!coords || coords.length < 2) continue;
    const props = f.properties ?? {};
    // `name` is the display title ("Shake Shack", "550 Madison Ave",
    // "Williamsburg"). `place_formatted` is the human-readable
    // subtitle ("New York, NY 10019"). Strip a trailing ", United
    // States" so the subtitle stays compact in narrow rows.
    const title = props.name_preferred ?? props.name ?? props.address ?? "";
    if (!title) continue;
    const subtitle = (props.place_formatted ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && s !== "United States" && s !== "USA")
      .join(", ");
    places.push({
      id: props.mapbox_id ?? `${coords[0]},${coords[1]}`,
      name: title,
      context: subtitle,
      lng: coords[0],
      lat: coords[1],
    });
  }
  return places;
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
