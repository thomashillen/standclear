import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import MarketingShell from "./MarketingShell";

// MarketingShell wraps every public marketing surface (/about /privacy
// /terms /changelog /status) plus the SEO surfaces (/station/[slug],
// /line/[id]). The header <nav> and the footer link cluster are both
// landmark regions to assistive tech — labelling them distinctly keeps
// VoiceOver / NVDA landmark navigation from announcing two unnamed
// "navigation" regions. Lock both labels in so a future refactor that
// drops them trips this test.
describe("MarketingShell", () => {
  it("labels the header and footer nav landmarks distinctly", () => {
    render(
      <MarketingShell title="About">
        <p>body</p>
      </MarketingShell>,
    );
    const navs = screen.getAllByRole("navigation");
    const labels = navs.map((n) => n.getAttribute("aria-label"));
    expect(labels).toEqual(expect.arrayContaining(["Primary", "Footer"]));
    expect(new Set(labels).size).toBe(labels.length);
  });
});
