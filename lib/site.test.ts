// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// `lib/site.ts` is the single source of truth for every brand string +
// URL on the marketing surface (/about, /privacy, /terms, /changelog,
// /status), the OG image, the sitemap, the footer, the About dialog,
// and the /api/health version field. Three contracts are load-bearing:
//
//   1. `VERSION === package.json.version`. The source comment says
//      "operator-facing identifiers are only useful if they match
//      what's running" — a refactor that swaps `pkg.version` for a
//      string literal would silently let the /api/health reporter +
//      /status footer drift from the actual shipped build.
//
//   2. URL composition is built off `GITHUB_URL`. A change to the
//      repo slug must update issues/feedback/bug-report/discussions
//      links in lockstep — they all share the same base.
//
//   3. `SITE_URL` honors the `NEXT_PUBLIC_SITE_URL` env override and
//      falls back to the brand URL when unset. The OG image, sitemap,
//      and structured-data resolve against this — the env-override
//      path is what makes Vercel preview deploys yield non-404 OG
//      cards before the brand domain is provisioned.
//
// Tests are written as fresh imports so the env-override case can
// flip `NEXT_PUBLIC_SITE_URL` before module-eval-time captures it.

async function loadFresh() {
  vi.resetModules();
  return await import("./site");
}

describe("VERSION ↔ package.json drift contract", () => {
  it("VERSION matches package.json.version verbatim", async () => {
    const pkgRaw = readFileSync(
      path.join(process.cwd(), "package.json"),
      "utf-8",
    );
    const pkg = JSON.parse(pkgRaw) as { version: string };
    const { VERSION } = await loadFresh();
    expect(VERSION).toBe(pkg.version);
  });

  it("VERSION is a non-empty semver-shaped string", async () => {
    const { VERSION } = await loadFresh();
    expect(typeof VERSION).toBe("string");
    expect(VERSION.length).toBeGreaterThan(0);
    // Allows 0.9.0 + future 1.2.3 + pre-release 1.2.3-rc.1 shapes.
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
  });
});

describe("VERSION_LABEL composition", () => {
  it("formats as `v{VERSION} · {APP_RELEASE_NAME}` — the shape /status, About, footer all read", async () => {
    const { VERSION, APP_RELEASE_NAME, VERSION_LABEL } = await loadFresh();
    expect(VERSION_LABEL).toBe(`v${VERSION} · ${APP_RELEASE_NAME}`);
  });

  it("APP_RELEASE_NAME is a non-empty string (load-bearing for the · separator)", async () => {
    const { APP_RELEASE_NAME } = await loadFresh();
    expect(typeof APP_RELEASE_NAME).toBe("string");
    expect(APP_RELEASE_NAME.length).toBeGreaterThan(0);
  });
});

describe("SITE_TITLE composition", () => {
  it("starts with SITE_NAME — so the layout-template suffix doesn't double the brand", async () => {
    // PR #132 fixed the doubled-suffix bug on the marketing pages;
    // SITE_TITLE is the `default` title at the layout level and is NOT
    // run through the template (Next's metadata contract — `default`
    // bypasses `template`), so it has to carry the brand itself.
    const { SITE_TITLE, SITE_NAME } = await loadFresh();
    expect(SITE_TITLE.startsWith(SITE_NAME)).toBe(true);
  });

  it("contains the product descriptor — Search results need more than the brand to disambiguate", async () => {
    const { SITE_TITLE } = await loadFresh();
    expect(SITE_TITLE).toMatch(/NYC Subway Tracker/);
  });
});

describe("GitHub URL composition", () => {
  it("GITHUB_URL is the public github.com path for the repo slug", async () => {
    const { GITHUB_URL, GITHUB_REPO } = await loadFresh();
    expect(GITHUB_URL).toBe(`https://github.com/${GITHUB_REPO}`);
  });

  it("ISSUES_URL hangs off GITHUB_URL — repo rename must keep them aligned", async () => {
    const { GITHUB_URL, ISSUES_URL } = await loadFresh();
    expect(ISSUES_URL.startsWith(GITHUB_URL)).toBe(true);
    expect(ISSUES_URL).toBe(`${GITHUB_URL}/issues`);
  });

  it("FEEDBACK_URL + BUG_REPORT_URL pre-fill the issue form with the right label", async () => {
    const { ISSUES_URL, FEEDBACK_URL, BUG_REPORT_URL } = await loadFresh();
    expect(FEEDBACK_URL.startsWith(`${ISSUES_URL}/new?`)).toBe(true);
    expect(FEEDBACK_URL).toMatch(/labels=feedback/);
    expect(BUG_REPORT_URL.startsWith(`${ISSUES_URL}/new?`)).toBe(true);
    expect(BUG_REPORT_URL).toMatch(/labels=bug/);
  });

  it("DISCUSSIONS_URL hangs off GITHUB_URL", async () => {
    const { GITHUB_URL, DISCUSSIONS_URL } = await loadFresh();
    expect(DISCUSSIONS_URL).toBe(`${GITHUB_URL}/discussions`);
  });
});

