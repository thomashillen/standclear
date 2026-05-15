# Playwright e2e harness — design note (2026-05-15)

Status: **design only.** No code in this PR. Scopes the TIER-1
"automated end-to-end tests for the three critical paths" item into
incremental, run-sized slices so a future MODE B run can implement one
flow at a time without re-deriving the constraints.

The three critical paths (from the decision matrix):

1. Open a station from search.
2. Plan an address-to-address trip.
3. Follow a train in cinematic mode.

## What the app gives us for free

There are **zero `data-testid` attributes** in the codebase. That is a
feature, not a gap: every interactive surface already carries a
`role`/`aria-label`, so Playwright's recommended `getByRole` /
`getByLabel` locators bind to the same accessibility contract the a11y
sweep (TIER 3) protects. **Do not add `data-testid`s.** A selector that
breaks because an `aria-label` changed is a selector that caught an a11y
regression — that is the double-win we want. Locators verified present
today:

| Surface | Locator |
| --- | --- |
| Map root | `getByLabel("StandClear — live NYC subway")` |
| Search/plan entry button | `getByLabel("Search stations and plan trips")` |
| Near-me button | `getByLabel("Find nearby stations")` |
| More button | `getByLabel("More options")` |
| Single search input | `getByPlaceholder("Where are you going?")` / `getByLabel("Search NYC")` |
| Trip planner inputs | `getByPlaceholder("Search start")`, `getByPlaceholder("Search destination")` |
| Swap origin/destination | `getByLabel("Swap from and to")` |
| Refresh routes | `getByLabel("Refresh routes")` |
| Close panel | `getByLabel("Close panel")` |
| Follow capsule (follow active) | `getByLabel("Stop following train")` (its container is `role="status"`) |

## The three data planes, from a test's point of view

- **Station search is local.** `SearchSheet` calls
  `searchStations(index, q, 30)` over `lib/stopsIndex`, built from
  `public/gtfsData.json` (439 KB, served statically by Next, fetched at
  runtime — never bundled, per the 65 GB incident). Flow 1's *search*
  step needs **no network**.
- **`/api/trains`** (8 live MTA GTFS-RT feeds), **`/api/alerts`**,
  **`/api/geocode`** (Mapbox proxy), **`/api/walk`** (Mapbox proxy) are
  the only network surfaces. Client entry points: `lib/useTrains.ts` →
  `/api/trains`; `lib/useAlerts.ts` → `/api/alerts`;
  `lib/geocoding.ts` → `/api/geocode`; `lib/walkingDirections.ts` →
  `/api/walk`.
- **The Mapbox GL canvas needs a real token.** A placeholder token
  builds fine and the DOM/sheets/panels all mount, but the WebGL map
  never paints tiles. Flows 1 and 2 are pure DOM (sheets, result rows,
  trip cards) and do **not** depend on the canvas. Flow 3 does — see
  below.

### Network strategy: stub at the route boundary

Intercept with `page.route()` and serve frozen JSON fixtures for
`/api/trains`, `/api/alerts`, `/api/geocode`, `/api/walk`. Rationale:
deterministic, offline, free, fast — and it does **not** contradict
principle #1 ("trust the MTA feed; don't add heuristics"). That
principle governs the *product*. A *test* asserting accuracy against a
flaky live feed asserts nothing; a frozen fixture is how you verify the
late-train-renders-late contract reproducibly. Capture each fixture
once from a real response, commit it under `e2e/fixtures/`.

### The subtle part: freeze the clock with the fixture

Arrival ETAs are relative (`"Next: 4m"` is computed from
`arrival.eta - now`). A frozen `/api/trains` fixture carries absolute
epoch timestamps; if wall-clock advances past them the same fixture
renders different (eventually negative) ETAs and the assertions rot
within minutes of capture. The harness **must** pin time —
`page.clock.setFixedTime(<fixtureGeneratedAt>)` — so the frozen
timestamps and the rendered ETAs stay consistent. This is the single
thing a naive first implementation gets wrong and then fights as
"flake" for a week. Document it in the harness, not just here.

## Flow-by-flow

