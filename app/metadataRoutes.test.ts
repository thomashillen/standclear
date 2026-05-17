// @vitest-environment node
import { describe, expect, it } from "vitest";
import manifest from "./manifest";
import robots from "./robots";
import {
  SITE_NAME,
  SITE_SHORT_DESCRIPTION,
  SITE_TITLE,
  SITE_URL,
} from "@/lib/site";

// app/robots.ts and app/manifest.ts are Next "metadata routes": the
// framework calls them at build/request time to emit /robots.txt and
// /manifest.webmanifest. They have no user-facing call site to catch
// a regression in code review — a refactor that disallows /, drops
// the sitemap reference, or labels the maskable icon as
// `any maskable` (vs the strict `maskable` Chrome's install dialog
// requires) breaks SEO crawl or PWA install with no test signal.
// Pin both contracts here.

describe("robots()", () => {
  const result = robots();

  it("has exactly one rule entry (single global rule, not per-bot)", () => {
    // Shape pin: array form so it can grow, but the project policy is
    // one global rule. A second entry would imply per-bot carve-outs
    // we haven't decided on; trip the suite so that decision is
    // explicit, not accidental.
    expect(Array.isArray(result.rules)).toBe(true);
    expect(result.rules).toHaveLength(1);
  });

  it("applies to every crawler", () => {
    const rules = result.rules as Array<{ userAgent: string }>;
    expect(rules[0].userAgent).toBe("*");
  });

  it("allows the root path (don't accidentally narrow the surface)", () => {
    const rules = result.rules as Array<{ allow: string }>;
    expect(rules[0].allow).toBe("/");
  });

  it("disallows /api/ (ephemeral GTFS payloads aren't useful in a search index)", () => {
    const rules = result.rules as Array<{ disallow: string[] }>;
    expect(rules[0].disallow).toContain("/api/");
  });

  it("does NOT disallow the SEO surface (/station, /line, marketing pages)", () => {
    // The 451 station pages + 25 line pages are the canonical SEO
    // surface (sitemap, structured data, breadcrumb JSON-LD all hang
    // off them). A regression that disallows /station or /line would
    // silently delist the entire long tail.
    const rules = result.rules as Array<{ disallow: string[] }>;
    const disallow = rules[0].disallow;
    for (const path of [
      "/station/",
      "/line/",
      "/about",
      "/changelog",
      "/privacy",
      "/terms",
      "/",
    ]) {
      expect(disallow).not.toContain(path);
    }
  });

  it("points the sitemap reference at ${SITE_URL}/sitemap.xml verbatim", () => {
    // SITE_URL deliberately doesn't trim trailing slashes (per the
    // lib/site.ts contract documented in PR #134) — every caller
    // composes `${SITE_URL}/path` literally. Crawlers do treat
    // trailing-slash variants as distinct, so pinning the exact
    // composition guards against a future "helpful" normalization.
    expect(result.sitemap).toBe(`${SITE_URL}/sitemap.xml`);
  });

  it("sets host to the canonical SITE_URL", () => {
    expect(result.host).toBe(SITE_URL);
  });
});

