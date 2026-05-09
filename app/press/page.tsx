import type { Metadata } from "next";
import Link from "next/link";
import MarketingShell from "@/components/marketing/MarketingShell";
import {
  AUTHOR_HANDLE,
  AUTHOR_NAME,
  CONTACT_EMAIL,
  FEEDBACK_URL,
  GITHUB_REPO,
  GITHUB_URL,
  SITE_NAME,
  SITE_SHORT_DESCRIPTION,
  SITE_TAGLINE,
  SITE_URL,
  VERSION_LABEL,
} from "@/lib/site";

// ─── /press ───────────────────────────────────────────────────────────
// Lightweight press kit: a one-paragraph quotable pitch, quick facts,
// pointers at brand assets, screenshot URLs a journalist can capture
// directly, and a single contact link. Intentionally static — no
// embeds, no analytics, no live data — so a writer on a deadline can
// load the page once, copy what they need, and leave. Mirrors the
// MarketingShell pattern of every other public page; nothing here
// touches the live data planes.

export const metadata: Metadata = {
  title: `Press · ${SITE_NAME}`,
  description: `Press kit for ${SITE_NAME} — boilerplate, brand assets, screenshots, and a contact for journalists writing about the live NYC subway tracker.`,
  alternates: { canonical: "/press" },
  openGraph: {
    title: `Press · ${SITE_NAME}`,
    description: `Press kit for ${SITE_NAME} — boilerplate, brand assets, screenshots, and a contact for journalists.`,
    url: "/press",
  },
};

