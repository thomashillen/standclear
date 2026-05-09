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
cp .env.example .env.local   # then fill in MAPBOX_TOKEN + NEXT_PUBLIC_MAPBOX_TOKEN
npm run dev
```

Then open http://localhost:3000.

You'll need a Mapbox access token to see the map. Create one (free tier is plenty) at https://mapbox.com, then add both vars to `.env.local` (they can be the same token in dev):

```
MAPBOX_TOKEN=pk.eyJ1...           # server-only: geocoding + walking directions
NEXT_PUBLIC_MAPBOX_TOKEN=pk.eyJ1... # client-visible: GL JS map tile rendering
```

The MTA GTFS-Realtime feeds are public and require no key.

### Production deploy notes

The app uses two Mapbox tokens with different exposure profiles:

- **`MAPBOX_TOKEN`** (server-only) — used by `/api/geocode` and `/api/walk` to proxy geocoding and walking-directions calls. Never leaves the server. No URL restriction needed.
- **`NEXT_PUBLIC_MAPBOX_TOKEN`** (client-visible) — used by Mapbox GL JS for tile rendering. Ships in the client bundle; restrict it at https://account.mapbox.com/access-tokens/ under *URL restrictions* to your production domain(s). A leaked map token restricted to your domain can only render tiles, not run geocoding or billing-intensive calls.

Additional pre-production checklist:

1. Set `NEXT_PUBLIC_SITE_URL` to your canonical URL so OG/Twitter cards, sitemap, and robots.txt resolve absolute URLs correctly.
2. (Optional) Wire `NEXT_PUBLIC_SENTRY_DSN` to forward client + server errors through `lib/observability.ts` to Sentry. The shim ships with a structured-console default, so error tracking works without a DSN — the DSN only enables remote forwarding.
3. Hook `/api/health` into an external uptime monitor (UptimeRobot, Better Stack). It returns 503 when the upstream MTA feed is unreachable so a probe can flip a status page without parsing JSON.

### A note on `standclear.app`

The codebase defaults to `https://standclear.app` as the canonical URL — that's the brand target, not necessarily the live deploy. Until the domain is registered + DNS-pointed at the Vercel deploy, set `NEXT_PUBLIC_SITE_URL` to the actual deployment URL (the Vercel preview URL is fine) so social previews and the sitemap don't reference a 404. Two places to update if the brand ever pivots away from `StandClear`:

- `lib/site.ts` — `SITE_NAME`, `SITE_URL`, `GITHUB_REPO`, etc.
- `capacitor.config.ts` — `appId`, `appName`, `server.url` (then run `npm run cap:sync:ios`).

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

## Native iOS app

StandClear also ships as a native iOS app via Capacitor. The native shell loads the live web app in a WebView, with native plugins for splash, status bar, share, and preferences layered on top — Apple Review-friendly without bundling a separate static export.

Quick start (on a Mac):

```bash
npm install
cd ios/App && pod install && cd -
npm run cap:open:ios   # opens the Xcode workspace
```

**You don't need a paid Apple Developer subscription to develop or test:**

- Free Xcode signing covers the iOS Simulator and your own iPhone (re-sign weekly via ⌘R).
- The $99/year Apple Developer Program is only needed for App Store submission and for distributing TestFlight builds to other testers.

Full setup, real-device testing, and App Store submission walkthrough in [NATIVE.md](./NATIVE.md).

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
| `npm run cap:sync:ios` | Push web shell + plugin updates into the Xcode project |
| `npm run cap:open:ios` | Open `ios/App/App.xcworkspace` in Xcode |

## Contributing

Issues and PRs welcome. Run `npm run lint` and `npm test` before opening a PR — CI runs both on every push and pull request.

## License

[MIT](./LICENSE) — do whatever you want, just don't blame me when the L is delayed.

## Acknowledgments

- The [MTA](https://new.mta.info/developers) for publishing GTFS-Realtime feeds without an API key.
- [Mapbox](https://mapbox.com) for the map tiles.
- The [`gtfs-realtime-bindings`](https://github.com/MobilityData/gtfs-realtime-bindings) project for protobuf decoding.
