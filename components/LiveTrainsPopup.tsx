"use client";

import { useMemo } from "react";
import { Activity, ArrowDown, ArrowUp, Radio, Train } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTrains } from "@/lib/useTrains";
import { useLines } from "@/lib/subwayData";
import { useNow } from "@/lib/useNow";
import { summarizeFleetStaleness } from "@/lib/trainStaleness";

interface Props {
  open: boolean;
  onClose: () => void;
}

// LiveTrainsPopup — a "system pulse" view tied to the live-feed pill in
// the floating header. Surfaces the pieces of the GTFS-RT snapshot that
// don't otherwise have a home in the app: total fleet in service right
// now, direction split, status mix (dwelling vs. moving vs. arriving),
// and a busiest-lines breakdown. Refreshes implicitly with `useTrains`.
export default function LiveTrainsPopup({ open, onClose }: Props) {
  const data = useTrains();
  const lines = useLines();
  // Tick once per second so the "updated Xs ago" footer stays honest
  // between feed polls. Only ticks while the dialog is mounted-open.
  const now = useNow(open, 1000);

  const stats = useMemo(() => {
    if (!data) return null;
    let north = 0;
    let south = 0;
    let stopped = 0;
    let moving = 0;
    let incoming = 0;
    const perLine = new Map<string, number>();
    for (const t of data.trains) {
      if (t.direction === "N") north++;
      else south++;
      if (t.status === "STOPPED_AT") stopped++;
      else if (t.status === "INCOMING_AT") incoming++;
      else moving++;
      perLine.set(t.routeId, (perLine.get(t.routeId) ?? 0) + 1);
    }

    // Aggregate express variants ("6X" → "6") onto their base route so
    // the bullet list stays familiar and a single line's express +
    // local count read together.
    const perBase = new Map<string, number>();
    for (const [routeId, n] of perLine) {
      const base = routeId.length > 1 && routeId.endsWith("X")
        ? routeId.slice(0, -1)
        : routeId;
      perBase.set(base, (perBase.get(base) ?? 0) + n);
    }

    const lineRows = Array.from(perBase.entries())
      .map(([routeId, count]) => ({ routeId, count }))
      .sort((a, b) => b.count - a.count);

    const arrivingSoon = data.arrivals.filter(
      (a) => a.eta - data.generatedAt / 1000 < 5 * 60,
    ).length;

    return {
      total: data.trains.length,
      north,
      south,
      stopped,
      moving,
      incoming,
      lineRows,
      arrivingSoon,
    };
  }, [data]);

  const ageSec = data ? Math.max(0, Math.round((now - data.generatedAt) / 1000)) : null;
  const fresh = ageSec !== null && ageSec < 30;
  const stale = ageSec !== null && ageSec >= 60;

  // Per-vehicle staleness rolled up across the fleet, separate from
  // the snapshot-age signal above. The snapshot can be fresh while
  // individual trains haven't reported in minutes (silent vehicle,
  // tunnel gap, late-update feed); riders deserve to see that
  // distinction in the System Pulse rather than have it hide behind
  // "Live · refreshed 4s ago". Recomputed on the per-second `now`
  // tick so the summary stays honest while the dialog is open.
  const fleetStaleness = useMemo(() => {
    if (!data) return null;
    return summarizeFleetStaleness(data.trains, now, data.generatedAt);
  }, [data, now]);

  const routeInfo = useMemo(() => {
    const m = new Map<string, { id: string; color: string; textColor: "white" | "black" }>();
    if (!lines) return m;
    for (const line of Object.values(lines)) {
      m.set(line.routeId, {
        id: line.id,
        color: line.color,
        textColor: line.textColor,
      });
    }
    return m;
  }, [lines]);

  const maxLineCount = stats?.lineRows[0]?.count ?? 1;
  const dirTotal = stats ? Math.max(stats.north + stats.south, 1) : 1;
  const northPct = stats ? (stats.north / dirTotal) * 100 : 0;

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="ios-glass ios-glass--modal border-white/[0.08] text-white rounded-t-[28px] sm:rounded-[22px] max-h-[85dvh] sm:max-h-[80dvh] overflow-hidden flex flex-col p-0 pb-[env(safe-area-inset-bottom)] sm:pb-0 gap-0 shadow-[0_20px_60px_-10px_rgba(0,0,0,0.6)]">
        <DialogHeader className="px-5 pt-5 pb-3 flex-shrink-0 text-left pr-12">
          <DialogTitle className="text-white text-xl font-black tracking-tight flex items-center gap-2">
            <span className="relative inline-flex w-2.5 h-2.5">
              <span
                className={`absolute inset-0 rounded-full ${
                  !data ? "bg-gray-500" : stale ? "bg-amber-400" : "bg-emerald-400"
                } shadow-[0_0_10px_currentColor]`}
                style={{
                  color: !data
                    ? "rgba(107,114,128,0.5)"
                    : stale
                      ? "rgba(251,191,36,0.6)"
                      : "rgba(52,211,153,0.7)",
                }}
              />
              {fresh && (
                <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-60" />
              )}
            </span>
            System Pulse
          </DialogTitle>
          <DialogDescription className="text-gray-400 text-left">
            {!data
              ? "Connecting to MTA realtime feed…"
              : stale
                ? `Stale — last refresh ${ageSec}s ago`
                : `Live · refreshed ${ageSec}s ago`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto ios-scroll px-5 pb-5 space-y-4">
          {/* Hero — total fleet in service. The single number that
              answers "how busy is the subway right now". */}
          <div className="rounded-2xl bg-gradient-to-br from-emerald-500/10 via-sky-500/5 to-transparent border border-white/[0.08] p-4 flex items-center gap-4">
            <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-emerald-400/15 text-emerald-300 flex-shrink-0">
              <Train className="w-6 h-6" strokeWidth={2.25} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[44px] leading-none font-black tabular-nums tracking-tight text-white">
                {stats?.total ?? "—"}
              </div>
              <div className="text-[12px] text-gray-400 mt-1">
                trains in service across NYC right now
              </div>
            </div>
          </div>

          {/* Direction split — horizontal capsule split by N/S share.
              Always sums to 100%, so the visual encodes the imbalance
              rush hours create (more S in the AM, more N in PM). */}
          <section>
            <SectionLabel>Direction</SectionLabel>
            <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] overflow-hidden">
              <div className="h-3 flex">
                <div
                  className="bg-sky-400/80 transition-all duration-500"
                  style={{ width: `${northPct}%` }}
                />
                <div
                  className="bg-rose-400/80 flex-1 transition-all duration-500"
                />
              </div>
              <div className="grid grid-cols-2 divide-x divide-white/[0.06]">
                <DirCell
                  icon={<ArrowUp className="w-3.5 h-3.5" />}
                  label="Northbound"
                  count={stats?.north ?? 0}
                  total={stats?.total ?? 0}
                  tint="sky"
                />
                <DirCell
                  icon={<ArrowDown className="w-3.5 h-3.5" />}
                  label="Southbound"
                  count={stats?.south ?? 0}
                  total={stats?.total ?? 0}
                  tint="rose"
                />
              </div>
            </div>
          </section>

          {/* Status mix — what each train is doing right this second.
              At-platform and arriving counts together hint at how many
              boarding moments are happening across the system. */}
          <section>
            <SectionLabel>Right now</SectionLabel>
            <div className="grid grid-cols-3 gap-2">
              <StatusCell
                icon={<span className="w-2 h-2 rounded-full bg-amber-300 shadow-[0_0_8px_rgba(251,191,36,0.6)]" />}
                label="At platform"
                count={stats?.stopped ?? 0}
                tint="amber"
              />
              <StatusCell
                icon={<Activity className="w-3.5 h-3.5" />}
                label="In transit"
                count={stats?.moving ?? 0}
                tint="emerald"
              />
              <StatusCell
                icon={<Radio className="w-3.5 h-3.5" />}
                label="Arriving"
                count={stats?.incoming ?? 0}
                tint="sky"
              />
            </div>
            {stats && stats.arrivingSoon > 0 && (
              <p className="mt-2 px-1 text-[11px] text-gray-500 leading-relaxed">
                <span className="font-semibold text-gray-300 tabular-nums">
                  {stats.arrivingSoon}
                </span>{" "}
                arrivals predicted in the next 5 minutes systemwide.
              </p>
            )}
            {fleetStaleness && fleetStaleness.stale > 0 && (
              // Surfaces "N trains haven't reported in 90 s+" so the
              // System Pulse can't read clean while the underlying
              // positions are aging out. Tinted amber to match the
              // marker fade and arrival-row sub-line that already
              // call out per-train staleness elsewhere. Suppressed
              // entirely when every train is fresh — calm default,
              // signal only when there's something to say.
              <p className="mt-2 px-1 text-[11px] text-amber-300/80 leading-relaxed">
                <span className="font-semibold tabular-nums">
                  {fleetStaleness.stale}
                </span>{" "}
                {fleetStaleness.stale === 1 ? "train hasn’t" : "trains haven’t"}{" "}
                reported in 90 s+
                {fleetStaleness.veryStale > 0 && (
                  <>
                    {" "}·{" "}
                    <span className="tabular-nums">
                      {fleetStaleness.veryStale}
                    </span>{" "}
                    stale (6 m+)
                  </>
                )}
              </p>
            )}
          </section>

          {/* Per-line breakdown — bullets ordered by current train
              count, with a thin bar to encode the spread. The 7 and L
              regularly top this list during rush; B / Z trail at off
              hours. */}
          <section>
            <SectionLabel>Lines running</SectionLabel>
            <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] divide-y divide-white/[0.04]">
              {stats?.lineRows.length ? (
                stats.lineRows.map(({ routeId, count }) => {
                  const info = routeInfo.get(routeId);
                  if (!info) return null;
                  const pct = (count / maxLineCount) * 100;
                  return (
                    <div
                      key={routeId}
                      className="flex items-center gap-3 px-3 py-2"
                    >
                      <span
                        className="nyc-bullet inline-flex items-center justify-center w-6 h-6 rounded-full text-[12px] flex-shrink-0"
                        style={{
                          backgroundColor: info.color,
                          color: info.textColor === "black" ? "#000" : "#fff",
                        }}
                      >
                        {info.id}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${pct}%`,
                              backgroundColor: info.color,
                              opacity: 0.85,
                            }}
                          />
                        </div>
                      </div>
                      <span className="text-[13px] font-semibold tabular-nums text-gray-100 flex-shrink-0 w-7 text-right">
                        {count}
                      </span>
                    </div>
                  );
                })
              ) : (
                <div className="px-4 py-6 text-[12px] text-gray-500 text-center">
                  Waiting on the feed…
                </div>
              )}
            </div>
          </section>

          <p className="text-[11px] text-gray-500 leading-relaxed px-1">
            Data streams from the MTA GTFS-Realtime feed, polled every 8
            seconds. Each train above corresponds to a live vehicle
            broadcasting its position to the public feed.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 px-1 mb-1.5">
      {children}
    </h3>
  );
}

const TINTS: Record<
  "amber" | "emerald" | "sky" | "rose",
  { text: string; chip: string }
> = {
  amber: { text: "text-amber-200", chip: "bg-amber-300/15 text-amber-200" },
  emerald: { text: "text-emerald-200", chip: "bg-emerald-300/15 text-emerald-200" },
  sky: { text: "text-sky-200", chip: "bg-sky-300/15 text-sky-200" },
  rose: { text: "text-rose-200", chip: "bg-rose-300/15 text-rose-200" },
};

function DirCell({
  icon,
  label,
  count,
  total,
  tint,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  total: number;
  tint: "sky" | "rose";
}) {
  const pct = total ? Math.round((count / total) * 100) : 0;
  return (
    <div className="px-3 py-2.5 flex items-center gap-2.5">
      <span
        className={`inline-flex items-center justify-center w-7 h-7 rounded-full flex-shrink-0 ${TINTS[tint].chip}`}
      >
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-gray-500 leading-none">
          {label}
        </div>
        <div className="text-[15px] font-bold tabular-nums text-white leading-tight mt-0.5">
          {count}
          <span className="text-[11px] font-semibold text-gray-500 ml-1">
            · {pct}%
          </span>
        </div>
      </div>
    </div>
  );
}

function StatusCell({
  icon,
  label,
  count,
  tint,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  tint: "amber" | "emerald" | "sky";
}) {
  return (
    <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] px-3 py-2.5 flex flex-col items-start gap-1">
      <span
        className={`inline-flex items-center justify-center w-7 h-7 rounded-full ${TINTS[tint].chip}`}
      >
        {icon}
      </span>
      <div className="text-[20px] font-black leading-none tabular-nums tracking-tight text-white">
        {count}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-gray-500 leading-none">
        {label}
      </div>
    </div>
  );
}
