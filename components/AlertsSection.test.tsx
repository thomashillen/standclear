import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AlertsSection } from "./AlertsSection";
import type { ServiceAlert } from "@/lib/useAlerts";

function makeAlert(over: Partial<ServiceAlert> = {}): ServiceAlert {
  return {
    id: "a1",
    header: "Sample alert",
    description: "",
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

describe("AlertsSection", () => {
  it("renders the count summary and pluralizes correctly", () => {
    render(
      <AlertsSection
        alerts={[
          makeAlert({ id: "a1" }),
          makeAlert({ id: "a2" }),
          makeAlert({ id: "a3" }),
        ]}
      />,
    );
    expect(screen.getByText("3 service alerts")).toBeTruthy();
  });

  it("uses singular form for a single alert", () => {
    render(<AlertsSection alerts={[makeAlert()]} />);
    expect(screen.getByText("1 service alert")).toBeTruthy();
  });

  it("starts collapsed: alert headers are not in the DOM until expanded", () => {
    render(
      <AlertsSection
        alerts={[makeAlert({ id: "a1", header: "No F service downtown" })]}
      />,
    );
    expect(screen.queryByText("No F service downtown")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show service alerts" }));
    expect(screen.getByText("No F service downtown")).toBeTruthy();
  });

  it("colors the summary by the highest severity (severe wins over warning over info)", () => {
    const { rerender } = render(
      <AlertsSection
        alerts={[
          makeAlert({ id: "a1", severity: "info" }),
          makeAlert({ id: "a2", severity: "warning" }),
        ]}
      />,
    );
    // The summary button gets the warning bg class when no severe is present.
    const warnBtn = screen.getByRole("button", { name: /service alerts/i });
    expect(warnBtn.className).toContain("bg-amber-500/15");

    rerender(
      <AlertsSection
        alerts={[
          makeAlert({ id: "a1", severity: "info" }),
          makeAlert({ id: "a2", severity: "warning" }),
          makeAlert({ id: "a3", severity: "severe" }),
        ]}
      />,
    );
    const severeBtn = screen.getByRole("button", { name: /service alerts/i });
    expect(severeBtn.className).toContain("bg-rose-500/15");
  });

  it("caps the expanded list to the first 8 alerts to avoid drowning the panel", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      makeAlert({ id: `a${i}`, header: `alert-${i}` }),
    );
    render(<AlertsSection alerts={many} />);
    fireEvent.click(screen.getByRole("button", { name: "Show service alerts" }));
    expect(screen.getByText("alert-0")).toBeTruthy();
    expect(screen.getByText("alert-7")).toBeTruthy();
    expect(screen.queryByText("alert-8")).toBeNull();
    expect(screen.queryByText("alert-11")).toBeNull();
  });
});
