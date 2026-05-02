"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
  // Optional handler to toggle detent on tap (without a drag).
  onHandleTap: () => void;
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
}: SheetDragOptions): SheetDragResult {
  const [detent, setDetentState] = useState<Detent>("half");
  const [dragY, setDragY] = useState(0);
  // Start false so server and first client render agree. NearbyPanel is
  // open by default and therefore rendered during SSR — reading matchMedia
  // in the initializer would emit the transform only on the client and
  // break hydration. The post-mount matchMedia effect bumps this to the
  // correct value before paint in practice (useEffect flush is
  // synchronous for the initial mount batch in React 18+).
  const [isMobile, setIsMobile] = useState(false);
  // Mirrors `dragStartY.current !== null`. Held in state so the render
  // path can read it without tripping react-hooks/refs (refs aren't
  // safe to read during render — only mutate from event handlers /
  // effects). Toggled in lockstep with dragStartY at the pointer
  // down / up / cancel boundaries.
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef<number | null>(null);
  const dragMoved = useRef(false);

  // Track viewport so we only emit the transform on the mobile bottom-sheet
  // layout. Desktop (sm+) repositions the card as a fixed side panel where
  // a translateY would shove it off-screen.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    setIsMobile(mq.matches);
    const update = () => setIsMobile(mq.matches);
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const setDetent = useCallback(
    (d: Detent) => {
      setDetentState((prev) => {
        if (prev !== d) onDetentChange?.(d);
        return d;
      });
    },
    [onDetentChange],
  );

  // Reset to half + clear drag state whenever the sheet is closed so
  // re-opening doesn't remember a stale position.
  useEffect(() => {
    if (!open) {
      setDragY(0);
      setDetentState("half");
      dragStartY.current = null;
      dragMoved.current = false;
      setIsDragging(false);
    }
  }, [open]);

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
        if (dy > dismissPx) {
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

  return { detent, setDetent, sheetStyle, handlers, onHandleTap };
}
