// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";

// captureWarning is mocked module-wide so the assertion is per-call
// rather than per-process — every `freshImport()` re-binds the spy to
// the freshly evaluated module graph below. Hoisted because vi.mock is.
const { captureWarningMock } = vi.hoisted(() => ({
  captureWarningMock: vi.fn(),
}));
vi.mock("./observability", () => ({
  captureWarning: captureWarningMock,
  // Other exports aren't used by walkingDirections.ts but keep the
  // shape compatible in case the surface grows.
  captureException: vi.fn(),
  logEvent: vi.fn(),
}));

// fetchWalkingRoute holds an in-memory cache and a module-level fetch
// reference; reset modules between tests so each starts clean.
async function freshImport() {
  vi.resetModules();
  captureWarningMock.mockClear();
  // No token stub needed — walkingDirections.ts calls /api/walk (server proxy)
  // and the fetch spy intercepts that call directly.
  return await import("./walkingDirections");
}

function okRouteResponse(distance = 500, duration = 360) {
  return new Response(
    JSON.stringify({
      routes: [
        {
          distance,
          duration,
          geometry: {
            coordinates: [
              [-73.99, 40.75],
              [-73.985, 40.748],
            ],
          },
          legs: [],
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
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

describe("fetchWalkingRoute — caching, abort, and error reporting", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns the cached promise on a second call without re-hitting fetch", async () => {
    // First successful call seeds the cache. Second call with the same
    // pair must reuse the cached promise — the trip overlay can render
    // the same dashed walk leg on every re-render without re-issuing.
    const { fetchWalkingRoute } = await freshImport();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(okRouteResponse(420, 300));

    const from = { lng: -73.99, lat: 40.75 };
    const to = { lng: -73.985, lat: 40.748 };

    const first = await fetchWalkingRoute(from, to);
    const second = await fetchWalkingRoute(from, to);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second!.distance).toBe(420);
  });

  it("collapses near-identical coordinate pairs onto the same cache entry (~1m rounding)", async () => {
    // Round-to-5dp = ~1.1m at NYC latitude. A re-render that recomputes
    // the destination by a sub-meter jitter should hit the cache, not
    // burn another /api/walk call.
    const { fetchWalkingRoute } = await freshImport();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okRouteResponse());

    const from = { lng: -73.99, lat: 40.75 };
    const to = { lng: -73.985, lat: 40.748 };
    // 1e-7 jitter is well below the 5dp rounding floor (1e-5) so the
    // cache key collapses to the same string.
    const toJittered = { lng: -73.985 + 1e-7, lat: 40.748 - 1e-7 };

    await fetchWalkingRoute(from, to);
    await fetchWalkingRoute(from, toJittered);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("clearWalkingRouteCache lets a subsequent call refetch the network", async () => {
    // The directions panel exposes a retry button after a failure; the
    // explicit-clear path needs to actually drop the cache entry so the
    // next call goes back to the network instead of returning whatever
    // landed in the cache previously.
    const { fetchWalkingRoute, clearWalkingRouteCache } = await freshImport();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(okRouteResponse(500, 360))
      .mockResolvedValueOnce(okRouteResponse(600, 420));

    const from = { lng: -73.99, lat: 40.75 };
    const to = { lng: -73.985, lat: 40.748 };

    const first = await fetchWalkingRoute(from, to);
    expect(first!.distance).toBe(500);

    clearWalkingRouteCache(from, to);

    const second = await fetchWalkingRoute(from, to);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(second!.distance).toBe(600);
  });

  it("returns null and drops the cache when Mapbox returns an empty routes array", async () => {
    // The API can legitimately return 200 with `routes: []` for endpoint
    // pairs Mapbox couldn't snap to its walking graph (e.g. inside a
    // tunnel, off-network island). Caller must see null and the cache
    // must drop so a different pair (e.g. retried with a nudged origin)
    // gets a fresh call.
    const { fetchWalkingRoute } = await freshImport();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ routes: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(okRouteResponse());

    const from = { lng: -73.99, lat: 40.75 };
    const to = { lng: -73.985, lat: 40.748 };

    const first = await fetchWalkingRoute(from, to);
    expect(first).toBeNull();

    const second = await fetchWalkingRoute(from, to);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(second).not.toBeNull();
  });

  it("treats AbortError as a silent cancellation — null result, no warning emitted", async () => {
    // The trip panel cancels in-flight walking-directions fetches when
    // the rider switches plans or closes the sheet. The abort is
    // expected; surfacing it through captureWarning would create noise
    // in operator logs that swamps real failures.
    const { fetchWalkingRoute } = await freshImport();
    const abortErr = new DOMException("aborted", "AbortError");
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(abortErr);

    const from = { lng: -73.99, lat: 40.75 };
    const to = { lng: -73.985, lat: 40.748 };
    const result = await fetchWalkingRoute(from, to);

    expect(result).toBeNull();
    expect(captureWarningMock).not.toHaveBeenCalled();
  });

  it("surfaces non-abort failures via captureWarning so the silent fallback is operator-visible", async () => {
    // Real failures (rate limit, 401, network drop) need to reach the
    // operator's log sink — the rider keeps seeing the dashed crow-flies
    // fallback so the UI doesn't break, but a degraded experience must
    // be visible or it stays a silent regression forever.
    const { fetchWalkingRoute } = await freshImport();
    const networkErr = new TypeError("Failed to fetch");
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(networkErr);

    const from = { lng: -73.99, lat: 40.75 };
    const to = { lng: -73.985, lat: 40.748 };
    const result = await fetchWalkingRoute(from, to);

    expect(result).toBeNull();
    expect(captureWarningMock).toHaveBeenCalledTimes(1);
    const [message, fields] = captureWarningMock.mock.calls[0];
    expect(message).toBe("Mapbox walking directions failed");
    expect((fields as { error: string }).error).toBe("Failed to fetch");
  });

  it("drops the cache after a failure so the next call refetches (not a sticky null)", async () => {
    // Cross-checks the same invariant from the HTTP path: a cached null
    // would shadow a healthy retry. The catch block has its own
    // cache.delete; this pins the behavior at the rejection path
    // (separate from the `!res.ok` branch already covered above).
    const { fetchWalkingRoute } = await freshImport();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(okRouteResponse());

    const from = { lng: -73.99, lat: 40.75 };
    const to = { lng: -73.985, lat: 40.748 };

    const first = await fetchWalkingRoute(from, to);
    expect(first).toBeNull();

    const second = await fetchWalkingRoute(from, to);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(second).not.toBeNull();
  });
});

describe("fetchWalkingRoute — step instruction synthesis", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("uses maneuver.instruction verbatim when present", async () => {
    const { fetchWalkingRoute } = await freshImport();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          routes: [
            {
              distance: 500,
              duration: 360,
              geometry: { coordinates: [[-73.99, 40.75], [-73.985, 40.748]] },
              legs: [
                {
                  steps: [
                    {
                      distance: 200,
                      duration: 150,
                      name: "Broadway",
                      geometry: { coordinates: [[-73.99, 40.75], [-73.987, 40.749]] },
                      maneuver: {
                        instruction: "Turn right onto Broadway",
                        type: "turn",
                        modifier: "right",
                      },
                    },
                  ],
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const route = await fetchWalkingRoute(
      { lng: -73.99, lat: 40.75 },
      { lng: -73.985, lat: 40.748 },
    );

    expect(route!.steps).toHaveLength(1);
    const step = route!.steps[0];
    expect(step.instruction).toBe("Turn right onto Broadway");
    expect(step.streetName).toBe("Broadway");
    expect(step.maneuver).toBe("turn");
    expect(step.modifier).toBe("right");
  });

  it("synthesizes 'Continue on <street>' when maneuver.instruction is absent but the step is named", async () => {
    // The Directions API occasionally omits `maneuver.instruction` on
    // straight-segment continuations; the fallback should still give
    // the rider a readable step rather than a blank row.
    const { fetchWalkingRoute } = await freshImport();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          routes: [
            {
              distance: 300,
              duration: 220,
              geometry: { coordinates: [[-73.99, 40.75], [-73.985, 40.748]] },
              legs: [
                {
                  steps: [
                    {
                      distance: 300,
                      duration: 220,
                      name: "Main St",
                      geometry: { coordinates: [[-73.99, 40.75], [-73.985, 40.748]] },
                      maneuver: { type: "continue" },
                    },
                  ],
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const route = await fetchWalkingRoute(
      { lng: -73.99, lat: 40.75 },
      { lng: -73.985, lat: 40.748 },
    );

    expect(route!.steps[0].instruction).toBe("Continue on Main St");
    expect(route!.steps[0].streetName).toBe("Main St");
  });

  it("falls back to a bare 'Continue' when both maneuver.instruction and name are missing", async () => {
    // Path / pedestrian segments through plazas and crossings often
    // arrive nameless; the fallback ladder bottoms out at "Continue"
    // rather than rendering the literal string "undefined".
    const { fetchWalkingRoute } = await freshImport();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          routes: [
            {
              distance: 100,
              duration: 70,
              geometry: { coordinates: [[-73.99, 40.75], [-73.985, 40.748]] },
              legs: [
                {
                  steps: [
                    {
                      distance: 100,
                      duration: 70,
                      geometry: { coordinates: [[-73.99, 40.75], [-73.985, 40.748]] },
                    },
                  ],
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const route = await fetchWalkingRoute(
      { lng: -73.99, lat: 40.75 },
      { lng: -73.985, lat: 40.748 },
    );

    expect(route!.steps[0].instruction).toBe("Continue");
    expect(route!.steps[0].streetName).toBeUndefined();
    expect(route!.steps[0].maneuver).toBeUndefined();
    expect(route!.steps[0].modifier).toBeUndefined();
  });

  it("normalizes an empty-string `name` to undefined `streetName` so callers can `if (streetName)`", async () => {
    // Mapbox returns "" for pedestrian-path segments that aren't
    // associated with a named street. Surfacing the empty string would
    // force every UI to `step.streetName?.trim()` defensively; the
    // helper handles the normalization once.
    const { fetchWalkingRoute } = await freshImport();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          routes: [
            {
              distance: 50,
              duration: 36,
              geometry: { coordinates: [[-73.99, 40.75], [-73.985, 40.748]] },
              legs: [
                {
                  steps: [
                    {
                      distance: 50,
                      duration: 36,
                      name: "",
                      geometry: { coordinates: [[-73.99, 40.75], [-73.985, 40.748]] },
                      maneuver: { instruction: "Cross the plaza" },
                    },
                  ],
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const route = await fetchWalkingRoute(
      { lng: -73.99, lat: 40.75 },
      { lng: -73.985, lat: 40.748 },
    );

    expect(route!.steps[0].instruction).toBe("Cross the plaza");
    expect(route!.steps[0].streetName).toBeUndefined();
  });

  it("flattens steps across multiple legs in travel order", async () => {
    // The Directions API can return multi-leg routes when a viewpoint
    // splits the path; the helper concatenates legs[].steps in order
    // so the rider sees one continuous step list, not a per-leg
    // breakdown.
    const { fetchWalkingRoute } = await freshImport();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          routes: [
            {
              distance: 500,
              duration: 360,
              geometry: { coordinates: [[-73.99, 40.75], [-73.985, 40.748]] },
              legs: [
                {
                  steps: [
                    {
                      distance: 100,
                      duration: 70,
                      name: "Broadway",
                      geometry: { coordinates: [[-73.99, 40.75], [-73.989, 40.7495]] },
                      maneuver: { instruction: "Walk south on Broadway" },
                    },
                    {
                      distance: 150,
                      duration: 110,
                      name: "42 St",
                      geometry: { coordinates: [[-73.989, 40.7495], [-73.987, 40.749]] },
                      maneuver: { instruction: "Turn left onto 42 St" },
                    },
                  ],
                },
                {
                  steps: [
                    {
                      distance: 250,
                      duration: 180,
                      name: "5 Av",
                      geometry: { coordinates: [[-73.987, 40.749], [-73.985, 40.748]] },
                      maneuver: { instruction: "Turn right onto 5 Av" },
                    },
                  ],
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const route = await fetchWalkingRoute(
      { lng: -73.99, lat: 40.75 },
      { lng: -73.985, lat: 40.748 },
    );

    expect(route!.steps).toHaveLength(3);
    expect(route!.steps.map((s) => s.instruction)).toEqual([
      "Walk south on Broadway",
      "Turn left onto 42 St",
      "Turn right onto 5 Av",
    ]);
  });
});
