// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("reactive glass removal", () => {
  it("does not mount or retain the reactive glass controller", () => {
    expect(existsSync(resolve(__dirname, "GlassTilt.tsx"))).toBe(false);
    expect(read("app/layout.tsx")).not.toContain("GlassTilt");
  });

  it("keeps compact glass highlights static without tilt variables", () => {
    const css = read("app/globals.css");

    expect(css).not.toContain("--glass-tilt-");
    expect(css).not.toContain("device tilt");
    expect(css).toContain("140% 110% at 50% 0%");
  });

  it("does not offer a motion-permission control in More", () => {
    const more = read("components/MoreSheet.tsx");

    expect(more).not.toContain("Reactive glass on tilt");
    expect(more).not.toContain("DeviceOrientation");
  });
});
