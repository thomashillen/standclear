"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronDown, Train, X } from "lucide-react";
import { useRef, useState } from "react";
import { LINE_GROUPS, type Lines } from "@/lib/subwayData";

interface LinePickerProps {
  lines: Lines | null;
  selectedLine: string | null;
  onSelect: (line: string | null) => void;
}

// Flat MTA-ordered list — numbered → ACE → BDFM/G → JZ/L → NQRW →
// shuttles → SI. Bullets are self-categorizing by color so the old
// section headers (Numbered lines / 8 Av · 6 Av / etc.) were just
// stretching the panel without aiding findability.
const ORDERED_LINES: string[] = LINE_GROUPS.flatMap((g) => g.lines);

// Mobile drag-to-dismiss threshold. Matches NearbyPanel / SearchSheet
// so the gesture grammar is consistent across sheets.
const DISMISS_PX = 120;
// Velocity threshold (px/ms) for a downward flick to dismiss without
// having to drag past DISMISS_PX. Tuned so a deliberate flick — not a
// slow scroll — closes; ~0.6 px/ms ≈ 36px in a 60ms gesture, which
// reads as a quick swipe rather than an inadvertent slide.
const FLICK_VY = 0.6;
// Minimum downward travel before a flick can dismiss. Prevents a stray
// downward microtap (release with non-zero velocity but ~0 travel)
// from closing the sheet.
const FLICK_MIN_PX = 20;
// How long to ignore drag input after open. Matches the Radix
// slide-in keyframe duration so a rider who plants their finger as
// the sheet is appearing doesn't yank against an animating transform.
const OPEN_DRAG_LOCKOUT_MS = 240;

