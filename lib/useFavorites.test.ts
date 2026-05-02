import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

// useFavorites holds its loaded state in a module-level `cache` variable
// to coordinate across multiple subscribers. Each test needs a fresh
// module to start from a clean slate; vi.resetModules() + dynamic
// import accomplishes that.
async function freshImport() {
  vi.resetModules();
  return await import("./useFavorites");
}

describe("useFavorites — toggle", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts empty when storage has nothing", async () => {
    const { useFavorites } = await freshImport();
    const { result } = renderHook(() => useFavorites());
    expect(result.current.favorites.size).toBe(0);
    expect(result.current.has("635")).toBe(false);
  });

  it("toggles a stopId on and off", async () => {
    const { useFavorites } = await freshImport();
    const { result } = renderHook(() => useFavorites());

    act(() => result.current.toggle("635"));
    expect(result.current.has("635")).toBe(true);
    expect(result.current.favorites.has("635")).toBe(true);

    act(() => result.current.toggle("635"));
    expect(result.current.has("635")).toBe(false);
  });

  it("persists toggles to localStorage under the v3 key", async () => {
    const { useFavorites } = await freshImport();
    const { result } = renderHook(() => useFavorites());
    act(() => result.current.toggle("635"));

    const raw = localStorage.getItem("standclear:commute:v3");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as { favorites: string[] };
    expect(parsed.favorites).toContain("635");
  });
});

describe("useFavorites — migrations", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("migrates v1 favorites array into the v3 shape", async () => {
    localStorage.setItem(
      "subwaysurfer:favorites:v1",
      JSON.stringify(["635", "L03"]),
    );
    const { useFavorites, useCommute } = await freshImport();
    const { result: favs } = renderHook(() => useFavorites());
    const { result: commute } = renderHook(() => useCommute());

    expect(favs.current.favorites.has("635")).toBe(true);
    expect(favs.current.favorites.has("L03")).toBe(true);
    expect(commute.current.home).toBeNull();
    expect(commute.current.work).toBeNull();

    // Migration should have written a v3 record.
    const v3 = localStorage.getItem("standclear:commute:v3");
    expect(v3).not.toBeNull();
  });

  it("migrates v2 string-keyed home/work into the v3 station shape", async () => {
    localStorage.setItem(
      "subwaysurfer:commute:v2",
      JSON.stringify({ home: "635", work: "631", favorites: ["L03"] }),
    );
    const { useCommute, useFavorites } = await freshImport();
    const { result: commute } = renderHook(() => useCommute());
    const { result: favs } = renderHook(() => useFavorites());

    expect(commute.current.home).toEqual({ kind: "station", stopId: "635" });
    expect(commute.current.work).toEqual({ kind: "station", stopId: "631" });
    expect(favs.current.favorites.has("L03")).toBe(true);
  });

  it("reads a v3 record with an address anchor as-is", async () => {
    localStorage.setItem(
      "standclear:commute:v3",
      JSON.stringify({
        home: { kind: "address", name: "123 Main St", lng: -73.99, lat: 40.73 },
        work: { kind: "station", stopId: "631" },
        favorites: ["635"],
      }),
    );
    const { useCommute } = await freshImport();
    const { result } = renderHook(() => useCommute());
    expect(result.current.home).toEqual({
      kind: "address",
      name: "123 Main St",
      lng: -73.99,
      lat: 40.73,
    });
    expect(result.current.work).toEqual({ kind: "station", stopId: "631" });
  });

  it("forwards a pre-rename subwaysurfer:commute:v3 record into the new key", async () => {
    localStorage.setItem(
      "subwaysurfer:commute:v3",
      JSON.stringify({
        home: { kind: "station", stopId: "635" },
        work: { kind: "station", stopId: "631" },
        favorites: ["L03"],
      }),
    );
    const { useCommute, useFavorites } = await freshImport();
    const { result: commute } = renderHook(() => useCommute());
    const { result: favs } = renderHook(() => useFavorites());

    expect(commute.current.home).toEqual({ kind: "station", stopId: "635" });
    expect(commute.current.work).toEqual({ kind: "station", stopId: "631" });
    expect(favs.current.favorites.has("L03")).toBe(true);

    // The legacy record should have been re-written under the new key.
    const newKey = localStorage.getItem("standclear:commute:v3");
    expect(newKey).not.toBeNull();
  });

  it("falls back to empty state when v3 JSON is corrupt", async () => {
    localStorage.setItem("standclear:commute:v3", "{not json");
    const { useFavorites, useCommute } = await freshImport();
    const { result: favs } = renderHook(() => useFavorites());
    const { result: commute } = renderHook(() => useCommute());
    expect(favs.current.favorites.size).toBe(0);
    expect(commute.current.home).toBeNull();
    expect(commute.current.work).toBeNull();
  });
});

