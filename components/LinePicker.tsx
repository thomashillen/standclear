"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { LINE_GROUPS, type Lines } from "@/lib/subwayData";

interface LinePickerProps {
  lines: Lines | null;
  selectedLine: string | null;
  onSelect: (line: string | null) => void;
}

const GROUP_LABELS: Record<string, string> = {
  IRT: "Numbered lines",
  IND: "8 Av · 6 Av · Crosstown",
  BMT: "Nassau · Canarsie · Broadway",
  S: "Shuttles",
  SI: "Staten Island",
};

export default function LinePicker({ lines, selectedLine, onSelect }: LinePickerProps) {
  const [open, setOpen] = useState(false);
  const selected = selectedLine && lines ? lines[selectedLine] : null;

  const pick = (id: string | null) => {
    onSelect(id);
    setOpen(false);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <button
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-full bg-gray-800/70 hover:bg-gray-800 border border-gray-700/60 transition-colors min-w-0 max-w-[180px] sm:max-w-[260px] touch-manipulation"
          aria-label="Choose a subway line"
        >
          {selected ? (
            <>
              <span
                className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black leading-none flex-shrink-0"
                style={{ backgroundColor: selected.color, color: selected.textColor }}
              >
                {selected.id}
              </span>
              <span className="text-sm font-semibold text-white truncate">
                {selected.name}
              </span>
            </>
          ) : (
            <span className="text-sm font-semibold text-white px-1">All lines</span>
          )}
          <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
        </button>
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0"
        />
        <DialogPrimitive.Content
          className="
            fixed z-50 bg-gray-950 text-white
            inset-x-0 bottom-0 rounded-t-3xl border-t border-gray-800 max-h-[85vh] overflow-y-auto
            sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:max-w-xl sm:w-full sm:max-h-[80vh]
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

          <div className="sm:hidden flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full bg-white/25" />
          </div>

          <div className="px-5 pt-3 pb-6 sm:p-6">
            <button
              onClick={() => pick(null)}
              className={`
                w-full mb-5 py-3 rounded-xl text-sm font-semibold transition-colors touch-manipulation
                ${
                  !selectedLine
                    ? "bg-white text-gray-950"
                    : "bg-gray-800 text-gray-200 hover:bg-gray-700 active:bg-gray-700"
                }
              `}
            >
              All lines
            </button>

            {LINE_GROUPS.map((group) => (
              <div key={group.label} className="mb-5 last:mb-0">
                <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2.5 px-1">
                  {GROUP_LABELS[group.label] ?? group.label}
                </div>
                <div className="grid grid-cols-6 sm:grid-cols-8 gap-3">
                  {group.lines.map((id) => {
                    const line = lines?.[id];
                    if (!line) return null;
                    const active = selectedLine === id;
                    return (
                      <button
                        key={id}
                        onClick={() => pick(id)}
                        className={`
                          aspect-square rounded-full text-base font-black leading-none flex items-center justify-center touch-manipulation transition-transform
                          ${
                            active
                              ? "scale-110 ring-2 ring-inset ring-white/90"
                              : "active:scale-95 hover:scale-105"
                          }
                        `}
                        style={{ backgroundColor: line.color, color: line.textColor }}
                        aria-label={`${line.id} — ${line.name}`}
                      >
                        {line.id}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
