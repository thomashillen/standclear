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

If `MAPBOX_TOKEN` is not set, `/api/geocode` and `/api/walk` fall back to `NEXT_PUBLIC_MAPBOX_TOKEN` so the app stays functional rather than silently 503-ing on every search. Setting `MAPBOX_TOKEN` is still recommended in production: it keeps PII-adjacent address queries off the same token that ships in the client bundle, and lets you scope each token's billing limits independently. The server logs a one-line warning per cold start when running on the fallback so the misconfig is visible in operator logs. Note that URL-restricted public tokens may not work when called server-to-Mapbox (no browser Referer is sent), so the fallback only helps if your public token's restrictions are lax — a fresh dedicated `MAPBOX_TOKEN` is always the most reliable setup.

Additional pre-production checklist:

1. Set `NEXT_PUBLIC_SITE_URL` to your canonical URL so OG/Twitter cards, sitemap, and robots.txt resolve absolute URLs correctly.
2. (Optional) Wire `NEXT_PUBLIC_SENTRY_DSN` to forward client + server errors through `lib/observability.ts` to Sentry. The shim ships with a structured-console default, so error tracking works without a DSN — the DSN only enables remote forwarding.
3. Hook `/api/health` into an external uptime monitor (UptimeRobot, Better Stack). It returns 503 when the upstream MTA feed is unreachable so a probe can flip a status page without parsing JSON.
4. Client-side `error`/`warn` records from `lib/observability.ts` are POSTed to `/api/log` (rate-limited, sanitized, capped per page-load) and re-emitted via the server logger so they land in your function-log sink (Vercel logs, etc.) without needing a third-party DSN. Set `NEXT_PUBLIC_LOG_FORWARD=off` to disable the network hop — useful for local development or when wiring a different transport.

### A note on `standclear.app`

The codebase defaults to `https://standclear.app` as the canonical URL — that's the brand target, not necessarily the live deploy. Until the domain is registered + DNS-pointed at the Vercel deploy, set `NEXT_PUBLIC_SITE_URL` to the actual deployment URL (the Vercel preview URL is fine) so social previews and the sitemap don't reference a 404. If the brand ever pivots away from `StandClear`, update `SITE_NAME`, `SITE_URL`, `GITHUB_REPO` in `lib/site.ts`.

### Push notifications (optional)

Push alerts for saved subway lines are opt-in. To enable them, three env vars need to be set in addition to the Mapbox + Site URL ones above:

- **`DATABASE_URL`** — Neon Postgres connection string. Easiest path: Vercel dashboard → Storage → Marketplace → Neon, free tier. Vercel injects this var automatically. Locally, run `npx vercel env pull .env.local` after adding Neon.
- **`NEXT_PUBLIC_VAPID_KEY`** — public half of a VAPID keypair (client uses it for `pushManager.subscribe()`).
- **`VAPID_PRIVATE_KEY`** — server-only half (server signs push payloads).
- **`VAPID_SUBJECT`** — a `mailto:` URL push services use as the abuse-report contact (e.g. `mailto:you@example.com`).
- **`CRON_SECRET`** — random unguessable string (e.g. `openssl rand -hex 32`) that the dispatch cron checks before fanning out pushes. Vercel passes it as `Authorization: Bearer <value>` on every cron invocation.

Generate the VAPID keypair once with `npx web-push generate-vapid-keys`.

Then apply the schema:

```bash
npm run db:migrate
```

This creates the `push_subscriptions` and `alert_dispatch_log` tables in the connected database. Re-running is safe — the migration ledger tracks applied files and skips them. The push features degrade gracefully when these env vars are missing: the API routes return 500 with a clear message, and the UI hides the opt-in.

The dispatch path runs as a GitHub Actions cron (every 5 min — Vercel Hobby restricts crons to daily, so we trigger externally). It polls the MTA alerts feed, filters to severity = "severe", and fans out web-push to every matching subscription. Per-(subscription, alert) dedup via the `alert_dispatch_log` primary key guarantees no double-fires. A second GitHub Actions cron (daily, 4am UTC) runs `/api/cron/cleanup-subscriptions` to purge `unsubscribed_at > 30d` rows and trim the dispatch log to 14 days.

**Operator commands** — both gated by `CRON_SECRET`:

```bash
SECRET=$(grep '^CRON_SECRET=' .env.local | cut -d= -f2- | tr -d '"')

# What's the current subscriber + dispatch volume?
curl -H "Authorization: Bearer $SECRET" \
  https://standclear.vercel.app/api/notifications/stats

# Fire the dispatch cron manually (useful right after a severe alert
# hits the MTA feed if you don't want to wait 5 minutes for the
# next scheduled GitHub Actions run).
curl -H "Authorization: Bearer $SECRET" \
  https://standclear.vercel.app/api/cron/dispatch-alerts

# Fire the cleanup cron manually.
curl -H "Authorization: Bearer $SECRET" \
  https://standclear.vercel.app/api/cron/cleanup-subscriptions
```

Both workflows can also be triggered from the GitHub Actions UI via "Run workflow" (workflow_dispatch).

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
| `npm run db:migrate` | Apply any pending Postgres migrations (push notifications schema) |
| `npm run db:migrate:list` | Show applied vs pending migration files |

## Contributing

Issues and PRs welcome. Run `npm run lint` and `npm test` before opening a PR — CI runs both on every push and pull request.

## License

[MIT](./LICENSE) — do whatever you want, just don't blame me when the L is delayed.

## Acknowledgments

- The [MTA](https://new.mta.info/developers) for publishing GTFS-Realtime feeds without an API key.
- [Mapbox](https://mapbox.com) for the map tiles.
- The [`gtfs-realtime-bindings`](https://github.com/MobilityData/gtfs-realtime-bindings) project for protobuf decoding.
