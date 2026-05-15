import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AlertItem } from "./AlertsButton";
import type { ServiceAlert } from "@/lib/useAlerts";

function makeAlert(over: Partial<ServiceAlert> = {}): ServiceAlert {
  return {
    id: "a1",
    header: "Sample header",
    description: "Sample description body",
    effect: "OTHER_EFFECT",
    severity: "info",
    routeIds: ["F"],
    stopIds: [],
    selectors: [{ routeId: "F" }],
    startTime: null,
    endTime: null,
    ...over,
  };
}

const routeInfo = new Map<
  string,
  { id: string; color: string; textColor: "white" | "black" }
>([
  ["F", { id: "F", color: "#FF6319", textColor: "white" }],
  // Shuttle: routeId "GS" rendered as display "S" — pins the routeId
  // vs display-id split that the /line/[slug] link relies on.
  ["GS", { id: "S", color: "#6D6E71", textColor: "white" }],
]);

// Pin to Sat 2026-05-09 06:00 NYC (EDT, UTC-4) for window-label tests.
// Using a literal nowMs prop keeps the tests pure — no fake timers.
const NOW_SAT_MAY_9_6AM_MS = Date.UTC(2026, 4, 9, 10, 0, 0);

describe("AlertsButton AlertItem", () => {
  it("info severity renders collapsed: description not in DOM until tapped", () => {
    render(
      <AlertItem
        alert={makeAlert({ severity: "info", description: "elevator out" })}
        routeInfo={routeInfo}
        nowMs={NOW_SAT_MAY_9_6AM_MS}
      />,
    );
    expect(screen.queryByText("elevator out")).toBeNull();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("elevator out")).toBeTruthy();
  });

  it("warning severity also renders collapsed by default — calm default", () => {
    render(
      <AlertItem
        alert={makeAlert({ severity: "warning", description: "delays in BK" })}
        routeInfo={routeInfo}
        nowMs={NOW_SAT_MAY_9_6AM_MS}
      />,
    );
    expect(screen.queryByText("delays in BK")).toBeNull();
  });

  it("severe severity auto-expands: description visible on mount", () => {
    render(
      <AlertItem
        alert={makeAlert({
          severity: "severe",
          description: "no F service downtown",
        })}
        routeInfo={routeInfo}
        nowMs={NOW_SAT_MAY_9_6AM_MS}
      />,
    );
    expect(screen.getByText("no F service downtown")).toBeTruthy();
  });

  it("severe with no description body stays well-formed (no chevron, header still visible)", () => {
    render(
      <AlertItem
        alert={makeAlert({
          severity: "severe",
          header: "Suspended",
          // Description equal to header counts as no body.
          description: "Suspended",
        })}
        routeInfo={routeInfo}
        nowMs={NOW_SAT_MAY_9_6AM_MS}
      />,
    );
    expect(screen.getByText("Suspended")).toBeTruthy();
    // Button should not advertise an aria-expanded since there's nothing
    // to expand — matches the existing `hasBody ? expanded : undefined` guard.
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-expanded")).toBeNull();
  });

  it("severe rider can collapse explicitly after auto-expand", () => {
    render(
      <AlertItem
        alert={makeAlert({
          severity: "severe",
          description: "no service",
        })}
        routeInfo={routeInfo}
        nowMs={NOW_SAT_MAY_9_6AM_MS}
      />,
    );
    expect(screen.getByText("no service")).toBeTruthy();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByText("no service")).toBeNull();
  });

  describe("window label", () => {
    it("renders nothing when both timestamps are missing", () => {
      render(
        <AlertItem
          alert={makeAlert({ startTime: null, endTime: null })}
          routeInfo={routeInfo}
          nowMs={NOW_SAT_MAY_9_6AM_MS}
        />,
      );
      expect(screen.queryByText(/Until|Ends in|Starts/)).toBeNull();
    });

    it("renders 'Until <weekday> <time>' for an end within the week", () => {
      // 5 AM NYC Mon May 11 = 09:00 UTC.
      const endsAt5amMon = Date.UTC(2026, 4, 11, 9, 0, 0) / 1000;
      render(
        <AlertItem
          alert={makeAlert({ startTime: null, endTime: endsAt5amMon })}
          routeInfo={routeInfo}
          nowMs={NOW_SAT_MAY_9_6AM_MS}
        />,
      );
      expect(screen.getByText("Until Mon 5 AM")).toBeTruthy();
    });

    it("renders 'Ends in N min' when less than an hour remains", () => {
      // 30 minutes from the pinned `now`.
      const endsSoon = NOW_SAT_MAY_9_6AM_MS / 1000 + 30 * 60;
      render(
        <AlertItem
          alert={makeAlert({ startTime: null, endTime: endsSoon })}
          routeInfo={routeInfo}
          nowMs={NOW_SAT_MAY_9_6AM_MS}
        />,
      );
      expect(screen.getByText("Ends in 30 min")).toBeTruthy();
    });
  });

  describe("affected-route bullets", () => {
    it("known routes render as Links to /line/<slug>", () => {
      render(
        <AlertItem
          alert={makeAlert({ routeIds: ["F"] })}
          routeInfo={routeInfo}
          nowMs={NOW_SAT_MAY_9_6AM_MS}
        />,
      );
      const link = screen.getByRole("link", { name: "Open F line" });
      expect(link.getAttribute("href")).toBe("/line/f");
      expect(link.textContent).toBe("F");
    });

    it("uses the canonical routeId for the slug, the display id for the bullet glyph", () => {
      // routeId "GS" must drive the href; display "S" must render in
      // the bullet. A regression that swapped the two would land
      // every shuttle Link on /line/s (404 — the page is /line/gs).
      render(
        <AlertItem
          alert={makeAlert({ routeIds: ["GS"] })}
          routeInfo={routeInfo}
          nowMs={NOW_SAT_MAY_9_6AM_MS}
        />,
      );
      const link = screen.getByRole("link", { name: "Open S line" });
      expect(link.getAttribute("href")).toBe("/line/gs");
      expect(link.textContent).toBe("S");
    });

    it("tapping a known-route bullet fires onLineNav (dialog closes in lockstep with nav)", () => {
      const onLineNav = vi.fn();
      render(
        <AlertItem
          alert={makeAlert({ routeIds: ["F"] })}
          routeInfo={routeInfo}
          nowMs={NOW_SAT_MAY_9_6AM_MS}
          onLineNav={onLineNav}
        />,
      );
      fireEvent.click(screen.getByRole("link", { name: "Open F line" }));
      expect(onLineNav).toHaveBeenCalledTimes(1);
    });

    it("unknown route ids render as non-Link spans (no href, still in the row)", () => {
      // An alert referencing a route the lines map doesn't know about
      // (e.g. a future MTA route id we haven't shipped yet) must still
      // surface the affected-routes row so the rider sees the badge —
      // just non-navigable, since we can't compose a /line/[slug] URL
      // for it.
      render(
        <AlertItem
          alert={makeAlert({ routeIds: ["XYZ"] })}
          routeInfo={routeInfo}
          nowMs={NOW_SAT_MAY_9_6AM_MS}
        />,
      );
      expect(screen.queryByRole("link")).toBeNull();
      expect(screen.getByText("XYZ")).toBeTruthy();
    });

    it("affected bullets are NOT inside the toggle button — tapping one does not toggle expansion", () => {
      // Pre-refactor the bullets lived inside the outer toggle button,
      // which (a) is invalid HTML (Link inside button) and (b) would
      // collapse the row out from under the rider on bullet tap. Pin
      // both: assert the link is a sibling of the toggle button, and
      // assert tapping it does not expand the description body.
      render(
        <AlertItem
          alert={makeAlert({
            routeIds: ["F"],
            severity: "info",
            description: "elevator out",
          })}
          routeInfo={routeInfo}
          nowMs={NOW_SAT_MAY_9_6AM_MS}
        />,
      );
      expect(screen.queryByText("elevator out")).toBeNull();
      const link = screen.getByRole("link", { name: "Open F line" });
      const toggle = screen.getByRole("button");
      expect(toggle.contains(link)).toBe(false);
      fireEvent.click(link);
      expect(screen.queryByText("elevator out")).toBeNull();
    });

    it("multiple known routes render in alert.routeIds order; each gets its own Link", () => {
      // routeInfo has F + GS; an alert listing F + GS in that order
      // should render two Links with the same ordering.
      render(
        <AlertItem
          alert={makeAlert({ routeIds: ["F", "GS"] })}
          routeInfo={routeInfo}
          nowMs={NOW_SAT_MAY_9_6AM_MS}
        />,
      );
      const links = screen.getAllByRole("link");
      expect(links).toHaveLength(2);
      expect(links[0].getAttribute("href")).toBe("/line/f");
      expect(links[1].getAttribute("href")).toBe("/line/gs");
    });

    it("known + unknown coexist; known render before unknown", () => {
      render(
        <AlertItem
          alert={makeAlert({ routeIds: ["XYZ", "F"] })}
          routeInfo={routeInfo}
          nowMs={NOW_SAT_MAY_9_6AM_MS}
        />,
      );
      // One Link for F, one non-Link span for XYZ.
      expect(screen.getAllByRole("link")).toHaveLength(1);
      expect(screen.getByText("XYZ")).toBeTruthy();
    });

    it("no onLineNav passed — Link still navigates (callback is optional)", () => {
      // Default behavior: a Link without a click handler still works
      // (Next.js Link does its own navigation). The dialog stays open
      // for a frame, but the soft-nav unmount tears it down. Pin that
      // the callback is genuinely optional so a future caller doesn't
      // have to thread closeOnNav to reuse AlertItem.
      render(
        <AlertItem
          alert={makeAlert({ routeIds: ["F"] })}
          routeInfo={routeInfo}
          nowMs={NOW_SAT_MAY_9_6AM_MS}
        />,
      );
      const link = screen.getByRole("link", { name: "Open F line" });
      expect(() => fireEvent.click(link)).not.toThrow();
    });
  });
});