describe("useCommute — anchor assignment", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("auto-favorites the station when assigning home or work", async () => {
    const { useCommute, useFavorites } = await freshImport();
    const { result: commute } = renderHook(() => useCommute());
    const { result: favs } = renderHook(() => useFavorites());

    act(() => commute.current.assignAnchor("home", "635"));
    expect(favs.current.has("635")).toBe(true);
    expect(commute.current.home).toEqual({ kind: "station", stopId: "635" });
    expect(commute.current.isHome("635")).toBe(true);
  });

  it("clears the other anchor if assigning the same station to both", async () => {
    const { useCommute } = await freshImport();
    const { result } = renderHook(() => useCommute());

    act(() => result.current.assignAnchor("work", "635"));
    expect(result.current.work).toEqual({ kind: "station", stopId: "635" });
    expect(result.current.home).toBeNull();

    act(() => result.current.assignAnchor("home", "635"));
    // Same station — work should now be cleared.
    expect(result.current.home).toEqual({ kind: "station", stopId: "635" });
    expect(result.current.work).toBeNull();
  });

  it("keeps the other anchor when assigning a DIFFERENT station", async () => {
    const { useCommute } = await freshImport();
    const { result } = renderHook(() => useCommute());

    act(() => result.current.assignAnchor("work", "631"));
    act(() => result.current.assignAnchor("home", "635"));
    expect(result.current.work).toEqual({ kind: "station", stopId: "631" });
    expect(result.current.home).toEqual({ kind: "station", stopId: "635" });
    expect(result.current.anchorOf("631")).toBe("work");
    expect(result.current.anchorOf("635")).toBe("home");
    expect(result.current.anchorOf("L03")).toBeNull();
  });

  it("assigns an address as an anchor without polluting favorites", async () => {
    const { useCommute, useFavorites } = await freshImport();
    const { result: commute } = renderHook(() => useCommute());
    const { result: favs } = renderHook(() => useFavorites());

    act(() =>
      commute.current.assignAnchorAddress("home", {
        name: "Cafe",
        lng: -73.99,
        lat: 40.73,
      }),
    );
    expect(commute.current.home).toEqual({
      kind: "address",
      name: "Cafe",
      lng: -73.99,
      lat: 40.73,
    });
    expect(favs.current.favorites.size).toBe(0);
    // anchorOf only matches station anchors — addresses don't have stopIds.
    expect(commute.current.anchorOf("anything")).toBeNull();
    expect(commute.current.isHome("anything")).toBe(false);
  });

  it("clears the other anchor when assigning the same address to both sides", async () => {
    const { useCommute } = await freshImport();
    const { result } = renderHook(() => useCommute());

    const addr = { name: "Cafe", lng: -73.99, lat: 40.73 };
    act(() => result.current.assignAnchorAddress("work", addr));
    act(() => result.current.assignAnchorAddress("home", addr));
    expect(result.current.home).toEqual({ kind: "address", ...addr });
    expect(result.current.work).toBeNull();
  });

  it("setAnchor(null) clears the anchor without touching favorites", async () => {
    const { useCommute, useFavorites } = await freshImport();
    const { result: commute } = renderHook(() => useCommute());
    const { result: favs } = renderHook(() => useFavorites());

    act(() => commute.current.assignAnchor("home", "635"));
    expect(favs.current.has("635")).toBe(true);

    act(() => commute.current.setAnchor("home", null));
    expect(commute.current.home).toBeNull();
    // Favorite stays — assignAnchor added it, setAnchor doesn't undo that.
    expect(favs.current.has("635")).toBe(true);
  });
});
