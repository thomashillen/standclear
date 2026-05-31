# DragHandle 44px hit-slop — design spec

Date: 2026-05-16 · Mode: C (research) · Status: ready to implement

Resolves the open question logged on PR #164
(`open-questions.md`, 2026-05-16): `components/DragHandle.tsx`'s tap
target is 28px tall, below the 44px one-handed minimum (north-star
principle #3). The prior run deferred it as "layout-risky on five
shared sheets, needs a Vercel screenshot loop." This note shows the
risk is a **hit-testing geometry** question (answerable from code, not
screenshots) and specifies an implementation that is **zero layout
shift and zero tap-hijack by construction**.

## Current state

`components/DragHandle.tsx`:

```
<button class="sm:hidden flex items-start justify-center h-7 pt-1.5 ... w-full">
  <div class="w-9 h-[5px] rounded-full bg-white/25" />
</button>
```

- Button flow box: `h-7` = **28px**. Header begins at sheet-y = 28px.
- Pill: `items-start` + `pt-1.5` (6px) → pill at sheet-y ∈ [6, 11].
- Full-width, but only 28px tall → fails the 44px minimum on the axis a
  thumb actually misses on a moving train.

### Finding: a load-bearing comment already lies

`components/LinePanel.tsx:395` documents the handle as *"Hit area is
h-11 (44px, the iOS minimum tap target)."* The shared `DragHandle` it
renders is `h-7` (28px). The 44px target was the **original intended
design** for at least LinePanel; the shared-component extraction
silently regressed it and left the comment asserting a contract the
code no longer keeps. `SearchSheet.tsx:973` and `NearbyPanel.tsx:889`
conversely call `h-7 = 28px` a *"proper tap target"* — also wrong
against principle #3. All three comments must be corrected by the
implementing run (see Follow-ups).

## Per-sheet header geometry (Tailwind unit = 4px)

The blocker is: a 44px collapse-tap target at sheet-y ∈ [0, 44] must
either push header content down (visible shift) **or** overlap the
header's top ~16px. Whether the overlap is safe depends on what lives
in the y ∈ [28, 44] band of each header. Measured from source:

| Sheet | Header pad-top | Topmost interactive control | Its position |
|---|---|---|---|
| StationPanel | `pt-2` (8) | Directions/Save `w-11 h-11 -mt-0.5` | sheet-y ≈ 34, **right edge** |
| LinePanel | `py-3` (12) | Close `w-11 h-11 -mr-1` (centered) | sheet-y ≈ 40, **right edge** |
| SearchSheet | `pt-1.5` (6) | Back `w-8 h-8 -ml-1` (dir. mode) | sheet-y ≈ 34, **left edge** |
| NearbyPanel | `pt-1.5` (6) | Close `w-9 h-9 -mr-1` (centered) | sheet-y ≈ 34, **right edge** |
| MoreSheet | `pt-1.5` (6) | Close `w-9 h-9 -mr-1` (centered) | sheet-y ≈ 34, **right edge** |

**The decisive invariant:** every header's interactive controls hug
the **left or right edge** (`-ml-1` / `-mr-1`); the horizontal
**center column is non-interactive in all five** — padding plus
non-interactive title text (station name `<h2>`, line-id `<span>`,
"Near me" / "More" labels). Nothing tappable lives under the pill.

## Recommended implementation — centered absolute hit-slop

Keep the button's **flow box at `h-7`** (so nothing below moves —
zero layout shift, guaranteed by construction, no screenshot needed).
Deliver the 44px target with a transparent, absolutely-positioned,
**center-banded** extension that overhangs only the header's
non-interactive center:

```tsx
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
      // Flow box stays h-7 (28px): nothing below moves, zero layout
      // shift across all five sheets — provable from this line alone,
      // no per-sheet screenshot needed. The 44px iOS-minimum tap
      // target is the absolute child below: it overhangs the header's
      // top ~16px but ONLY in a centered band. Every sheet header's
      // interactive controls (close / back / directions) hug the
      // left/right edge with -ml-1 / -mr-1; the center column under
      // the pill is padding + non-interactive title text in all five,
      // so the overhang never steals a control's tap. z-10 lifts it
      // above the header (a later DOM sibling) so the overhang is
      // actually live and not painted over.
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
```

