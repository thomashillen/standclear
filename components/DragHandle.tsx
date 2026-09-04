"use client";

// Mobile-only drag handle that crowns every bottom-sheet panel
// (StationPanel, LinePanel, NearbyPanel, SearchSheet, MoreSheet). The
// 28px flow row keeps every sheet header in place; a centered absolute
// child extends the touch target to 44px without overlapping the edge
// controls below. The visible pill remains the small `w-9 h-[5px]`
// capsule. `sm:hidden` hides it on desktop where panels aren't draggable.
export function DragHandle({
  onTap,
  ariaLabel,
}: {
  onTap: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      className="sm:hidden relative flex items-start justify-center h-7 pt-1.5 flex-shrink-0 touch-none w-full"
      onClick={onTap}
      aria-label={ariaLabel}
    >
      <div className="w-9 h-[5px] rounded-full bg-white/25" />
      <span
        aria-hidden
        className="absolute left-1/2 -translate-x-1/2 top-0 h-11 w-[120px] z-10"
      />
    </button>
  );
}
