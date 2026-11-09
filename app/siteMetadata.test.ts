// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/local", () => ({
  default: () => ({ className: "test-font" }),
}));
vi.mock("@vercel/analytics/next", () => ({ Analytics: () => null }));
vi.mock("@/components/RegisterSW", () => ({ default: () => null }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("public metadata origin", () => {
  it.each([
    {
      name: "the live deployment by default",
      configuredUrl: undefined,
      expectedUrl: "https://standclear.vercel.app",
    },
    {
      name: "an explicitly configured custom domain",
      configuredUrl: "https://transit.example.org",
      expectedUrl: "https://transit.example.org",
    },
    {
      name: "an explicitly configured preview",
      configuredUrl: "https://standclear-preview.vercel.app",
      expectedUrl: "https://standclear-preview.vercel.app",
    },
  ])("uses $name across metadata consumers", async ({ configuredUrl, expectedUrl }) => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", configuredUrl);
    vi.resetModules();
    const { metadata } = await import("./layout");
    const { default: sitemap } = await import("./sitemap");
    const { default: robots } = await import("./robots");
    const { homepageJsonLd, websiteJsonLd } = await import("@/lib/seoSchemas");
    const { SITE_HOST } = await import("@/lib/site");

    // Next resolves the relative canonical and Open Graph URLs against
    // metadataBase, so they must all name the same verified deployment.
    expect(metadata.metadataBase?.toString()).toBe(`${expectedUrl}/`);
    expect(metadata.alternates?.canonical).toBe("/");
    expect(metadata.openGraph?.url).toBe("/");
    expect(SITE_HOST).toBe(new URL(expectedUrl).host);
    expect(homepageJsonLd().url).toBe(expectedUrl);
    expect(websiteJsonLd().url).toBe(expectedUrl);
    expect(robots()).toMatchObject({
      host: expectedUrl,
      sitemap: `${expectedUrl}/sitemap.xml`,
    });
    const urls = sitemap().map(({ url }) => url);
    expect(urls).toContain(expectedUrl);
    expect(new Set(urls.map((url) => new URL(url).origin))).toEqual(
      new Set([expectedUrl]),
    );
  });
});
