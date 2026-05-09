// ─── Brand & contact constants ───────────────────────────────────────
// Centralized so the marketing surface (about / privacy / terms /
// changelog / OG image / sitemap / footer / dialogs) stays consistent
// and the deployment URL only has to change in one place. When the
// project gets a real contact inbox, set CONTACT_EMAIL — until then,
// feedback flows route through GitHub Issues.

export const SITE_NAME = "StandClear";

export const SITE_TAGLINE = "Live NYC subway in your pocket.";

export const SITE_SHORT_DESCRIPTION =
  "Real-time NYC subway tracking with arrivals, nearby stations, and service alerts.";

export const SITE_DESCRIPTION =
  "Real-time NYC subway tracking — every train on every line, animated live on a Mapbox dark map with arrivals, nearby stations, address-to-address routing, and service alerts. Streaming straight from the MTA's public GTFS-Realtime feeds.";

// Canonical site URL. The `standclear.app` default is the brand
// target — if/when the domain is provisioned this is the URL OG
// cards, sitemap, robots.txt, and structured data resolve against.
// Until then, set NEXT_PUBLIC_SITE_URL to the actual deployment
// URL (the Vercel preview URL works) so social previews and the
// sitemap don't 404 against a domain that isn't pointed at this
// app yet. Override per environment via NEXT_PUBLIC_SITE_URL.
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://standclear.app";

// Source repository.
export const GITHUB_REPO = "thomashillen/standclear";
export const GITHUB_URL = `https://github.com/${GITHUB_REPO}`;
export const ISSUES_URL = `${GITHUB_URL}/issues`;
export const FEEDBACK_URL = `${ISSUES_URL}/new?labels=feedback&title=Feedback%3A%20`;
export const BUG_REPORT_URL = `${ISSUES_URL}/new?labels=bug&title=Bug%3A%20`;
export const DISCUSSIONS_URL = `${GITHUB_URL}/discussions`;

// Optional support inbox. Wire when provisioned — until then UI falls
// back to the GitHub feedback links above.
export const CONTACT_EMAIL: string | null = null;

// Author of record.
export const AUTHOR_NAME = "Thomas Hillen";
export const AUTHOR_HANDLE = "thomashillen";

// Versioning. VERSION is sourced directly from package.json so the
// /api/health response, the status page, the About dialog footer, and
// the marketing footer can never drift apart from the actual shipped
// build — operator-facing identifiers are only useful if they match
// what's running. APP_RELEASE_NAME is the human-readable label
// (e.g. "MVP") that lives alongside the numeric version.
import pkg from "../package.json" with { type: "json" };
export const VERSION = pkg.version;
export const APP_RELEASE_NAME = "MVP";
export const VERSION_LABEL = `v${VERSION} · ${APP_RELEASE_NAME}`;

// Stable display label used by OG / Twitter / changelog headers.
export const SITE_TITLE = `${SITE_NAME} — NYC Subway Tracker`;
