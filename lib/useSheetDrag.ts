"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

// Shared subscription to the mobile-layout media query. Reads through
// useSyncExternalStore so the value is always live (no setState-in-
// effect cascade) and the SSR pass renders with the same `false` the
// client uses during hydration — matching the server keeps the bottom
// sheet's transform off until after hydration, when the real match
// state is applied.
const MOBILE_MQ = "(max-width: 639px)";

function subscribeMobileMq(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia(MOBILE_MQ);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

function getMobileMqSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(MOBILE_MQ).matches;
}

function getMobileMqServerSnapshot(): boolean {
  return false;
}

export type Detent = "half" | "full";

interface SheetDragResult {
  detent: Detent;
  setDetent: (d: Detent) => void;
  // CSS inline style to apply to the sheet container. Encodes the current
  // detent's resting position plus any in-flight drag offset. Sheet height
  // should be fixed at the `full` value so the drag just translates it.
  sheetStyle: React.CSSProperties;
  handlers: {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => void;
  };
  // Touch handlers to attach to the sheet's *scrollable content
  // region* (NOT the header). When the rider's finger starts at the
  // top of the scroll (`scrollTop === 0`), these promote a vertical
  // drag into a detent change instead of a no-op rubber-band:
  //
  //   • half  + drag-up   → expand to full
  //   • full  + drag-down → collapse to half
  //   • half  + drag-down → dismiss (when `dismissOnDrag`)
  //
  // Mirrors the iOS native sheet pattern where the boundary between
  // "scroll content" and "drag sheet" is whether the content has
  // already scrolled. If the rider starts mid-scroll, native scroll
  // wins and we step out of the way.
  contentHandlers: {
    onTouchStart: (e: React.TouchEvent<HTMLElement>) => void;
    onTouchMove: (e: React.TouchEvent<HTMLElement>) => void;
    onTouchEnd: () => void;
    onTouchCancel: () => void;
  };
  // Optional handler to toggle detent on tap (without a drag).
  onHandleTap: () => void;
  // True while a pointer drag is in flight. Surfaces wire this into
  // `data-glass-active` on the panel root so the iOS-26 inset highlight
  // brightens during the gesture — the surface "catches light" as the
  // rider grabs it.
  isDragging: boolean;
}

interface SheetDragOptions {
  // Resting translateY at each detent, expressed as a CSS value. The sheet
  // is `fullHeight` tall and sits pinned to the bottom; at `full` the
  // translateY is 0, at `half` it's a positive px/dvh value that slides
  // the lower portion off-screen.
  halfRestingY: string;
  fullRestingY?: string;
  // Distance (px) a drag must travel past a detent to commit to a new one.
  commitPx?: number;
  // Distance (px) a downward drag from `half` must travel to dismiss.
  dismissPx?: number;
  // Whether the sheet is currently open. Used to reset state on close.
  open: boolean;
  // Called when the user drags past the dismiss threshold from `half`.
  onDismiss: () => void;
  // Called when detent changes, e.g. to trigger haptic feedback.
  onDetentChange?: (d: Detent) => void;
  // When false, a downward drag past the dismiss threshold collapses
  // back to half instead of closing the sheet. Used by SearchSheet so
  // a rider doesn't accidentally lose their in-progress directions
  // search by pulling the sheet down a touch too far. Default true.
  dismissOnDrag?: boolean;
}

