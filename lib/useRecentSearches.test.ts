import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { Place } from "./geocoding";

async function freshImport() {
  vi.resetModules();
  return await import("./useRecentSearches");
}

const STORAGE_KEY = "standclear.recents.v1";
const LEGACY_STORAGE_KEY = "subwaysurfer.recents.v1";

function placeFixture(over: Partial<Place> = {}): Place {
  return {
    id: over.id ?? "p1",
    name: over.name ?? "Cafe",
    context: over.context ?? "Brooklyn, NY",
    lng: over.lng ?? -73.99,
    lat: over.lat ?? 40.73,
  };
}

describe("useRecentSearches", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts empty when storage is empty", async () => {
    const { useRecentSearches } = await freshImport();
    const { result } = renderHook(() => useRecentSearches());
    expect(result.current.recents).toEqual([]);
  });

  it("adds a station and dedupes repeat picks (newest first)", async () => {
    const { useRecentSearches } = await freshImport();
    const { result } = renderHook(() => useRecentSearches());

    act(() => result.current.addStation("635", "14 St-Union Sq"));
    act(() => result.current.addStation("631", "Grand Central"));
    act(() => result.current.addStation("635", "14 St-Union Sq"));

    expect(result.current.recents).toHaveLength(2);
    expect(result.current.recents[0]).toMatchObject({
      kind: "station",
      stopId: "635",
    });
    expect(result.current.recents[1]).toMatchObject({
      kind: "station",
      stopId: "631",
    });
  });

  it("caps history at 10 items, dropping the oldest", async () => {
    const { useRecentSearches } = await freshImport();
    const { result } = renderHook(() => useRecentSearches());
    for (let i = 0; i < 12; i++) {
      act(() => result.current.addStation(`stop-${i}`, `Stop ${i}`));
    }
    expect(result.current.recents).toHaveLength(10);
    // Newest at the head — stop-11.
    expect(result.current.recents[0]).toMatchObject({ stopId: "stop-11" });
    // Oldest two (stop-0, stop-1) should have been dropped.
    expect(
      result.current.recents.find(
        (r) => r.kind === "station" && r.stopId === "stop-0",
      ),
    ).toBeUndefined();
  });

  it("dedupes places by Mapbox feature id", async () => {
    const { useRecentSearches } = await freshImport();
    const { result } = renderHook(() => useRecentSearches());
    act(() => result.current.addPlace(placeFixture({ id: "abc", name: "A" })));
    act(() => result.current.addPlace(placeFixture({ id: "abc", name: "A" })));
    expect(result.current.recents).toHaveLength(1);
  });

  it("dedupes places by name + coords when ids differ", async () => {
    const { useRecentSearches } = await freshImport();
    const { result } = renderHook(() => useRecentSearches());
    act(() =>
      result.current.addPlace(
        placeFixture({ id: "id-old", name: "Cafe", lng: -73.99, lat: 40.73 }),
      ),
    );
    act(() =>
      result.current.addPlace(
        placeFixture({ id: "id-new", name: "Cafe", lng: -73.99, lat: 40.73 }),
      ),
    );
    expect(result.current.recents).toHaveLength(1);
    expect(result.current.recents[0]).toMatchObject({ id: "id-new" });
  });

  it("removeRecent strips a station by stopId and a place by id", async () => {
    const { useRecentSearches } = await freshImport();
    const { result } = renderHook(() => useRecentSearches());
    act(() => result.current.addStation("635", "Union Sq"));
    act(() => result.current.addPlace(placeFixture({ id: "p-1" })));
    expect(result.current.recents).toHaveLength(2);

    act(() => result.current.removeRecent("635"));
    expect(result.current.recents).toHaveLength(1);
    act(() => result.current.removeRecent("p-1"));
    expect(result.current.recents).toHaveLength(0);
  });

  it("clear empties recents and persists the empty state", async () => {
    const { useRecentSearches } = await freshImport();
    const { result } = renderHook(() => useRecentSearches());
    act(() => result.current.addStation("635", "Union Sq"));
    act(() => result.current.clear());
    expect(result.current.recents).toEqual([]);
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({ v: 1, items: [] });
  });

  it("ignores stored data with the wrong version tag", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ v: 99, items: [{ kind: "station", stopId: "X", name: "X", addedAt: 0 }] }),
    );
    const { useRecentSearches } = await freshImport();
    const { result } = renderHook(() => useRecentSearches());
    expect(result.current.recents).toEqual([]);
  });

  it("ignores corrupt JSON in storage", async () => {
    localStorage.setItem(STORAGE_KEY, "{not-json");
    const { useRecentSearches } = await freshImport();
    const { result } = renderHook(() => useRecentSearches());
    expect(result.current.recents).toEqual([]);
  });

  it("reads from the pre-rename subwaysurfer.recents.v1 key when the new key is absent", async () => {
    localStorage.setItem(
      LEGACY_STORAGE_KEY,
      JSON.stringify({
        v: 1,
        items: [{ kind: "station", stopId: "635", name: "Union Sq", addedAt: 0 }],
      }),
    );
    const { useRecentSearches } = await freshImport();
    const { result } = renderHook(() => useRecentSearches());
    expect(result.current.recents).toHaveLength(1);
    expect(result.current.recents[0]).toMatchObject({ stopId: "635" });
  });

  it("falls back to legacy recents when the new key is corrupt", async () => {
    localStorage.setItem(STORAGE_KEY, "{not-json");
    localStorage.setItem(
      LEGACY_STORAGE_KEY,
      JSON.stringify({
        v: 1,
        items: [{ kind: "station", stopId: "635", name: "Union Sq", addedAt: 0 }],
      }),
    );
    const { useRecentSearches } = await freshImport();
    const { result } = renderHook(() => useRecentSearches());
    expect(result.current.recents).toHaveLength(1);
    expect(result.current.recents[0]).toMatchObject({ stopId: "635" });
  });
});
