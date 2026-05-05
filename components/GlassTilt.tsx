"use client";

import { useEffect } from "react";

// Maximum device tilt (degrees) we map to the full ±50% specular
// excursion. Beyond this the highlight just clamps — riders rarely
// hold a phone past 25° from level for sustained reading, and going
// further makes the gradient slide off the surface entirely.
const MAX_TILT_DEG = 25;

// Smoothing factor for incoming samples. DeviceOrientation events on
// iOS emit at ~60 Hz with mild jitter; a low-pass blends successive
// readings so the specular highlight glides instead of chattering.
// 0 = freeze, 1 = no smoothing. 0.18 ≈ ~10-frame settle to a stable
// pose, fast enough to feel reactive but slow enough to read as
// "real glass" rather than a gyroscope debug overlay.
const SMOOTH = 0.18;

type WindowWithDOE = Window & {
  DeviceOrientationEvent?: typeof DeviceOrientationEvent & {
    requestPermission?: () => Promise<"granted" | "denied">;
  };
};

/**
 * Drives the global `--glass-tilt-x` / `--glass-tilt-y` CSS variables
 * that every `.ios-glass` surface reads from for its specular
 * highlight gradient. Two sources, in priority order:
 *
 *   1. DeviceOrientation events (mobile, gyroscope-equipped). Auto-
 *      attaches on platforms where permission is implicit (Android,
 *      older iOS). On iOS 13+ the gated `requestPermission` API
 *      requires a user gesture to grant — we don't auto-prompt
 *      (would feel intrusive on a transit app). A future toggle in
 *      MoreSheet can opt riders in if they want the full effect.
 *   2. Pointer position (desktop, plus iOS without orientation
 *      permission). The tilt tracks the cursor so a user moving
 *      their mouse over a panel still gets a live, light-catching
 *      highlight.
 *
 * Once an orientation event has been observed, pointer events are
 * ignored for the rest of the session — mixing the two sources
 * mid-stream produces a janky double-source highlight.
 *
 * Rendered as a sibling node (returns null) so it can be mounted
 * inside the root layout without wrapping content.
 */
export function GlassTilt() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;

    const root = document.documentElement;
    let raf = 0;
    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;
    let source: "pointer" | "orientation" = "pointer";

    const flush = () => {
      raf = 0;
      // Continue animating until we're within 0.05% of target, then
      // snap. Avoids rAF leaking past a settled pose.
      currentX += (targetX - currentX) * SMOOTH;
      currentY += (targetY - currentY) * SMOOTH;
      const settled =
        Math.abs(targetX - currentX) < 0.05 &&
        Math.abs(targetY - currentY) < 0.05;
      if (settled) {
        currentX = targetX;
        currentY = targetY;
      }
      root.style.setProperty("--glass-tilt-x", currentX.toFixed(2) + "%");
      root.style.setProperty("--glass-tilt-y", currentY.toFixed(2) + "%");
      if (!settled) raf = requestAnimationFrame(flush);
    };
    const queue = () => {
      if (raf) return;
      raf = requestAnimationFrame(flush);
    };

    const onPointer = (e: PointerEvent) => {
      if (source === "orientation") return;
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      // Map cursor to ±50%, then dampen to ±35% so the highlight
      // doesn't ride the surface edge at extreme corners.
      targetX = ((e.clientX / w) * 2 - 1) * 35;
      targetY = ((e.clientY / h) * 2 - 1) * 35;
      queue();
    };

    const onOrientation = (e: DeviceOrientationEvent) => {
      // First orientation sample takes over from pointer for the
      // remainder of the session. Mixing produces a jittery dual
      // highlight on hybrid devices (iPad with a trackpad).
      if (source !== "orientation") source = "orientation";
      const beta = e.beta ?? 0; // front/back tilt, -180 → 180
      const gamma = e.gamma ?? 0; // left/right tilt, -90 → 90
      const clampedB = Math.max(-MAX_TILT_DEG, Math.min(MAX_TILT_DEG, beta));
      const clampedG = Math.max(-MAX_TILT_DEG, Math.min(MAX_TILT_DEG, gamma));
      // Account for landscape orientation: gamma maps to "left/right"
      // in the device frame, but the visible viewport's horizontal
      // axis swaps when the screen rotates. screen.orientation.angle
      // is the most reliable read across browsers.
      const angle =
        (typeof screen !== "undefined" && screen.orientation?.angle) || 0;
      let xDeg = clampedG;
      let yDeg = clampedB;
      if (angle === 90) {
        xDeg = -clampedB;
        yDeg = clampedG;
      } else if (angle === -90 || angle === 270) {
        xDeg = clampedB;
        yDeg = -clampedG;
      } else if (angle === 180) {
        xDeg = -clampedG;
        yDeg = -clampedB;
      }
      targetX = (xDeg / MAX_TILT_DEG) * 50;
      targetY = (yDeg / MAX_TILT_DEG) * 50;
      queue();
    };

    const W = window as WindowWithDOE;
    const Doe = W.DeviceOrientationEvent;
    // Attach orientation listener only on platforms that don't gate
    // it behind a user-gesture permission prompt (Android, older
    // iOS). On iOS 13+ the listener would silently no-op anyway.
    if (Doe && typeof Doe.requestPermission !== "function") {
      window.addEventListener(
        "deviceorientation",
        onOrientation as EventListener,
        { passive: true },
      );
    }

    window.addEventListener("pointermove", onPointer, { passive: true });

    return () => {
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener(
        "deviceorientation",
        onOrientation as EventListener,
      );
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return null;
}
