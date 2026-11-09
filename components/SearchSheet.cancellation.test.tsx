import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SearchSheet from "./SearchSheet";

vi.mock("@/lib/useTrains", () => ({ useTrains: () => null }));
vi.mock("@/lib/useNow", () => ({ useNow: () => 1_800_000_000_000 }));
vi.mock("@/lib/subwayData", () => {
  const lines = {
    A: { id: "A", routeId: "A", name: "A", color: "#0039A6", textColor: "white",
      shape: [[-74, 40.7], [-74, 40.8]], stops: [
        { id: "test-home", name: "Home station", lng: -74, lat: 40.7, shapeIdx: 0 },
        { id: "test-work", name: "Work station", lng: -74, lat: 40.8, shapeIdx: 1 },
      ] },
  };
  return { useLines: () => lines };
});
vi.mock("@/lib/useGeolocation", () => ({
  useGeolocation: () => ({ status: "idle", lat: null, lng: null, request: vi.fn() }),
}));
vi.mock("@/lib/useFavorites", () => ({
  useCommute: () => ({ home: null, work: null }),
  useFavorites: () => ({ favorites: new Set(), has: () => false, toggle: vi.fn() }),
}));

let queryNumber = 0;
function query(input: HTMLElement) {
  // The real geocoder keeps a session cache. Each test uses a new query.
  fireEvent.change(input, { target: { value: `Madison ${++queryNumber}` } });
}

function pendingSuggest() {
  let resolve!: (response: Response) => void;
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementationOnce(
    () => new Promise<Response>(finish => { resolve = finish; }),
  );
  return {
    fetchSpy,
    finish: async () => {
      await act(async () => {
        resolve(new Response(JSON.stringify({ suggestions: [
          { mapbox_id: "old-place", name: "Obsolete place", place_formatted: "New York" },
        ] }), { status: 200 }));
      });
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", () => ({
    matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function startRequest() {
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
}

describe("SearchSheet autocomplete lifecycle", () => {
  it.each(["", "M"])("does not restore old search places after shortening the query to %j", async shortened => {
    const request = pendingSuggest();
    render(<SearchSheet open onClose={vi.fn()} onStationOpen={vi.fn()} />);
    const input = screen.getByRole("searchbox", { name: "Search NYC" });
    query(input);
    await startRequest();
    fireEvent.change(input, { target: { value: shortened } });
    await request.finish();
    expect(screen.queryByText("Obsolete place")).toBeNull();
    expect(request.fetchSpy.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("cancels a pending debounce when the sheet closes, without a hidden request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ suggestions: [] })));
    const props = { onClose: vi.fn(), onStationOpen: vi.fn() };
    const view = render(<SearchSheet open {...props} />);
    query(screen.getByRole("searchbox", { name: "Search NYC" }));
    view.rerender(<SearchSheet open={false} {...props} />);
    await startRequest();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not restore old places after closing and reopening Search", async () => {
    const request = pendingSuggest();
    const props = { onClose: vi.fn(), onStationOpen: vi.fn() };
    const view = render(<SearchSheet open {...props} />);
    query(screen.getByRole("searchbox", { name: "Search NYC" }));
    await startRequest();
    view.rerender(<SearchSheet open={false} {...props} />);
    await request.finish();
    view.rerender(<SearchSheet open {...props} />);
    expect(screen.queryByText("Obsolete place")).toBeNull();
    expect(request.fetchSpy.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("cancels the active planner query when returning to Search", async () => {
    const request = pendingSuggest();
    render(<SearchSheet open initialMode="directions" onClose={vi.fn()} onStationOpen={vi.fn()} />);
    query(screen.getByRole("textbox", { name: "From station search" }));
    await startRequest();
    fireEvent.click(screen.getByRole("button", { name: "Back to search" }));
    await request.finish();
    expect(request.fetchSpy.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(screen.queryByText("Obsolete place")).toBeNull();
  });

  it("cancels From suggestions when the rider switches to To", async () => {
    const request = pendingSuggest();
    render(<SearchSheet open initialMode="directions" onClose={vi.fn()} onStationOpen={vi.fn()} />);
    query(screen.getByRole("textbox", { name: "From station search" }));
    await startRequest();
    fireEvent.click(screen.getByRole("button", { name: "To: Search destination" }));
    await request.finish();
    expect(request.fetchSpy.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "To station search" }).value).toBe("");
    expect(screen.queryByText("Obsolete place")).toBeNull();
  });

  it("aborts in-flight work when the sheet unmounts", async () => {
    const request = pendingSuggest();
    const view = render(<SearchSheet open onClose={vi.fn()} onStationOpen={vi.fn()} />);
    query(screen.getByRole("searchbox", { name: "Search NYC" }));
    await startRequest();
    view.unmount();
    await request.finish();
    expect(request.fetchSpy.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("still shows a service notice when the active search fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Unavailable", { status: 503 }));
    render(<SearchSheet open onClose={vi.fn()} onStationOpen={vi.fn()} />);
    query(screen.getByRole("searchbox", { name: "Search NYC" }));
    await startRequest();
    expect(screen.getByText(/Address search is temporarily unavailable/)).toBeTruthy();
  });
});
