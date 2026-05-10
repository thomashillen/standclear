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

describe("AlertsButton AlertItem", () => {
  it("info severity renders collapsed: description not in DOM until tapped", () => {
    render(
      <AlertItem
        alert={makeAlert({ severity: "info", description: "elevator out" })}
        routeInfo={routeInfo}
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
      />,
    );
    expect(screen.getByText("no service")).toBeTruthy();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByText("no service")).toBeNull();
  });
});
