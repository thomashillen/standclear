// ─── Push-notification fan-out ──────────────────────────────────────
// The actual dispatch path. Separate from the cron route so the
// logic is unit-testable without a running HTTP server — the route
// is the thin glue that wires authentication + the lib together.
//
// Flow per cron tick:
//   1. Fetch active alerts from the MTA feed
//   2. Filter to severity === "severe"
//   3. For each severe alert with at least one affected route:
//        a. Query active subscriptions whose subscribed_lines is
//           empty (v1 severe-tier sentinel) OR overlaps the alert's
//           routes
//        b. Per candidate: INSERT INTO alert_dispatch_log ON CONFLICT
//           DO NOTHING. The PK (subscription_id, alert_id) is the
//           dedup guarantee — if the row already exists we silently
//           skip this rider for this alert.
//        c. On a *new* insert, send the push payload via web-push.
//        d. If web-push returns 404/410, mark the subscription
//           unsubscribed — the endpoint is dead.
//
// Order is "log first, then send." Accepts the rare case of a lost
// notification when web-push has a transient 5xx, to avoid the
// double-fire risk if we sent-then-logged and crashed mid-flight.
// Lost notifications are recoverable (the alert is still in the app);
// duplicate pushes erode trust.

import webpush from "web-push";
import { getDb } from "./db";
import { fetchActiveAlerts, type ServiceAlert } from "./mtaAlerts";
import { captureException } from "./observability";

// Subscription rows we hand to web-push. Mirrors the shape of the
// browser-side PushSubscription.toJSON().
interface DispatchRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface DispatchSummary {
  /** How many severe alerts we considered. */
  alertsConsidered: number;
  /** New pushes actually fired (one per (subscription, alert) pair
   *  we hadn't already logged). */
  dispatched: number;
  /** Subscriptions marked unsubscribed because the endpoint returned
   *  404/410 (gone). */
  pruned: number;
  /** Transient errors during dispatch (5xx, network failures). The
   *  dispatch_log row stays — we accept the lost notification rather
   *  than risking a duplicate on retry. */
  errors: number;
}

function configureVapid(): boolean {
  const pub = process.env.NEXT_PUBLIC_VAPID_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!pub || !priv || !subject) return false;
  webpush.setVapidDetails(subject, pub, priv);
  return true;
}

// Title we surface in the OS banner. Limited to ~50 chars on iOS;
// we'd rather list affected routes than chase a long header.
function buildTitle(alert: ServiceAlert): string {
  if (alert.routeIds.length === 0) return "Service alert";
  if (alert.routeIds.length === 1) {
    return `${alert.routeIds[0]} line — service disruption`;
  }
  // Multi-line: "Q · N · R — service disruption"
  return `${alert.routeIds.join(" · ")} — service disruption`;
}

// Body is the alert header. Stays short — riders open the app for
// the long version. Sanitize the GTFS-RT "[F]" bracket bullets to
// the bare route id so the OS notification reads cleanly: a system
// font doesn't render the bracketed glyph the way our in-app
// RouteBullet does.
function buildBody(alert: ServiceAlert): string {
  const h = alert.header
    .replace(/\[([A-Z0-9]+)\]/g, "$1")
    .trim();
  return h.length > 0 ? h : alert.description.slice(0, 140);
}

// Deep link the rider lands on when they tap the notification.
// Single-route alerts open the line page; multi-route alerts open
// the home map (the rider will see the alert in the global list).
function buildUrl(alert: ServiceAlert): string {
  if (alert.routeIds.length === 1) return `/line/${alert.routeIds[0]}`;
  return "/";
}

async function fetchCandidates(
  sql: ReturnType<typeof getDb>,
  routeIds: string[],
): Promise<DispatchRow[]> {
  // Empty subscribed_lines = "all severe" sentinel; otherwise
  // overlap match. ARRAY[...]::TEXT[] cast keeps the parameterized
  // query well-typed when routeIds is empty (shouldn't happen
  // because we filter alerts to those with at least one route, but
  // the cast keeps the planner happy regardless).
  return (await sql`
    SELECT id, endpoint, p256dh, auth
    FROM push_subscriptions
    WHERE unsubscribed_at IS NULL
      AND (
        subscribed_lines = '{}'
        OR subscribed_lines && ${routeIds}::TEXT[]
      )
  `) as DispatchRow[];
}

async function tryLogDispatch(
  sql: ReturnType<typeof getDb>,
  subId: string,
  alertId: string,
): Promise<boolean> {
  // INSERT … RETURNING returns one row on insert, zero on conflict.
  // The length of the result is the unambiguous "did we just claim
  // this dispatch?" signal.
  const rows = (await sql`
    INSERT INTO alert_dispatch_log (subscription_id, alert_id)
    VALUES (${subId}, ${alertId})
    ON CONFLICT (subscription_id, alert_id) DO NOTHING
    RETURNING 1
  `) as Array<unknown>;
  return rows.length > 0;
}

async function markUnsubscribed(
  sql: ReturnType<typeof getDb>,
  subId: string,
): Promise<void> {
  await sql`
    UPDATE push_subscriptions
    SET unsubscribed_at = NOW()
    WHERE id = ${subId} AND unsubscribed_at IS NULL
  `;
}

async function dispatchOne(
  alert: ServiceAlert,
  sub: DispatchRow,
  sql: ReturnType<typeof getDb>,
): Promise<"sent" | "pruned" | "error"> {
  const payload = JSON.stringify({
    title: buildTitle(alert),
    body: buildBody(alert),
    url: buildUrl(alert),
    // OS-level dedup tag so a re-issued alert with the same id
    // coalesces into one banner instead of stacking.
    tag: `alert:${alert.id}`,
  });
  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      payload,
    );
    return "sent";
  } catch (err: unknown) {
    const status =
      typeof err === "object" && err !== null && "statusCode" in err
        ? (err as { statusCode?: number }).statusCode
        : undefined;
    if (status === 404 || status === 410) {
      await markUnsubscribed(sql, sub.id);
      return "pruned";
    }
    captureException(err, { source: "pushDispatch", subscriptionId: sub.id });
    return "error";
  }
}

export async function dispatchAlerts(): Promise<DispatchSummary> {
  const summary: DispatchSummary = {
    alertsConsidered: 0,
    dispatched: 0,
    pruned: 0,
    errors: 0,
  };

  if (!configureVapid()) {
    captureException(new Error("VAPID config missing — dispatch noop"), {
      source: "pushDispatch",
    });
    return summary;
  }

  const sql = getDb();
  const { alerts } = await fetchActiveAlerts();
  const severeWithRoutes = alerts.filter(
    (a) => a.severity === "severe" && a.routeIds.length > 0,
  );
  summary.alertsConsidered = severeWithRoutes.length;

  for (const alert of severeWithRoutes) {
    const candidates = await fetchCandidates(sql, alert.routeIds);
    for (const sub of candidates) {
      const isNew = await tryLogDispatch(sql, sub.id, alert.id);
      if (!isNew) continue;
      const result = await dispatchOne(alert, sub, sql);
      if (result === "sent") summary.dispatched++;
      else if (result === "pruned") summary.pruned++;
      else summary.errors++;
    }
  }

  return summary;
}
