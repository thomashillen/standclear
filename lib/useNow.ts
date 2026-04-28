"use client";

import { useEffect, useState } from "react";

/**
 * Ticking wall-clock timestamp for live countdown UIs. Returns Date.now()
 * and updates the consumer every `intervalMs` while `enabled` is true.
 * When disabled, the hook stops the timer and freezes the value, so a
 * closed sheet doesn't keep the tab busy or hold a wakelock open on
 * mobile Safari. Pause-on-hidden mirrors useTrains: backgrounded tabs
 * don't tick.
 */
export function useNow(enabled: boolean = true, intervalMs: number = 1000): number {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!enabled) return;
    // First paint reads from the useState lazy initializer's Date.now(),
    // so the initial value is already current. Subsequent ticks come
    // from setInterval; no snap-to-now is needed and avoiding a
    // setState-in-effect keeps React 19's purity rule happy.
    let id: ReturnType<typeof setInterval> | null = setInterval(
      () => setNow(Date.now()),
      intervalMs,
    );
    const onVisibility = () => {
      if (typeof document === "undefined") return;
      if (document.hidden) {
        if (id) {
          clearInterval(id);
          id = null;
        }
      } else if (id == null) {
        // Coming back from background — push the freshest "now" so any
        // ETAs that crossed a minute boundary while we were hidden snap
        // to the right value before the next interval fires.
        setNow(Date.now());
        id = setInterval(() => setNow(Date.now()), intervalMs);
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }
    return () => {
      if (id) clearInterval(id);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }, [enabled, intervalMs]);

  return now;
}
