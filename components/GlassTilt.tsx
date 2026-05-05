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

// localStorage key for the iOS permission grant. Surviving the grant
// across reloads matters because iOS' `requestPermission` *requires*
// a user gesture each call, but a stored "granted" flag lets the
// next session attach the listener directly without re-prompting.
const PERMISSION_STORAGE_KEY = "standclear:glass-tilt-permission";

// Custom event the GlassTilt instance listens for so a runtime grant
// (e.g. from MoreSheet's "Reactive glass on tilt" toggle) can attach
// the orientation listener without unmounting/remounting the
// provider. The event carries no payload — the listener just calls
// the same attach path it would on initial mount.
const PERMISSION_EVENT = "standclear:glass-tilt-permission-granted";

type WindowWithDOE = Window & {
  DeviceOrientationEvent?: typeof DeviceOrientationEvent & {
    requestPermission?: () => Promise<"granted" | "denied">;
  };
};

/**
 * True only when the runtime is iOS Safari (or another platform that
 * gates DeviceOrientation behind `requestPermission`). UI surfaces
 * use this to decide whether to render the opt-in toggle at all —
 * everywhere else the listener attaches automatically and the toggle
 * would be confusing.
 */
export function isGlassTiltGated(): boolean {
  if (typeof window === "undefined") return false;
  const W = window as WindowWithDOE;
  return (
    !!W.DeviceOrientationEvent &&
    typeof W.DeviceOrientationEvent.requestPermission === "function"
  );
}

/**
 * True when the rider has already granted permission in a previous
 * session (or this one). MoreSheet uses this to render the toggle in
 * its "on" state without re-prompting.
 */
export function isGlassTiltGranted(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(PERMISSION_STORAGE_KEY) === "granted";
  } catch {
    return false;
  }
}

/**
 * Prompt the rider for DeviceOrientation permission. Must be called
 * synchronously inside a user-gesture handler (click / pointerdown);
 * iOS rejects the prompt otherwise. On grant, stores the flag and
 * dispatches a custom event so the live `<GlassTilt />` instance
 * can attach the listener without unmounting. Returns the actual
 * outcome so callers can surface a denied state.
 */
export async function requestGlassTiltPermission(): Promise<
  "granted" | "denied" | "unsupported"
> {
  if (typeof window === "undefined") return "unsupported";
  const W = window as WindowWithDOE;
  const Doe = W.DeviceOrientationEvent;
  if (!Doe || typeof Doe.requestPermission !== "function") return "unsupported";
  try {
    const result = await Doe.requestPermission();
    if (result === "granted") {
      try {
        window.localStorage.setItem(PERMISSION_STORAGE_KEY, "granted");
      } catch {
        // Quota / private mode — best-effort only.
      }
      window.dispatchEvent(new CustomEvent(PERMISSION_EVENT));
    }
    return result;
  } catch {
    return "denied";
  }
}

/**
 * Drives the global `--glass-tilt-x` / `--glass-tilt-y` CSS variables
 * that every `.ios-glass` surface reads from for its specular
 * highlight gradient. Two sources, in priority order:
 *
 *   1. DeviceOrientation events (mobile, gyroscope-equipped). Auto-
 *      attaches on platforms where permission is implicit (Android,
 *      older iOS) and on iOS where the rider previously opted in.
 *      On iOS 13+ the gated `requestPermission` API requires a user
 *      gesture to grant — we don't auto-prompt (would feel intrusive
 *      on a transit app). MoreSheet's "Reactive glass on tilt" row
 *      drives the prompt and dispatches `PERMISSION_EVENT` on grant
 *      so this provider can attach the listener mid-session.
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

    let orientationAttached = false;
    const attachOrientation = () => {
      if (orientationAttached) return;
      orientationAttached = true;
      window.addEventListener(
        "deviceorientation",
        onOrientation as EventListener,
        { passive: true },
      );
    };

    const W = window as WindowWithDOE;
    const Doe = W.DeviceOrientationEvent;
    if (Doe) {
      if (typeof Doe.requestPermission !== "function") {
        // Implicit-permission platform (Android, older iOS) — the
        // listener fires from page load.
        attachOrientation();
      } else if (isGlassTiltGranted()) {
        // iOS-style gated permission, but the rider already granted
        // it in a previous session. Reattach immediately so the
        // tilt highlight works without a fresh prompt.
        attachOrientation();
      } else {
        // Wait for an explicit grant. MoreSheet's "Reactive glass on
        // tilt" toggle calls `requestGlassTiltPermission()`, which
        // dispatches this event on success.
        window.addEventListener(PERMISSION_EVENT, attachOrientation);
      }
    }

    window.addEventListener("pointermove", onPointer, { passive: true });

    return () => {
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener(
        "deviceorientation",
        onOrientation as EventListener,
      );
      window.removeEventListener(PERMISSION_EVENT, attachOrientation);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return null;
}
