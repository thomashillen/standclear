// ─── Push-subscription cleanup ──────────────────────────────────────
// Daily janitor for the notifications tables. Two GC passes:
//
//   1. Purge push_subscriptions whose unsubscribed_at is older than
//      30 days. The row sticks around for ~a month after a rider
//      opts out so we can collect churn metrics and so a re-opt-in
//      from the same device updates the original row. Beyond 30
//      days the metric isn't actionable and the row is dead weight.
//      The FK ON DELETE CASCADE drops the matching dispatch_log
//      rows automatically.
//
//   2. Trim alert_dispatch_log entries older than 14 days. The MTA
//      doesn't re-issue alerts with the same ID after the active
//      window closes, so a 14-day-old log row will never match a
//      live alert again. Keeping them just grows the table.
//
// Both passes are idempotent — running the cleanup multiple times
// in a row converges to the same end state.

import { getDb } from "./db";

export interface CleanupSummary {
  /** Rows removed from push_subscriptions (riders who unsubscribed
   *  more than 30 days ago). */
  subscriptionsPurged: number;
  /** Rows removed from alert_dispatch_log (entries older than the
   *  alert-active window). */
  dispatchLogPurged: number;
}

const STALE_UNSUBSCRIBED_DAYS = 30;
const STALE_DISPATCH_LOG_DAYS = 14;

export async function cleanupSubscriptions(): Promise<CleanupSummary> {
  const sql = getDb();

  // ORDER MATTERS: subscriptions first so the CASCADE has fewer
  // dispatch_log rows to delete on its way out — saves work in the
  // second pass.
  const subsDeleted = (await sql`
    DELETE FROM push_subscriptions
    WHERE unsubscribed_at IS NOT NULL
      AND unsubscribed_at < NOW() - INTERVAL '30 days'
    RETURNING id
  `) as Array<{ id: string }>;

  const logDeleted = (await sql`
    DELETE FROM alert_dispatch_log
    WHERE dispatched_at < NOW() - INTERVAL '14 days'
    RETURNING subscription_id
  `) as Array<{ subscription_id: string }>;

  return {
    subscriptionsPurged: subsDeleted.length,
    dispatchLogPurged: logDeleted.length,
  };
}

// Sanity-check exports for tests.
export const _internals = {
  STALE_UNSUBSCRIBED_DAYS,
  STALE_DISPATCH_LOG_DAYS,
};
