# "Leave at X" departure reminders — feasibility + architecture

**Status:** research note (no code). MODE C, 2026-05-15.
**Backlog item:** TIER 2 — *"'Leave at X' reminders for saved commutes
(local notifications, no server push needed)."*
**Author context:** the parenthetical "no server push needed" in the
backlog line is the assumption this note exists to test. It does not
hold on the web platform. The rest of the note is about what to build
instead.

---

## 1. The use case, stated precisely

A returning rider has a commute pinned (Home → Work). They want the app
to tell them *"leave now to catch the 8:14"* — a single timed nudge,
delivered **while the phone is in their pocket and no tab is open**,
roughly N minutes before they need to walk to the platform.

The load-bearing phrase is "while no tab is open." A reminder that only
fires when the rider is already looking at the app is not a reminder —
it is a countdown they have to babysit, which defeats the entire point.
This distinction is the whole feasibility question.

---

## 2. What exists today (code-grounded)

- **Commute is client-only.** `lib/useFavorites.ts` stores Home/Work as
  a `CommuteState` in `localStorage` under `standclear:commute:v3`
  (`useFavorites.ts:23`, `CommuteEndpoint` union at `:34`). It is a
  module-scope singleton with cross-tab `storage`-event sync. **The
  server never sees Home, Work, or any rider time preference.** The only
  thing the server stores per rider is a push subscription keyed by an
  anonymous UUID, and its only payload column is `subscribed_lines` for
  *alert* fan-out (CLAUDE.md "Push notifications"; `lib/pushDispatch.ts`
  flow comment).

- **Push is server-cron-driven and alert-only.** `public/sw.js` has a
  `push` listener that calls `showNotification` from a *server-sent*
  payload, and a `notificationclick` deep-link handler. Delivery is a
  GitHub Actions cron every 5 min → `/api/cron/dispatch-alerts` →
  `dispatchAlerts()`. There is **no per-rider timer anywhere** — the
  cron fans a severe MTA alert out to matching subs; it has no concept
  of "this rider, at 08:05 local."

