import { describe, expect, it } from "vitest";
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
>([["F", { id: "F", color: "#FF6319", textColor: "white" }]]);

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
});
