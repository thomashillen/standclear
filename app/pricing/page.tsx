import type { Metadata } from "next";
import Link from "next/link";
import MarketingShell from "@/components/marketing/MarketingShell";
import { GITHUB_URL, SITE_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: `Pricing · ${SITE_NAME}`,
  description: `${SITE_NAME} is free, with no accounts, no ads, and no tracking. Here's what's planned for power users.`,
  alternates: { canonical: "/pricing" },
};

interface Tier {
  name: string;
  tagline: string;
  price: string;
  cadence: string;
  cta: { label: string; href: string; primary?: boolean };
  features: { text: string; included: boolean; soon?: boolean }[];
  badge?: string;
  available: boolean;
}

const TIERS: Tier[] = [
  {
    name: "Free",
    tagline: "Live NYC subway in your pocket — every feature, no asterisk.",
    price: "$0",
    cadence: "forever",
    available: true,
    cta: { label: "Open the app", href: "/", primary: true },
    features: [
      { text: "Every train, every line, on a live map", included: true },
      { text: "Tap any station for the next 4 trains in each direction", included: true },
      { text: "Address-to-address routing with walking legs", included: true },
      { text: "Pin Home & Work for one-tap commute", included: true },
      { text: "Severity-tinted service alerts", included: true },
      { text: "Installable PWA — works offline", included: true },
      { text: "No accounts, no email, no tracking pixels", included: true },
      { text: "Open source, MIT licensed", included: true },
    ],
  },
  {
    name: "Pro",
    tagline: "Planned features for power riders. Free Pro for early supporters.",
    price: "TBD",
    cadence: "in development",
    available: false,
    badge: "Coming soon",
    cta: {
      label: "Request early access",
      href: `${GITHUB_URL}/issues/new?labels=pro&title=Pro%20early%20access`,
    },
    features: [
      { text: "Push alerts for your saved lines", included: true, soon: true },
      { text: "“Leave at X” reminders for saved commutes", included: true, soon: true },
      { text: "Cross-device sync of favorites + commutes", included: true, soon: true },
      { text: "Per-station arrival history & trends", included: true, soon: true },
      { text: "Apple Watch / Wear OS companion", included: true, soon: true },
      { text: "Priority support", included: true, soon: true },
    ],
  },
];

export default function PricingPage() {
  return (
    <MarketingShell
      eyebrow="Pricing"
      title={`${SITE_NAME} is free.`}
      description="No accounts, no ads, no tracking pixels. The whole app — every line, every train, every feature — is free for everyone, forever. Pro is the optional layer for power riders that's in development."
    >
      <div className="not-prose grid sm:grid-cols-2 gap-4 mt-2">
        {TIERS.map((tier) => (
          <div
            key={tier.name}
            className={`relative rounded-2xl p-6 sm:p-7 border ${
              tier.available
                ? "border-emerald-400/30 bg-emerald-500/[0.03]"
                : "border-white/[0.08] bg-white/[0.02]"
            }`}
          >
            {tier.badge && (
              <span className="absolute top-4 right-4 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-sky-500/15 text-sky-200 ring-1 ring-sky-400/30">
                {tier.badge}
              </span>
            )}
            <h2 className="!mt-0 !mb-1 text-xl font-black tracking-tight text-white">
              {tier.name}
            </h2>
            <p className="text-[13.5px] text-gray-400 leading-snug">
              {tier.tagline}
            </p>
            <div className="mt-5 flex items-baseline gap-2">
              <span className="text-3xl font-black tracking-tight text-white">
                {tier.price}
              </span>
              <span className="text-[12px] text-gray-500">{tier.cadence}</span>
            </div>
            <Link
              href={tier.cta.href}
              {...(tier.cta.href.startsWith("http")
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
              className={`mt-5 inline-flex items-center justify-center w-full px-4 py-2.5 rounded-full font-semibold text-[13.5px] transition-colors ${
                tier.cta.primary
                  ? "bg-white text-gray-950 hover:bg-gray-100 active:bg-gray-200"
                  : "bg-white/[0.06] text-gray-100 hover:bg-white/[0.10]"
              }`}
            >
              {tier.cta.label}
            </Link>
            <ul className="mt-6 space-y-2.5">
              {tier.features.map((f) => (
                <li
                  key={f.text}
                  className="flex items-start gap-2.5 text-[13.5px] text-gray-300 leading-snug"
                >
                  <span
                    className={`flex-shrink-0 mt-[3px] inline-flex items-center justify-center w-4 h-4 rounded-full ${
                      f.soon
                        ? "bg-sky-500/15 text-sky-200 ring-1 ring-sky-400/30"
                        : "bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/30"
                    }`}
                    aria-hidden
                  >
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 12 12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="m2 6 3 3 5-6" />
                    </svg>
                  </span>
                  <span>
                    {f.text}
                    {f.soon && (
                      <span className="ml-1.5 text-[11px] text-sky-300">
                        (planned)
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <h2>Why is it free?</h2>
      <p>
        The infrastructure cost of {SITE_NAME} today is a few dollars
        a month — Vercel bandwidth + Mapbox tile usage on the free
        tier. That&rsquo;s easy to absorb, and the tool is more useful
        when there&rsquo;s no friction between you and live arrivals.
      </p>
      <p>
        If usage ever scales beyond what hobby-tier hosting covers,
        Pro is the lever — opt-in features that pay for the
        infrastructure, with the whole baseline experience staying
        free for everyone. We&rsquo;re committed to that line.
      </p>

      <h2>What about ads?</h2>
      <p>
        No ads. No tracking pixels beyond aggregate Vercel Analytics
        (no cookies, no cross-site identifiers — see the{" "}
        <Link href="/privacy">privacy policy</Link>). No data resale.
        No sponsored stations.
      </p>

      <h2>Self-host it</h2>
      <p>
        {SITE_NAME} is{" "}
        <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
          MIT-licensed open source
        </a>
        . Fork it, deploy it, modify it. Your only running cost is your
        own Mapbox token; the MTA feeds are free.
      </p>
    </MarketingShell>
  );
}
