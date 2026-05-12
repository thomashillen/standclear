// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

async function freshImport() {
  vi.resetModules();
  // Reset useOnline's module-scope cache by re-importing through the
  // same boundary the component does. Re-importing StatusPanel alone
  // would skip the reset because vitest dedupes lib/useOnline; the
  // resetModules call above clears that cache too.
  return await import("./StatusPanel");
}

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    value,
    configurable: true,
  });
}

function setDocumentHidden(value: boolean) {
  Object.defineProperty(document, "hidden", {
    value,
    configurable: true,
  });
}

const HEALTH_OK = {
  status: "ok" as const,
  version: "0.0.0-test",
  uptimeMs: 1000,
  timestamp: Date.now(),
  checks: {
    mta: { status: "ok" as const, latencyMs: 50 },
    static: { status: "ok" as const },
    runtime: { status: "ok" as const },
  },
};

describe("StatusPanel", () => {
  beforeEach(() => {
    setNavigatorOnline(true);
    setDocumentHidden(false);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetches /api/health on mount and renders the rollup", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => HEALTH_OK,
    });
    vi.stubGlobal("fetch", fetchMock);
    const { default: StatusPanel } = await freshImport();
    render(<StatusPanel />);
    await screen.findByText(/All systems operational/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/health");
  });

  it("does not fetch when document.hidden is true on mount", async () => {
    setDocumentHidden(true);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { default: StatusPanel } = await freshImport();
    render(<StatusPanel />);
    // The poller skips the immediate tick when the tab is hidden;
    // visibilitychange will resume it. No fetch yet.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not fetch when offline and surfaces the paused placeholder", async () => {
    setNavigatorOnline(false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { default: StatusPanel } = await freshImport();
    render(<StatusPanel />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Offline — health checks paused/),
    ).toBeTruthy();
  });

  it("resumes polling when the device comes back online", async () => {
    setNavigatorOnline(false);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => HEALTH_OK,
    });
    vi.stubGlobal("fetch", fetchMock);
    const { default: StatusPanel } = await freshImport();
    render(<StatusPanel />);
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      setNavigatorOnline(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await screen.findByText(/All systems operational/);
  });

  it("resumes polling when the tab becomes visible after being hidden", async () => {
    setDocumentHidden(true);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => HEALTH_OK,
    });
    vi.stubGlobal("fetch", fetchMock);
    const { default: StatusPanel } = await freshImport();
    render(<StatusPanel />);
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      setDocumentHidden(false);
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows the Offline · paused tail-label in the header once data has loaded", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => HEALTH_OK,
    });
    vi.stubGlobal("fetch", fetchMock);
    const { default: StatusPanel } = await freshImport();
    render(<StatusPanel />);
    await screen.findByText(/All systems operational/);

    await act(async () => {
      setNavigatorOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByText(/Offline · paused/)).toBeTruthy();
  });

  it("wraps the rollup headline in a polite live region", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => HEALTH_OK,
    });
    vi.stubGlobal("fetch", fetchMock);
    const { default: StatusPanel } = await freshImport();
    render(<StatusPanel />);
    const headline = await screen.findByText(/All systems operational/);
    // The headline is wrapped in a role="status" container so screen
    // readers re-read the rollup when the status transitions
    // (ok → degraded → down). The wrapper sits on the *inner* pair so
    // the per-15s timestamp update on the sibling node doesn't trigger
    // noisy repeat announcements.
    const liveRegion = headline.closest('[role="status"]');
    expect(liveRegion).not.toBeNull();
    expect(liveRegion?.textContent).toContain("All systems operational");
    expect(liveRegion?.textContent).toContain("Operational");
  });

  it("announces the offline placeholder as a status", async () => {
    setNavigatorOnline(false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { default: StatusPanel } = await freshImport();
    render(<StatusPanel />);
    // Cold-start offline: the only thing on the page is the
    // paused-health placeholder. Should sit inside a role="status"
    // region so a screen-reader rider hears the reason instead of
    // landing on a silent page.
    const placeholder = screen.getByText(/Offline — health checks paused/);
    expect(placeholder.closest('[role="status"]')).not.toBeNull();
  });

  it("announces a fetch failure as an alert", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("boom"));
    vi.stubGlobal("fetch", fetchMock);
    const { default: StatusPanel } = await freshImport();
    render(<StatusPanel />);
    // role="alert" → assertive: a rider hitting /status to confirm
    // health needs to hear "endpoint unreachable" without waiting
    // for a polite queue to flush.
    const errorEl = await screen.findByText(/Failed to reach the health endpoint/);
    expect(errorEl.closest('[role="alert"]')).not.toBeNull();
  });
});
