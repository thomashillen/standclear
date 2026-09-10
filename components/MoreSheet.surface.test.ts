// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(__dirname, "MoreSheet.tsx"), "utf8");

describe("MoreSheet grouped reading surfaces", () => {
  it("groups related rows with subtle separators", () => {
    const groupedList =
      'overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.025] divide-y divide-white/[0.06]';

    expect(source.split(groupedList)).toHaveLength(3);
  });

  it("does not box each grouped row as its own card", () => {
    expect(
      source.match(/rounded-2xl bg-white\/\[0\.04\] hover:bg-white\/\[0\.08\]/g),
    ).toHaveLength(1);
  });

  it("keeps the commute explanation concise", () => {
    expect(source).toContain(
      "Pin Home and Work for faster route planning.",
    );
    expect(source).not.toContain("whichever direction");
  });
});
