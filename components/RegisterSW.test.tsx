// jsdom default — RegisterSW touches `navigator`, `document.readyState`,
// and `window.addEventListener`.
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { render } from "@testing-library/react";

// Hoisted observability spy — RegisterSW pipes the SW-registration
// rejection through `captureException` so a silently failing
// registration (cache quota, locked storage, CSP edge case) becomes
// ops-visible. The mock must be declared before the component import.
const captureException = vi.hoisted(() => vi.fn());
vi.mock("@/lib/observability", () => ({ captureException }));

import RegisterSW from "./RegisterSW";

// Helpers — assign / remove navigator.serviceWorker without making
// jsdom's prototype permanent across tests.
function installServiceWorker(registerImpl: (path: string) => Promise<unknown>) {
  Object.defineProperty(window.navigator, "serviceWorker", {
    configurable: true,
    value: { register: registerImpl },
  });
}

function removeServiceWorker() {
  // `delete` + redefine: jsdom's navigator doesn't ship serviceWorker
  // by default, but a prior test may have polyfilled it.
  if ("serviceWorker" in window.navigator) {
    Object.defineProperty(window.navigator, "serviceWorker", {
      configurable: true,
      value: undefined,
    });
    delete (window.navigator as unknown as Record<string, unknown>).serviceWorker;
  }
}

function setReadyState(state: DocumentReadyState) {
  Object.defineProperty(document, "readyState", {
    configurable: true,
    get: () => state,
  });
}

describe("RegisterSW", () => {
  beforeEach(() => {
    captureException.mockReset();
    removeServiceWorker();
    setReadyState("complete");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    removeServiceWorker();
  });

  it("no-ops in non-production builds (dev HMR vs cache-first SW would fight)", () => {
    vi.stubEnv("NODE_ENV", "development");
    const register = vi.fn().mockResolvedValue(undefined);
    installServiceWorker(register);

    render(<RegisterSW />);

    expect(register).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("returns null markup (renders nothing)", () => {
    vi.stubEnv("NODE_ENV", "production");
    const register = vi.fn().mockResolvedValue(undefined);
    installServiceWorker(register);

    const { container } = render(<RegisterSW />);

    expect(container.firstChild).toBeNull();
  });

  it("no-ops when navigator.serviceWorker is absent (older browsers / locked-down WebViews)", () => {
    vi.stubEnv("NODE_ENV", "production");
    removeServiceWorker();

    expect(() => render(<RegisterSW />)).not.toThrow();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("registers /sw.js immediately when document.readyState === 'complete'", async () => {
    vi.stubEnv("NODE_ENV", "production");
    setReadyState("complete");
    const register = vi.fn().mockResolvedValue(undefined);
    installServiceWorker(register);

    render(<RegisterSW />);

    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith("/sw.js");
  });

  it("defers registration to the 'load' event when the document is still loading", () => {
    vi.stubEnv("NODE_ENV", "production");
    setReadyState("loading");
    const register = vi.fn().mockResolvedValue(undefined);
    installServiceWorker(register);
    const addEventSpy = vi.spyOn(window, "addEventListener");

    render(<RegisterSW />);

    expect(register).not.toHaveBeenCalled();
    // The load handler is installed with `once: true` so it can't
    // re-fire if the document reloads via SPA navigation.
    const loadCall = addEventSpy.mock.calls.find(([type]) => type === "load");
    expect(loadCall).toBeDefined();
    expect(loadCall?.[2]).toEqual({ once: true });

    // Fire the load event and confirm the deferred register runs.
    window.dispatchEvent(new Event("load"));
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith("/sw.js");

    addEventSpy.mockRestore();
  });

  it("forwards a register() rejection to captureException with the documented source tag", async () => {
    vi.stubEnv("NODE_ENV", "production");
    setReadyState("complete");
    const err = new Error("Quota exceeded");
    const register = vi.fn().mockRejectedValue(err);
    installServiceWorker(register);

    render(<RegisterSW />);

    // The catch handler fires on the next microtask; flush.
    await Promise.resolve();
    await Promise.resolve();

    expect(captureException).toHaveBeenCalledTimes(1);
    const [forwarded, fields] = captureException.mock.calls[0];
    expect(forwarded).toBe(err);
    expect(fields).toEqual({ source: "service-worker-registration" });
  });

  it("does NOT report success cases to captureException", async () => {
    vi.stubEnv("NODE_ENV", "production");
    setReadyState("complete");
    const register = vi.fn().mockResolvedValue({ scope: "/" });
    installServiceWorker(register);

    render(<RegisterSW />);

    await Promise.resolve();
    await Promise.resolve();

    expect(captureException).not.toHaveBeenCalled();
  });

  it("never registers when NODE_ENV is unset (empty string treated as not-production)", () => {
    vi.stubEnv("NODE_ENV", "");
    const register = vi.fn().mockResolvedValue(undefined);
    installServiceWorker(register);

    render(<RegisterSW />);

    expect(register).not.toHaveBeenCalled();
  });
});