**Flow 1 — open station from search (hermetic, ship first).**
Stub `/api/trains` + `/api/alerts`. Open search via
`getByLabel("Search stations and plan trips")`, type a stable station
name (e.g. `"Times Sq"`), assert a result row appears, tap it, assert
`StationPanel` mounts with the station name and arrival rows sourced
from the fixture. No token, no canvas.

**Flow 2 — address-to-address trip (hermetic).**
Additionally stub `/api/geocode` (the `/suggest` + `/retrieve`
typeahead pair) and `/api/walk`. Enter directions mode, fill
`Search start` + `Search destination`, assert a `TripPlanRow` renders
with a route ribbon, a total-time pill, and a `"Next:"` ETA list keyed
to the frozen `/api/trains` fixture. Still pure DOM.

**Flow 3 — follow-train cinematic mode (NOT hermetic — see blocker).**
`followedTrainId` is set **only** through `MapView`'s `onFollowTrain`
(`SubwayMap.tsx:821`), and the only trigger is a train-marker tap on
the Mapbox GL canvas (`MapView.tsx:1184`). There is no non-map entry
point. So flow 3 cannot run under a placeholder token. Two ways
forward, neither blocking flows 1–2:

- **(a)** A CI-scoped Mapbox token as a GitHub Actions secret,
  URL-restricted to `localhost`, on Mapbox's free tier (no paid plan —
  honors the guardrail). `test.skip()` flow 3 when the secret is
  absent (forks, local).
- **(b)** Add a non-map "Follow this train" affordance (e.g. on the
  `StationPanel` arrival row / `LiveTrainsPopup`). This is independently
  good UX — cinematic follow is currently undiscoverable to anyone who
  doesn't know to tap a moving dot — and would make flow 3 hermetic.
  Logged to `open-questions.md` as a product question; out of scope for
  the harness PR itself.

Interim: keep the follow **state machine** covered by the existing
jsdom unit tests; e2e flow 3 lands once (a) or (b) is decided.

## CI integration

Add a **separate parallel job** `e2e` in `.github/workflows/ci.yml` —
do not bolt it onto `lint-and-test` (keeps the existing four checks
fast; aligns with the TIER-5 "parallelize CI" item). Shape:

```
npx playwright install --with-deps chromium
npm run build            # prod build, placeholder token + NEXT_PUBLIC_SITE_URL
npm run start &          # deterministic prod server, not `next dev`
npx playwright test
```

Start the job as a **non-required** check. Promote to required only
after ~1 week of green runs proves it non-flaky — a flaky required
gate trains the maintainer to ignore CI, which is worse than no e2e.

## Decisions

- **Dependency:** `@playwright/test` as a `devDependency`. The quality
  bar's "no new third-party runtime dependency without justification"
  governs *runtime*; this is dev-only (zero bundle/runtime impact) and
  is the industry-standard cross-browser e2e runner — a home-grown
  equivalent would be strictly worse. Justified.
- **Project matrix:** `chromium` for slices 1–2. Add a `Mobile Safari`
  (WebKit) project in a later slice — iOS Safari is the primary target
  (principle #3) and the geolocation cold-start incident is
  iOS-specific, so a WebKit project has real regression value.
- **File layout:** `e2e/` dir at repo root; `playwright.config.ts` at
  root; specs as `e2e/*.spec.ts`; fixtures in `e2e/fixtures/*.json`.
  Vitest's glob is `*.test.ts(x)` — keeping Playwright on `*.spec.ts`
  keeps `npm test` and `playwright test` disjoint with no config
  surgery. Add `playwright-report/` and `test-results/` to
  `.gitignore`. `@/` resolves to repo root (matches Next + Vitest).

## Rollout (three run-sized MODE B PRs)

1. Harness (`playwright.config.ts`, `@playwright/test`, `e2e/` scaffold,
   non-required CI `e2e` job) **+ flow 1**, fully stubbed, chromium.
2. **Flow 2** (address-to-address trip).
3. **Flow 3** once the token-vs-affordance question is answered, plus
   the WebKit project.

Each slice is a self-contained PR with its own fixtures. None blocks
`main` merge until the gate is proven stable.
