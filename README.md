# StandClear

Real-time NYC subway tracker. Every train on every line, rendered live on a Mapbox dark-mode map, with arrivals, nearby stations, address-to-address commute routing, and active service alerts. Named for the iconic *"stand clear of the closing doors, please."*

Built with Next.js 16, React 19, TypeScript, Tailwind, and Mapbox GL. Data comes straight from the MTA's public GTFS-Realtime feeds — no API key, no third party.

## Features

- **Live trains** — all 23 lines, animated along true GTFS shape geometry, refreshed from the MTA feeds.
- **Station-centric UX** — tap any stop to see northbound/southbound arrivals, walking distance, and active alerts.
- **Nearby panel** — auto-populated on first load using device geolocation (with iOS Safari quirks handled).
- **Commute routing** — type a home and work address; get walking + transfer + ride legs with live ETAs.
- **Service alerts** — severity-classified, scoped to your route or station, polled separately from train data.
- **PWA** — installable on iOS / Android with proper icons, offline shell, and Dynamic Island clearance.

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in NEXT_PUBLIC_MAPBOX_TOKEN
npm run dev
```

Then open http://localhost:3000.

You'll need a Mapbox access token to see the map. Create one (free tier is plenty) at https://mapbox.com, then add it to `.env.local`:

```
NEXT_PUBLIC_MAPBOX_TOKEN=pk.eyJ1...
```

The MTA GTFS-Realtime feeds are public and require no key.

### Production deploy notes

`NEXT_PUBLIC_MAPBOX_TOKEN` is bundled into the client. Before production:

1. Restrict the token at https://account.mapbox.com/access-tokens/ under *URL restrictions* to your production domain(s). A leaked token can otherwise be billed against your account from arbitrary origins.
2. Set `NEXT_PUBLIC_SITE_URL` to your canonical URL so OG/Twitter cards, sitemap, and robots.txt resolve absolute URLs correctly.
3. (Optional) Wire `NEXT_PUBLIC_SENTRY_DSN` to forward client + server errors through `lib/observability.ts` to Sentry. The shim ships with a structured-console default, so error tracking works without a DSN — the DSN only enables remote forwarding.
4. Hook `/api/health` into an external uptime monitor (UptimeRobot, Better Stack). It returns 503 when the upstream MTA feed is unreachable so a probe can flip a status page without parsing JSON.

## Project layout

```
app/
  api/trains/   GTFS-RT vehicle + arrival aggregation across 8 MTA feeds
  api/alerts/   GTFS-RT subway-alerts feed, severity-classified
  page.tsx      Map shell
components/
  SubwayMap.tsx, MapView.tsx       Map + render layers
  StationPanel, NearbyPanel, …     Bottom-sheet UI
lib/
  commuteRouting.ts   Address-to-address routing with transfer + walking legs
  stopsIndex.ts       Spatial index over all stops for nearest-N lookup
  useTrains, useAlerts, …          React data hooks (polling + caching)
scripts/
  build-gtfs.mjs      Static GTFS → public/gtfsData.json (lines, shapes, stops)
public/
  gtfsData.json       Pre-baked line geometry shipped to the client
```

## Rebuilding the static GTFS data

The repo ships with a pre-built `public/gtfsData.json`. To regenerate from a fresh MTA GTFS dump:

1. Download `gtfs_subway.zip` from the [MTA developer page](https://new.mta.info/developers).
2. Unzip it to `data/gtfs/` (the raw zip and unpacked folder are gitignored).
3. Run `npm run build:gtfs`.

The script picks the longest representative trip + shape per route, snaps each stop to the nearest shape vertex, and emits a single JSON the client streams in.

## Scripts

| Command            | What it does                                  |
| ------------------ | --------------------------------------------- |
| `npm run dev`      | Next.js dev server                            |
| `npm run build`    | Production build                              |
| `npm run start`    | Run the production build                      |
| `npm run lint`     | ESLint                                        |
| `npm test`         | Vitest unit tests                             |
| `npm run test:watch` | Vitest watch mode                           |
| `npm run build:gtfs` | Regenerate `public/gtfsData.json` from raw GTFS |

## Contributing

Issues and PRs welcome. Run `npm run lint` and `npm test` before opening a PR — CI runs both on every push and pull request.

## License

[MIT](./LICENSE) — do whatever you want, just don't blame me when the L is delayed.

## Acknowledgments

- The [MTA](https://new.mta.info/developers) for publishing GTFS-Realtime feeds without an API key.
- [Mapbox](https://mapbox.com) for the map tiles.
- The [`gtfs-realtime-bindings`](https://github.com/MobilityData/gtfs-realtime-bindings) project for protobuf decoding.
