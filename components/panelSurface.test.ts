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
  it.each(panels)("keeps %s on the steady shared reading surface", (panel) => {
    const source = readFileSync(resolve(__dirname, panel), "utf8");

    expect(source).toContain("panel-surface");
    expect(source).not.toContain("ios-glass--sheet");
    expect(source).not.toContain("data-glass-active");
  });

  it("does not add backdrop blur to the reading surface", () => {
    const css = readFileSync(resolve(__dirname, "../app/globals.css"), "utf8");
    const surface = css.match(/\.panel-surface \{([\s\S]*?)\n\}/)?.[1];

    expect(surface).toBeTruthy();
    expect(surface).toContain("background-color: rgb(15 18 24 / 0.97)");
    expect(surface).not.toContain("position:");
    expect(surface).not.toContain("backdrop-filter");
    expect(css).not.toContain("@utility ios-glass--sheet");
  });
});
