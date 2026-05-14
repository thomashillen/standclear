// @vitest-environment node
import { describe, it, expect } from "vitest";
import { cn } from "./utils";

// `cn` is the class-composition helper every component reaches for
// when conditionally building a className. It composes `clsx` (which
// flattens arrays / drops falsy values) with `twMerge` (which resolves
// duplicate Tailwind utilities to the last-wins variant — the contract
// every `... ${active && "bg-foo"} ...` site relies on). The order is
// load-bearing: `twMerge(clsx(...))` runs clsx first to normalize the
// inputs, then twMerge to dedup. Reversed, twMerge would see a single
// pre-joined string and pass it through without per-token comparison,
// so the override behavior would silently break.
describe("cn", () => {
  it("joins multiple class strings with single spaces", () => {
    expect(cn("a", "b", "c")).toBe("a b c");
  });

  it("drops falsy values (undefined / null / false / empty string)", () => {
    expect(cn("a", undefined, null, false, "", "b")).toBe("a b");
  });

  it("supports conditional patterns (short-circuit && idiom)", () => {
    const active = false;
    const disabled = true;
    expect(cn("base", active && "is-active", disabled && "is-disabled")).toBe(
      "base is-disabled",
    );
  });

  it("flattens arrays (clsx pass-through)", () => {
    expect(cn(["a", "b"], "c")).toBe("a b c");
    expect(cn(["a", ["b", "c"]], "d")).toBe("a b c d");
  });

  it("collapses object syntax to keys with truthy values", () => {
    expect(cn({ a: true, b: false, c: true })).toBe("a c");
  });

  it("deduplicates conflicting Tailwind utilities — last wins (twMerge)", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
    expect(cn("bg-white", "bg-black")).toBe("bg-black");
  });

  it("preserves non-conflicting utilities alongside overrides", () => {
    expect(cn("p-2 text-sm", "p-4")).toBe("text-sm p-4");
  });

  it("respects responsive + state variant boundaries (different scopes don't override)", () => {
    expect(cn("p-2", "sm:p-4")).toBe("p-2 sm:p-4");
    expect(cn("hover:p-2", "p-4")).toBe("hover:p-2 p-4");
  });

  it("returns an empty string when given no truthy inputs", () => {
    expect(cn()).toBe("");
    expect(cn(undefined, null, false, "")).toBe("");
  });
});
