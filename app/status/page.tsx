import type { Metadata } from "next";
import Link from "next/link";
import MarketingShell from "@/components/marketing/MarketingShell";
import StatusPanel from "./StatusPanel";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: `Status · ${SITE_NAME}`,
  description: `Live status of ${SITE_NAME} services and the upstream MTA feeds.`,
  alternates: { canonical: "/status" },
  // Don't index the status page — it's transient and a search-result
  // snapshot of a transient outage would be misleading.
  robots: { index: false, follow: true },
};

export default function StatusPage() {
  return (
    <MarketingShell
      eyebrow="Status"
      title="System status"
      description={`Live health check of ${SITE_NAME} services and the MTA upstream feeds. Refreshes every 15 seconds.`}
    >
      <StatusPanel />
      <h2>What this measures</h2>
      <ul>
        <li>
          <strong>MTA feed</strong> — a HEAD request against one of the
          MTA&rsquo;s GTFS-Realtime feeds. When this is down or slow,
          live train data on {SITE_NAME} is also degraded.
        </li>
        <li>
          <strong>Static data</strong> — the baked GTFS line and
          station blob shipped with the app. Sentinel today; future
          checks will probe the edge cache.
        </li>
        <li>
          <strong>Runtime</strong> — that the {SITE_NAME} server itself
          is responding. If you&rsquo;re reading this page, the
          runtime is up.
        </li>
      </ul>
      <p>
        For deeper incident context or to report an outage, head to{" "}
        the project repo via the{" "}
        <Link href="/about">about page</Link>.
      </p>
    </MarketingShell>
  );
}
