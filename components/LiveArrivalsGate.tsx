"use client";

import { startLiveDemo } from "@/lib/useTrains";

export function LiveArrivalsGate({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={compact
        ? "flex min-h-11 max-w-[230px] items-center gap-2 rounded-2xl border border-sky-300/20 bg-gray-950/90 px-2.5 py-1.5 text-[12px] text-gray-300"
        : "py-6 text-center text-xs text-gray-400"}
    >
      <span className={compact ? "leading-tight" : "block mb-2"}>
        Live arrivals are off to save data.
      </span>
      <button
        type="button"
        onClick={() => startLiveDemo()}
        className={compact
          ? "press min-h-9 shrink-0 rounded-xl bg-sky-400/15 px-2 font-semibold text-sky-100"
          : "press min-h-11 rounded-xl border border-sky-300/20 bg-sky-400/15 px-3 font-semibold text-sky-100"}
      >
        Start 5-minute demo
      </button>
    </div>
  );
}
