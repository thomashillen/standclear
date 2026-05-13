// @vitest-environment node
//
// The root layout (app/layout.tsx) sets a Next.js `title.template` of
// `%s · ${SITE_NAME}`. Any child segment that exports a plain-string
// `metadata.title` gets that template applied — i.e. `title: "About"`
// renders `<title>About · StandClear</title>`. If the child *also*
// hand-writes the ` · StandClear` suffix into its title, Next.js
// applies the template on top of that, producing the duplicate
// `<title>About · StandClear · StandClear</title>` (a SERP-quality bug
// that's invisible in code review because the title looks right at the
// page-file source).
//
// This test pins the convention across the five marketing routes
// (/about /changelog /privacy /status /terms) by reading the file
// source — importing the page modules drags `next/font/google` +
// `next/link` into a node-only test runner, which the Vitest env
// can't resolve without a Next runtime. Source-string assertion is
// good enough because the title literal is what the bug looks like:
// the moment someone re-introduces a hard-coded ` · StandClear`
// suffix, the regex flags it.
//
// Companion to PR #127's sitemap test: same shape (read SEO/marketing
// truth out of the source rather than at runtime) and protects the
// same surface.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SITE_NAME } from "@/lib/site";

const MARKETING_PAGES = [
  "about",
  "changelog",
  "privacy",
  "status",
  "terms",
] as const;

function readPage(slug: string): string {
  return readFileSync(resolve(__dirname, slug, "page.tsx"), "utf8");
}

// Extract the metadata.title literal from the page source. Matches:
//   title: "Foo"
//   title: `Foo`
//   title: `Foo · ${SITE_NAME}`
// Returns the raw inside-the-quotes/backticks string verbatim so the
// caller can assert against template interpolation syntax.
function extractTitle(source: string): string | null {
  const m = source.match(
    /export\s+const\s+metadata\s*:\s*Metadata\s*=\s*\{[\s\S]*?title:\s*(?:`([^`]+)`|"([^"]+)"|'([^']+)')/,
  );
  if (!m) return null;
  return m[1] ?? m[2] ?? m[3] ?? null;
}

describe("marketing page title convention", () => {
  // Verify the test harness itself is finding titles before asserting
  // shape — a regex regression would otherwise silently pass every
  // page through.
  it("extracts a title literal from each marketing page", () => {
    for (const slug of MARKETING_PAGES) {
      const src = readPage(slug);
      const title = extractTitle(src);
      expect(title, `${slug}/page.tsx missing parseable metadata.title`).toBeTruthy();
      expect(title!.length).toBeGreaterThan(0);
    }
  });

  for (const slug of MARKETING_PAGES) {
    it(`/${slug} sets a plain title that the layout template wraps`, () => {
      const src = readPage(slug);
      const title = extractTitle(src);
      expect(title).not.toBeNull();

      // The bug: a hand-written ` · ${SITE_NAME}` suffix that the
      // layout template (`%s · ${SITE_NAME}`) then re-applies. Either
      // form — the literal "StandClear" string or the template
      // interpolation `${SITE_NAME}` — is the regression.
      expect(title).not.toMatch(new RegExp(` · ${SITE_NAME}$`));
      expect(title).not.toMatch(/ · \$\{SITE_NAME\}$/);

      // Sanity-check the resolved <title> a real visitor sees once
      // the layout template wraps the plain section name.
      const resolved = `${title} · ${SITE_NAME}`;
      const occurrences = resolved.split(SITE_NAME).length - 1;
      expect(
        occurrences,
        `${slug} resolves to "${resolved}" — SITE_NAME should appear exactly once`,
      ).toBe(1);
    });
  }

  // The /not-found.tsx fallback uses a plain "Page not found" title
  // for the same reason — pin it alongside the marketing surface so a
  // regression there is caught by the same suite.
  it("/not-found uses a plain title", () => {
    const src = readFileSync(resolve(__dirname, "not-found.tsx"), "utf8");
    const title = extractTitle(src);
    expect(title).not.toBeNull();
    expect(title).not.toMatch(new RegExp(` · ${SITE_NAME}$`));
    expect(title).not.toMatch(/ · \$\{SITE_NAME\}$/);
  });

  // Layout template contract: if someone changes the layout's
  // template, the assertions above need to be re-evaluated. Pinning
  // the template shape here makes that dependency explicit.
  it("layout title template is `%s · ${SITE_NAME}`", () => {
    const src = readFileSync(resolve(__dirname, "layout.tsx"), "utf8");
    expect(src).toMatch(/template:\s*`%s · \$\{SITE_NAME\}`/);
  });
});
