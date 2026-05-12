import type { Metadata } from "next";
import Link from "next/link";
import MarketingShell from "@/components/marketing/MarketingShell";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: `Privacy · ${SITE_NAME}`,
  description: `How ${SITE_NAME} handles your data: no accounts, no tracking pixels, no third-party advertising.`,
  alternates: { canonical: "/privacy" },
};

const LAST_UPDATED = "2026-05-12";

export default function PrivacyPage() {
  return (
    <MarketingShell
      eyebrow="Legal"
      title="Privacy policy"
      description={`How ${SITE_NAME} handles your data — in plain language, with the receipts.`}
    >
      <p className="text-gray-500 text-[13px]">
        Last updated <time dateTime={LAST_UPDATED}>{LAST_UPDATED}</time>
      </p>

      <h2>Short version</h2>
      <ul>
        <li>No accounts, no sign-up, no email collection.</li>
        <li>
          No advertising, no tracking pixels, no third-party trackers
          beyond the two services strictly required to operate the map
          (Mapbox) and measure aggregate uptime (Vercel Analytics).
        </li>
        <li>
          Your geolocation, favorites, recent searches, and pinned Home /
          Work addresses are stored <strong>only</strong> in your
          browser&rsquo;s <code>localStorage</code>. They never leave
          your device.
        </li>
        <li>
          The one exception is the opt-in push notification feature: if
          you enable it, a small subscription record (push-service URL +
          encryption keys, no personal data) is stored on our server so
          we can deliver severe-alert pushes. You can turn it off at any
          time and the record is purged. Details below.
        </li>
        <li>
          We don&rsquo;t set cookies for tracking. The session cookies
          some browsers create for the service worker are technical and
          carry no identifier.
        </li>
      </ul>

      <h2>What is collected</h2>

      <h3>Geolocation</h3>
      <p>
        When you tap &ldquo;Find nearby stations&rdquo; or open the app
        with location permission already granted, your browser hands{" "}
        {SITE_NAME} a coordinate pair. That coordinate is used in your
        browser to compute walking distances and sort nearby stations.{" "}
        <strong>It is never transmitted to {SITE_NAME}&rsquo;s servers.</strong>{" "}
        You can revoke geolocation permission at any time in your
        browser&rsquo;s site settings.
      </p>

      <h3>Address typeahead and walking directions</h3>
      <p>
        When you type an address into the search field or plan a trip
        with a non-station endpoint, {SITE_NAME} sends the query string
        and the resulting walking-route endpoints to{" "}
        <a
          href="https://www.mapbox.com/legal/privacy"
          target="_blank"
          rel="noopener noreferrer"
        >
          Mapbox
        </a>
        . Mapbox&rsquo;s privacy policy applies to that data. {SITE_NAME}{" "}
        does not store these queries on its own servers.
      </p>

      <h3>Push notification subscriptions (opt-in)</h3>
      <p>
        If you tap <em>Enable</em> on the &ldquo;Service alert push&rdquo;
        row in the More sheet and grant browser permission, {SITE_NAME}{" "}
        stores a single row in its database so the dispatch job can send
        you a push when the MTA reports a severe alert (full suspensions
        or &ldquo;no service&rdquo;). That row contains:
      </p>
      <ul>
        <li>
          An <strong>anonymous UUID</strong> minted in your browser. It
          is not tied to your name, email, IP address, or any other
          identifier &mdash; just a random value used to find your row
          on re-subscribe.
        </li>
        <li>
          The <strong>push-service endpoint URL</strong> your browser
          returned from <code>pushManager.subscribe()</code>. This URL
          points at Apple, Google, or Mozilla&rsquo;s push gateway (whichever
          your browser uses) and is what those gateways treat as the
          delivery address.
        </li>
        <li>
          The <strong>ECDH public key and auth secret</strong> the push
          gateway uses to encrypt the payload. Without these the
          gateway can&rsquo;t hand a push off to your device.
        </li>
        <li>
          The list of subway routes you opted in for (currently always
          empty, meaning &ldquo;every severe alert&rdquo;; a future
          version will let you scope to specific lines).
        </li>
        <li>
          Timestamps for when the row was created and last seen, plus
          (if applicable) when you unsubscribed.
        </li>
      </ul>
      <p>
        We use this row <strong>only</strong> to deliver severe-alert
        pushes. We do not share it with anyone, do not use it to build
        a profile, and do not correlate it with any other data.
      </p>
      <p>
        When you turn the toggle off, the row is marked unsubscribed
        immediately and hard-deleted by a daily cleanup job after 30
        days. A separate dispatch log (one row per push we&rsquo;ve sent
        you, kept so we don&rsquo;t fire the same alert twice) is
        trimmed after 14 days.
      </p>

      <h3>Aggregate analytics</h3>
      <p>
        We run{" "}
        <a
          href="https://vercel.com/docs/analytics/privacy-policy"
          target="_blank"
          rel="noopener noreferrer"
        >
          Vercel Analytics
        </a>{" "}
        in privacy-friendly mode. It records page views and basic
        performance metrics (load time, navigation type) <em>without</em>{" "}
        cookies, without IP-address persistence, and without any
        cross-site identifier. We use it to know which features are
        being used in aggregate and to catch performance regressions.
      </p>

      <h3>Server-side logs</h3>
      <p>
        Like every web service, our hosting provider (Vercel) keeps
        short-lived request logs that include the requesting IP address.
        These are operational logs used to debug abuse and outages, are
        not used for advertising or profiling, and are rotated by Vercel
        on its standard retention schedule.
      </p>

      <h3>Error tracking</h3>
      <p>
        If a runtime error occurs in the app or on the API, an
        anonymized error report (stack trace, browser version, app
        version — no personal data) may be sent to our error-tracking
        service so we can fix the bug. This is opt-out by feature: turn
        off JavaScript or block third-party origins to disable it.
      </p>

      <h2>What is stored on your device</h2>
      <p>
        {SITE_NAME} writes a few small entries to your browser&rsquo;s{" "}
        <code>localStorage</code> for state that should survive a refresh:
      </p>
      <ul>
        <li>
          <strong>Favorites</strong> — the list of stations you&rsquo;ve
          starred.
        </li>
        <li>
          <strong>Commute anchors</strong> — your pinned Home and Work
          locations, including the address text and coordinates so the
          planner can use them without a network round-trip.
        </li>
        <li>
          <strong>Recent searches</strong> — the last few queries you
          made.
        </li>
        <li>
          <strong>Last-known train snapshot</strong> — so the map can
          render instantly on cold boot before the next live poll
          completes.
        </li>
        <li>
          <strong>Personalization flags</strong> — e.g. whether you
          enabled the reactive-glass-on-tilt effect on iOS.
        </li>
        <li>
          <strong>Anonymous notification ID</strong> — if you enabled
          push notifications, a random UUID we use to find your
          subscription row on the server. No personal data is derived
          from it.
        </li>
      </ul>
      <p>
        You can clear all of this at any time by clearing site data in
        your browser settings.
      </p>

      <h2>What is NOT collected</h2>
      <ul>
        <li>Your name, email, phone number, or any account identifier.</li>
        <li>Your contact list, photos, or any device sensor beyond geolocation.</li>
        <li>Cross-site tracking identifiers or third-party advertising cookies.</li>
        <li>
          Any persistent fingerprint of your device beyond what
          Vercel&rsquo;s standard request logs capture.
        </li>
      </ul>

      <h2>Children</h2>
      <p>
        {SITE_NAME} is not directed at children under 13 and does not
        knowingly collect any data from them. There&rsquo;s no
        meaningful data to collect — there are no accounts.
      </p>

      <h2>Your rights (GDPR / CCPA)</h2>
      <p>
        Because {SITE_NAME} doesn&rsquo;t maintain user accounts, the
        only server-side data tied (anonymously) to you is your push
        notification subscription row, if you opted into one. To
        exercise your rights:
      </p>
      <ul>
        <li>
          <strong>Withdraw push consent / delete the subscription row:</strong>{" "}
          open the More sheet and toggle the &ldquo;Service alert
          push&rdquo; row off. The row is marked unsubscribed
          immediately (we stop sending) and hard-deleted after 30 days.
        </li>
        <li>
          <strong>Revoke geolocation permission:</strong> clear the
          site&rsquo;s permissions in your browser settings.
        </li>
        <li>
          <strong>Erase on-device data:</strong> clear site data /
          cookies for {SITE_NAME} in your browser. This removes
          favorites, recent searches, pinned anchors, and the anonymous
          notification ID. (Once the ID is gone we can no longer
          correlate any past push to you, even by request.)
        </li>
      </ul>

      <h2>Changes</h2>
      <p>
        If this policy changes materially, we&rsquo;ll update the
        &ldquo;Last updated&rdquo; date at the top of this page and call
        out the diff in the <Link href="/changelog">changelog</Link>.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy? Open an issue on the{" "}
        <Link href="/about">project repository</Link>.
      </p>
    </MarketingShell>
  );
}
