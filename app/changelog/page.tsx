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
      { type: "added", text: "Press kit at /press — boilerplate paragraph, brand assets, screenshot URLs, and a contact link for journalists writing about the project." },
      { type: "added", text: "Per-page Open Graph cards for /about, /pricing, and /changelog so shared marketing links get framed thumbnails instead of the generic site card." },
      { type: "added", text: "Tappable walking card opens turn-by-turn detail at half-detent." },
      { type: "added", text: "Offline shell, cross-tab sync, audit-driven app improvements across the board." },
      { type: "added", text: "iOS-26 Liquid Glass design system with tilt-reactive specular highlights." },
      { type: "added", text: "Incoming-train pulse rings on the map; desktop panel overlap fix." },
      { type: "added", text: "Real walking paths from Mapbox Directions; expandable route details with refresh." },
      { type: "added", text: "Pin Home and Work; planner picks the fastest route based on where you are." },
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
