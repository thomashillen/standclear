"use client";

import { useMemo, useState } from "react";
import {
  Bell,
  BellRing,
  AlertTriangle,
  Info,
  ChevronDown,
  CheckCircle2,
} from "lucide-react";
import { useAlerts, type ServiceAlert } from "@/lib/useAlerts";
import { useLines } from "@/lib/subwayData";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

// Severity styling shared with LinePanel's AlertItem so the global sheet
// reads consistently with the per-line section. Severe = rose, warning =
// amber, info = sky. Icon swaps to Info for the lowest tier so a wall of
// AlertTriangles doesn't make routine elevator outages look critical.
const SEVERITY_STYLE: Record<
  ServiceAlert["severity"],
  { bg: string; text: string; icon: typeof AlertTriangle; rank: number; label: string }
> = {
  severe: {
    bg: "bg-rose-500/15 border-rose-500/30",
    text: "text-rose-200",
    icon: AlertTriangle,
    rank: 0,
    label: "Severe",
  },
  warning: {
    bg: "bg-amber-500/15 border-amber-500/30",
    text: "text-amber-200",
    icon: AlertTriangle,
    rank: 1,
    label: "Warnings",
  },
  info: {
    bg: "bg-sky-500/10 border-sky-500/25",
    text: "text-sky-200",
    icon: Info,
    rank: 2,
    label: "Info",
  },
};

// Compact route bullet for showing which lines an alert affects. Smaller
// than the StationPanel/LinePanel bullets — alerts can affect 5+ lines
// and a row of full-size bullets blows out the layout.
function MiniRouteBullet({
  id,
  color,
  textColor,
}: {
  id: string;
  color: string;
  textColor: "white" | "black";
}) {
  return (
    <span
      className="nyc-bullet inline-flex items-center justify-center w-[18px] h-[18px] rounded-full text-[11px] leading-none flex-shrink-0"
      style={{ backgroundColor: color, color: textColor === "black" ? "#000" : "#fff" }}
    >
      {id}
    </span>
  );
}

interface AlertItemProps {
  alert: ServiceAlert;
  routeInfo: Map<string, { id: string; color: string; textColor: "white" | "black" }>;
}

