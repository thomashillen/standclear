// ─── MTA service-alerts fetcher + classifier ────────────────────────
// Shared between the public /api/alerts route (consumed by the
// client poll loop) and the /api/cron/dispatch-alerts route
// (consumed by the push-notification fan-out). Keeping the MTA fetch
// + protobuf decode + severity classification in one place means the
// client and the cron always agree on what counts as "severe" — if
// the heuristic changes, both update at once.

import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { captureException } from "./observability";

// MTA's subway alerts feed. Same host as the train feeds, separate
// endpoint. Payload is GTFS-RT protobuf with alert entities instead
// of vehicle/trip updates. No API key required since late 2023.
const ALERTS_URL =
  "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts";

export type AlertSeverity = "severe" | "warning" | "info";

// One GTFS-RT informed_entity selector. Each `informedEntity` is an
// AND (a route+stop selector means "this route at this stop");
// multiple selectors on an alert are an OR. Preserving the
// per-selector shape is load-bearing for `alertsForStation` —
// flattening selectors into two independent sets loses the
// per-selector AND, so a mixed alert that pairs a route-wide
// selector with a stop-specific selector would get scoped down to
// the listed stop only.
export interface AlertSelector {
  routeId?: string;
  stopId?: string; // parent stop id (N/S suffix stripped)
}

export interface ServiceAlert {
  id: string;
  header: string;
  description: string;
  effect: string;
  severity: AlertSeverity;
  routeIds: string[];
  stopIds: string[];
  selectors: AlertSelector[];
  startTime: number | null;
  endTime: number | null;
}

export interface AlertsResponse {
  generatedAt: number;
  alerts: ServiceAlert[];
}

// The protobuf decoder returns `effect` as a numeric enum, not a
// name. Map it back to the canonical GTFS-RT names for display and
// logic. Values per https://gtfs.org/realtime/reference/#message-alert.
const EFFECT_NAMES: Record<number, string> = {
  1: "NO_SERVICE",
  2: "REDUCED_SERVICE",
  3: "SIGNIFICANT_DELAYS",
  4: "DETOUR",
  5: "ADDITIONAL_SERVICE",
  6: "MODIFIED_SERVICE",
  7: "OTHER_EFFECT",
  8: "UNKNOWN_EFFECT",
  9: "STOP_MOVED",
  10: "NO_EFFECT",
  11: "ACCESSIBILITY_ISSUE",
};

function effectName(e: unknown): string {
  if (typeof e === "number") return EFFECT_NAMES[e] ?? "UNKNOWN_EFFECT";
  if (typeof e === "string") return e;
  return "UNKNOWN_EFFECT";
}

// MTA's feed mostly publishes effect=UNKNOWN_EFFECT and packs the
// real state into the header. When the enum is informative, trust
// it; otherwise scan the header for common disruption phrasing.
// Order matters — check strongest indicators first so "No [4]
// service" beats "partially running".
export function severityOf(effect: string, header: string): AlertSeverity {
  if (effect === "NO_SERVICE" || effect === "SIGNIFICANT_DELAYS") return "severe";
  if (
    effect === "REDUCED_SERVICE" ||
    effect === "DETOUR" ||
    effect === "MODIFIED_SERVICE" ||
    effect === "STOP_MOVED"
  ) {
    return "warning";
  }
  const h = header.toLowerCase();
  if (
    /^no \[/.test(h) ||
    h.includes(" no service") ||
    h.includes("suspended") ||
    h.includes("significant delay")
  ) {
    return "severe";
  }
  if (
    h.includes("delays") ||
    h.includes("rerouted") ||
    h.includes("runs express") ||
    h.includes("runs local") ||
    h.includes("bypass") ||
    h.includes("skipping") ||
    h.includes("every ")
  ) {
    return "warning";
  }
  return "info";
}

type Translated = {
  translation?: { language?: string | null; text?: string | null }[] | null;
} | null | undefined;

function firstEnglish(t: Translated): string {
  const list = t?.translation ?? [];
  if (list.length === 0) return "";
  const en = list.find((tr) => !tr.language || tr.language === "en");
  return (en?.text ?? list[0]?.text ?? "").trim();
}

function parentStop(id: string): string {
  return id.replace(/[NS]$/, "");
}

function toSec(t: number | { toNumber(): number } | null | undefined): number | null {
  if (t == null) return null;
  if (typeof t === "number") return t;
  if (typeof t === "object" && typeof t.toNumber === "function") return t.toNumber();
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export async function fetchActiveAlerts(): Promise<AlertsResponse> {
  try {
    const res = await fetch(ALERTS_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buf);

    const now = Math.floor(Date.now() / 1000);
    const alerts: ServiceAlert[] = [];

    for (const entity of feed.entity) {
      const a = entity.alert;
      if (!a) continue;

      // Active-window filter. Empty active_period = always-on; with
      // periods, at least one window must contain `now`. Planned-
      // future alerts get dropped here — both the rider-facing list
      // and the dispatch path scope to "what matters right now".
      const periods = a.activePeriod ?? [];
      const isActive =
        periods.length === 0 ||
        periods.some((p) => {
          const start = toSec(p.start) ?? -Infinity;
          const end = toSec(p.end) ?? Infinity;
          return start <= now && now <= end;
        });
      if (!isActive) continue;

      const effect = effectName(a.effect);
      const routeIds = new Set<string>();
      const stopIds = new Set<string>();
      const selectors: AlertSelector[] = [];
      for (const ie of a.informedEntity ?? []) {
        const selector: AlertSelector = {};
        if (ie.routeId) {
          selector.routeId = ie.routeId;
          routeIds.add(ie.routeId);
        }
        if (ie.stopId) {
          const parent = parentStop(ie.stopId);
          selector.stopId = parent;
          stopIds.add(parent);
        }
        if (selector.routeId || selector.stopId) selectors.push(selector);
      }

      const firstPeriod = periods[0];
      const header = firstEnglish(a.headerText);
      alerts.push({
        id: entity.id || `alert-${alerts.length}`,
        header,
        description: firstEnglish(a.descriptionText),
        effect,
        severity: severityOf(effect, header),
        routeIds: [...routeIds],
        stopIds: [...stopIds],
        selectors,
        startTime: firstPeriod ? toSec(firstPeriod.start) : null,
        endTime: firstPeriod ? toSec(firstPeriod.end) : null,
      });
    }

    return { generatedAt: Date.now(), alerts };
  } catch (err) {
    captureException(err, { what: "alerts feed failed", url: ALERTS_URL });
    return { generatedAt: Date.now(), alerts: [] };
  }
}
