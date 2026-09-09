import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentType } from "react";
import SubwayMap from "./SubwayMap";

const feed = vi.hoisted(() => ({ online: true, degraded: false, generatedAt: 100_000 }));
vi.mock("@/lib/subwayData", () => ({ useLines: () => null }));
vi.mock("@/lib/useOnline", () => ({ useOnline: () => feed.online }));
vi.mock("@/lib/useNow", () => ({ useNow: () => 100_000 }));
vi.mock("@/lib/useTrains", () => ({
  useTrains: () => ({ trains: [], arrivals: [], generatedAt: feed.generatedAt }),
  useFeedHealth: () => ({ degraded: feed.degraded, consecutiveFailures: 2 }),
}));
vi.mock("./LinePicker", () => ({ default: () => <button>Lines</button> }));
// Exercise shell ownership independently of Mapbox and each panel's data fetching.
vi.mock("next/dynamic", () => ({ default: (loader: () => Promise<unknown>) => {
  const name = loader.toString().match(/(LiveTrainsPopup|MoreSheet|SearchSheet|NearbyPanel|MapView|InstallPrompt|LinePanel|StationPanel)/)?.[1] ?? "Panel";
  const Panel: ComponentType<{ open?: boolean; onClose?: () => void; onOpenMore?: () => void }> = ({ open, onClose, onOpenMore }) => open ? (
    <section aria-label={name}>
      <button onClick={onClose}>Dismiss {name}</button>
      {onOpenMore && <button onClick={onOpenMore}>Open more from search</button>}
    </section>
  ) : null;
  return Panel;
} }));

beforeEach(() => { feed.online = true; feed.degraded = false; feed.generatedAt = 100_000; });

describe("mobile home shell", () => {
  it("yields the home surface to search, hands off to More, and restores home on dismissal", () => {
    render(<SubwayMap />);
    fireEvent.click(within(screen.getByRole("region", { name: "Search" })).getByRole("button", { name: "Search stations and plan trips" }));
    expect(screen.queryByRole("region", { name: "Search" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open more from search" }));
    expect(screen.queryByRole("region", { name: "SearchSheet" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss MoreSheet" }));
    expect(screen.getByRole("region", { name: "Search" })).toBeTruthy();
  });

  it.each([
    ["Stale", true, false, 1],
    ["Offline", false, false, 100_000],
    ["Feed issue", true, true, 100_000],
    ["Live", true, false, 100_000],
  ])("keeps %s visible and System Pulse reachable", (label, online, degraded, generatedAt) => {
    Object.assign(feed, { online, degraded, generatedAt });
    render(<SubwayMap />);
    const labelNode = screen.getByText(label, { exact: true });
    fireEvent.click(labelNode.closest("button")!);
    expect(screen.getByRole("region", { name: "LiveTrainsPopup" })).toBeTruthy();
  });
});
