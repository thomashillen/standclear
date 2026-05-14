import type { Metadata } from "next";
import Link from "next/link";
import MarketingShell from "@/components/marketing/MarketingShell";
import { GITHUB_URL, SITE_NAME, SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  // Plain section name; the root layout's title template appends
  // ` · ${SITE_NAME}`. Including the suffix here would double it.
  title: "Terms",
  description: `Terms of service for ${SITE_NAME}.`,
  alternates: { canonical: "/terms" },
};

const LAST_UPDATED = "2026-05-09";

export default function TermsPage() {
  return (
    <MarketingShell
      eyebrow="Legal"
      title="Terms of service"
      description={`The ground rules for using ${SITE_NAME}. Plain English; nothing exotic.`}
    >
      <p className="text-gray-500 text-[13px]">
        Last updated <time dateTime={LAST_UPDATED}>{LAST_UPDATED}</time>
      </p>

      <h2>1. What this is</h2>
      <p>
        {SITE_NAME} (&ldquo;the Service&rdquo;) is a free, web-based
        visualization of New York City subway data hosted at{" "}
        <a href={SITE_URL}>{SITE_URL}</a>. By using the Service you
        agree to these terms. If you don&rsquo;t agree, please
        don&rsquo;t use it.
      </p>

      <h2>2. The data is informational, not authoritative</h2>
      <p>
        Train positions, arrival predictions, walking routes, and
        service alerts come from third parties — primarily the MTA and
        Mapbox — and are passed through {SITE_NAME} in close to real
        time. They can be wrong, late, missing, or stale. Use them as a
        signal, not as the basis for safety-critical decisions. For
        official information, consult the MTA directly.
      </p>

      <h2>3. No warranty</h2>
      <p>
        The Service is provided &ldquo;as is,&rdquo; without warranty of
        any kind, express or implied, including but not limited to the
        warranties of merchantability, fitness for a particular purpose,
        and non-infringement. The Service may be unavailable, interrupted,
        or contain errors at any time. We do not guarantee that the
        Service will meet your requirements or be free of bugs.
      </p>

      <h2>4. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, in no event shall the
        creators, contributors, or operators of {SITE_NAME} be liable
        for any direct, indirect, incidental, special, consequential, or
        exemplary damages arising out of or in connection with your use
        of the Service — including but not limited to missed trains,
        delayed commutes, incorrect routes, or any reliance placed on
        information surfaced by the Service.
      </p>

      <h2>5. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>
          Scrape, hammer, or otherwise abuse the API endpoints. The
          live-feed endpoints are rate-limited at the source by the MTA
          and at our edge for fairness.
        </li>
        <li>
          Use the Service to harm, harass, or deceive others, or to
          violate any law.
        </li>
        <li>
          Misrepresent the data as official MTA information or as coming
          from any party other than {SITE_NAME}.
        </li>
        <li>
          Attempt to disrupt the Service, probe for vulnerabilities
          beyond responsible-disclosure norms, or otherwise interfere
          with normal operation.
        </li>
      </ul>

      <h2>6. Trademarks and third-party content</h2>
      <p>
        &ldquo;MTA,&rdquo; the M logo, route bullets, route names, and
        station names are trademarks of the Metropolitan Transportation
        Authority. {SITE_NAME} is unaffiliated with the MTA and uses the
        MTA&rsquo;s publicly published transit data under its developer
        terms. Map tiles and address data are provided by Mapbox under
        its own terms.
      </p>

      <h2>7. Open source</h2>
      <p>
        The {SITE_NAME} source code is published under the MIT License
        on{" "}
        <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
        . You may fork, modify, and self-host the project subject to
        that license. Your obligations under these Terms apply to{" "}
        <em>this</em> hosted instance only — your fork is your own.
      </p>

      <h2>8. Privacy</h2>
      <p>
        Your privacy is described separately in the{" "}
        <Link href="/privacy">privacy policy</Link>, which is
        incorporated by reference into these Terms.
      </p>

      <h2>9. Changes</h2>
      <p>
        We may update these Terms from time to time. Material changes
        will be called out in the{" "}
        <Link href="/changelog">changelog</Link>; the &ldquo;Last
        updated&rdquo; date at the top of this page reflects the most
        recent revision. Continued use of the Service after a change
        means you accept the updated Terms.
      </p>

      <h2>10. Governing law</h2>
      <p>
        These Terms are governed by the laws of the State of New York,
        without regard to conflict-of-laws principles, except where
        applicable consumer-protection laws override.
      </p>

      <h2>11. Contact</h2>
      <p>
        Questions about these terms? Open an issue on the{" "}
        <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
          project repository
        </a>
        .
      </p>
    </MarketingShell>
  );
}
