"use client";

import { Bell, BellOff, Share } from "lucide-react";
import { usePushSubscription } from "@/lib/usePushSubscription";

// ─── NotificationsRow ───────────────────────────────────────────────
// The MoreSheet's "get push when a line is suspended" opt-in row.
// Every state branch renders the same outer chrome (rounded card,
// bell icon, title, helper line) — only the trailing affordance
// differs (button, status pill, "Add to Home Screen" hint). Keeps
// the layout stable so the rider's eye doesn't jump as state
// transitions.
//
// Owns its own section wrapper + heading so unsupported browsers
// render absolutely nothing (no stranded "Notifications" header
// over an empty space).

export function NotificationsRow() {
  const { state, pending, error, subscribe, unsubscribe } =
    usePushSubscription();

  if (state === "unsupported") return null;

  const baseCard =
    "w-full flex items-center gap-3 px-3 py-3 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] touch-manipulation text-left";

  const inner = renderInner(state, pending, subscribe, unsubscribe, baseCard);
  return (
    <section>
      <h3 className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        Notifications
      </h3>
      {inner}
      {/* role="alert" (implicit aria-live="assertive") so a SR rider
          hears the failure without waiting for a polite queue — the
          tap they just made appeared to do nothing. The region exists
          even when empty so React preserves its identity across
          re-renders; some AT pairs only announce subsequent text
          updates inside a live region that mounted before the text. */}
      <p
        role="alert"
        className={`px-3 pt-2 text-[12px] text-rose-300 leading-snug ${
          error ? "" : "sr-only"
        }`}
      >
        {error ?? ""}
      </p>
    </section>
  );
}

function renderInner(
  state: Exclude<ReturnType<typeof usePushSubscription>["state"], "unsupported">,
  pending: boolean,
  subscribe: () => Promise<void>,
  unsubscribe: () => Promise<void>,
  baseCard: string,
): React.ReactNode {

  // iOS Safari outside an installed PWA — push will never fire.
  // Render an explanatory card pointing at the share-sheet flow
  // rather than a dead [Enable] button. The InstallPrompt component
  // already handles the actual share-sheet hint at the bottom of
  // the viewport; this row reinforces *why* installing matters now.
  if (state === "needs-install") {
    return (
      <div
        className={`${baseCard} cursor-default`}
        role="status"
        aria-label="Install StandClear to your Home Screen to enable push alerts"
      >
        <span className="flex items-center justify-center w-9 h-9 rounded-full bg-amber-500/15 text-amber-200 ring-1 ring-amber-500/30 flex-shrink-0">
          <Share className="w-4 h-4" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[14px] font-semibold text-gray-100">
            Add to Home Screen first
          </span>
          <span className="block text-[12px] text-gray-400 leading-snug">
            iOS only delivers push notifications inside installed apps.
            Tap the share icon, then &ldquo;Add to Home Screen&rdquo;.
          </span>
        </span>
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div
        className={`${baseCard} cursor-default`}
        role="status"
        aria-label="Notifications blocked in browser settings"
      >
        <span className="flex items-center justify-center w-9 h-9 rounded-full bg-rose-500/15 text-rose-200 ring-1 ring-rose-500/30 flex-shrink-0">
          <BellOff className="w-4 h-4" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[14px] font-semibold text-gray-100">
            Notifications blocked
          </span>
          <span className="block text-[12px] text-gray-400 leading-snug">
            Enable in your browser&rsquo;s site settings to get push
            alerts about service disruptions.
          </span>
        </span>
      </div>
    );
  }

  // "default" or "granted-not-subscribed" — both want a [Enable]
  // tap. Permission-prompt only fires for "default"; the granted
  // branch silently re-registers.
  if (state === "default" || state === "granted-not-subscribed") {
    return (
      <button
        type="button"
        onClick={subscribe}
        disabled={pending}
        className={`${baseCard} press disabled:opacity-60 disabled:cursor-not-allowed`}
        aria-label="Enable push notifications for severe service alerts"
      >
        <span className="flex items-center justify-center w-9 h-9 rounded-full bg-white/[0.08] text-gray-300 flex-shrink-0">
          <Bell className="w-4 h-4" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[14px] font-semibold text-gray-100">
            Service alert push
          </span>
          <span className="block text-[12px] text-gray-400 leading-snug">
            Get notified when a line is suspended or has no service.
            Severe alerts only — quiet otherwise.
          </span>
        </span>
        <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-300 flex-shrink-0">
          {pending ? "…" : "Enable"}
        </span>
      </button>
    );
  }

  // granted-subscribed — fully on. Tap unsubscribes.
  return (
    <button
      type="button"
      onClick={unsubscribe}
      disabled={pending}
      className={`${baseCard} press disabled:opacity-60 disabled:cursor-not-allowed`}
      aria-label="Disable push notifications"
    >
      <span className="flex items-center justify-center w-9 h-9 rounded-full bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/30 flex-shrink-0">
        <Bell className="w-4 h-4" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[14px] font-semibold text-gray-100">
          Service alert push
        </span>
        <span className="block text-[12px] text-gray-400 leading-snug">
          On — you&rsquo;ll get a push when a line is suspended. Tap to
          turn off.
        </span>
      </span>
      <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-300 flex-shrink-0">
        {pending ? "…" : "On"}
      </span>
    </button>
  );
}
