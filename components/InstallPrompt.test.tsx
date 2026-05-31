import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import InstallPrompt from "./InstallPrompt";

// InstallPrompt mounts a 60s setTimeout before revealing the banner,
// sniffs platform via navigator.userAgent + window.matchMedia, and
// gates against a localStorage dismiss flag. Each test sets the env
// up front and then advances fake timers — touching userAgent /
// matchMedia after mount won't re-run the gating effect.

const STORAGE_KEY = "standclear:a2hs-dismissed:v1";
const SHOW_DELAY_MS = 60_000;

const UA_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const UA_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36";
const UA_DESKTOP =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value: ua,
    writable: true,
  });
}

function setStandalone(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === "(display-mode: standalone)" ? matches : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function clearIosStandaloneFlag() {
  // iOS Safari exposes `navigator.standalone`; jsdom doesn't define
  // it, but a prior test may have polyfilled it. Reset to undefined
  // so the isStandalone() iOS branch returns false.
  if ("standalone" in window.navigator) {
    Object.defineProperty(window.navigator, "standalone", {
      configurable: true,
      value: undefined,
      writable: true,
    });
  }
}

function dispatchBeforeInstall(): {
  prompt: ReturnType<typeof vi.fn>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
} {
  const prompt = vi.fn().mockResolvedValue(undefined);
  const userChoice = Promise.resolve({ outcome: "accepted" as const });
  const event = new Event("beforeinstallprompt") as Event & {
    prompt: typeof prompt;
    userChoice: typeof userChoice;
  };
  event.prompt = prompt;
  event.userChoice = userChoice;
  act(() => {
    window.dispatchEvent(event);
  });
  return { prompt, userChoice };
}

describe("InstallPrompt", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    clearIosStandaloneFlag();
    setStandalone(false);
    setUserAgent(UA_ANDROID);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders nothing before the 60s show-delay elapses", () => {
    const { container } = render(<InstallPrompt />);
    // Just shy of the threshold — still hidden.
    act(() => {
      vi.advanceTimersByTime(SHOW_DELAY_MS - 1);
    });
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when the app is already running standalone (PWA installed)", () => {
    setStandalone(true);
    const { container } = render(<InstallPrompt />);
    act(() => {
      vi.advanceTimersByTime(SHOW_DELAY_MS + 1_000);
    });
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing on iOS when navigator.standalone is true", () => {
    setUserAgent(UA_IOS);
    Object.defineProperty(window.navigator, "standalone", {
      configurable: true,
      value: true,
      writable: true,
    });
    const { container } = render(<InstallPrompt />);
    act(() => {
      vi.advanceTimersByTime(SHOW_DELAY_MS + 1_000);
    });
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing on a desktop UA — banner is mobile-only", () => {
    setUserAgent(UA_DESKTOP);
    const { container } = render(<InstallPrompt />);
    act(() => {
      vi.advanceTimersByTime(SHOW_DELAY_MS + 1_000);
    });
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when the rider has dismissed it on a previous visit", () => {
    window.localStorage.setItem(STORAGE_KEY, "1");
    const { container } = render(<InstallPrompt />);
    act(() => {
      vi.advanceTimersByTime(SHOW_DELAY_MS + 1_000);
    });
    expect(container.innerHTML).toBe("");
  });

  it("shows the iOS share-sheet instruction copy on iOS Safari", () => {
    setUserAgent(UA_IOS);
    render(<InstallPrompt />);
    act(() => {
      vi.advanceTimersByTime(SHOW_DELAY_MS);
    });
    expect(screen.getByText("Install StandClear")).toBeDefined();
    expect(
      screen.getByText(/Add to Home Screen/i, { selector: "strong" }),
    ).toBeDefined();
    // No native install button on iOS — the share-sheet flow is manual.
    expect(screen.queryByText("Install app")).toBeNull();
  });

  it("shows the generic install copy on Android before beforeinstallprompt fires", () => {
    setUserAgent(UA_ANDROID);
    render(<InstallPrompt />);
    act(() => {
      vi.advanceTimersByTime(SHOW_DELAY_MS);
    });
    expect(screen.getByText("Install StandClear")).toBeDefined();
    expect(screen.getByText(/works\s+offline/i)).toBeDefined();
    // The native "Install app" button is gated on a deferred event;
    // without one the prompt only shows the explanatory copy + close.
    expect(screen.queryByText("Install app")).toBeNull();
  });

  it("surfaces the native Install button once beforeinstallprompt is captured", () => {
    setUserAgent(UA_ANDROID);
    render(<InstallPrompt />);
    dispatchBeforeInstall();
    act(() => {
      vi.advanceTimersByTime(SHOW_DELAY_MS);
    });
    expect(screen.getByRole("button", { name: "Install app" })).toBeDefined();
  });

  it("calls deferred.prompt + persists the dismiss flag when Install app is tapped", async () => {
    setUserAgent(UA_ANDROID);
    render(<InstallPrompt />);
    const { prompt } = dispatchBeforeInstall();
    act(() => {
      vi.advanceTimersByTime(SHOW_DELAY_MS);
    });
    const installBtn = screen.getByRole("button", { name: "Install app" });
    await act(async () => {
      fireEvent.click(installBtn);
      // Let the async prompt() + userChoice chain settle.
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("1");
    // Banner unmounts after the choice resolves.
    expect(screen.queryByText("Install StandClear")).toBeNull();
  });

  it("dismisses + persists the flag when the close (X) button is tapped", () => {
    setUserAgent(UA_ANDROID);
    render(<InstallPrompt />);
    act(() => {
      vi.advanceTimersByTime(SHOW_DELAY_MS);
    });
    const closeBtn = screen.getByRole("button", {
      name: "Dismiss install prompt",
    });
    act(() => {
      fireEvent.click(closeBtn);
    });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("1");
    expect(screen.queryByText("Install StandClear")).toBeNull();
  });

  it("dismiss button is a 44px touch target (principle #3)", () => {
    // jsdom has no CSS engine, so the rendered hit area can't be
    // measured — the Tailwind class list is the contract. Pin the
    // HIG-minimum size and reject the old 32px size so a future
    // refactor that shrinks the only dismiss on this banner trips
    // this test. Same approach as the FollowCapsule regression test.
    setUserAgent(UA_ANDROID);
    render(<InstallPrompt />);
    act(() => {
      vi.advanceTimersByTime(SHOW_DELAY_MS);
    });
    const closeBtn = screen.getByRole("button", {
      name: "Dismiss install prompt",
    });
    expect(closeBtn.classList.contains("w-11")).toBe(true);
    expect(closeBtn.classList.contains("h-11")).toBe(true);
    expect(closeBtn.classList.contains("w-8")).toBe(false);
    expect(closeBtn.classList.contains("h-8")).toBe(false);
  });

  it("uses role=region (not dialog) so AT users aren't promised modal semantics the component doesn't deliver", () => {
    setUserAgent(UA_ANDROID);
    render(<InstallPrompt />);
    act(() => {
      vi.advanceTimersByTime(SHOW_DELAY_MS);
    });
    const region = screen.getByRole("region", { name: "Install StandClear" });
    expect(region).toBeDefined();
    // The component intentionally never sets role="dialog" — see the
    // inline comment + PR #117 / routine-log 2026-05-13 06:15.
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
