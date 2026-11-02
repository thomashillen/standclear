// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const panels = [
  "SearchSheet.tsx",
  "NearbyPanel.tsx",
  "StationPanel.tsx",
  "LinePanel.tsx",
  "MoreSheet.tsx",
];

describe("primary panel surfaces", () => {
  it.each(panels)("keeps %s on the shared liquid-glass reading surface", (panel) => {
    const source = readFileSync(resolve(__dirname, panel), "utf8");

    expect(source).toContain("panel-surface");
    expect(source).not.toContain("ios-glass--sheet");
    expect(source).not.toContain("data-glass-active");
  });

  it("uses a legible translucent material with an opaque accessibility fallback", () => {
    const css = readFileSync(resolve(__dirname, "../app/globals.css"), "utf8");
    const surface = css.match(/\.panel-surface \{([\s\S]*?)\n\}/)?.[1];

    expect(surface).toBeTruthy();
    expect(surface).toContain("linear-gradient");
    expect(surface).toContain("backdrop-filter: saturate(150%) blur(34px)");
    expect(css).toContain("background: rgb(12 15 21)");
    expect(css).not.toContain("@utility ios-glass--sheet");
  });

  it.each(panels)("uses the shared visible 44px close control in %s", (panel) => {
    const source = readFileSync(resolve(__dirname, panel), "utf8");
    const close = source.match(/panel-action[\s\S]{0,160}aria-label="Close panel"/);

    expect(close, `${panel} close control`).toBeTruthy();
  });

  it("keeps Search's adjacent More and Close actions visually equal", () => {
    const source = readFileSync(resolve(__dirname, "SearchSheet.tsx"), "utf8");

    expect(source).toContain('aria-label="More options" className="panel-action press sm:hidden"');
    expect(source).toContain('className="panel-action press"\n            aria-label="Close panel"');
  });

  it("uses inset grouped lists for Search shortcuts instead of separate cards", () => {
    const source = readFileSync(resolve(__dirname, "SearchSheet.tsx"), "utf8");

    expect(source.split('panel-group divide-y divide-white/[0.06]')).toHaveLength(4);
    expect(source).not.toContain('px-3 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08]');
  });

  it("keeps route-header actions independently contrasted", () => {
    const line = readFileSync(resolve(__dirname, "LinePanel.tsx"), "utf8");
    const css = readFileSync(resolve(__dirname, "../app/globals.css"), "utf8");

    expect(line).toContain('className="panel-action panel-action--route press"');
    expect(css).toContain(".panel-action--route {");
    expect(css).toContain("rgb(0 0 0 / 0.62)");
  });
});