describe("SITE_URL env override", () => {
  const original = process.env.NEXT_PUBLIC_SITE_URL;

  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = original;
  });

  it("defaults to https://standclear.app when NEXT_PUBLIC_SITE_URL is unset", async () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const { SITE_URL } = await loadFresh();
    expect(SITE_URL).toBe("https://standclear.app");
  });

  it("honors NEXT_PUBLIC_SITE_URL when set — the Vercel-preview-deploy escape hatch", async () => {
    process.env.NEXT_PUBLIC_SITE_URL =
      "https://standclear-git-claude-keen.vercel.app";
    const { SITE_URL } = await loadFresh();
    expect(SITE_URL).toBe("https://standclear-git-claude-keen.vercel.app");
  });

  it("does NOT trim trailing slashes — callers compose `${SITE_URL}/path` literally", async () => {
    // Sitemap, OG image, and structured-data all concatenate with a
    // leading-slash path. A future "helpful" normalization that
    // stripped a trailing slash here would double-slash any caller
    // that happens to remember the convention.
    process.env.NEXT_PUBLIC_SITE_URL = "https://example.com/";
    const { SITE_URL } = await loadFresh();
    expect(SITE_URL).toBe("https://example.com/");
  });
});

describe("SITE_HOST derivation", () => {
  const original = process.env.NEXT_PUBLIC_SITE_URL;

  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = original;
  });

  it("defaults to the bare brand host (no scheme) when unset", async () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const { SITE_HOST } = await loadFresh();
    expect(SITE_HOST).toBe("standclear.app");
  });

  it("strips the scheme from a Vercel-preview override — the footer must name where the card is actually served", async () => {
    // The whole reason SITE_URL is env-overridable is so a preview
    // deploy's OG card doesn't advertise the not-yet-provisioned
    // brand domain. The footer host has to track the override too.
    process.env.NEXT_PUBLIC_SITE_URL =
      "https://standclear-git-claude-keen.vercel.app";
    const { SITE_HOST } = await loadFresh();
    expect(SITE_HOST).toBe("standclear-git-claude-keen.vercel.app");
  });

  it("trims a trailing slash (URL.host has none) so the footer never reads `host./path`", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://example.com/";
    const { SITE_HOST } = await loadFresh();
    expect(SITE_HOST).toBe("example.com");
  });

  it("preserves the port for a local-dev override", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
    const { SITE_HOST } = await loadFresh();
    expect(SITE_HOST).toBe("localhost:3000");
  });

  it("returns host only, dropping any path in the override", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://example.com/some/path";
    const { SITE_HOST } = await loadFresh();
    expect(SITE_HOST).toBe("example.com");
  });

  it("never contains a scheme separator (the invariant the footers depend on)", async () => {
    process.env.NEXT_PUBLIC_SITE_URL =
      "https://standclear-git-claude-keen.vercel.app";
    const { SITE_HOST } = await loadFresh();
    expect(SITE_HOST).not.toContain("://");
  });

  it("degrades a schemeless operator typo without throwing at module load — every route imports this module", async () => {
    // `new URL("standclear.app")` throws; an unguarded derive would
    // fail the entire build over one bad env value rather than just
    // degrading one footer. The regex fallback keeps it sane.
    process.env.NEXT_PUBLIC_SITE_URL = "standclear.app/changelog";
    const { SITE_HOST } = await loadFresh();
    expect(SITE_HOST).toBe("standclear.app");
  });
});

describe("brand-string sanity", () => {
  beforeEach(() => {
    // Lock SITE_URL to the brand default so the snapshot below is
    // deterministic against env state in the runner.
    delete process.env.NEXT_PUBLIC_SITE_URL;
  });

  it("CONTACT_EMAIL is null until provisioned — guards the UI fallback to GitHub feedback", async () => {
    // The source comment says "Wire when provisioned — until then UI
    // falls back to the GitHub feedback links above." Several call
    // sites check for `null` to decide whether to render a mailto.
    const { CONTACT_EMAIL } = await loadFresh();
    expect(CONTACT_EMAIL).toBe(null);
  });

  it("AUTHOR_HANDLE matches the GITHUB_REPO owner segment", async () => {
    const { AUTHOR_HANDLE, GITHUB_REPO } = await loadFresh();
    expect(GITHUB_REPO.startsWith(`${AUTHOR_HANDLE}/`)).toBe(true);
  });

  it("brand strings are all non-empty (cheap regression guard)", async () => {
    const mod = await loadFresh();
    const fields: Array<keyof typeof mod> = [
      "SITE_NAME",
      "SITE_TAGLINE",
      "SITE_SHORT_DESCRIPTION",
      "SITE_DESCRIPTION",
      "SITE_TITLE",
      "AUTHOR_NAME",
      "AUTHOR_HANDLE",
      "APP_RELEASE_NAME",
    ];
    for (const k of fields) {
      const v = mod[k];
      expect(typeof v).toBe("string");
      expect((v as string).length).toBeGreaterThan(0);
    }
  });
});
