"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronDown, X } from "lucide-react";
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

export default function LinePicker({ lines, selectedLine, onSelect }: LinePickerProps) {
  const [open, setOpen] = useState(false);
  const selected = selectedLine && lines ? lines[selectedLine] : null;

  const pick = (id: string | null) => {
    onSelect(id);
    setOpen(false);
  };

  // Mobile-only drag-to-dismiss. The sheet sits at rest (translateY 0)
  // and follows the rider's finger down; past DISMISS_PX it closes,
  // otherwise it bounces back. Upward drag rubber-bands so the surface
  // feels physical rather than rigid. Desktop uses a centered modal
  // and skips the gesture entirely.
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef<number | null>(null);

  const isMobile = () =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches;

  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (!isMobile()) return;
    // Skip drag-init on interactive children (close button, line
    // bullets) so taps register normally.
    const t = e.target as HTMLElement | null;
    if (t && t.closest("button, a, input, [data-no-drag]")) return;
    dragStartY.current = e.clientY;
    setIsDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (dragStartY.current === null) return;
    const dy = e.clientY - dragStartY.current;
    setDragY(dy < 0 ? dy * 0.25 : dy);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    if (dragStartY.current === null) return;
    const dy = e.clientY - dragStartY.current;
    dragStartY.current = null;
    setIsDragging(false);
    if (dy > DISMISS_PX) {
      setOpen(false);
      setDragY(0);
      return;
    }
    setDragY(0);
  };
  const onPointerCancel = () => {
    dragStartY.current = null;
    setIsDragging(false);
    setDragY(0);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
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
            <span className="text-[13px] font-semibold text-white px-0.5">All lines</span>
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
            inset-x-0 bottom-0 rounded-t-[22px] border-t border-white/[0.08]
            pb-[env(safe-area-inset-bottom)]
            sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[18px] sm:border sm:border-white/[0.08] sm:max-w-sm sm:w-full sm:pb-0
            shadow-[0_20px_60px_-10px_rgba(0,0,0,0.7)]
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
            {/* Header: drag handle (mobile) + title + close. Drag
                handlers attach here so a touch on the bullet grid
                below taps cleanly without intercepting as a drag. */}
            <div
              className="relative flex items-center justify-between px-4 pt-3 pb-2 sm:cursor-auto cursor-grab active:cursor-grabbing touch-none sm:pt-3.5 sm:pb-2"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerCancel}
            >
              <div className="sm:hidden absolute top-1.5 left-1/2 -translate-x-1/2 w-9 h-[5px] rounded-full bg-white/30" />
              <span className="text-[13px] font-bold tracking-tight text-white pt-2 sm:pt-0">
                Lines
              </span>
              <DialogPrimitive.Close asChild>
                <button
                  data-no-drag
                  className="press w-7 h-7 -mr-1 flex items-center justify-center rounded-full bg-white/[0.08] hover:bg-white/[0.12] text-white touch-manipulation"
                  aria-label="Close"
                >
                  <X className="w-3.5 h-3.5" strokeWidth={2.5} />
                </button>
              </DialogPrimitive.Close>
            </div>

            <div className="px-3 pt-1 pb-4 sm:px-4 sm:pt-1 sm:pb-4">
              <div className="grid grid-cols-7 sm:grid-cols-8 gap-2">
                {ORDERED_LINES.map((id) => {
                  const line = lines?.[id];
                  if (!line) return null;
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
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
