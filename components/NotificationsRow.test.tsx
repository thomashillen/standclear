import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const mockState = vi.hoisted(() => ({
  current: "default" as string,
  error: null as string | null,
}));
const subscribeSpy = vi.hoisted(() => vi.fn());
const unsubscribeSpy = vi.hoisted(() => vi.fn());

vi.mock("@/lib/usePushSubscription", () => ({
  usePushSubscription: () => ({
    state: mockState.current,
    pending: false,
    error: mockState.error,
    subscribe: subscribeSpy,
    unsubscribe: unsubscribeSpy,
  }),
}));

import { NotificationsRow } from "./NotificationsRow";

describe("NotificationsRow", () => {
  beforeEach(() => {
    mockState.error = null;
  });

  it("renders nothing on unsupported browsers", () => {
    mockState.current = "unsupported";
    const { container } = render(<NotificationsRow />);
    expect(container.innerHTML).toBe("");
  });

  it("shows the install hint on iOS Safari outside a PWA", () => {
    mockState.current = "needs-install";
    render(<NotificationsRow />);
    expect(screen.getByText(/Add to Home Screen first/i)).toBeDefined();
    expect(screen.getByText(/iOS only delivers/i)).toBeDefined();
  });

  it("shows the blocked card on permission denied", () => {
    mockState.current = "denied";
    render(<NotificationsRow />);
    expect(screen.getByText(/Notifications blocked/i)).toBeDefined();
    expect(screen.getByText(/site settings/i)).toBeDefined();
  });

  it("shows the Enable button on permission default", () => {
    mockState.current = "default";
    render(<NotificationsRow />);
    expect(screen.getByText("Enable")).toBeDefined();
    expect(screen.getByText(/Get notified when a line is suspended/i)).toBeDefined();
  });

  it("shows the Enable button when granted but no sub exists", () => {
    mockState.current = "granted-not-subscribed";
    render(<NotificationsRow />);
    expect(screen.getByText("Enable")).toBeDefined();
  });

  it("shows the On affordance when fully subscribed", () => {
    mockState.current = "granted-subscribed";
    render(<NotificationsRow />);
    expect(screen.getByText("On")).toBeDefined();
    expect(screen.getByText(/Tap to/i)).toBeDefined();
  });

  it("surfaces a hook error message under the row as an alert", () => {
    mockState.current = "default";
    mockState.error = "Couldn't enable notifications. Try again.";
    render(<NotificationsRow />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe(
      "Couldn't enable notifications. Try again.",
    );
    // The visible error tints the copy so the rider sees it; sr-only
    // is dropped only when there's content to announce.
    expect(alert.className).not.toMatch(/sr-only/);
  });

  it("keeps the alert region mounted (sr-only) when error is null", () => {
    mockState.current = "default";
    mockState.error = null;
    render(<NotificationsRow />);
    // Mounted-but-silent so AT pairs that only announce changes
    // inside a pre-existing live region still pick up the next
    // failure. Empty text content + sr-only keeps it invisible.
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("");
    expect(alert.className).toMatch(/sr-only/);
  });
});