export default function PressPage() {
  return (
    <MarketingShell
      eyebrow="Press"
      title="Press kit"
      description={`Everything a journalist or blogger needs to write about ${SITE_NAME}: a quotable pitch, the facts, brand assets, and a single contact link. Cleared for use under attribution.`}
    >
      <h2>Boilerplate</h2>
      <p>
        Use this paragraph verbatim, or paraphrase freely:
      </p>
      <blockquote
        className="not-prose my-4 rounded-2xl border border-white/[0.08] bg-white/[0.04] px-5 py-4 text-[15px] text-gray-200 leading-relaxed"
      >
        <p>
          {SITE_NAME} is a free, real-time tracker for the New York City
          subway. Every train on every line is animated live on a dark
          map, with seconds-precise arrival countdowns at every station,
          severity-classified service alerts, and address-to-address
          trip planning that includes street-level walking directions
          and transfer routing. There&rsquo;s no account, no app store
          download required, and no advertising — the source code is
          MIT-licensed on GitHub. Built by {AUTHOR_NAME}; data streams
          straight from the MTA&rsquo;s public GTFS-Realtime feeds.
        </p>
      </blockquote>

      <h2>Quick facts</h2>
      <ul>
        <li>
          <strong>Name:</strong> {SITE_NAME}
        </li>
        <li>
          <strong>Tagline:</strong> {SITE_TAGLINE}
        </li>
        <li>
          <strong>Short description:</strong> {SITE_SHORT_DESCRIPTION}
        </li>
        <li>
          <strong>Site:</strong>{" "}
          <a href={SITE_URL} target="_blank" rel="noopener noreferrer">
            {SITE_URL.replace(/^https?:\/\//, "")}
          </a>
        </li>
        <li>
          <strong>Status:</strong> {VERSION_LABEL}
        </li>
        <li>
          <strong>Coverage area:</strong> New York City — all 27 numbered
          and lettered subway routes (1–7, A/C/E, B/D/F/M, G, J/Z, L,
          N/Q/R/W, GS/FS/H shuttles, SI Staten Island Railway).
        </li>
        <li>
          <strong>Data source:</strong> MTA public GTFS-Realtime feeds —
          the same streams the official MTA apps consume. {SITE_NAME} is
          unaffiliated with the MTA.
        </li>
        <li>
          <strong>Platforms:</strong> any modern browser; installable as
          a PWA on iOS and Android; native iOS shell via Capacitor.
        </li>
        <li>
          <strong>Pricing:</strong> free, forever — no accounts, no ads,
          no tracking pixels.
        </li>
        <li>
          <strong>License:</strong> MIT (open source).
        </li>
        <li>
          <strong>Source:</strong>{" "}
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
            github.com/{GITHUB_REPO}
          </a>
        </li>
        <li>
          <strong>Built by:</strong> {AUTHOR_NAME} (
          <a
            href={`https://github.com/${AUTHOR_HANDLE}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            @{AUTHOR_HANDLE}
          </a>
          ).
        </li>
      </ul>

      <h2>Screenshots</h2>
      <p>
        Capture the live app directly — these URLs render the same
        production app a rider sees, with real-time MTA data, so a
        screenshot reflects current service conditions:
      </p>
      <ul>
        <li>
          <Link href="/">{SITE_URL.replace(/^https?:\/\//, "")}/</Link> —
          live map, every train animated.
        </li>
        <li>
          <Link href="/station/times-sq-42-st-127">
            /station/times-sq-42-st-127
          </Link>{" "}
          — a station landing page with arrivals and alerts.
        </li>
        <li>
          <Link href="/changelog">/changelog</Link> — what shipped, what
          changed, what got fixed.
        </li>
      </ul>
      <p>
        For framed social-share thumbnails, every public page emits a{" "}
        <code>og:image</code>. Append <code>/opengraph-image</code> to
        any page URL to fetch the 1200×630 PNG directly (e.g.{" "}
        <code>{SITE_URL.replace(/^https?:\/\//, "")}/opengraph-image</code>
        ).
      </p>

      <h2>Brand assets</h2>
      <p>
        The brand uses the train emoji (🚇) as the icon glyph rather
        than a custom mark — the visual identity is intentionally
        riderly, not corporate. Treat the assets below as authoritative
        for editorial use:
      </p>
      <ul>
        <li>
          <a href="/icon-512.png" target="_blank" rel="noopener noreferrer">
            App icon — 512×512 PNG
          </a>
        </li>
        <li>
          <a href="/icon-192.png" target="_blank" rel="noopener noreferrer">
            App icon — 192×192 PNG
          </a>
        </li>
        <li>
          <a
            href="/apple-touch-icon.png"
            target="_blank"
            rel="noopener noreferrer"
          >
            Apple touch icon — 180×180 PNG
          </a>
        </li>
        <li>
          <a
            href="/icon-maskable-512.png"
            target="_blank"
            rel="noopener noreferrer"
          >
            Maskable icon — 512×512 PNG
          </a>
        </li>
      </ul>
      <p>
        Brand colors: emerald{" "}
        <code>#34d399</code> for status / confirmation,{" "}
        <code>#0a0a0f</code> for the dark canvas, white type. Type is
        the platform default sans (San Francisco on Apple, Roboto on
        Android, system-ui on the web).
      </p>

      <h2>About the maker</h2>
      <p>
        {SITE_NAME} is built by {AUTHOR_NAME}, an independent software
        engineer based in New York. The project started as a personal
        tool for a daily subway commute; everything it ships is what a
        rider actually wanted, not what an analytics dashboard demanded.
        The product principles — accuracy first, zero onboarding,
        one-handed on the subway, calm by default — are documented in
        the repo&rsquo;s root <code>CLAUDE.md</code>.
      </p>

      <h2>Contact</h2>
      <p>
        Press inquiries, interviews, fact-checks: open a thread on the{" "}
        <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
          GitHub repo
        </a>{" "}
        or use the{" "}
        <a href={FEEDBACK_URL} target="_blank" rel="noopener noreferrer">
          feedback issue template
        </a>
        {CONTACT_EMAIL ? (
          <>
            . You can also reach the maker at{" "}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
          </>
        ) : (
          <>. A direct press inbox is on the way; in the meantime GitHub is the fastest channel.</>
        )}
      </p>
      <p className="text-sm text-gray-500">
        Last updated alongside {VERSION_LABEL}. See the{" "}
        <Link href="/changelog">changelog</Link> for what just shipped,
        the <Link href="/about">about page</Link> for the longer
        narrative, and <Link href="/status">status</Link> for live
        service health.
      </p>
    </MarketingShell>
  );
}