export default function LinePicker({ lines, selectedLine, onSelect }: LinePickerProps) {
  const [open, setOpen] = useState(false);
  const selected = selectedLine && lines ? lines[selectedLine] : null;

  const pick = (id: string | null) => {
    onSelect(id);
    setOpen(false);
  };

  // Mobile-only drag-to-dismiss. The sheet sits at rest (translateY 0)
  // and follows the rider's finger down; past DISMISS_PX — or via a
  // downward flick — it closes, otherwise it bounces back. Upward drag
  // rubber-bands so the surface feels physical rather than rigid.
  // Desktop uses a centered modal and skips the gesture entirely.
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef<number | null>(null);
  // Rolling window of recent pointer samples (last ~100ms) used to
  // compute release velocity for flick-to-dismiss. A single last-move
  // sample is too noisy when the rider pauses before lifting; the
  // window smooths over a couple of frames.
  const samples = useRef<{ y: number; t: number }[]>([]);

  // Drag is locked out for the first ~240ms of the open animation so
  // the rider can't fight Radix's slide-in keyframe with the inline
  // wrapper transform. Toggled in onOpenChange below.
  const [canDrag, setCanDrag] = useState(false);
  const dragLockoutTimer = useRef<number | null>(null);
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (dragLockoutTimer.current !== null) {
      window.clearTimeout(dragLockoutTimer.current);
      dragLockoutTimer.current = null;
    }
    if (next) {
      setCanDrag(false);
      dragLockoutTimer.current = window.setTimeout(() => {
        setCanDrag(true);
        dragLockoutTimer.current = null;
      }, OPEN_DRAG_LOCKOUT_MS);
    } else {
      setCanDrag(false);
    }
  };

  const isMobile = () =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches;

  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (!canDrag) return;
    if (!isMobile()) return;
    // Skip drag-init on interactive children (close button, line
    // bullets) so taps register normally.
    const t = e.target as HTMLElement | null;
    if (t && t.closest("button, a, input, [data-no-drag]")) return;
    dragStartY.current = e.clientY;
    samples.current = [{ y: e.clientY, t: performance.now() }];
    setIsDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (dragStartY.current === null) return;
    const dy = e.clientY - dragStartY.current;
    setDragY(dy < 0 ? dy * 0.25 : dy);
    const now = performance.now();
    samples.current.push({ y: e.clientY, t: now });
    // Trim to the last 100ms so velocity reflects the actual final
    // gesture rather than a long slow drag.
    const cutoff = now - 100;
    while (samples.current.length > 2 && samples.current[0].t < cutoff) {
      samples.current.shift();
    }
  };
  const onPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    if (dragStartY.current === null) return;
    const dy = e.clientY - dragStartY.current;
    // Velocity (px/ms) over the recent sample window. Positive = down.
    const s = samples.current;
    const first = s[0];
    const lastT = performance.now();
    const dt = first ? lastT - first.t : 0;
    const vy = first && dt > 0 ? (e.clientY - first.y) / dt : 0;

    dragStartY.current = null;
    samples.current = [];
    setIsDragging(false);

    const flicked = dy > FLICK_MIN_PX && vy > FLICK_VY;
    if (dy > DISMISS_PX || flicked) {
      setOpen(false);
      setDragY(0);
      return;
    }
    setDragY(0);
  };
  const onPointerCancel = () => {
    dragStartY.current = null;
    samples.current = [];
    setIsDragging(false);
    setDragY(0);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Trigger asChild>
        <button
          // Sized to match the live-count pill (h-9 / 36px) so the
          // header reads as a row of consistent-height controls.
          className="press flex items-center gap-1.5 px-2.5 h-9 rounded-full bg-white/[0.08] hover:bg-white/[0.12] border border-white/[0.08] min-w-0 max-w-[260px] touch-manipulation transition-colors"
          aria-label={selected ? `Line ${selected.id} — ${selected.name}. Tap to choose another line.` : "Choose a subway line"}
        >
          {selected ? (
            <>
              <span
                className="nyc-bullet w-5 h-5 rounded-full flex items-center justify-center text-[12px] leading-none flex-shrink-0"
                style={{ backgroundColor: selected.color, color: selected.textColor }}
              >
                {selected.id}
              </span>
              <span className="hidden sm:inline text-[13px] font-semibold text-white truncate">
                {selected.name}
              </span>
            </>
          ) : (
            <span className="text-[13px] font-semibold text-white px-0.5">Lines</span>
          )}
          <ChevronDown className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
        </button>
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0"
        />
        <DialogPrimitive.Content
          className="
            fixed z-50 text-white ios-glass
            inset-x-0 bottom-0 rounded-t-[28px] border-t border-white/[0.08]
            pb-[env(safe-area-inset-bottom)]
            sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[22px] sm:border sm:border-white/[0.08] sm:max-w-sm sm:w-full sm:pb-0
            shadow-[0_20px_60px_-10px_rgba(0,0,0,0.6)]
            data-[state=open]:animate-in data-[state=closed]:animate-out
            data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom
            sm:data-[state=open]:slide-in-from-bottom-0 sm:data-[state=closed]:slide-out-to-bottom-0
            sm:data-[state=open]:zoom-in-95 sm:data-[state=closed]:zoom-out-95
            duration-200
          "
        >
          <DialogPrimitive.Title className="sr-only">
            Choose a subway line
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Pick a line to focus on it, or All lines to see every train.
          </DialogPrimitive.Description>

          {/* Inner wrapper carries the drag transform so Radix's open /
              close keyframe animations on DialogContent stay
              independent of the user's drag. */}
          <div
            style={{
              transform: dragY ? `translateY(${dragY}px)` : undefined,
              transition: isDragging
                ? "none"
                : "transform 220ms var(--ease-ios)",
            }}
          >
            {/* Header: drag handle (mobile, absolutely positioned at
                the top edge so the row's vertical rhythm matches the
                rest of the app) + title + close. Same flex layout,
                paddings, and close-button visual weight as
                SearchSheet / NearbyPanel. Drag handlers live on the
                whole row so a touch on the handle or the title text
                starts a drag; taps on the close button (and bullets
                below) register normally via the data-no-drag /
                button-skip in the pointerdown handler. */}
            <div
              className="relative flex items-center justify-between px-4 pt-3.5 pb-2.5 sm:cursor-auto cursor-grab active:cursor-grabbing touch-none sm:pt-4 sm:pb-3"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerCancel}
            >
              <div className="sm:hidden absolute top-1.5 left-1/2 -translate-x-1/2 w-9 h-[5px] rounded-full bg-white/25" />
              <div className="flex items-center gap-2 text-white">
                <Train className="w-[17px] h-[17px]" />
                <span className="font-black text-[16px] tracking-tight">Lines</span>
              </div>
              <DialogPrimitive.Close asChild>
                <button
                  data-no-drag
                  className="press text-white opacity-85 hover:opacity-100 w-9 h-9 -mr-1 flex items-center justify-center rounded-full bg-white/[0.08] hover:bg-white/[0.12] touch-manipulation flex-shrink-0"
                  aria-label="Close panel"
                >
                  <X className="w-[16px] h-[16px]" strokeWidth={2.5} />
                </button>
              </DialogPrimitive.Close>
            </div>

            <div className="px-4 pt-1 pb-5 sm:px-4 sm:pt-2 sm:pb-5">
              <div className="grid grid-cols-7 sm:grid-cols-8 gap-2">
                {ORDERED_LINES.map((id) => {
                  const line = lines?.[id];
                  // While /gtfsData.json is still loading, render a
                  // pulsing neutral disc so the grid keeps its final
                  // shape and the rider doesn't see a blank popup.
                  if (!line) {
                    return (
                      <div
                        key={id}
                        aria-hidden="true"
                        className="aspect-square rounded-full bg-white/[0.06] animate-pulse"
                      />
                    );
                  }
                  const active = selectedLine === id;
                  return (
                    <button
                      key={id}
                      // Tap a non-selected bullet to filter to that
                      // line. Tap the already-selected bullet to clear
                      // the filter (back to all lines) — mirrors the
                      // iOS Maps tap-pin-to-deselect grammar.
                      onClick={() => pick(active ? null : id)}
                      aria-pressed={active}
                      className={`
                        nyc-bullet aspect-square rounded-full text-[17px] leading-none flex items-center justify-center touch-manipulation
                        transition-transform duration-150
                        shadow-[0_1px_4px_rgba(0,0,0,0.25)]
                        ${
                          active
                            ? "scale-[1.10] ring-2 ring-white/95"
                            : "active:scale-[0.92] hover:scale-105"
                        }
                      `}
                      style={{ backgroundColor: line.color, color: line.textColor }}
                      aria-label={
                        active
                          ? `${line.id} — ${line.name}, selected. Tap to show all lines.`
                          : `${line.id} — ${line.name}`
                      }
                    >
                      {line.id}
                    </button>
                  );
                })}
              </div>

              {/* Discoverability hint — only visible when a line is
                  selected. The tap-the-active-bullet-to-clear gesture
                  has no built-in affordance (the ring just reads as
                  "selected", not "tap to clear"), so a one-line caption
                  surfaces it without re-introducing a dedicated
                  "All lines" button. */}
              {selectedLine && (
                <p className="mt-3 text-center text-[11px] text-gray-400">
                  Tap the selected line again to show all
                </p>
              )}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
