import type { Metadata } from "next";
import Link from "next/link";
import MarketingShell from "@/components/marketing/MarketingShell";
import {
  AUTHOR_NAME,
  GITHUB_URL,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TAGLINE,
} from "@/lib/site";

export const metadata: Metadata = {
  title: `About · ${SITE_NAME}`,
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/about" },
  openGraph: {
    title: `About ${SITE_NAME}`,
    description: SITE_DESCRIPTION,
    url: "/about",
  },
};

export default function AboutPage() {
  return (
    <MarketingShell
      eyebrow="About"
      title={SITE_TAGLINE}
      description={SITE_DESCRIPTION}
    >
      <h2>What it is</h2>
      <p>
        {SITE_NAME} is a live, real-time view of the New York City subway.
        It streams train positions, arrivals, and service alerts straight
        from the MTA, animates every train along true GTFS shape geometry,
        and gives you address-to-address routing with multi-leg planning,
        walking directions, and a personal commute pinned to Home and
        Work.
      </p>
      <p>
        It works in your browser. There is nothing to install. There is no
        account. Every feature is free.
      </p>

      <h2>What you can do with it</h2>
      <ul>
        <li>
          <strong>Watch the system breathe.</strong> Every train, every
          line, animated on a dark Mapbox map at near-real-time cadence.
        </li>
        <li>
          <strong>Tap any station</strong> for the next four trains in
          each direction with seconds-precise countdowns and active
          alerts scoped to that platform.
        </li>
        <li>
          <strong>Plan a trip</strong> from an address, a station, or a
          place name to anywhere else in the city. Plans rank by total
          time including walks and transfers, and the map shows the real
          street-level walking route, not crow-flies.
        </li>
        <li>
          <strong>Pin Home and Work</strong> and the planner picks the
          fastest route based on whichever direction you&rsquo;re coming
          from. Your daily commute is one tap away.
        </li>
        <li>
          <strong>Service alerts</strong> are severity-tinted and scoped
          per route or per station, so a {SITE_NAME} session never
          buries the alert for the line you&rsquo;re actually on.
        </li>
        <li>
          <strong>Install it as an app</strong> on iOS or Android —
          standalone window, dynamic-island clearance, offline shell.
        </li>
      </ul>

      <h2>How it works</h2>
      <p>
        Trains and arrivals come from the MTA&rsquo;s public{" "}
        <a
          href="https://api.mta.info/"
          target="_blank"
          rel="noopener noreferrer"
        >
          GTFS-Realtime feeds
        </a>{" "}
        — the same streams the official MTA apps consume. {SITE_NAME}{" "}
        fans out to all eight subway feeds in parallel on the server,
        decodes the protobuf, dedupes per trip, and ships a compact JSON
        snapshot to your browser every few seconds.
      </p>
      <p>
        Static line geometry — shapes, stops, transfer complexes — is
        baked from the MTA&rsquo;s GTFS static dump and shipped as a
        single cached blob, so the map renders instantly even on a cold
        boot. Address typeahead and walking directions use{" "}
        <a
          href="https://www.mapbox.com/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Mapbox
        </a>
        ; everything else is straight from the MTA.
      </p>

      <h2>The honest part</h2>
      <p>
        {SITE_NAME} is unaffiliated with the MTA. Train data can lag the
        physical world, especially in tunnels and at terminuses. Treat
        ETAs as a signal, not a contract — for safety-critical decisions,
        check the MTA&rsquo;s official channels.
      </p>
      <p>
        The MTA logo, route bullets, and station names are trademarks of
        the New York Metropolitan Transportation Authority. {SITE_NAME}{" "}
        is a third-party visualization that uses publicly published
        transit data under the MTA&rsquo;s developer terms.
      </p>

      <h2>Behind it</h2>
      <p>
        Built by {AUTHOR_NAME}. The source is{" "}
        <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
          MIT-licensed on GitHub
        </a>{" "}
        — issues, pull requests, and forks welcome.
      </p>
      <p>
        Have feedback, a feature request, or a bug to report? Open an
        issue on{" "}
        <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
          GitHub
        </a>{" "}
        or read the <Link href="/privacy">privacy policy</Link> and{" "}
        <Link href="/terms">terms of service</Link>.
      </p>
    </MarketingShell>
  );
}
