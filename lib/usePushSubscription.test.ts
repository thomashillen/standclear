import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

// Set the VAPID env var *before* importing the hook so the lazy
// urlBase64 helper sees it. Vitest hoists vi.mock but env reads
// happen at runtime, which is fine — just keep this near the top.
process.env.NEXT_PUBLIC_VAPID_KEY = "BPx-placeholder";

vi.mock("./observability", () => ({
  captureException: vi.fn(),
}));

import { usePushSubscription } from "./usePushSubscription";

// Test helpers: mock the browser push surface piece by piece so each
// test can assert against a specific state branch without spinning
// up a real service worker.

function setNotificationPermission(
  perm: "default" | "granted" | "denied",
  promptResolves?: "default" | "granted" | "denied",
) {
  // Notification is a global object; in jsdom it exists with a
  // settable .permission only if we replace it. `promptResolves`
  // controls what requestPermission() returns (defaults to the
  // same value as the current permission, since prompting an
  // already-decided permission is a no-op).
  Object.defineProperty(window, "Notification", {
    configurable: true,
    value: {
      permission: perm,
      requestPermission: vi.fn().mockResolvedValue(promptResolves ?? perm),
    },
  });
}

function mockServiceWorker(existingSub: object | null) {
  const subscribeSpy = vi.fn().mockResolvedValue({
    endpoint: "https://example.com/test-endpoint",
    keys: { p256dh: "BLcTest", auth: "k7Test" },
    toJSON() {
      return {
        endpoint: this.endpoint,
        keys: this.keys,
      };
    },
    unsubscribe: vi.fn().mockResolvedValue(true),
  });
  const getSubscriptionSpy = vi.fn().mockResolvedValue(existingSub);
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      ready: Promise.resolve({
        pushManager: {
          getSubscription: getSubscriptionSpy,
          subscribe: subscribeSpy,
        },
      }),
    },
  });
  return { subscribeSpy, getSubscriptionSpy };
}

function mockPushManager() {
  Object.defineProperty(window, "PushManager", {
    configurable: true,
    value: function PushManager() {},
  });
}

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value: ua,
    writable: true,
  });
}

function setStandaloneFalse() {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
}

const fetchSpy = vi.fn();

