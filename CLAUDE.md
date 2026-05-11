# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Next.js dev server at http://localhost:3000 |
| `npm run build` / `npm run start` | Production build / run |
| `npm run lint` | ESLint (run before PRs; CI runs this) |
| `npm test` | Vitest, single run (CI runs this) |
| `npm run test:watch` | Vitest watch mode |
| `npx vitest run path/to/file.test.ts` | Run a single test file |
| `npx vitest run -t "name"` | Run a single test by name pattern |
| `npm run build:gtfs` | Regenerate `public/gtfsData.json` from `data/gtfs/` |

`NEXT_PUBLIC_MAPBOX_TOKEN` is required in `.env.local` for the map to render. The MTA GTFS-RT feeds need no key.

## Architecture

This is a Next.js 16 / React 19 app rendering live NYC subway data on a Mapbox dark map. There are three data planes that have to stay in sync:

**1. Static GTFS geometry** (`scripts/build-gtfs.mjs` → `public/gtfsData.json`, consumed by `lib/subwayData.ts`)
- The 429KB blob is fetched at runtime, NOT imported as a module — bundling it through Turbopack blew up tsserver memory previously. Don't change this.
- One representative shape + stop list per route. Shuttles (`GS`/`FS`/`H`) collapse to display id `"S"`; `SI` stays `"SI"`.
- `useLines()` is a singleton-cached hook with a subscriber set; all panels read from it.

**2. Live trains + arrivals** (`app/api/trains/route.ts` → `lib/useTrains.ts`)
- Fans out to 8 MTA GTFS-RT feeds in parallel, decodes protobuf, returns `{ trains, arrivals }`.
- Module-scope `tripStopCache` is load-bearing: MTA's `stopTimeUpdate` only contains future stops, so for an in-transit train the previous stop is unrecoverable from a single snapshot. The cache survives across requests on the same Vercel Node instance and recovers within one poll on cold start. If you change request-handling, preserve this cache.
- Dedup is **tripId-only** by design. Do not add `(routeId, direction, stopId, status)` dedup — multiple trains legitimately queue STOPPED_AT at terminuses (J at Broad St, 1 at South Ferry, etc.). The comment in `route.ts` explains why; respect it.
- Client polls every 8s; faster returns identical data, slower causes visible jumps. The hook hydrates from `localStorage` on cold boot before the first poll.

**3. Alerts** (`app/api/alerts/route.ts` → `lib/useAlerts.ts`) — separate poll from trains, severity-classified, scoped per route/station in the UI.

### UI shell

`app/page.tsx` mounts a single `SubwayMap` (client component, dynamic-imported `MapView` so Mapbox stays out of SSR). Bottom-sheet panels (`StationPanel`, `NearbyPanel`, `LinePanel`, `SearchSheet`, `MoreSheet`, `LiveTrainsPopup`) are mutually exclusive — opening one closes the others; that orchestration lives in `SubwayMap.tsx`. All panels start closed; the live map is the cold-boot hero. The Near-me button in the floating header is the user-tap path that triggers iOS Safari's geolocation prompt.

### Routing & station model

- `lib/stopsIndex.ts` — builds a `StationEntry` per *complex* (Union Sq merges 4/5/6 + NQRW + L into one entry across separate MTA stop records), provides nearest-N spatial lookup. `haversineMeters` is good enough at NYC scale — the 1.3× grid-detour factor in walk-time estimates dominates.
- `lib/commuteRouting.ts` — direct + 1-transfer trip planning over the line graph. Ranks by leg count first, then total stops; carries both platform stop_id (`boardStopId`) and canonical complex id (`boardComplexId`).
- `lib/walkingDirections.ts` — Mapbox Directions API for the dashed pedestrian legs connecting addresses to platforms.
- `lib/geocoding.ts` — Mapbox `/suggest` + `/retrieve` (the typeahead pair, not `/forward`).

## Tests

Vitest config (`vitest.config.ts`) defaults to `jsdom` so hook tests get `window`/`localStorage`. Pure-logic and Node-only tests opt out via a `// @vitest-environment node` directive at the top of the file (e.g. `app/api/trains/route.test.ts`, `lib/stopsIndex.test.ts`). Match this pattern when adding tests.

`@/` resolves to the repo root in both Next and Vitest.

## Conventions

- The codebase has dense comments explaining *why* — many encode incidents (the 65GB tsserver incident, the terminus-dedup undercounting, iOS Safari geolocation cold-start). Treat them as load-bearing; don't strip them when refactoring.
- Module-scope singletons are used deliberately (`useTrains` cache, `subwayData` cache, server `tripStopCache`). Don't replace with React context unless you've thought through cold-boot and cross-request behavior.
