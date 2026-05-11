import type { Metadata } from "next";
import MarketingShell from "@/components/marketing/MarketingShell";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: `Changelog · ${SITE_NAME}`,
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
    date: "2026-05-09",
    title: "MVP build",
    changes: [
      { type: "changed", text: "Search empty-state now reads as one calm Apple-Maps-style list: Favorites (Commute / Home / Work) sit above Nearby Stations (the three closest, with route bullets) above Recent. Replaces the previous mix of a big Quick-Commute card, two small Home/Work pills, and the Recent list — three competing visual idioms for the same intent." },
      { type: "fixed", text: "Station-row arrivals now fit three trains per direction even when both miss and walk verdicts are present — dropped the 'miss' verdict pill since the strikethrough on the ETA already communicates 'you missed it'." },
      { type: "added", text: "System Pulse aggregates per-vehicle staleness: when one or more trains in service haven't reported in 90 s+, an amber footer line under the status grid spells out the count (and the hard-stale subset past 6 m+), so a rider checking system health can tell apart a fresh feed from a feed full of aging vehicles." },
      { type: "changed", text: "Severe service alerts (full suspensions, 'no service') now auto-expand on the station and line panels so a rider opening a station with a route-wide outage sees the disruption headline without an extra tap. Warning + info alerts stay collapsed by default to keep arrivals visible." },
      { type: "added", text: "Severe service alerts auto-expand in the Service Alerts dialog: when the MTA reports a suspension or 'no service' alert, the description body unfolds on mount instead of starting collapsed under a chevron — the rider opening the dialog during a disruption sees the why immediately. Warning and info severities still start collapsed by default." },
      { type: "changed", text: "Service-worker registration failures and alerts-poll errors now flow through the observability shim instead of bare console.warn — both signals land in the same /api/log sink as other client errors, so a rider whose SW silently fails to register or whose alerts feed has stalled becomes visible to the operator." },
      { type: "added", text: "Station arrival rows now flag stale predictions — when the underlying train hasn't reported its position in 90 s+, an amber 'Updated 4m ago' sub-line appears under the route so a rider deciding whether to run for a 'next train in 5 min' can tell the prediction is being made off old data." },
      { type: "added", text: "Trip-plan rows carry the same staleness signal: each upcoming-arrival ETA on the boarding-station inline list flips amber when its train hasn't reported in 90 s+, with a single 'Updated Nm ago' / 'Stale · Nm' sub-line beneath the soonest stale entry — same idiom as the station panel, threaded into both the Near-me hero card and the Search directions list." },
      { type: "added", text: "Trunk-route trip plans (N/R/W on Broadway BMT, A/C on the 8th Av express, etc.) now show miss/run/walk catchability tinting on each upcoming-arrival ETA in the 'Next:' inline list — same VERDICT_STYLES idiom the single-route trip rows already carry, so a rider walking up to a trunk station gets the same actionable signal as one walking up to a single-route platform." },
      { type: "added", text: "Press kit at /press — boilerplate paragraph, brand assets, screenshot URLs, and a contact link for journalists writing about the project." },
      { type: "added", text: "Per-line landing pages at /line/[id] mirror the per-station pages — every train (1–7, A/C/E, B/D/F/M, G, J/Z, L, N/Q/R/W, shuttles, SI) has its own SEO-indexable surface that links straight into the live map." },
      { type: "added", text: "Per-page Open Graph cards for /about, /pricing, /changelog, /press, /status, /privacy, /terms, and every /line/[id] so a tweeted page link gets a card framed for that surface instead of the generic site card." },
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
