import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { SITE_NAME } from "@/lib/site";
import NotFound, { metadata } from "./not-found";

// `app/not-found.tsx` is the surface every typo'd URL and every
// `notFound()` thrown from the dynamic SEO routes
// (`app/station/[slug]/page.tsx`, `app/line/[id]/page.tsx`) lands on.
// Two contracts are load-bearing and pinned here so a future refactor
// can't silently regress either:
//
//   1. `robots: { index: false }` — without it Google indexes every
//      404, including the unbounded set of garbage slugs that resolve
//      to `notFound()`. That's a real crawl-budget + SERP-pollution
//      harm, and it's invisible until weeks later in Search Console.
//   2. The two recovery links — this page is the ONLY way back into
//      the app from a dead share link. Drop them and a rider who
//      tapped a stale tweet is stranded with no affordance.
describe("app/not-found.tsx", () => {
  it("marks the page noindex so dead/typo URLs stay out of the index", () => {
    // follow:true is deliberate — the recovery links should still
    // pass authority back to "/" and /about even though the 404
    // itself must never rank.
    expect(metadata.robots).toEqual({ index: false, follow: true });
  });

  it("sets a branded title + description carrying the site name", () => {
    expect(metadata.title).toBe("Page not found");
    expect(String(metadata.description)).toContain(SITE_NAME);
  });

  it("offers an Open the map link back to /", () => {
    render(<NotFound />);
    const link = screen.getByRole("link", { name: /open the map/i });
    expect(link.getAttribute("href")).toBe("/");
  });

  it("offers an About link carrying the brand name", () => {
    render(<NotFound />);
    const link = screen.getByRole("link", {
      name: new RegExp(`about ${SITE_NAME}`, "i"),
    });
    expect(link.getAttribute("href")).toBe("/about");
  });

  it("renders exactly two recovery actions — calm, not a menu", () => {
    // The restraint is the point: a 404 gets the rider home or to
    // /about and nothing else. A regression that bolts on more links
    // (search box, station list, etc.) should be a deliberate choice,
    // not an accident — so the count is pinned.
    render(<NotFound />);
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("renders the brand 404 copy so an emptied page trips the suite", () => {
    render(<NotFound />);
    expect(screen.getByText(/404 · Off the map/i)).toBeTruthy();
    expect(
      screen.getByText(/This station isn.t on the line\./i),
    ).toBeTruthy();
  });
});
