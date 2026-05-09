// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";

async function freshImport() {
  vi.resetModules();
  // No token stub needed — geocoding.ts calls /api/geocode (server proxy)
  // and the fetch spy intercepts that call directly.
  return await import("./geocoding");
}

function mockSuggestResponse(name: string, id = "feature-1") {
  return new Response(
    JSON.stringify({
      suggestions: [
        {
          mapbox_id: id,
          name,
          place_formatted: "New York, NY, United States",
          feature_type: "address",
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("suggestPlaces — session cache", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("caches results for identical query + proximity within a session", async () => {
    const { suggestPlaces } = await freshImport();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(mockSuggestResponse("Broadway"));

    const a = await suggestPlaces("broadway");
    const b = await suggestPlaces("broadway");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(a[0].name).toBe("Broadway");
  });

  it("caches per-query — distinct prefixes each issue a request", async () => {
    const { suggestPlaces } = await freshImport();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url) => {
        const q = new URL(String(url), "http://localhost").searchParams.get("q") ?? "";
        return mockSuggestResponse(q);
      });

    await suggestPlaces("br");
    await suggestPlaces("bro");
    await suggestPlaces("br"); // cache hit

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("invalidates the cache when retrievePlace rotates the session token", async () => {
    const { suggestPlaces, retrievePlace } = await freshImport();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url) => {
        const u = String(url);
        if (u.includes("action=suggest")) return mockSuggestResponse("Broadway");
        if (u.includes("action=retrieve"))
          return new Response(
            JSON.stringify({
              features: [
                {
                  geometry: { coordinates: [-73.99, 40.75] },
                  properties: { mapbox_id: "feature-1", name: "Broadway" },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        return new Response("404", { status: 404 });
      });

    await suggestPlaces("broadway");
    await retrievePlace({ mapboxId: "feature-1", name: "Broadway", context: "" });
    await suggestPlaces("broadway"); // post-rotation; should re-fetch

    const suggestCalls = fetchSpy.mock.calls.filter((c) =>
      String(c[0]).includes("action=suggest"),
    );
    expect(suggestCalls.length).toBe(2);
  });

  it("returns [] for queries shorter than two characters without calling fetch", async () => {
    const { suggestPlaces } = await freshImport();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    expect(await suggestPlaces("")).toEqual([]);
    expect(await suggestPlaces("a")).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("makeDebouncedSuggester — error reporting", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });

  // Riders previously saw a generic "no matches" empty state when
  // the proxy returned 5xx (e.g. missing MAPBOX_TOKEN on deploy).
  // The debouncer now reports failures via an optional onError so
  // the UI can show a distinct "address search unavailable" notice.
  it("invokes onError when the proxy fetch rejects", async () => {
    const { makeDebouncedSuggester } = await freshImport();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Service Unavailable", { status: 503 }),
    );

    const onResult = vi.fn();
    const onError = vi.fn();
    const debounced = makeDebouncedSuggester(0);
    debounced("550 madison", undefined, onResult, onError);

    await vi.runAllTimersAsync();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onResult).toHaveBeenCalledWith([]);
  });

  it("does not invoke onError when the result is a plain empty list", async () => {
    const { makeDebouncedSuggester } = await freshImport();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ suggestions: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const onResult = vi.fn();
    const onError = vi.fn();
    const debounced = makeDebouncedSuggester(0);
    debounced("zzznomatch", undefined, onResult, onError);

    await vi.runAllTimersAsync();
    await vi.waitFor(() => expect(onResult).toHaveBeenCalledWith([]));
    expect(onError).not.toHaveBeenCalled();
  });
});
