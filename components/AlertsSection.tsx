"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, Info } from "lucide-react";
import type { ServiceAlert } from "@/lib/useAlerts";

// Severity → tint. Info shifts to the sky palette so a routine
// "elevator out" card doesn't carry the same weight as a suspension —
// using AlertTriangles for everything makes routine outages look
// critical.
const SEVERITY_STYLE: Record<
  ServiceAlert["severity"],
  { bg: string; text: string; icon: typeof AlertTriangle }
> = {
  severe: {
    bg: "bg-rose-500/15 border-rose-500/30",
    text: "text-rose-200",
    icon: AlertTriangle,
  },
  warning: {
    bg: "bg-amber-500/15 border-amber-500/30",
    text: "text-amber-200",
    icon: AlertTriangle,
  },
  info: {
    bg: "bg-sky-500/10 border-sky-500/25",
    text: "text-sky-200",
    icon: Info,
  },
};

function AlertItem({ alert }: { alert: ServiceAlert }) {
  const [expanded, setExpanded] = useState(false);
  const s = SEVERITY_STYLE[alert.severity];
  const Icon = s.icon;
  const hasBody = alert.description && alert.description !== alert.header;
  return (
    <div className={`border rounded-lg px-3 py-2 ${s.bg}`}>
      <button
        type="button"
        onClick={() => hasBody && setExpanded((x) => !x)}
        className="w-full flex items-start gap-2 text-left"
      >
        <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${s.text}`} />
        <div className="flex-1 min-w-0">
          <p className={`text-[12px] font-semibold ${s.text} leading-snug`}>
            {alert.header || alert.effect.replace(/_/g, " ").toLowerCase()}
          </p>
        </div>
        {hasBody && (
          <ChevronDown
            className={`w-4 h-4 flex-shrink-0 transition-transform ${s.text} ${expanded ? "rotate-180" : ""}`}
          />
        )}
      </button>
      {hasBody && expanded && (
        <p className="mt-1.5 text-[11px] leading-snug text-gray-300 whitespace-pre-line">
          {alert.description}
        </p>
      )}
    </div>
  );
}

// Collapsed-by-default summary bar for a list of scoped alerts. One
// "elevator out" warning eats enough vertical space to push the live
// arrivals list off-screen on a 50dvh bottom sheet, so the default
// state is a single 44px row with count + top severity tint; the
// rider expands when they want detail.
//
// Parents pass a stable `key` (e.g. lineId / stopId) so a context
// switch remounts the section and resets the disclosure to collapsed
// without a setState-in-effect.
export function AlertsSection({ alerts }: { alerts: ServiceAlert[] }) {
  const [open, setOpen] = useState(false);

  // Highest-severity alert drives the summary-bar color so a
  // suspension reads as urgent at a glance, distinct from a routine
  // info-level notice.
  const topSeverity: ServiceAlert["severity"] = alerts.some(
    (a) => a.severity === "severe",
  )
    ? "severe"
    : alerts.some((a) => a.severity === "warning")
      ? "warning"
      : "info";
  const s = SEVERITY_STYLE[topSeverity];
  const Icon = s.icon;
  const n = alerts.length;

  return (
    <div className="flex-shrink-0 border-b border-white/[0.06]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`press w-full flex items-center gap-2 px-4 h-11 text-left transition-colors touch-manipulation ${s.bg}`}
        aria-expanded={open}
        aria-label={open ? "Hide service alerts" : "Show service alerts"}
      >
        <Icon className={`w-4 h-4 flex-shrink-0 ${s.text}`} />
        <span className={`text-[12px] font-semibold ${s.text}`}>
          {n} service alert{n !== 1 ? "s" : ""}
        </span>
        <span className={`text-[11px] ml-1 ${s.text} opacity-70`}>
          {open ? "Hide" : "Show"}
        </span>
        <ChevronDown
          className={`w-4 h-4 ml-auto flex-shrink-0 transition-transform ${s.text} ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="px-3 pb-2 pt-1 space-y-1.5 max-h-[28dvh] sm:max-h-[220px] overflow-y-auto ios-scroll">
          {alerts.slice(0, 8).map((a) => (
            <AlertItem key={a.id} alert={a} />
          ))}
        </div>
      )}
    </div>
  );
}
