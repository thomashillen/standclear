import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// Hoisted observability mock — `app/error.tsx` calls
// `captureException` inside its mount effect. Pin that call site so a
// future refactor that drops the useEffect (or strips the import)
// trips the suite instead of silently dropping every client-side
// route error from the operator log.
const captureException = vi.fn();
vi.mock("@/lib/observability", () => ({
  captureException,
}));

// Re-import the page under test through a fresh module graph each
// test so the mock above is bound — matches the pattern
// `lib/useAlerts.observability.test.ts` already establishes.
async function freshImport() {
  vi.resetModules();
  vi.doMock("@/lib/observability", () => ({ captureException }));
  return await import("./error");
}

describe("app/error.tsx route boundary", () => {
  beforeEach(() => {
    captureException.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("forwards the error through captureException on mount", async () => {
    const { default: ErrorPage } = await freshImport();
    const err = Object.assign(new Error("route blew up"), {
      digest: "abc123",
    });
    render(<ErrorPage error={err} reset={() => {}} />);
    expect(captureException).toHaveBeenCalledTimes(1);
    const [forwarded, fields] = captureException.mock.calls[0];
    expect(forwarded).toBe(err);
    expect(fields).toEqual({
      what: "route-level error boundary",
      digest: "abc123",
    });
  });

  it("passes through an undefined digest cleanly", async () => {
    const { default: ErrorPage } = await freshImport();
    const err = new Error("no digest");
    render(<ErrorPage error={err} reset={() => {}} />);
    expect(captureException).toHaveBeenCalledTimes(1);
    const [, fields] = captureException.mock.calls[0];
    expect(fields).toEqual({
      what: "route-level error boundary",
      digest: undefined,
    });
  });

  it("renders the error digest when present so a rider can file a bug with it", async () => {
    const { default: ErrorPage } = await freshImport();
    const err = Object.assign(new Error("derailed"), {
      digest: "deadbeef-1234",
    });
    render(<ErrorPage error={err} reset={() => {}} />);
    expect(screen.getByText(/Error ID: deadbeef-1234/)).toBeTruthy();
  });

  it("omits the digest line entirely when error has no digest", async () => {
    const { default: ErrorPage } = await freshImport();
    const err = new Error("no digest here");
    render(<ErrorPage error={err} reset={() => {}} />);
    expect(screen.queryByText(/Error ID:/)).toBeNull();
  });

  it("renders the brand headline + recovery copy", async () => {
    const { default: ErrorPage } = await freshImport();
    render(
      <ErrorPage error={new Error("any")} reset={() => {}} />,
    );
    expect(screen.getByText("Something derailed.")).toBeTruthy();
    // SITE_NAME is interpolated into the body copy — checking the
    // brand-visible string lands rather than the raw constant import.
    expect(
      screen.getByText(/StandClear hit an unexpected error/),
    ).toBeTruthy();
  });

  it("wires the Try again button to the supplied reset()", async () => {
    const { default: ErrorPage } = await freshImport();
    const reset = vi.fn();
    render(<ErrorPage error={new Error("any")} reset={reset} />);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("offers an Open the map link back to /", async () => {
    const { default: ErrorPage } = await freshImport();
    render(<ErrorPage error={new Error("any")} reset={() => {}} />);
    const link = screen.getByRole("link", { name: /open the map/i });
    expect(link.getAttribute("href")).toBe("/");
  });

  it("file-a-bug link opens GitHub Issues in a new tab with safe rel", async () => {
    const { default: ErrorPage } = await freshImport();
    render(<ErrorPage error={new Error("any")} reset={() => {}} />);
    const link = screen.getByRole("link", { name: /file a bug/i });
    expect(link.getAttribute("href")).toBe(
      "https://github.com/thomashillen/standclear/issues",
    );
    expect(link.getAttribute("target")).toBe("_blank");
    // `noopener` + `noreferrer` guard against reverse-tabnabbing.
    const rel = link.getAttribute("rel") ?? "";
    expect(rel).toContain("noopener");
    expect(rel).toContain("noreferrer");
  });

  it("re-fires captureException when the error identity changes", async () => {
    // Pins the `[error]` dep on the useEffect — Next remounts this
    // boundary with a fresh error object on each render that throws,
    // so each distinct error must reach the operator log.
    const { default: ErrorPage } = await freshImport();
    const first = new Error("first");
    const { rerender } = render(
      <ErrorPage error={first} reset={() => {}} />,
    );
    expect(captureException).toHaveBeenCalledTimes(1);
    const second = new Error("second");
    rerender(<ErrorPage error={second} reset={() => {}} />);
    expect(captureException).toHaveBeenCalledTimes(2);
    expect(captureException.mock.calls[1][0]).toBe(second);
  });
});
