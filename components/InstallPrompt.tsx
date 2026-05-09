"use client";

import { useEffect, useState } from "react";
import { Share, X } from "lucide-react";
import { isNative } from "@/lib/native";

// ─── Add-to-Home-Screen prompt ───────────────────────────────────────
// Shows once, on mobile, when the rider isn't already running the
// installed PWA. Two paths:
//
//   • Android / Chromium: listens for `beforeinstallprompt`, defers
//     it, and surfaces a native "Install" button that calls prompt().
//   • iOS Safari: that event doesn't exist on iOS, so we surface a
//     short instruction with the share-glyph + "Add to Home Screen"
//     copy. The rider has to do the gesture themselves.
//
// The prompt waits ~60s into the first session before appearing —
// long enough that "first contact" friction is past, short enough
// that a brief visit still gets the prompt. Dismissal sticks via
// localStorage so we never nag twice.

const STORAGE_KEY = "standclear:a2hs-dismissed:v1";
const SHOW_DELAY_MS = 60_000;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return true;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  // iOS-specific
  return (
    "standalone" in window.navigator &&
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

function isMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !("MSStream" in window)
  );
}

function dismissed(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function markDismissed() {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // Quota / private mode — accept that we may show it next visit.
  }
}

export default function InstallPrompt() {
  const [show, setShow] = useState(false);
  const [deferred, setDeferred] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    // Already running as a native app — no install prompt makes sense.
    if (isNative()) return;
    if (isStandalone() || !isMobile() || dismissed()) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    // One-shot platform sniff on mount — the install path differs
    // between iOS Safari (manual share-sheet flow) and Android/
    // Chromium (deferred beforeinstallprompt).
    setIos(isIos());
    /* eslint-enable react-hooks/set-state-in-effect */
    const handleBefore = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handleBefore);
    const t = setTimeout(() => setShow(true), SHOW_DELAY_MS);
    return () => {
      clearTimeout(t);
      window.removeEventListener("beforeinstallprompt", handleBefore);
    };
  }, []);

  if (!show) return null;

  const close = () => {
    setShow(false);
    markDismissed();
  };

  const triggerNative = async () => {
    if (!deferred) return;
    try {
      await deferred.prompt();
      await deferred.userChoice;
    } catch {
      // Swallow — the dismiss path below records the choice anyway.
    }
    close();
  };

  return (
    <div
      className="
        pointer-events-none fixed inset-x-0 z-40 px-3
        bottom-[calc(env(safe-area-inset-bottom)+1rem)]
      "
      role="dialog"
      aria-label="Install StandClear"
    >
      <div
        className="
          pointer-events-auto mx-auto max-w-sm
          ios-glass ios-glass--sheet rounded-2xl border border-white/[0.10]
          shadow-[0_20px_60px_-10px_rgba(0,0,0,0.6)]
          p-3 pr-2 flex items-start gap-3
        "
      >
        <span
          className="flex-shrink-0 w-10 h-10 rounded-full bg-emerald-500/15 ring-1 ring-emerald-400/30 flex items-center justify-center text-emerald-200 text-[20px]"
          aria-hidden
        >
          🚇
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-gray-100 leading-tight">
            Install StandClear
          </p>
          {ios ? (
            <p className="mt-1 text-[12px] text-gray-400 leading-snug">
              Tap{" "}
              <span className="inline-flex items-center align-[-2px] mx-0.5">
                <Share className="w-3.5 h-3.5" />
              </span>{" "}
              then <strong className="text-gray-200">Add to Home Screen</strong>{" "}
              for one-tap access.
            </p>
          ) : (
            <p className="mt-1 text-[12px] text-gray-400 leading-snug">
              Add it to your home screen for one-tap access — works
              offline, opens in a clean window.
            </p>
          )}
          {deferred && !ios && (
            <button
              type="button"
              onClick={triggerNative}
              className="press mt-2.5 px-3 py-1.5 rounded-full bg-white text-gray-950 font-semibold text-[12px] hover:bg-gray-100 active:bg-gray-200 transition-colors"
            >
              Install app
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={close}
          aria-label="Dismiss install prompt"
          className="press flex-shrink-0 -mt-0.5 -mr-0.5 w-8 h-8 flex items-center justify-center rounded-full bg-white/[0.06] hover:bg-white/[0.10] text-gray-300 touch-manipulation"
        >
          <X className="w-3.5 h-3.5" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
