// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

// `app/robots.ts` is the crawl contract, and two of its clauses are
// load-bearing in opposite directions:
//
//   1. `disallow: ["/api/"]` — the API surface proxies eight MTA
//      GTFS-Realtime feeds and is hit on an 8 s client poll. A crawler
//      that discovered `/api/trains` would multiply that upstream
//      fan-out by its own crawl rate for zero indexable value. The
//      source comment pins the reason; this pins the behavior, and
//      that the block is scoped to *exactly* `/api/` — a future edit
//      that broadened it to `/`, `/station/`, or `/line/` would
//      silently deindex the ~470 station + 27 line SEO pages the
//      product's organic-discovery bet depends on, and the harm is
//      invisible until weeks later in Search Console.
//
//   2. `allow: "/"` — the inverse: the marketing + per-station +
//      per-line surface must stay crawlable. A regression to a
//      site-wide disallow is the single most damaging SEO change
//      possible here, so it gets its own assertion.
//
//   3. `sitemap` + `host` resolve against `SITE_URL`, which honors the
//      `NEXT_PUBLIC_SITE_URL` override. This is the same correctness
//      class as the OG-card footer fix (PR #157): a preview deploy
//      whose robots pointed crawlers at the not-yet-provisioned brand
//      domain's sitemap would orphan the crawl pointer. Tested as
//      fresh imports so the override can flip before module-eval-time
//      captures `SITE_URL`.
//
// Mirrors the `app/sitemap.test.ts` idiom (node env, contract-pinning
// describe, `loadFresh()` for the env-override path).

async function loadFresh() {
  vi.resetModules();
  const [{ default: robots }, { SITE_URL }] = await Promise.all([
    import("./robots"),
    import("@/lib/site"),
  ]);
  return { robots, SITE_URL };
}

// `MetadataRoute.Robots["rules"]` may be a single object or an array;
// the implementation uses a one-element array. Normalize so the
// assertions read the same either way and a future single-object
// refactor still exercises the same invariants.
type Rule = { userAgent?: unknown; allow?: unknown; disallow?: unknown };
function asRules(rules: unknown): Rule[] {
  return Array.isArray(rules) ? (rules as Rule[]) : [rules as Rule];
}

describe("robots()", () => {
  const original = process.env.NEXT_PUBLIC_SITE_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = original;
  });

  it("blocks the /api/ surface from crawlers", async () => {
    const { robots } = await loadFresh();
    const rules = asRules(robots().rules);
    const blocked = rules.flatMap((r) =>
      Array.isArray(r.disallow) ? r.disallow : r.disallow ? [r.disallow] : [],
    );
    expect(blocked).toContain("/api/");
  });

  it("scopes the block to exactly /api/ — nothing site-wide that would deindex the SEO pages", async () => {
    // The asymmetric danger: over-blocking here silently removes the
    // ~470 station + 27 line pages from the index with no error, no
    // build failure, and no signal until Search Console weeks later.
    // Pin that no clause is the empty string, "/", or a parent of the
    // crawlable SEO routes.
    const { robots } = await loadFresh();
    const rules = asRules(robots().rules);
    const blocked = rules.flatMap((r) =>
      Array.isArray(r.disallow) ? r.disallow : r.disallow ? [r.disallow] : [],
    );
    for (const path of blocked) {
      expect(path).not.toBe("");
      expect(path).not.toBe("/");
      expect(path).not.toBe("/station/");
      expect(path).not.toBe("/line/");
    }
  });

  it("allows the root so the marketing + station + line pages stay crawlable", async () => {
    const { robots } = await loadFresh();
    const rules = asRules(robots().rules);
    const allowed = rules.flatMap((r) =>
      Array.isArray(r.allow) ? r.allow : r.allow ? [r.allow] : [],
    );
    expect(allowed).toContain("/");
  });

  it("ships a single wildcard rule (a future per-bot carve-out must be deliberate)", async () => {
    // Same restraint idiom as sitemap.test.ts's inclusion-list pin:
    // there is one `userAgent: "*"` rule today. Adding a Googlebot- or
    // GPTBot-specific block is a real policy decision; pinning the
    // shape makes it trip the suite rather than slip in unreviewed.
    const { robots } = await loadFresh();
    const rules = asRules(robots().rules);
    expect(rules).toHaveLength(1);
    expect(rules[0].userAgent).toBe("*");
  });

  it("points crawlers at the sitemap.xml route Next serves for app/sitemap.ts", async () => {
    // The leaf must stay `/sitemap.xml` — that's the path Next exposes
    // for `app/sitemap.ts`. A rename of the sitemap route without
    // updating this pointer would orphan it (robots advertising a 404).
    const { robots, SITE_URL } = await loadFresh();
    const r = robots();
    expect(r.sitemap).toBe(`${SITE_URL}/sitemap.xml`);
    const sitemap = Array.isArray(r.sitemap) ? r.sitemap[0] : r.sitemap;
    expect(new URL(sitemap!).pathname).toBe("/sitemap.xml");
  });

  it("declares the canonical host as SITE_URL", async () => {
    const { robots, SITE_URL } = await loadFresh();
    expect(robots().host).toBe(SITE_URL);
  });

  it("defaults sitemap + host to the brand URL when the env override is unset", async () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const { robots } = await loadFresh();
    const r = robots();
    expect(r.host).toBe("https://standclear.app");
    expect(r.sitemap).toBe("https://standclear.app/sitemap.xml");
  });

  it("tracks the NEXT_PUBLIC_SITE_URL override so a preview deploy's robots point at the preview, not the brand domain", async () => {
    // The PR #157 correctness class: before the brand domain is
    // provisioned, NEXT_PUBLIC_SITE_URL is the Vercel preview URL.
    // Both the sitemap pointer and the declared host must follow it,
    // or crawlers reaching the preview get sent to a 404 sitemap on a
    // domain that isn't pointed at this app yet.
    process.env.NEXT_PUBLIC_SITE_URL =
      "https://standclear-git-claude-keen.vercel.app";
    const { robots } = await loadFresh();
    const r = robots();
    expect(r.host).toBe("https://standclear-git-claude-keen.vercel.app");
    expect(r.sitemap).toBe(
      "https://standclear-git-claude-keen.vercel.app/sitemap.xml",
    );
  });

  it("keeps host and the sitemap pointer on the same origin (no partial-override drift)", async () => {
    // A refactor that updated one SITE_URL consumer but not the other
    // would send crawlers a sitemap on a different origin than the
    // declared canonical host — pin that they can't diverge.
    process.env.NEXT_PUBLIC_SITE_URL = "https://example.com";
    const { robots } = await loadFresh();
    const r = robots();
    const sitemap = Array.isArray(r.sitemap) ? r.sitemap[0] : r.sitemap;
    expect(new URL(sitemap!).origin).toBe(new URL(r.host as string).origin);
  });
});
