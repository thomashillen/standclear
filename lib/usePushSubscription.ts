"use client";

import { useCallback, useEffect, useState } from "react";
import { captureException } from "./observability";

// ─── Push subscription state machine ────────────────────────────────
// Bridges three browser APIs (Notification, ServiceWorker, PushManager)
// + our server-side subscription store into a single state the
// MoreSheet UI can switch on. The transitions are explicit so we
// don't have to interpret raw permission strings + subscription
// objects inline in JSX:
//
//   unsupported           — the browser lacks Notification API,
//                           ServiceWorker, or PushManager. Hide the
//                           opt-in row entirely.
//
//   needs-install         — running mobile Safari in a regular
//                           browser tab. iOS only delivers push
//                           inside installed PWAs (since iOS 16.4),
//                           so we surface an "Add to Home Screen"
//                           hint instead of a dead button.
//
//   default               — permission has never been asked. Show
//                           the [Enable] button.
//
//   granted-subscribed    — fully wired up. Show the [On] toggle
//                           that flips to unsubscribe.
//
//   granted-not-subscribed — permission was granted but the local
//                           PushSubscription is missing (cleared
//                           site data, browser-rotated endpoint
//                           that we haven't re-registered, etc.).
//                           Show [Re-enable] — calling subscribe()
//                           skips the permission prompt and just
//                           re-registers.
//
//   denied                — permission denied. Show "Blocked —
//                           change in browser settings" — we can't
//                           re-prompt.

export type PushState =
  | "unsupported"
  | "needs-install"
  | "default"
  | "granted-subscribed"
  | "granted-not-subscribed"
  | "denied";

const ANON_ID_KEY = "standclear:anonymous-id:v1";

function getOrMintAnonymousId(): string {
  try {
    const existing = window.localStorage.getItem(ANON_ID_KEY);
    if (existing) return existing;
    // crypto.randomUUID() is available in every browser that supports
    // PushManager + service workers, so no fallback needed here.
    const fresh = crypto.randomUUID();
    window.localStorage.setItem(ANON_ID_KEY, fresh);
    return fresh;
  } catch {
    // localStorage quota / private mode — return a per-session UUID
    // so the subscribe call still works; the rider just won't
    // recognize themselves across browser restarts.
    return crypto.randomUUID();
  }
}

// VAPID public key arrives base64-url-encoded from process.env. The
// pushManager.subscribe() API wants an ArrayBuffer-backed view of
// the raw bytes — we go through a fresh ArrayBuffer explicitly
// because TS 6's narrower `BufferSource` type rejects the
// SharedArrayBuffer-compatible default Uint8Array constructor.
function urlBase64ToBufferSource(base64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buf;
}

function detectIosBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  return (
    "standalone" in window.navigator &&
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

function isPushSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

async function resolveInitialState(): Promise<PushState> {
  if (!isPushSupported()) {
    // iOS not-installed is a special case: the APIs *exist* but
    // push won't be delivered. Detect the install gap and route
    // riders to the Add-to-Home-Screen flow instead of letting
    // them subscribe to a feed that'll never fire.
    return "unsupported";
  }
  if (detectIosBrowser() && !isStandalone()) {
    return "needs-install";
  }
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission === "default") return "default";

  // Permission granted. Check whether a PushSubscription is
  // currently registered with the SW — if it's been cleared by the
  // browser or never registered, we're "granted-not-subscribed".
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub ? "granted-subscribed" : "granted-not-subscribed";
  } catch {
    return "granted-not-subscribed";
  }
}

// Rider-facing error copy. Operator detail goes to captureException;
// these strings are what shows up under the row. Kept generic on
// purpose — "try again" is the only action a rider can take, and
// HTTP status / VAPID-misconfig framing belongs in the function log,
// not the panel.
const ERR_SUBSCRIBE = "Couldn't enable notifications. Try again.";
const ERR_UNSUBSCRIBE = "Couldn't disable notifications. Try again.";
const ERR_NOT_CONFIGURED = "Notifications aren't set up on this deploy.";