// Single-pointer drag with two detents (half / full) + a dismiss threshold
// at the bottom. The sheet itself is always `full` tall — this hook only
// produces a translateY so the content area keeps a stable height across
// detent changes. Commit distances (80px to change detent, 120px to
// dismiss) match what UIKit uses for small sheets; we don't do velocity
// tracking because pointer events don't expose a reliable v.
export function useSheetDrag({
  halfRestingY,
  fullRestingY = "0px",
  commitPx = 80,
  dismissPx = 120,
  open,
  onDismiss,
  onDetentChange,
  dismissOnDrag = true,
}: SheetDragOptions): SheetDragResult {
  const [detent, setDetentState] = useState<Detent>("half");
  const [dragY, setDragY] = useState(0);
  // Track viewport so we only emit the transform on the mobile bottom-sheet
  // layout. Desktop (sm+) repositions the card as a fixed side panel where
  // a translateY would shove it off-screen. The server snapshot returns
  // false so SSR'd panels (NearbyPanel renders on the server) skip the
  // transform during hydration — the live matchMedia value takes over
  // immediately after.
  const isMobile = useSyncExternalStore(
    subscribeMobileMq,
    getMobileMqSnapshot,
    getMobileMqServerSnapshot,
  );
  // Mirrors `dragStartY.current !== null`. Held in state so the render
  // path can read it without tripping react-hooks/refs (refs aren't
  // safe to read during render — only mutate from event handlers /
  // effects). Toggled in lockstep with dragStartY at the pointer
  // down / up / cancel boundaries.
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef<number | null>(null);
  const dragMoved = useRef(false);

  // Reset to half + clear drag state whenever the sheet closes so
  // re-opening doesn't remember a stale position. Synchronizing to a
  // prop change is exactly what an effect is for here — the React 19
  // lint rule still complains about the synchronous setState, but the
  // alternative ("track previous open in render") would mean writing
  // to refs during render, which trips a stricter rule. Effect wins.
  useEffect(() => {
    if (!open) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setDragY(0);
      setDetentState("half");
      dragStartY.current = null;
      dragMoved.current = false;
      setIsDragging(false);
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [open]);

  const setDetent = useCallback(
    (d: Detent) => {
      setDetentState((prev) => {
        if (prev !== d) onDetentChange?.(d);
        return d;
      });
    },
    [onDetentChange],
  );

  const isDraggable = () =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches;

  const handlers = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (!isDraggable()) return;
      // Drag zone is the whole header — pointerdown can land on an
      // interactive child (close, star, route bullet). Skip drag init
      // there so taps register normally; empty header space still
      // initiates a drag.
      const t = e.target as HTMLElement | null;
      if (t && t.closest("button, a, input, [data-no-drag]")) return;
      dragStartY.current = e.clientY;
      dragMoved.current = false;
      setIsDragging(true);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      if (dragStartY.current === null) return;
      const dy = e.clientY - dragStartY.current;
      if (Math.abs(dy) > 4) dragMoved.current = true;
      // Rubber-band when dragging further up than `full`.
      const clamped = detent === "full" && dy < 0 ? dy * 0.3 : dy;
      setDragY(clamped);
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      if (dragStartY.current === null) return;
      const dy = e.clientY - dragStartY.current;
      dragStartY.current = null;
      setIsDragging(false);

      if (detent === "half") {
        if (dy > dismissPx && dismissOnDrag) {
          onDismiss();
        } else if (dy < -commitPx) {
          setDetent("full");
        }
      } else {
        if (dy > commitPx) setDetent("half");
      }
      setDragY(0);
    },
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => {
      void e;
      dragStartY.current = null;
      setIsDragging(false);
      setDragY(0);
    },
  };

  // ── Content-area scroll-driven detent gestures ────────────────────
  // Track per-touch start position + scrollTop. We only care about
  // gestures that start at the top of the scrollable region; a touch
  // that starts mid-scroll is ordinary list scrolling and we get out
  // of its way. `EXPAND_THRESHOLD_PX` is the minimal upward delta
  // that promotes a half→full; deliberately small so a rider's first
  // upward flick is rewarded immediately rather than fighting native
  // scroll bounce. The dismiss / collapse thresholds reuse
  // `dismissPx` / `commitPx` so they match the header-drag commit
  // distances — same gesture, two tap targets.
  const contentDragRef = useRef<{
    startY: number;
    startScrollTop: number;
    fired: boolean;
  } | null>(null);
  const EXPAND_THRESHOLD_PX = 12;

  const contentHandlers = {
    onTouchStart: (e: React.TouchEvent<HTMLElement>) => {
      if (!isDraggable()) {
        contentDragRef.current = null;
        return;
      }
      const el = e.currentTarget as HTMLElement;
      contentDragRef.current = {
        startY: e.touches[0].clientY,
        startScrollTop: el.scrollTop,
        fired: false,
      };
    },
    onTouchMove: (e: React.TouchEvent<HTMLElement>) => {
      const ref = contentDragRef.current;
      if (!ref || ref.fired) return;
      // Only the gestures that *began* at the top of scroll convert
      // into detent changes. If startScrollTop > 0 the rider was
      // already scrolling and the content owns the gesture.
      if (ref.startScrollTop > 0) {
        contentDragRef.current = null;
        return;
      }
      const dy = e.touches[0].clientY - ref.startY;
      if (detent === "half") {
        if (dy < -EXPAND_THRESHOLD_PX) {
          ref.fired = true;
          setDetent("full");
        } else if (dy > dismissPx && dismissOnDrag) {
          ref.fired = true;
          onDismiss();
        }
      } else {
        if (dy > commitPx) {
          ref.fired = true;
          setDetent("half");
        }
      }
    },
    onTouchEnd: () => {
      contentDragRef.current = null;
    },
    onTouchCancel: () => {
      contentDragRef.current = null;
    },
  };

  // Tap on the handle (no drag) toggles between detents — a one-tap
  // alternative for users who don't discover the drag gesture.
  const onHandleTap = useCallback(() => {
    if (dragMoved.current) {
      dragMoved.current = false;
      return;
    }
    setDetent(detent === "half" ? "full" : "half");
  }, [detent, setDetent]);

  const restingY = detent === "full" ? fullRestingY : halfRestingY;
  const sheetStyle: React.CSSProperties = isMobile
    ? {
        transform: `translateY(calc(${restingY} + ${dragY}px))`,
        transition: isDragging ? undefined : "transform 380ms var(--ease-ios)",
        willChange: "transform",
      }
    : {};

  return {
    detent,
    setDetent,
    sheetStyle,
    handlers,
    contentHandlers,
    onHandleTap,
    isDragging,
  };
}
