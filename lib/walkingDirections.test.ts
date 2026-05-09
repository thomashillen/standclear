// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";

// fetchWalkingRoute holds an in-memory cache and a module-level fetch
// reference; reset modules between tests so each starts clean.
async function freshImport() {
  vi.resetModules();
  // No token stub needed — walkingDirections.ts calls /api/walk (server proxy)
  // and the fetch spy intercepts that call directly.
  return await import("./walkingDirections");
}

describe("fetchWalkingRoute — short-walk shortcut", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("synthesizes a straight-line route under the short-walk threshold without hitting fetch", async () => {
    const { fetchWalkingRoute } = await freshImport();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    // ~30m apart in NYC — well under the 80m threshold.
    const from = { lng: -73.9857, lat: 40.7484 };
    const to = { lng: -73.9854, lat: 40.7484 };
    const route = await fetchWalkingRoute(from, to);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(route).not.toBeNull();
    expect(route!.coordinates.length).toBe(2);
    expect(route!.coordinates[0]).toEqual([from.lng, from.lat]);
    expect(route!.coordinates[1]).toEqual([to.lng, to.lat]);
    // Distance & duration should be sane positives, not NaN / 0 / negatives.
    expect(route!.distance).toBeGreaterThan(0);
    expect(route!.distance).toBeLessThan(80);
    expect(route!.duration).toBeGreaterThan(0);
    expect(route!.steps.length).toBe(1);
  });

  it("hits the Directions API for walks beyond the threshold", async () => {
    const { fetchWalkingRoute } = await freshImport();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          routes: [
            {
              distance: 500,
              duration: 360,
              geometry: { coordinates: [[-73.99, 40.75], [-73.985, 40.748]] },
              legs: [],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    // ~500m apart — well above the 80m threshold.
    const from = { lng: -73.99, lat: 40.75 };
    const to = { lng: -73.985, lat: 40.748 };
    const route = await fetchWalkingRoute(from, to);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(route).not.toBeNull();
    expect(route!.distance).toBe(500);
  });

  it("drops the cache on HTTP failure so a retry can refetch", async () => {
    const { fetchWalkingRoute, clearWalkingRouteCache } = await freshImport();
    const from = { lng: -73.99, lat: 40.75 };
    const to = { lng: -73.985, lat: 40.748 };

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("server error", { status: 500 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            routes: [
              {
                distance: 500,
                duration: 360,
                geometry: { coordinates: [[-73.99, 40.75], [-73.985, 40.748]] },
                legs: [],
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const first = await fetchWalkingRoute(from, to);
    expect(first).toBeNull();

    // Without the cache-on-failure drop, this second call would hit
    // the cached null and never re-issue the network request.
    const second = await fetchWalkingRoute(from, to);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(second).not.toBeNull();
    expect(second!.distance).toBe(500);

    // clearWalkingRouteCache is exported for explicit retry use.
    expect(typeof clearWalkingRouteCache).toBe("function");
  });
});