Why each property:

- **Flow box unchanged (`h-7`)** → header content stays exactly where
  it is in all five sheets. Zero visual shift is a property of the
  source, not something a screenshot must confirm.
- **Absolute child** → out of flow, contributes no height; a tap on it
  bubbles to the parent `<button>` → fires `onTap`. The pill `<div>`
  is untouched → zero visual change.
- **`h-11` (44px) from `top-0`** → 28px over the button + 16px
  overhang into the header's top.
- **`w-[120px]` centered** → on the narrowest supported viewport
  (320px; handle is `sm:hidden` so mobile-only) the band spans
  x ∈ [100, 220]. Right-edge close: inner edge ≈ x 272 (`px-4` 16 −
  `-mr-1` 4, then 36 wide) → clear by 50px+. Left-edge back/icon:
  right edge ≈ x 48 → clear by 50px+. Margin only grows on larger
  phones. Pill itself is `w-9` (36px) centered, so 120px fully
  contains the affordance.
- **`z-10`** → the header is a *later* DOM sibling and would otherwise
  paint over the overhang. `position: relative` on a header without a
  z-index does not open a new stacking context, so a z-10 absolute
  child of the (now `relative`) button composes above it. The
  implementing run must confirm this holds for LinePanel /
  SearchSheet / NearbyPanel headers (they carry `relative`); if any
  header gains its own stacking context, add `relative z-10` to the
  button itself.

This is the iOS sheet-grabber pattern: a generous **centered** grab
zone that coexists with edge nav controls rather than a full-width bar
that fights them.

## Why this is now a single-run task

The deferral reasons no longer hold:

- *"Visible layout shift, needs a design pass"* — eliminated. Flow box
  is unchanged; shift is provably zero from one line of source.
- *"Hijacks header taps, needs per-sheet confirmation"* — eliminated.
  The geometry table above already did the per-sheet confirmation:
  controls are edge-aligned in all five, the center band is clear.
- *"Five shared surfaces"* — the change is to **one** component
  (`DragHandle.tsx`); the five call sites are untouched.

The Vercel preview is now a 60-second sanity glance (pill unmoved,
grabber reachable), not a five-sheet design exploration.

## Test plan for the implementing run

`components/DragHandle.test.tsx` is new (no existing coverage). jsdom,
mirroring the sibling `useSheetDrag` / `InstallPrompt` test shape:

- Renders the visible pill (`w-9 h-[5px]`) — visual affordance intact.
- Renders exactly one `aria-hidden` extension carrying `h-11`,
  `w-[120px]`, `absolute`, `left-1/2`, `z-10` — pins the hit-slop
  contract literally so a future refactor that drops it fails.
- `onClick` on the button fires `onTap`; a click dispatched on the
  extension also fires `onTap` (event bubbles through the button).
- `sm:hidden` retained (desktop sheets aren't draggable).
- `aria-label` is forwarded; the extension is `aria-hidden` so the
  control exposes exactly one accessible name (no double-announce).

Real hit-testing / z-order is outside jsdom — covered by the preview
sanity glance, materially de-risked because it is now one component.

## Follow-ups the implementing run must also do

1. Fix `LinePanel.tsx:395` — drop the false *"Hit area is h-11"*
   claim; the shared component now genuinely delivers 44px, so the
   comment becomes true once implemented, but reword it to point at
   `DragHandle` as the single source rather than restating a number
   that can drift again.
2. Fix the stale *"h-7 = 28px ... proper tap target"* comments at
   `SearchSheet.tsx:973` and `NearbyPanel.tsx:889`.
3. Changelog: one `changed` bullet (rider-visible — the grabber is
   easier to catch one-handed on a moving train).
4. No README / env / dependency impact. No new runtime dependency.
   Reduced-motion: N/A (no animation introduced).