export function usePushSubscription(): {
  state: PushState;
  /** True while subscribe() / unsubscribe() is mid-flight. UI uses
   *  this to disable the button + show a spinner. */
  pending: boolean;
  /** Last subscribe/unsubscribe failure surface-ready for the row.
   *  Null when the operation succeeded or hasn't been attempted; set
   *  on fetch reject, non-2xx, missing VAPID, or thrown push API
   *  errors. Cleared at the start of the next attempt. The hook
   *  intentionally treats user-dismissed permission prompts (perm =
   *  "default") as not-an-error — the rider explicitly declined, so
   *  the [Enable] affordance stays as the next step. */
  error: string | null;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
} {
  // Start in "unsupported" — the safest default — and let the
  // effect below correct the state once we've actually inspected
  // the browser. Prevents a brief "Enable" button flash on SSR /
  // pre-mount renders.
  const [state, setState] = useState<PushState>("unsupported");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = await resolveInitialState();
      if (!cancelled) setState(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const subscribe = useCallback(async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      // Permission prompt. Must run from a user-gesture chain — the
      // calling component invokes subscribe() from an onClick, which
      // satisfies that. Re-prompting an already-granted permission
      // is a no-op.
      const perm = await Notification.requestPermission();
      if (perm === "denied") {
        setState("denied");
        return;
      }
      if (perm !== "granted") {
        // "default" — user dismissed without choosing. Stay where
        // we were so the [Enable] button keeps its affordance.
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const vapidPub = process.env.NEXT_PUBLIC_VAPID_KEY;
      if (!vapidPub) {
        captureException(new Error("VAPID public key not configured"), {
          source: "usePushSubscription",
        });
        setError(ERR_NOT_CONFIGURED);
        return;
      }

      // Re-use any existing PushSubscription before creating a new
      // one — re-subscribing returns the existing object, but we
      // want to be explicit about not double-creating.
      const existing = await reg.pushManager.getSubscription();
      const sub =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToBufferSource(vapidPub),
        }));

      const json = sub.toJSON() as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      };
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        captureException(new Error("PushSubscription missing fields"), {
          source: "usePushSubscription",
        });
        setError(ERR_SUBSCRIBE);
        return;
      }

      const res = await fetch("/api/notifications/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          anonymousId: getOrMintAnonymousId(),
          endpoint: json.endpoint,
          keys: json.keys,
          // v1: severe-tier subscriber. Empty array is the sentinel
          // PR 3's dispatch logic reads as "fire for every severe
          // alert regardless of which routes are affected." When
          // per-line opt-ins ship in v2, this becomes the rider's
          // selected route set.
          lines: [],
        }),
      });
      if (!res.ok) {
        captureException(new Error(`Subscribe HTTP ${res.status}`), {
          source: "usePushSubscription",
        });
        // Roll back the browser-side subscription so a future retry
        // doesn't think we're already subscribed.
        await sub.unsubscribe().catch(() => {});
        setError(ERR_SUBSCRIBE);
        return;
      }
      setState("granted-subscribed");
    } catch (err) {
      captureException(err, { source: "usePushSubscription:subscribe" });
      setError(ERR_SUBSCRIBE);
    } finally {
      setPending(false);
    }
  }, [pending]);

  const unsubscribe = useCallback(async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    // Track whether the server-side delete actually landed. A failed
    // unsubscribe shouldn't claim the rider is unsubscribed, otherwise
    // a transient 500 would silently leave them subscribed on the
    // server while the UI flips to off.
    let serverOk = false;
    try {
      const anonymousId = getOrMintAnonymousId();
      // Server-side first — if this fails we're still subscribed
      // browser-side, which is recoverable on the rider's next
      // subscribe tap. The reverse order would leave a zombie
      // server-side row pointing at a dead browser endpoint.
      try {
        const res = await fetch("/api/notifications/unsubscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ anonymousId }),
        });
        serverOk = res.ok;
        if (!res.ok) {
          captureException(new Error(`Unsubscribe HTTP ${res.status}`), {
            source: "usePushSubscription",
          });
        }
      } catch (err) {
        captureException(err, { source: "usePushSubscription:unsubscribe" });
      }

      if (!serverOk) {
        setError(ERR_UNSUBSCRIBE);
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();

      // Permission still granted, just no active subscription.
      setState(
        Notification.permission === "granted"
          ? "granted-not-subscribed"
          : "default",
      );
    } catch (err) {
      captureException(err, { source: "usePushSubscription:unsubscribe" });
      setError(ERR_UNSUBSCRIBE);
    } finally {
      setPending(false);
    }
  }, [pending]);

  return { state, pending, error, subscribe, unsubscribe };
}
