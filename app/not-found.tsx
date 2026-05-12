import Link from "next/link";
import type { Metadata } from "next";
import { SITE_NAME } from "@/lib/site";

// Branded 404 for unknown routes. Without this file Next.js falls back
// to its default unstyled "404 - This page could not be found." page,
// which already triggered on every typo'd URL and on every `notFound()`
// thrown from the dynamic SEO routes (`app/station/[slug]/page.tsx`,
// `app/line/[id]/page.tsx`). Both paths now land on a brand-consistent
// surface that mirrors the visual idiom of `app/error.tsx` (subway
// emoji + headline + two-action affordance) so a rider arriving from a
// stale share link or a slug typo gets a clear way back into the app.
//
// Server component — no interactivity needed, just two Links. Next
// renders this with a 404 status code automatically.

export const metadata: Metadata = {
  title: "Page not found",
  description: `${SITE_NAME} couldn't find that page.`,
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <main className="min-h-dvh bg-gray-950 text-white flex items-center justify-center px-6 py-16">
      <div className="max-w-md w-full text-center">
        <div className="text-5xl mb-5" aria-hidden>
          🚇
        </div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/90 mb-3">
          404 · Off the map
        </p>
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight">
          This station isn&rsquo;t on the line.
        </h1>
        <p className="mt-3 text-gray-400 text-[15px] leading-relaxed">
          The page you&rsquo;re looking for doesn&rsquo;t exist — maybe a
          stale link, or a typo in the URL. The live map is still
          running.
        </p>
        <div className="mt-7 flex flex-col sm:flex-row gap-2.5 justify-center">
          <Link
            href="/"
            className="press px-5 py-2.5 rounded-full bg-white text-gray-950 font-semibold text-[14px] hover:bg-gray-100 active:bg-gray-200 transition-colors"
          >
            Open the map
          </Link>
          <Link
            href="/about"
            className="press px-5 py-2.5 rounded-full bg-white/[0.06] text-gray-100 font-semibold text-[14px] hover:bg-white/[0.10] transition-colors"
          >
            About {SITE_NAME}
          </Link>
        </div>
      </div>
    </main>
  );
}