describe("manifest()", () => {
  const result = manifest();

  it("name + short_name + description hang off lib/site.ts constants", () => {
    // The PWA install prompt reads `name`; the home-screen icon label
    // reads `short_name`. Pinning both to the lib/site.ts source of
    // truth keeps the rest of the marketing surface (OG cards, page
    // titles, footer) in lockstep — a brand-name change in one place
    // shouldn't leave the installed icon stuck on the old label.
    expect(result.name).toBe(SITE_TITLE);
    expect(result.short_name).toBe(SITE_NAME);
    expect(result.description).toBe(SITE_SHORT_DESCRIPTION);
  });

  it("start_url and scope are both '/' — PWA installability floor", () => {
    // A scope that doesn't include start_url makes the manifest
    // invalid per the spec and Chrome refuses to install. Pin both.
    expect(result.start_url).toBe("/");
    expect(result.scope).toBe("/");
  });

  it("declares an explicit, stable `id` decoupled from start_url", () => {
    // Per the W3C spec `id` defaults to `start_url`. If we ever ship
    // a deep-linked start_url (campaign param, `/nearby`, etc.)
    // without a pinned `id`, every installed home-screen app is
    // treated as a new app — duplicate icon, broken update channel.
    // The constant must therefore NOT be derived from start_url so a
    // future start_url change can't drag identity with it; assert it
    // independently rather than against result.start_url.
    expect(result.id).toBe("/");
  });

  it("declares manifest language + base direction", () => {
    // Drives how the OS install prompt and app-store wrapper listing
    // localize/lay out the name + description strings. Kept in lockstep
    // with the root <html lang="en"> and the OpenGraph en_US locale —
    // a drift here would render the install entry in the wrong
    // language/direction on a localized device.
    expect(result.lang).toBe("en-US");
    expect(result.dir).toBe("ltr");
  });

  it("display is 'standalone' (required for app-store wrapper eligibility)", () => {
    // Capacitor / PWA Builder require display=standalone to package
    // for the Apple App Store and Play Store. A "browser" or
    // "minimal-ui" downgrade would silently break that path.
    expect(result.display).toBe("standalone");
  });

  it("orientation is portrait (one-handed on the subway product principle)", () => {
    expect(result.orientation).toBe("portrait");
  });

  it("background and theme colors are both #0a0a0a (no launch-flash)", () => {
    // Mismatched background/theme colors produce a visible flash on
    // PWA launch between the splash screen and the first painted
    // frame. The dark map idiom is #0a0a0a end-to-end.
    expect(result.background_color).toBe("#0a0a0a");
    expect(result.theme_color).toBe("#0a0a0a");
  });

  it("ships the four icon variants required for cross-platform install", () => {
    // 192 + 512 cover the Android/Chrome PWA install dialog (Chrome
    // explicitly requires both); the 512 maskable variant enables
    // Android's adaptive icon mask; apple-touch-icon 180x180 is the
    // iOS home-screen icon. Any one missing degrades the install.
    expect(Array.isArray(result.icons)).toBe(true);
    const icons = result.icons!;
    const bySrc = new Map(icons.map((i) => [i.src, i]));

    const i192 = bySrc.get("/icon-192.png");
    expect(i192?.sizes).toBe("192x192");
    expect(i192?.type).toBe("image/png");
    expect(i192?.purpose).toBe("any");

    const i512 = bySrc.get("/icon-512.png");
    expect(i512?.sizes).toBe("512x512");
    expect(i512?.type).toBe("image/png");
    expect(i512?.purpose).toBe("any");

    const apple = bySrc.get("/apple-touch-icon.png");
    expect(apple?.sizes).toBe("180x180");
    expect(apple?.type).toBe("image/png");
    expect(apple?.purpose).toBe("any");
  });

  it("the 512 maskable variant labels purpose as the strict 'maskable' string", () => {
    // Chrome's install dialog parses `purpose` as a space-separated
    // set, but it only picks up a maskable variant when a dedicated
    // icon has purpose === "maskable" (NOT "any maskable" on the
    // same file — that defeats Android's adaptive-icon crop, which
    // assumes the entire bitmap is safe to mask). Pin the exact
    // string against a future "let's combine variants" simplification.
    const maskable = result
      .icons!.find((i) => i.src === "/icon-maskable-512.png");
    expect(maskable).toBeDefined();
    expect(maskable?.sizes).toBe("512x512");
    expect(maskable?.type).toBe("image/png");
    expect(maskable?.purpose).toBe("maskable");
  });

  it("categories include travel + navigation (app-store-listing relevant)", () => {
    // Apple's App Store and Google Play surface PWA submissions
    // against these category keywords; "travel" + "navigation" are
    // the two that match the product. Pin both so a refactor that
    // narrows the list trips the suite.
    expect(result.categories).toContain("travel");
    expect(result.categories).toContain("navigation");
  });
});
