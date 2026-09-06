/**
 * Centered hit slop for a positioned button whose visible box stays compact.
 * Pointer events bubble to that button, preserving its name, focus behavior,
 * and exclusion from the sheet's drag gesture.
 */
export function CompactControlHitArea() {
  return (
    <span
      aria-hidden="true"
      data-compact-control-hit-area
      className="absolute left-1/2 top-1/2 z-10 h-11 w-11 -translate-x-1/2 -translate-y-1/2"
    />
  );
}
