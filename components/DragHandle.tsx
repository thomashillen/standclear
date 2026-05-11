"use client";

// Mobile-only drag handle that crowns every bottom-sheet panel
// (StationPanel, LinePanel, NearbyPanel, SearchSheet, MoreSheet). The
// tap target is a full-width invisible button so the pill is easy to
// hit; the visible pill itself is the small `w-9 h-[5px]` capsule.
// `sm:hidden` hides it on desktop where the panels aren't draggable.
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
      className="sm:hidden flex items-start justify-center h-7 pt-1.5 flex-shrink-0 touch-none w-full"
      onClick={onTap}
      aria-label={ariaLabel}
    >
      <div className="w-9 h-[5px] rounded-full bg-white/25" />
    </button>
  );
}
