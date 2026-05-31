import type { Metadata } from "next";
import MarketingShell from "@/components/marketing/MarketingShell";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = {
  // Plain section name; the root layout's title template appends
  // ` · ${SITE_NAME}`. Including the suffix here would double it.
  title: "Changelog",
  description: `What shipped, what changed, what got fixed in ${SITE_NAME}.`,
  alternates: { canonical: "/changelog" },
};

interface Entry {
  version: string;
  date: string;
  title: string;
  changes: { type: "added" | "changed" | "fixed" | "removed"; text: string }[];
}

// Hand-curated from the merged PR titles on `main`. When a release is
// cut, prepend a new entry — don't rely on git log being canonical
// since branches and squash merges can muddy the history.
const ENTRIES: Entry[] = [
  {
    version: "0.9.0",
    date: "2026-05-12",
    title: "MVP build",
    changes: [
      { type: "fixed", text: "The 'incoming train' ring on an open station no longer flashes a nonsensical '60s' caption: an arrival just under a minute out now rolls straight to '1 min' (and a train ~5 s away reads 'Now' at the same instant the station panel's chip does), so the on-map caption and the panel agree for the same train." },
      { type: "changed", text: "System Pulse's per-line breakdown is now tappable: each row in the 'Lines running' list (bullet · count bar · count) is a link to that line's landing page, so a rider watching the L top the chart during rush hour can tap into /line/L for the full schedule diagram and active alerts in one move. The dialog closes in lockstep with the navigation so the destination's first frame isn't painted under a stale popup." },
      { type: "changed", text: "The trip planner now tags its top option 'Fastest' when more than one route is offered — the list is already sorted by estimated total time (walk + wait + ride + transfer), so the leading card now says so out loud instead of leaving the rider to infer it from a subtly brighter highlight. A single-option result stays untagged; there's nothing to be fastest against." },
      { type: "changed", text: "Route-letter bullets on the station and line landing pages now read correctly to screen readers: the nearby-stations list on a station page announces 'A train, C train…' instead of spelling out bare ambiguous letters, and the decorative line bullet that duplicated the page heading is now skipped by assistive tech instead of repeating it." },
      { type: "changed", text: "The cinematic follow-mode close button is now a full 44px touch target — it was the one control you tap while the train is actually moving, and it was undersized for a thumb under jostle. The X glyph looks the same; the tappable area grew to the size your thumb needs." },
      { type: "changed", text: "The close buttons on the More sheet and the line picker, and the dismiss on the install banner, are now full 44px touch targets — they were 32–36px, undersized for a thumb on a moving train. The X glyphs look identical; only the tappable area grew to the size your thumb needs." },
      { type: "changed", text: "Screen readers now hear the same sentence for a stale-position warning everywhere it appears: the station arrival row and the line panel's per-direction ETA chip used to speak two slightly different phrasings ('Position last updated…' vs 'position last updated…', with different rounding), and either could drift from the visible 'Updated Nm ago' badge. The spoken age is now single-sourced alongside the visible label so the two can never disagree. No change for sighted riders." },
      { type: "fixed", text: "Installing StandClear to your home screen now pins a stable app identity, so a future deep-linked launch URL won't spawn a duplicate icon or break updates for an already-installed app. The web app manifest also declares its language and text direction for a correctly localized install prompt." },
      { type: "fixed", text: "Opening a station on a cold first visit no longer shows 'No upcoming trains in the next 45 min.' under both directions while the live feed is still loading. The definitive empty line now waits until the first arrivals payload lands, so a brand-new rider isn't told the station is dead before the app has even polled — the calm 'Loading live arrivals…' line carries that moment instead." },
      { type: "changed", text: "The station panel's 'Show all / Show less' arrivals control now announces its collapsed/expanded state to screen readers, matching the service-alert disclosures — a rider using VoiceOver hears that tapping reveals more trains rather than navigating away." },
      { type: "fixed", text: "Station arrivals now show the train's real destination, not the end of the line. A 6 short-turning at Parkchester (roughly 40% of northbound 6 trains at peak) used to read 'to Pelham Bay Park' — board it expecting Pelham Bay and you'd get put off mid-route. The panel now labels each train with the actual last stop the MTA feed reports for that specific run, so short-turns and branch services (a 5 to Dyre Av) read correctly. Falls back to the line's terminus only when the feed omits a destination." },
      { type: "fixed", text: "Live trains, service alerts, and the route map now refresh more reliably on a cold launch underground: the offline cache serves the last-known snapshot instantly while a fresh copy downloads in the background, but the background refresh could be cut short the moment the cached copy was shown — so the next launch sometimes served even staler data. The refresh is now held open until it completes." },
      { type: "changed", text: "Service alert route bullets are now tappable: in the global alerts dialog, the small route bullets under each card link straight to that line's landing page so a rider seeing 'No [F] service downtown' can tap the F bullet to check the F's live trains without scrolling back to the map. Unknown route ids (future MTA bullets we haven't shipped yet) still surface as inert badges." },
      { type: "changed", text: "Trip planner now uses live transfer-station arrivals for the second leg's wait — a fast L→4 transfer (4 arriving a minute after you reach Union Sq) ranks ahead of a slow L→4 (next 4 is 12 min out) when both share the same nominal stop count. Previously every transfer was modeled on a constant 4-minute wait, so leg-2 ranking was blind to whether the connecting train was actually about to arrive." },
      { type: "added", text: "Push-notification subscribe and unsubscribe failures now surface inline under the More-sheet row — a rejected toggle reads 'Couldn't enable notifications. Try again.' (or its disable counterpart) instead of silently reverting, and a deploy missing its VAPID key reads 'Notifications aren't set up on this deploy.' so a self-hoster sees the gap in the UI. A server-side disable that fails keeps you subscribed instead of claiming you're off." },
      { type: "added", text: "Station landing pages link each train at the station to its per-line page — bullet pills in the header and the Lines list rows both navigate to /line/[id], so a rider arriving from a search result can pivot from a station view to the full line schedule diagram in one tap. The reverse direction (line page linking into stations) already shipped." },
      { type: "fixed", text: "Pinned Home/Work commute rows in More now show the anchored station's actual name (e.g. '14 St-Union Sq') instead of a generic 'Pinned station' placeholder once the station index has loaded." },
      { type: "removed", text: "Rider IP addresses are no longer persisted in the server-side error log — the in-memory rate limiter still uses them for abuse defense, but the logged record now contains no IP field. Closes the last gap between the /privacy promise and the production log shape." },
      { type: "added", text: "Opt-in push notifications for severe service alerts: pick which lines you ride from the More sheet's Notifications row, and the next time the MTA flags a 'no service' or 'suspended' alert on one of them you get a heads-up on your lock screen. No account, no email — the subscription is keyed off an anonymous browser ID and you can disable it from the same row at any time." },
      { type: "removed", text: "/pricing and /press marketing pages dropped — the 'free, no ads, you can self-host' copy moved into a 'Free forever' section on /about, and the press boilerplate + brand assets condensed into a 'For press & fact-checks' section at the bottom of /about. Less surface area for a rider catching a train to wade through." },
      { type: "changed", text: "/status page now announces health transitions to screen readers — the rollup headline (All systems operational / Some systems are degraded / Major outage in progress) sits in a polite live region so a state change is re-read aloud, the cold-start placeholder and offline-paused notice are statuses, and a /api/health fetch failure surfaces as an assertive alert." },
      { type: "changed", text: "Per-line landing pages (/line/A, /line/4, etc.) now surface transfer-line bullets next to each station instead of the same redundant current-line bullet on every row — a rider scanning the stop list is planning where to switch off this line, and the Apple/Google Maps transit idiom is to show interchange routes. Single-line stops render no bullets; hub complexes (Times Sq, Union Sq, Atlantic-Barclays) flex-wrap a strip of every transfer at the complex." },
      { type: "changed", text: "Loading-skeleton pulses (Service Alerts list placeholders, station and line live-arrivals shimmer, the geolocation 'Finding you…' icon, the map's first-paint label, LinePicker bullet grid) now respect prefers-reduced-motion: the gray placeholder shapes still hold the layout, but the breathing animation only runs for riders who haven't asked the OS to reduce motion." },
      { type: "added", text: "Service-alert cards now surface their active window — a compact 'Until Sun 5 AM' / 'Ends in 45 min' sub-line under the headline so a rider reading 'No [Q] service' knows when service returns without having to expand the description or open a separate page. Hidden for indefinite or out-of-horizon windows so the card doesn't grow a no-op row." },
      { type: "changed", text: "Search empty-state now reads as one calm Apple-Maps-style list: Favorites (Commute / Home / Work) sit above Nearby Stations (the three closest, with route bullets) above Recent. Replaces the previous mix of a big Quick-Commute card, two small Home/Work pills, and the Recent list — three competing visual idioms for the same intent." },
      { type: "fixed", text: "Station-row arrivals now fit three trains per direction even when both miss and walk verdicts are present — dropped the 'miss' verdict pill since the strikethrough on the ETA already communicates 'you missed it'." },
      { type: "fixed", text: "Station rows in search results, favorites, and the nearest-stations list no longer claim 'No upcoming trains' during the first-paint moment before live data has loaded — on a brand-new visit the row holds its name and route bullets while the feed loads instead of flashing a false 'this station is dead', then fills in arrivals (or the genuine empty state) once the first poll lands. Matches the same loading-vs-empty fix already applied to the station and line detail panels." },
      { type: "changed", text: "Decorative 'live-feed' ping rings (floating header pill, System Pulse popup, /status page) now respect prefers-reduced-motion: the colored dot + glow still carries the state signal, but the outward pulse animation only runs for riders who haven't asked the OS to reduce motion." },
      { type: "added", text: "System Pulse aggregates per-vehicle staleness: when one or more trains in service haven't reported in 90 s+, an amber footer line under the status grid spells out the count (and the hard-stale subset past 6 m+), so a rider checking system health can tell apart a fresh feed from a feed full of aging vehicles." },
      { type: "changed", text: "Severe service alerts (full suspensions, 'no service') now auto-expand on the station and line panels so a rider opening a station with a route-wide outage sees the disruption headline without an extra tap. Warning + info alerts stay collapsed by default to keep arrivals visible." },
      { type: "added", text: "Severe service alerts auto-expand in the Service Alerts dialog: when the MTA reports a suspension or 'no service' alert, the description body unfolds on mount instead of starting collapsed under a chevron — the rider opening the dialog during a disruption sees the why immediately. Warning and info severities still start collapsed by default." },
      { type: "changed", text: "Service-worker registration failures and alerts-poll errors now flow through the observability shim instead of bare console.warn — both signals land in the same /api/log sink as other client errors, so a rider whose SW silently fails to register or whose alerts feed has stalled becomes visible to the operator." },
      { type: "added", text: "Station arrival rows now flag stale predictions — when the underlying train hasn't reported its position in 90 s+, an amber 'Updated 4m ago' sub-line appears under the route so a rider deciding whether to run for a 'next train in 5 min' can tell the prediction is being made off old data." },
      { type: "added", text: "Trip-plan rows carry the same staleness signal: each upcoming-arrival ETA on the boarding-station inline list flips amber when its train hasn't reported in 90 s+, with a single 'Updated Nm ago' / 'Stale · Nm' sub-line beneath the soonest stale entry — same idiom as the station panel, threaded into both the Near-me hero card and the Search directions list." },
      { type: "changed", text: "Station list rows — the compact arrival chips under search results, favorites, and the nearest-stations list — now carry the staleness signal too: an ETA flips amber when the train predicting it hasn't reported its position in 90 s+, so a confident '3m' off a stale fix reads the same 'trust this less' as the fading map marker. When a run/walk/miss catch verdict already owns the chip color, the staleness age still rides the screen-reader label so it isn't lost. This was the last live-arrival surface still painting stale predictions as fresh." },
      { type: "added", text: "Trunk-route trip plans (N/R/W on Broadway BMT, A/C on the 8th Av express, etc.) now show miss/run/walk catchability tinting on each upcoming-arrival ETA in the 'Next:' inline list — same VERDICT_STYLES idiom the single-route trip rows already carry, so a rider walking up to a trunk station gets the same actionable signal as one walking up to a single-route platform." },
      { type: "added", text: "Per-line landing pages at /line/[id] mirror the per-station pages — every train (1–7, A/C/E, B/D/F/M, G, J/Z, L, N/Q/R/W, shuttles, SI) has its own SEO-indexable surface that links straight into the live map." },
      { type: "added", text: "Per-page Open Graph cards for /about, /changelog, /status, /privacy, /terms, and every /line/[id] so a tweeted page link gets a card framed for that surface instead of the generic site card." },
      { type: "added", text: "Tappable walking card opens turn-by-turn detail at half-detent." },
      { type: "added", text: "Offline shell, cross-tab sync, audit-driven app improvements across the board." },
      { type: "added", text: "iOS-26 Liquid Glass design system with tilt-reactive specular highlights." },
      { type: "added", text: "Incoming-train pulse rings on the map; desktop panel overlap fix." },
      { type: "added", text: "Real walking paths from Mapbox Directions; expandable route details with refresh." },
      { type: "added", text: "Pin Home and Work; planner picks the fastest route based on where you are." },
      { type: "changed", text: "Line panel snapshot-staleness now aligns with the rest of the app — 60 s threshold (was 30 s) so a single recovered poll hiccup no longer flashes 'stale' for a moment, and the eyebrow now shows the actual age ('Stale · 90s' / 'Stale · 2m') instead of a binary label." },
      { type: "changed", text: "Search now uses Mapbox /suggest + /retrieve for typeahead-grade autocomplete." },
      { type: "changed", text: "Scroll-up-to-expand on route detail; auto fastest-route preview; smaller route-detail sheet." },
      { type: "changed", text: "Flatter LinePicker with grouped lines and drag-to-dismiss." },
      { type: "fixed", text: "Trains visible on map after staleness fade landed." },
      { type: "fixed", text: "Commute-route overlay now clears on Near-me exit paths." },
      { type: "fixed", text: "Full route stays visible when shown from Near-me daily commute." },
      { type: "fixed", text: "Tests, store migration to useSyncExternalStore, lint cleared across the codebase." },
    ],
  },
  {
    version: "0.8.0",
    date: "2026-04-22",
    title: "StandClear",
    changes: [
      { type: "changed", text: "Renamed the project from SubwaySurfer to StandClear; rewrote the README and added an MIT license for open-sourcing." },
      { type: "fixed", text: "Legacy localStorage migration when post-rename keys had corrupt JSON." },
    ],
  },
];