describe("usePushSubscription", () => {
  beforeEach(() => {
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValue({ ok: true });
    Object.defineProperty(global, "fetch", {
      configurable: true,
      value: fetchSpy,
    });
    // Clean per-test localStorage.
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is 'unsupported' when Notification/PushManager are missing", async () => {
    // Strip the APIs.
    // @ts-expect-error — deleting global for test only
    delete window.Notification;
    // @ts-expect-error — deleting global for test only
    delete window.PushManager;
    const { result } = renderHook(() => usePushSubscription());
    await waitFor(() => expect(result.current.state).toBe("unsupported"));
  });

  it("is 'needs-install' on iOS Safari outside a PWA", async () => {
    setNotificationPermission("default");
    mockPushManager();
    mockServiceWorker(null);
    setUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605",
    );
    setStandaloneFalse();
    const { result } = renderHook(() => usePushSubscription());
    await waitFor(() => expect(result.current.state).toBe("needs-install"));
  });

  it("is 'default' when permission has not been asked", async () => {
    setNotificationPermission("default");
    mockPushManager();
    mockServiceWorker(null);
    setUserAgent("Mozilla/5.0 (X11; Linux x86_64)");
    setStandaloneFalse();
    const { result } = renderHook(() => usePushSubscription());
    await waitFor(() => expect(result.current.state).toBe("default"));
  });

  it("is 'denied' when permission is blocked", async () => {
    setNotificationPermission("denied");
    mockPushManager();
    mockServiceWorker(null);
    setUserAgent("Mozilla/5.0 (X11; Linux x86_64)");
    setStandaloneFalse();
    const { result } = renderHook(() => usePushSubscription());
    await waitFor(() => expect(result.current.state).toBe("denied"));
  });

  it("is 'granted-subscribed' when a PushSubscription already exists", async () => {
    setNotificationPermission("granted");
    mockPushManager();
    mockServiceWorker({ endpoint: "https://x.example/sub" });
    setUserAgent("Mozilla/5.0 (X11; Linux x86_64)");
    setStandaloneFalse();
    const { result } = renderHook(() => usePushSubscription());
    await waitFor(() =>
      expect(result.current.state).toBe("granted-subscribed"),
    );
  });

  it("is 'granted-not-subscribed' when permission is granted but no sub exists", async () => {
    setNotificationPermission("granted");
    mockPushManager();
    mockServiceWorker(null);
    setUserAgent("Mozilla/5.0 (X11; Linux x86_64)");
    setStandaloneFalse();
    const { result } = renderHook(() => usePushSubscription());
    await waitFor(() =>
      expect(result.current.state).toBe("granted-not-subscribed"),
    );
  });

  it("subscribes and POSTs to /api/notifications/subscribe on tap", async () => {
    setNotificationPermission("default", "granted");
    mockPushManager();
    mockServiceWorker(null);
    setUserAgent("Mozilla/5.0 (X11; Linux x86_64)");
    setStandaloneFalse();
    const { result } = renderHook(() => usePushSubscription());
    await waitFor(() => expect(result.current.state).toBe("default"));

    await act(async () => {
      await result.current.subscribe();
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/notifications/subscribe");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.endpoint).toBe("https://example.com/test-endpoint");
    expect(body.keys.p256dh).toBe("BLcTest");
    expect(body.lines).toEqual([]); // v1 = severe-tier sentinel
    expect(typeof body.anonymousId).toBe("string");
    expect(body.anonymousId.length).toBeGreaterThan(0);

    expect(result.current.state).toBe("granted-subscribed");
  });

  it("reuses the same anonymousId across subscribe calls (localStorage)", async () => {
    setNotificationPermission("default", "granted");
    mockPushManager();
    mockServiceWorker(null);
    setUserAgent("Mozilla/5.0 (X11; Linux x86_64)");
    setStandaloneFalse();
    const { result } = renderHook(() => usePushSubscription());
    await waitFor(() => expect(result.current.state).toBe("default"));

    await act(async () => {
      await result.current.subscribe();
    });
    const firstId = JSON.parse(fetchSpy.mock.calls[0][1].body as string)
      .anonymousId;

    await act(async () => {
      await result.current.subscribe();
    });
    const secondId = JSON.parse(fetchSpy.mock.calls[1][1].body as string)
      .anonymousId;

    expect(firstId).toBe(secondId);
  });

  it("subscribe → 'denied' on permission denial", async () => {
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: {
        permission: "default",
        requestPermission: vi.fn().mockResolvedValue("denied"),
      },
    });
    mockPushManager();
    mockServiceWorker(null);
    setUserAgent("Mozilla/5.0 (X11; Linux x86_64)");
    setStandaloneFalse();
    const { result } = renderHook(() => usePushSubscription());
    await waitFor(() => expect(result.current.state).toBe("default"));

    await act(async () => {
      await result.current.subscribe();
    });

    expect(result.current.state).toBe("denied");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("unsubscribe POSTs and returns to 'granted-not-subscribed'", async () => {
    setNotificationPermission("granted");
    mockPushManager();
    const existing = {
      endpoint: "https://x.example/sub",
      unsubscribe: vi.fn().mockResolvedValue(true),
    };
    mockServiceWorker(existing);
    setUserAgent("Mozilla/5.0 (X11; Linux x86_64)");
    setStandaloneFalse();
    const { result } = renderHook(() => usePushSubscription());
    await waitFor(() =>
      expect(result.current.state).toBe("granted-subscribed"),
    );

    await act(async () => {
      await result.current.unsubscribe();
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/notifications/unsubscribe");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(typeof body.anonymousId).toBe("string");

    expect(result.current.state).toBe("granted-not-subscribed");
    expect(existing.unsubscribe).toHaveBeenCalled();
  });

  it("rolls back the browser sub if the server returns non-ok", async () => {
    setNotificationPermission("default", "granted");
    mockPushManager();
    const { subscribeSpy } = mockServiceWorker(null);
    setUserAgent("Mozilla/5.0 (X11; Linux x86_64)");
    setStandaloneFalse();
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 500 });

    const { result } = renderHook(() => usePushSubscription());
    await waitFor(() => expect(result.current.state).toBe("default"));

    await act(async () => {
      await result.current.subscribe();
    });

    // Should still be "default" — the server reject means we
    // shouldn't claim subscribed.
    expect(result.current.state).toBe("default");
    // The browser-side sub from pushManager.subscribe() should have
    // been rolled back via .unsubscribe().
    const createdSub = await subscribeSpy.mock.results[0].value;
    expect(createdSub.unsubscribe).toHaveBeenCalled();
  });
});
