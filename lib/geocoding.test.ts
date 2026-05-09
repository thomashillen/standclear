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