- **iOS only delivers Web Push inside an installed PWA.**
  `lib/usePushSubscription.ts` already encodes this as the
  `needs-install` state (comment at `usePushSubscription.ts:~17`: "iOS
  only delivers push inside installed PWAs (since iOS 16.4)"). A large
  share of the target audience (iPhone Safari, not installed) cannot
  receive *any* background notification today.

- **Trip timing already exists.** `lib/commuteRouting.ts` produces
  ranked plans with per-leg stop counts; `lib/walkingDirections.ts`
  gives the walk-leg duration; the live `/api/trains` arrivals give
  real departures. So "what time must the rider leave to catch a
  specific train" is computable from pieces that already ship. The gap
  is **delivery**, not **computation**.

---

## 3. The hard constraint: the web has no reliable scheduled local notification

There is no cross-browser API to say "show a notification at timestamp
T" from the client without a network round-trip at T.

- **Notification Triggers API** (`TimestampTrigger`, `showTrigger`) —
  the one API that was *designed* for exactly this — never left an
  experimental Chromium origin trial, was never standardized, and is
  **not implemented in Safari at all**. It cannot be the basis of an
  iOS feature, which is the primary target (North Star is an
  Apple-quality iOS-feeling web app).

- **`setTimeout` in a Service Worker** does not survive. The SW is
  terminated aggressively when idle (per spec, UA-controlled). A timer
  armed at app-close is gone long before an 8 AM fire. This is not a
  tuning problem; it is by design.

- **`setTimeout` in a page** only runs while the tab is alive and
  foregrounded-enough. This is the "babysit a countdown" non-solution
  from §1.

Therefore the *only* mechanism that delivers a notification at a chosen
time with the app closed is **server-scheduled Web Push** — the same
transport `sw.js` already handles, but driven by a per-rider timer the
server owns, not the alert-fanout cron. "No server push needed" is
false for the real use case.

This is the wall a naive implementation run hits after the UI is
already built. Shipping the foreground-only version anyway would
violate **principle #1 (ACCURACY FIRST)**: a reminder the rider has
set, that silently never fires because their phone was locked, is worse
than no reminder — they planned around it and missed the train.

---

## 4. Architectural options

### Option A — Foreground-only "leave-now" banner (no notification)
Reframe the feature as an *in-app* element: when the rider opens the
app within the departure window for a pinned commute, surface a
"Leave now for the 8:14 → Work" pill. Pure client, zero new
infrastructure, honest (it never claims to fire in the background).
- ✅ Zero onboarding, zero server, no PWA-install requirement, works
  for every rider including iPhone-Safari-not-installed.
- ✅ Composes with the existing commute surface (NearbyPanel's
  `GoingToCard`, the pinned-commute plan card).
- ❌ Not the asked-for feature. It is a *smart default surface*, not a
  reminder. Useful, but a different product.

### Option B — Server-scheduled push, PWA-install gated
Persist `{anonId, anchor, targetLocalTime, days[], tz}` server-side
(extend the push-subscription row / a sibling table). A cron (finer
than the 5-min alert cron, or a per-row scheduled job) computes, near
the window, the live trip for that rider's pinned commute and pushes
"Leave in 5 min for the 8:14." Reuses `sw.js`'s existing `push` +
`notificationclick` path verbatim.
- ✅ The real feature — fires with the app closed.
- ❌ Requires the rider to have installed the PWA (iOS 16.4 push
  constraint, already modeled as `needs-install`). The backlog's
  "no server push needed" is contradicted.
- ❌ **Privacy surface change.** Today the server stores only an
  opaque UUID + alert line prefs. Persisting a commute schedule
  server-side means the server now holds *when this anonymous person
  commutes*. `/privacy` currently promises a very thin server
  footprint. This is the single biggest open question (see §6) — it
  is a product/trust decision, not an engineering one.
- ❌ Real per-rider time computation on the server needs the commute
  *endpoints* server-side too (Home/Work coords or stopIds), widening
  the stored data further. Mitigation: store only the resolved
  `targetLocalTime` + a precomputed board stop, not raw Home/Work.

### Option C — Hybrid: Option A now, Option B as an explicit opt-in later
Ship A as the default (calm, honest, zero-onboarding). If/when a rider
has installed the PWA *and* explicitly opts into background reminders,
light up B for them only, with copy that states plainly "we store your
departure time on our server to send this." Progressive trust
(principle #5): the same feature reveals more as the rider grants more.

---

## 5. Recommendation

**Build Option A first, as its own run-sized slice.** It is the part
that is unambiguously shippable, needs no privacy-policy change, no
server, no install gate, and delivers most of the day-to-day value (the
rider who opens the app on their way out the door gets the leave-now
nudge immediately). It also de-risks B: the trip-window computation,
the "is the rider inside the leave-now window for a pinned commute"
predicate, and the copy are all shared, and can be unit-tested as a
pure function before any delivery mechanism is wired.

Defer B until the §6 privacy question is answered by the human. Do
**not** start B as an implementation run before that — the server-side
data-retention decision gates the schema, and the schema gates
everything else.

### Suggested incremental slices

1. **Pure core (run-sized, no UI):** `lib/leaveAt.ts` —
   `leaveWindow(plan, walkSec, now)` → `{ departBy, leaveNowFrom,
   leaveNowUntil }`. Pure, node-env tested. No delivery, no storage.
   Reuses `commuteRouting` + `walkingDirections` outputs; does not
   re-implement routing.
2. **Option A surface (run-sized):** consume slice 1 in the existing
   pinned-commute card / `GoingToCard` to render a "Leave now" state
   when `now ∈ [leaveNowFrom, leaveNowUntil]`. UI-only, regression
   test, one changelog bullet. No notification API touched.
3. **(Blocked on §6) Option B:** schema + scheduled push. Its own
   design note once the privacy decision lands.

---

## 6. Open product question (logged to `open-questions.md`)

Background "Leave at X" reminders (Option B) require persisting a
per-rider commute *schedule* server-side, which the current `/privacy`
posture (opaque UUID + alert line prefs only) does not cover. **Is
storing an anonymous rider's departure-time schedule an acceptable
privacy trade for background reminders, and does it require a
`/privacy` rewrite + explicit opt-in copy?** This is a trust decision
for the human, not an engineering call — it gates the Option B schema.

---

## 7. Non-goals / things explicitly ruled out

- Notification Triggers API — not in Safari, never standardized. Do not
  build on it even as a Chromium-only enhancement; it is a maintenance
  trap with no iOS payoff.
- SW `setTimeout` scheduling — unreliable by spec, do not attempt.
- Reusing the 5-min alert cron for per-rider timing — wrong shape; it
  is an alert *fan-out*, not a scheduler, and coupling them would make
  both harder to reason about (the CLAUDE.md dispatch comment is
  load-bearing; keep that path single-purpose).