const TYPE_LABELS: Record<Entry["changes"][number]["type"], string> = {
  added: "Added",
  changed: "Changed",
  fixed: "Fixed",
  removed: "Removed",
};

const TYPE_TINT: Record<Entry["changes"][number]["type"], string> = {
  added: "bg-emerald-500/15 text-emerald-200 ring-emerald-500/30",
  changed: "bg-sky-500/15 text-sky-200 ring-sky-500/30",
  fixed: "bg-amber-500/15 text-amber-200 ring-amber-500/30",
  removed: "bg-rose-500/15 text-rose-200 ring-rose-500/30",
};

export default function ChangelogPage() {
  return (
    <MarketingShell
      eyebrow="Product"
      title="Changelog"
      description={`What shipped, what changed, what got fixed in ${SITE_NAME}. Newest first.`}
    >
      <div className="not-prose space-y-12">
        {ENTRIES.map((e) => (
          <section
            key={e.version}
            className="relative pl-5 sm:pl-6 border-l border-white/[0.08]"
          >
            <div className="absolute left-[-5px] top-1 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-4 ring-emerald-400/15" />
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-1">
              <h2 className="text-2xl font-black tracking-tight !mt-0 !mb-0">
                v{e.version}
              </h2>
              <span className="text-[13px] text-gray-500 tabular-nums">
                {e.date}
              </span>
              <span className="text-[13px] text-gray-400">— {e.title}</span>
            </div>
            <ul className="mt-4 space-y-2">
              {e.changes.map((c, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span
                    className={`flex-shrink-0 mt-0.5 px-2 py-0.5 rounded-full ring-1 text-[10px] font-bold uppercase tracking-wider ${TYPE_TINT[c.type]}`}
                  >
                    {TYPE_LABELS[c.type]}
                  </span>
                  <span className="text-[14.5px] text-gray-300 leading-relaxed">
                    {c.text}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </MarketingShell>
  );
}
