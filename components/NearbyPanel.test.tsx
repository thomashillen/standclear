import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NearbyEmptyState } from "./NearbyPanel";

describe("NearbyEmptyState", () => {
  it("renders the idle CTA with an Enable location button", () => {
    const onRequest = vi.fn();
    render(
      <NearbyEmptyState status="idle" hasFix={false} onRequest={onRequest} />,
    );
    expect(screen.getByText(/Find stations near you/)).toBeTruthy();
    const button = screen.getByRole("button", { name: /Enable location/ });
    fireEvent.click(button);
    expect(onRequest).toHaveBeenCalledTimes(1);
  });

  it("renders 'Finding your location…' while prompting without a fix", () => {
    render(
      <NearbyEmptyState status="prompting" hasFix={false} onRequest={vi.fn()} />,
    );
    expect(screen.getByText(/Finding your location…/)).toBeTruthy();
  });

  it("renders nothing when prompting AFTER a fix has landed", () => {
    // Watch re-prompts shouldn't blank out a panel that already has
    // useful content above; this branch leaves the empty state silent
    // so the rest of the panel can keep rendering.
    const { container } = render(
      <NearbyEmptyState status="prompting" hasFix={true} onRequest={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the denied state without a retry button", () => {
    // Permission denied is a dead-end from the web's POV — retrying
    // won't re-prompt the OS. Surface the message + settings nudge,
    // but no button.
    render(
      <NearbyEmptyState status="denied" hasFix={false} onRequest={vi.fn()} />,
    );
    expect(screen.getByText(/Location is blocked/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders the error state with a Try again button that re-requests", () => {
    const onRequest = vi.fn();
    render(
      <NearbyEmptyState status="error" hasFix={false} onRequest={onRequest} />,
    );
    expect(screen.getByText(/We couldn't find your location/)).toBeTruthy();
    const button = screen.getByRole("button", { name: /Try again/ });
    fireEvent.click(button);
    expect(onRequest).toHaveBeenCalledTimes(1);
  });

  it("renders the unavailable state with no retry button", () => {
    // No Geolocation API at all — retry can't help. Just explain the
    // state and point the rider at the manual path (More).
    render(
      <NearbyEmptyState
        status="unavailable"
        hasFix={false}
        onRequest={vi.fn()}
      />,
    );
    expect(screen.getByText(/Location isn't available/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders nothing for granted (the parent shows real content)", () => {
    const { container } = render(
      <NearbyEmptyState status="granted" hasFix={true} onRequest={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
