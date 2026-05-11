-- ─── Push notifications schema ──────────────────────────────────────
-- Storage for rider opt-ins to push alerts. Keyed by an anonymous
-- client-side UUID (stored in localStorage, never exposed) so the
-- product stays no-accounts.
--
-- A subscription is the {endpoint, p256dh, auth} triple that
-- self.registration.pushManager.subscribe() returns plus the routes
-- the rider opted into. The dispatch path (a Vercel cron) reads
-- subscribed_lines via the GIN index to find every subscription that
-- overlaps a fresh severe-tier alert.

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Stable per-device UUID minted by the client. Used for
    -- subscribe-after-unsubscribe and for the dispatch path to update
    -- last_seen_at without a row scan.
    anonymous_id TEXT NOT NULL UNIQUE,
    -- Push service URL the browser hands back. Apple, Mozilla, and
    -- Google each return a different host; web-push routes to each by
    -- inspecting this URL.
    endpoint TEXT NOT NULL,
    -- ECDH public key the push service uses to encrypt the payload
    -- our server signs. Base64-url encoded.
    p256dh TEXT NOT NULL,
    -- Auth secret for the encryption envelope. Base64-url encoded.
    auth TEXT NOT NULL,
    -- MTA routeIds (1-7, A/C/E, etc.) the rider opted in for.
    -- Empty array means "no per-line opt-ins" (the row stays so the
    -- rider can re-opt without re-prompting for notification
    -- permission).
    subscribed_lines TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Bumped on every dispatch + every subscribe POST so a future
    -- cleanup job can prune zombie subscriptions whose endpoints
    -- have silently expired (push services 410 on dead endpoints).
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Set when the rider unsubscribes or the push service returns
    -- 404/410. Kept (vs. hard-deleted) so a follow-on cleanup job
    -- can collect metrics on churn before the row is purged.
    unsubscribed_at TIMESTAMPTZ
);

-- GIN index on the line array so dispatch can find every subscription
-- whose subscribed_lines && '{Q,N}'::TEXT[] (alert affects Q or N).
-- Without this the cron does a full table scan on every tick.
CREATE INDEX IF NOT EXISTS idx_push_subs_lines
    ON push_subscriptions USING GIN (subscribed_lines);

-- Active-subscriptions filter on the dispatch path. Partial index so
-- the planner can use a plain index scan instead of filtering.
CREATE INDEX IF NOT EXISTS idx_push_subs_active
    ON push_subscriptions (id) WHERE unsubscribed_at IS NULL;

-- ─── Dispatch log ───────────────────────────────────────────────────
-- One row per (subscription, alert_id) so the cron never fires twice
-- for the same alert + rider, even if the MTA feed re-publishes the
-- alert with the same ID (which it does — alerts persist for the
-- entire active window). Primary-key dedup is the cheapest possible
-- guarantee here; the cron does INSERT ... ON CONFLICT DO NOTHING and
-- only fires push for rows that actually inserted.

CREATE TABLE IF NOT EXISTS alert_dispatch_log (
    subscription_id UUID NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
    alert_id TEXT NOT NULL,
    dispatched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (subscription_id, alert_id)
);

-- Periodic-cleanup-friendly index — old log rows can be GC'd once
-- the alert is no longer active in the MTA feed.
CREATE INDEX IF NOT EXISTS idx_dispatch_log_time
    ON alert_dispatch_log (dispatched_at);
