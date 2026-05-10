/**
 * Phase value (0..1) for the breathing pulse on the open-station
 * "incoming train" rings drawn underneath each train marker.
 *
 * The ring's radius and opacity oscillate as `base + range * phase`,
 * so 0 is rest-min, 1 is rest-max, and 0.5 is the average — the value
 * you'd see at any random instant if you froze the animation. We use
 * a ~0.9 Hz sine wave (period ≈ 1.4 s) so it reads as "live" without
 * competing with the surrounding map for attention.
 *
 * When the rider has set `prefers-reduced-motion: reduce`, we hold
 * the phase at 0.5 instead of oscillating. This preserves the
 * informational content of the ring (which trains are headed to the
 * open station, with imminent ones glowing brighter) while removing
 * the decorative breathing motion. 0.5 — not 0 or 1 — keeps the ring
 * sized and opacified at its visual midpoint, identical to what a
 * non-reduced rider sees on average.
 */
export function ringPulsePhase(
  nowMs: number,
  prefersReducedMotion: boolean,
): number {
  if (prefersReducedMotion) return 0.5;
  return (Math.sin((nowMs / 700) * Math.PI * 2) + 1) / 2;
}
