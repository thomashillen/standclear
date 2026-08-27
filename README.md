# StandClear

**See the NYC subway move in real time.**

StandClear is a live, interactive map of the New York City subway. Watch trains move across the city, tap a station to see upcoming arrivals, and use your location to instantly understand what is happening around you.

No account. No app download. Open it and see the subway.

**[Open StandClear →](https://standclear.vercel.app)**

Named after the iconic *“Stand clear of the closing doors, please.”*

> StandClear is built mobile-first. The goal is simple: make the subway feel alive at a glance, then make the information useful enough that New Yorkers can come back whenever they need to know what is happening nearby.

## What makes it different

- **A live subway map** — trains across all 23 lines animate along real GTFS shape geometry using the MTA's GTFS-Realtime feeds.
- **Useful in one tap** — enable location to see nearby stations and upcoming trains without entering a destination or planning a trip.
- **Made for exploration** — tap around the map to inspect stations, arrivals, lines, and current service information.
- **Planning when you need it** — address search, saved Home/Work destinations, walking legs, transfers, and live-aware commute estimates are available without taking over the default experience.
- **Installable, but still just a link** — StandClear is a PWA, so it can live on an iPhone or Android home screen while remaining instantly shareable on the web.

The product philosophy is intentionally **less is more**. StandClear is not trying to become every possible transit tool. The live map is the heart of the experience; nearby arrivals and trustworthy realtime information are what make it useful day to day.

## Features

- **Live trains** — animated across the subway network and refreshed from MTA realtime feeds.
- **Station arrivals** — tap a stop for direction-aware upcoming trains, walking distance, and relevant alerts.
- **Near Me** — location-powered nearby stations and arrivals for quick everyday checks.
- **Commute routing** — optional Home/Work and address-to-address planning with walking, transfers, ride legs, and live-aware timing.
- **Service alerts** — severity-classified alerts scoped to relevant routes and stations.
- **PWA** — home-screen installation on iOS and Android, app icons, offline shell, and mobile safe-area handling.

## How it works

StandClear combines static MTA GTFS data with the MTA's public GTFS-Realtime feeds. Static data provides subway lines, stations, shapes, and stop ordering; realtime vehicle and trip data places trains on those shapes and powers arrival information.

The map is rendered with Mapbox GL. The application is built with Next.js 16, React 19, TypeScript, and Tailwind CSS.

## Getting started

```bash
npm install
cp .env.example .env.local
npm run dev
```

Add Mapbox tokens to `.env.local`:

```bash
MAPBOX_TOKEN=pk.eyJ1...
NEXT_PUBLIC_MAPBOX_TOKEN=pk.eyJ1...
```

Then open `http://localhost:3000`.

`MAPBOX_TOKEN` is server-only and is used for geocoding and walking directions. `NEXT_PUBLIC_MAPBOX_TOKEN` is client-visible and renders the map. They can be the same token locally, but production should use separate tokens with the public token restricted to the production domain.

The MTA GTFS-Realtime feeds are public and require no API key.

## Project layout

```text
app/
  api/trains/       GTFS-RT vehicle + arrival aggregation
  api/alerts/       GTFS-RT subway alerts
  page.tsx          Map shell
components/
  SubwayMap.tsx     Product state + map experience
  MapView.tsx       Mapbox rendering and interactions
  StationPanel      Station arrivals and detail
  NearbyPanel       Location-powered nearby experience
lib/
  commuteRouting.ts Address-to-address routing
  stopsIndex.ts     Spatial station index
  useTrains         Realtime train polling + caching
  useAlerts         Service-alert polling + caching
scripts/
  build-gtfs.mjs    Static GTFS → public/gtfsData.json
public/
  gtfsData.json     Pre-built subway geometry + stop data
```

## Rebuilding static GTFS data

The repository ships with a pre-built `public/gtfsData.json`. To refresh it:

1. Download `gtfs_subway.zip` from the [MTA developer page](https://new.mta.info/developers).
2. Unzip it to `data/gtfs/` (the raw files are gitignored).
3. Run `npm run build:gtfs`.

The build script chooses representative route shapes, associates stops with shape geometry, and emits the static dataset used by the client.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the Next.js development server |
| `npm run build` | Create a production build |
| `npm run start` | Run the production build |
| `npm run lint` | Run ESLint |
| `npm test` | Run Vitest tests |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run build:gtfs` | Regenerate `public/gtfsData.json` |
| `npm run db:migrate` | Apply pending database migrations |
| `npm run db:migrate:list` | List applied and pending migrations |

## Production notes

### Canonical URL

Set `NEXT_PUBLIC_SITE_URL` to the actual production URL so Open Graph/Twitter cards, the sitemap, and `robots.txt` resolve correctly.

The codebase uses `https://standclear.app` as the brand-target canonical URL, but the current public deployment is `https://standclear.vercel.app`. Until a custom domain is registered and connected, production configuration should point at the live deployment rather than a domain that does not resolve.

### Mapbox tokens

Use separate tokens in production:

- `MAPBOX_TOKEN` — server-only, for `/api/geocode` and `/api/walk`.
- `NEXT_PUBLIC_MAPBOX_TOKEN` — client-visible, for Mapbox GL map rendering. Restrict this token to the production domain in Mapbox.

If `MAPBOX_TOKEN` is absent, server routes can fall back to `NEXT_PUBLIC_MAPBOX_TOKEN`, but a dedicated server token is the recommended production setup.

### Observability

`/api/health` reports upstream MTA feed health and can be connected to an external uptime monitor. Client `error`/`warn` records can be forwarded through `/api/log` into server logs. Optional Sentry forwarding is supported with `NEXT_PUBLIC_SENTRY_DSN`; no Sentry SDK is required.

Set `NEXT_PUBLIC_LOG_FORWARD=off` to disable client-to-server log forwarding.

### Push notifications (optional)

Saved-line push alerts are opt-in and degrade gracefully when their infrastructure is not configured. They require:

- `DATABASE_URL`
- `NEXT_PUBLIC_VAPID_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`
- `CRON_SECRET`

Generate VAPID keys with:

```bash
npx web-push generate-vapid-keys
```

Then apply the database schema:

```bash
npm run db:migrate
```

The dispatch workflow polls MTA alerts, sends qualifying severe alerts to matching subscriptions, and deduplicates deliveries. A cleanup workflow removes old unsubscribed records and dispatch history.

## Contributing

Issues and PRs are welcome. Before opening a PR, run:

```bash
npm run lint
npm test
npm run build
```

CI runs the repository's validation checks on pull requests.

## License

[MIT](./LICENSE) — do whatever you want, just don't blame me when the L is delayed.

## Acknowledgments

- [MTA](https://new.mta.info/developers) for publishing the subway's GTFS and GTFS-Realtime data.
- [Mapbox](https://www.mapbox.com) for map rendering and location services.
- [`gtfs-realtime-bindings`](https://github.com/MobilityData/gtfs-realtime-bindings) for GTFS-Realtime protobuf decoding.