function AlertItem({ alert, routeInfo }: AlertItemProps) {
  const [expanded, setExpanded] = useState(false);
  const s = SEVERITY_STYLE[alert.severity];
  const Icon = s.icon;
  const hasBody = alert.description && alert.description !== alert.header;

  // Sort affected routes the way the rider expects to see them: known
  // routes first (in the order from the lines map, which already matches
  // signage groupings), unknown route ids appended at the end.
  const affected = useMemo(() => {
    const known: { id: string; color: string; textColor: "white" | "black" }[] = [];
    const unknown: string[] = [];
    for (const r of alert.routeIds) {
      const info = routeInfo.get(r);
      if (info) known.push(info);
      else unknown.push(r);
    }
    return { known, unknown };
  }, [alert.routeIds, routeInfo]);

  return (
    <div className={`border rounded-xl px-3 py-2.5 ${s.bg}`}>
      <button
        type="button"
        onClick={() => hasBody && setExpanded((x) => !x)}
        className="w-full flex items-start gap-2 text-left"
        aria-expanded={hasBody ? expanded : undefined}
      >
        <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${s.text}`} />
        <div className="flex-1 min-w-0">
          <p className={`text-[12.5px] font-semibold ${s.text} leading-snug`}>
            {alert.header || alert.effect.replace(/_/g, " ").toLowerCase()}
          </p>
          {(affected.known.length > 0 || affected.unknown.length > 0) && (
            <div className="flex items-center gap-1 mt-1.5 flex-wrap">
              {affected.known.map((r) => (
                <MiniRouteBullet
                  key={r.id}
                  id={r.id}
                  color={r.color}
                  textColor={r.textColor}
                />
              ))}
              {affected.unknown.map((r) => (
                <span
                  key={r}
                  className="inline-flex items-center justify-center px-1.5 h-[18px] rounded-full text-[9px] font-bold bg-white/[0.10] text-gray-300"
                >
                  {r}
                </span>
              ))}
            </div>
          )}
        </div>
        {hasBody && (
          <ChevronDown
            className={`w-4 h-4 flex-shrink-0 transition-transform ${s.text} ${
              expanded ? "rotate-180" : ""
            }`}
          />
        )}
      </button>
      {hasBody && expanded && (
        <p className="mt-2 text-[11.5px] leading-relaxed text-gray-300 whitespace-pre-line">
          {alert.description}
        </p>
      )}
    </div>
  );
}

// ─── AlertsDialog ────────────────────────────────────────────────────
// Controlled dialog version — pass `open` and `onOpenChange` so the
// dialog can be opened from anywhere (the legacy floating button OR
// the new More menu row). Same styling and content as the original
// AlertsButton dialog; only the trigger plumbing changed.
export function AlertsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const data = useAlerts();
  const lines = useLines();

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

  const grouped = useMemo(() => {
    const out: Record<ServiceAlert["severity"], ServiceAlert[]> = {
      severe: [],
      warning: [],
      info: [],
    };
    if (!data) return out;
    for (const a of data.alerts) out[a.severity].push(a);
    return out;
  }, [data]);

  const totalCount = data?.alerts.length ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="ios-glass ios-glass--modal border-white/[0.08] text-white rounded-t-[28px] sm:rounded-[22px] max-h-[85dvh] sm:max-h-[80dvh] overflow-hidden flex flex-col pb-[env(safe-area-inset-bottom)] sm:pb-6 shadow-[0_20px_60px_-10px_rgba(0,0,0,0.6)]">
        <DialogHeader className="text-left pr-12">
          <DialogTitle className="text-white text-xl font-black tracking-tight flex items-center gap-2 leading-none">
            <Bell className="w-[18px] h-[18px]" />
            Service alerts
          </DialogTitle>
          <DialogDescription className="text-gray-400 text-left">
            {!data
              ? "Loading…"
              : totalCount === 0
                ? "All clear across the system right now."
                : `${totalCount} active across ${
                    new Set(data.alerts.flatMap((a) => a.routeIds)).size
                  } line${
                    new Set(data.alerts.flatMap((a) => a.routeIds)).size === 1 ? "" : "s"
                  }.`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto ios-scroll -mx-2 px-2">
          {!data ? (
            // Loading skeleton — three pulsing card placeholders so
            // the body keeps its rough shape on a slow first paint.
            // Without this branch the body would render the
            // "All clear" empty state while the title still says
            // "Loading…", since totalCount falls back to 0 when
            // data is null.
            <div className="space-y-2 pb-2 pt-1" aria-hidden>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-[60px] rounded-xl bg-white/[0.04] animate-pulse"
                />
              ))}
            </div>
          ) : totalCount === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-400/80 mb-3" />
              <p className="text-sm text-gray-200 font-medium">
                No service issues right now
              </p>
              <p className="text-[11px] text-gray-500 mt-1 max-w-[260px]">
                When the MTA reports delays, reroutes, or suspensions,
                they&apos;ll show up here.
              </p>
            </div>
          ) : (
            <div className="space-y-4 pb-2">
              {(["severe", "warning", "info"] as const).map((sev) => {
                const items = grouped[sev];
                if (items.length === 0) return null;
                const s = SEVERITY_STYLE[sev];
                return (
                  <section key={sev} className="space-y-1.5">
                    <div className="flex items-center gap-2 px-1">
                      <span
                        className={`inline-block w-1.5 h-1.5 rounded-full ${
                          sev === "severe"
                            ? "bg-rose-400"
                            : sev === "warning"
                              ? "bg-amber-400"
                              : "bg-sky-400"
                        }`}
                      />
                      <h3 className={`text-[11px] font-semibold uppercase tracking-wider ${s.text}`}>
                        {s.label}
                      </h3>
                      <span className="text-[11px] text-gray-500 ml-auto tabular-nums">
                        {items.length}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {items.map((alert) => (
                        <AlertItem key={alert.id} alert={alert} routeInfo={routeInfo} />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>

        {data && totalCount > 0 && (
          <p className="text-[10px] text-gray-600 text-center pt-1">
            Tap any alert for details. Source: MTA GTFS-RT alerts feed.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function AlertsButton() {
  const data = useAlerts();
  const lines = useLines();

  // routeId → display info, used by AlertItem to render the affected
  // bullets. Built once per lines change, not per render.
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

  // Sort by severity (severe → warning → info), then group by severity
  // for sectioned display. Within a group we keep the API's natural
  // order (alphabetical-ish by alert id), which is stable enough.
  const grouped = useMemo(() => {
    const out: Record<ServiceAlert["severity"], ServiceAlert[]> = {
      severe: [],
      warning: [],
      info: [],
    };
    if (!data) return out;
    for (const a of data.alerts) out[a.severity].push(a);
    return out;
  }, [data]);

  const totalCount = data?.alerts.length ?? 0;
  const hasSevere = grouped.severe.length > 0;
  const hasWarning = grouped.warning.length > 0;
  // Bell color reflects worst active severity. The badge count includes
  // every active alert, but the color tells you whether to look now or
  // ignore until next time.
  const tone: ServiceAlert["severity"] | null =
    hasSevere ? "severe" : hasWarning ? "warning" : totalCount > 0 ? "info" : null;
  const dotColor =
    tone === "severe"
      ? "bg-rose-500"
      : tone === "warning"
        ? "bg-amber-400"
        : tone === "info"
          ? "bg-sky-400"
          : "bg-transparent";

  // Don't render a count badge of 0 — the empty state is the dialog
  // body itself ("All clear"). The bell stays in the header so users
  // can always check, but its appearance reflects nothing-pending.
  const showBadge = totalCount > 0;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={
            totalCount > 0
              ? `${totalCount} service alert${totalCount === 1 ? "" : "s"}`
              : "Service alerts"
          }
          className={`pointer-events-auto press relative flex items-center justify-center w-11 h-11 rounded-full touch-manipulation flex-shrink-0 transition-colors border shadow-[0_6px_20px_rgba(0,0,0,0.45)] ${
            tone === "severe"
              ? "bg-rose-500/25 text-rose-100 border-rose-500/40"
              : tone === "warning"
                ? "bg-amber-500/20 text-amber-100 border-amber-500/40"
                : "ios-glass ios-glass--header text-gray-100 border-white/[0.10]"
          }`}
        >
          {hasSevere ? (
            <BellRing className="w-[18px] h-[18px]" />
          ) : (
            <Bell className="w-[18px] h-[18px]" />
          )}
          {showBadge && (
            <span
              className={`absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold leading-4 text-white ${dotColor} ring-2 ring-gray-950 tabular-nums`}
            >
              {totalCount > 99 ? "99+" : totalCount}
            </span>
          )}
        </button>
      </DialogTrigger>
      <DialogContent className="ios-glass ios-glass--modal border-white/[0.08] text-white rounded-t-[28px] sm:rounded-[22px] max-h-[85dvh] sm:max-h-[80dvh] overflow-hidden flex flex-col pb-[env(safe-area-inset-bottom)] sm:pb-6 shadow-[0_20px_60px_-10px_rgba(0,0,0,0.6)]">
        <DialogHeader className="text-left pr-12">
          <DialogTitle className="text-white text-xl font-black tracking-tight flex items-center gap-2 leading-none">
            <Bell className="w-[18px] h-[18px]" />
            Service alerts
          </DialogTitle>
          <DialogDescription className="text-gray-400 text-left">
            {!data
              ? "Loading…"
              : totalCount === 0
                ? "All clear across the system right now."
                : `${totalCount} active across ${
                    new Set(data.alerts.flatMap((a) => a.routeIds)).size
                  } line${
                    new Set(data.alerts.flatMap((a) => a.routeIds)).size === 1 ? "" : "s"
                  }.`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto ios-scroll -mx-2 px-2">
          {!data ? (
            // Loading skeleton — three pulsing card placeholders so
            // the body keeps its rough shape on a slow first paint.
            // Without this branch the body would render the
            // "All clear" empty state while the title still says
            // "Loading…", since totalCount falls back to 0 when
            // data is null.
            <div className="space-y-2 pb-2 pt-1" aria-hidden>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-[60px] rounded-xl bg-white/[0.04] animate-pulse"
                />
              ))}
            </div>
          ) : totalCount === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-400/80 mb-3" />
              <p className="text-sm text-gray-200 font-medium">
                No service issues right now
              </p>
              <p className="text-[11px] text-gray-500 mt-1 max-w-[260px]">
                When the MTA reports delays, reroutes, or suspensions,
                they&apos;ll show up here.
              </p>
            </div>
          ) : (
            <div className="space-y-4 pb-2">
              {(["severe", "warning", "info"] as const).map((sev) => {
                const items = grouped[sev];
                if (items.length === 0) return null;
                const s = SEVERITY_STYLE[sev];
                return (
                  <section key={sev} className="space-y-1.5">
                    <div className="flex items-center gap-2 px-1">
                      <span
                        className={`inline-block w-1.5 h-1.5 rounded-full ${
                          sev === "severe"
                            ? "bg-rose-400"
                            : sev === "warning"
                              ? "bg-amber-400"
                              : "bg-sky-400"
                        }`}
                      />
                      <h3 className={`text-[11px] font-semibold uppercase tracking-wider ${s.text}`}>
                        {s.label}
                      </h3>
                      <span className="text-[11px] text-gray-500 ml-auto tabular-nums">
                        {items.length}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {items.map((alert) => (
                        <AlertItem key={alert.id} alert={alert} routeInfo={routeInfo} />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>

        {data && totalCount > 0 && (
          <p className="text-[10px] text-gray-600 text-center pt-1">
            Tap any alert for details. Source: MTA GTFS-RT alerts feed.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
