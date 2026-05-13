// @vitest-environment node

import { describe, expect, it } from "vitest";
import { homepageJsonLd } from "./seoSchemas";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "./site";

describe("homepageJsonLd", () => {
  it("declares the WebApplication shape Google expects", () => {
    const ld = homepageJsonLd();
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("WebApplication");
    expect(ld.name).toBe(SITE_NAME);
    expect(ld.url).toBe(SITE_URL);
    expect(ld.description).toBe(SITE_DESCRIPTION);
  });

  // Free-app rich-result template reads either `isAccessibleForFree`
  // or `offers.price === "0"` depending on the surface. Setting both
  // is the canonical Google-recommended duplication for free apps —
  // miss either field and the rich result can degrade or drop.
  it("signals free access via both fields Google reads", () => {
    const ld = homepageJsonLd();
    expect(ld.isAccessibleForFree).toBe(true);
    expect(ld.offers.price).toBe("0");
    expect(ld.offers.priceCurrency).toBe("USD");
    expect(ld.offers["@type"]).toBe("Offer");
  });

  it("uses a real schema.org applicationCategory (TravelApplication is the closest published type)", () => {
    expect(homepageJsonLd().applicationCategory).toBe("TravelApplication");
  });

  it("serializes to JSON cleanly so the inline <script> tag is valid", () => {
    const ld = homepageJsonLd();
    expect(() => JSON.stringify(ld)).not.toThrow();
    const round = JSON.parse(JSON.stringify(ld));
    expect(round.name).toBe(SITE_NAME);
    expect(Array.isArray(round.featureList)).toBe(true);
    expect(round.featureList.length).toBeGreaterThan(0);
  });
});
