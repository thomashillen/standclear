# Mobile home cloud QA — 2026-09-09

Scope: draft PR #213 at `26ba5fff`, plus the connectivity fix documented below. Testing used the local Next.js app and a Chromium-based browser surface with explicit viewport overrides. The protected Vercel preview redirected to Vercel login, so the current branch was exercised locally instead.

## Viewports and interaction

### 390 × 844

- The resting mobile search surface occupied `x=12..378`, `y=702..812`; the document and visual viewport both remained 390 × 844.
- Opening **Where to?** focused the `Search NYC` input. The input remained fully visible at `y=525.88..569.88`.
- `window.scrollY` stayed `0`, `documentElement.scrollHeight` stayed `844`, and the visual viewport offset stayed `0`. Autofocus did not displace the map or hide the top controls.
- The Lines and Live controls, location control, resting search surface, and More handoff were all reachable.

### 320 × 568

- The resting search surface occupied `x=12..308`, `y=426..536`; its **Where to?** target was 270 × 48 and the location target was 48 × 48.
- Opening search focused the `Search NYC` input at `x=12..308`, `y=382.36..426.36`.
- `window.scrollY` stayed `0` and `documentElement.scrollHeight` stayed `568`; the compact-height layout did not create document scrolling or hide the top controls.

Browser captures were taken for the 390 × 844 resting and focused-search states and the 320 × 568 resting state. The browser QA surface displayed them inline but did not expose the image bytes as repository files, so no generated or lossy recreation is committed here.

## Larger text, zoom, and keyboard limits

- Browser zoom shortcuts were exercised at the 320 × 568 focused-search state. This embedded browser host kept the page viewport and computed type metrics fixed, so it could not provide a reliable larger-text assertion.
- Autofocus and viewport displacement were measurable, but this environment does not produce the iOS software keyboard or its animation.
- Real iOS Dynamic Type, Safari page zoom, software-keyboard animation, safe-area behavior, and VoiceOver focus remain physical-iPhone validation items.

## Offline, stale, and degraded behavior

- Stopping the local server after a live snapshot caused polling failures and transitioned the visible control to **Feed issue** with the accessible status `Live feed degraded.` Document scroll remained zero.
- Existing mobile-shell regression coverage verifies visible **Offline**, **Stale**, **Feed issue**, and **Live** labels and confirms each state can open System Pulse.
- A concrete race was reproduced in the connectivity source: browser emulation can change `navigator.onLine` before the corresponding `online`/`offline` event is delivered. The module-level cached mirror could therefore briefly report the old value to polling code.
- `isOnline()` and the React snapshot now read `navigator.onLine` directly. The events remain responsible for notifying React and imperative subscribers. A regression test covers the pre-event interval as well as ordinary event-driven transitions.

## Verification

- `npm test -- lib/useOnline.test.ts components/SubwayMap.home.test.tsx` — 9 tests passed.
- `npm run lint` — passed.
- `npx tsc --noEmit` — passed.
- `npm test` — 909 tests across 87 files passed.
- `NEXT_PUBLIC_MAPBOX_TOKEN=pk.test npm run build` — passed; 971 static pages generated.
- `git diff --check` — passed.

## Outstanding physical-device QA

Before merge, validate on a real iPhone: Safari keyboard appearance/dismissal and animation, safe-area insets in browser and installed-PWA modes, Dynamic Type and VoiceOver focus order, and real Wi-Fi/cellular/offline transitions. Browser emulation is not treated as equivalent evidence for those items.
