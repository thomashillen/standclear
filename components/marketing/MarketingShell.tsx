import Link from "next/link";
import { ReactNode } from "react";
import { GithubIcon } from "@/components/marketing/GithubIcon";
import {
  GITHUB_URL,
  SITE_NAME,
  SITE_TAGLINE,
  VERSION_LABEL,
} from "@/lib/site";

// Shared chrome for the public marketing routes (/about /privacy /terms
// /changelog /status). The map app at "/" intentionally has no chrome
// — these pages do, so visitors arriving from a search result, a
// tweet, or a back-link get a coherent product surface rather than a
// single-page tool dropped on a static page.

interface Props {
  /** Page title (rendered as <h1>). */
  title: string;
  /** Optional subtitle / lede. */
  description?: string;
  /** Optional eyebrow above the title (e.g. "Legal", "Product"). */
  eyebrow?: string;
  children: ReactNode;
}

export default function MarketingShell({
  title,
  description,
  eyebrow,
  children,
}: Props) {
  return (
    <div className="min-h-dvh bg-gray-950 text-white flex flex-col">
      <header className="sticky top-0 z-30 backdrop-blur-md bg-gray-950/75 border-b border-white/[0.06]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <Link
            href="/"
            className="flex items-center gap-2 text-[15px] font-bold tracking-tight hover:opacity-90"
          >
            <span aria-hidden className="text-lg leading-none">
              🚇
            </span>
            <span>{SITE_NAME}</span>
          </Link>
          <nav className="flex items-center gap-1 sm:gap-3 text-[13px] text-gray-400">
            <Link
              href="/about"
              className="hidden sm:inline px-2 py-1 rounded hover:text-white transition-colors"
            >
              About
            </Link>
            <Link
              href="/changelog"
              className="hidden sm:inline px-2 py-1 rounded hover:text-white transition-colors"
            >
              Changelog
            </Link>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub"
              className="px-2 py-1 rounded text-gray-400 hover:text-white transition-colors flex items-center gap-1.5"
            >
              <GithubIcon className="w-4 h-4" />
              <span className="hidden sm:inline">GitHub</span>
            </a>
            <Link
              href="/"
              className="ml-1 px-3.5 py-1.5 rounded-full bg-white text-gray-950 font-semibold text-[12px] hover:bg-gray-100 active:bg-gray-200 transition-colors"
            >
              Open app
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 py-10 sm:py-16">
        <div className="mb-10">
          {eyebrow && (
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/90 mb-3">
              {eyebrow}
            </p>
          )}
          <h1 className="text-[34px] sm:text-[44px] font-black tracking-tight leading-[1.05]">
            {title}
          </h1>
          {description && (
            <p className="mt-4 text-gray-400 text-base sm:text-lg leading-relaxed max-w-2xl">
              {description}
            </p>
          )}
        </div>
        <article className="text-[15px] text-gray-300 leading-relaxed space-y-5 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-white [&_h2]:tracking-tight [&_h2]:mt-10 [&_h2]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-white [&_h3]:mt-6 [&_h3]:mb-1 [&_p]:leading-relaxed [&_a]:text-emerald-300 [&_a]:underline [&_a]:underline-offset-4 [&_a:hover]:text-emerald-200 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1.5 [&_strong]:text-white [&_code]:text-emerald-200 [&_code]:bg-white/[0.06] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded">
          {children}
        </article>
      </main>

      <footer className="border-t border-white/[0.06] mt-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-[12px] text-gray-500">
          <div className="flex items-center gap-2">
            <span aria-hidden className="text-base leading-none">
              🚇
            </span>
            <span>
              <span className="text-gray-300 font-semibold">{SITE_NAME}</span>{" "}
              · {SITE_TAGLINE} · {VERSION_LABEL}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <Link href="/about" className="hover:text-white transition-colors">
              About
            </Link>
            <Link
              href="/changelog"
              className="hover:text-white transition-colors"
            >
              Changelog
            </Link>
            <Link href="/status" className="hover:text-white transition-colors">
              Status
            </Link>
            <Link
              href="/privacy"
              className="hover:text-white transition-colors"
            >
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-white transition-colors">
              Terms
            </Link>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors"
            >
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
