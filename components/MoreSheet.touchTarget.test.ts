// @vitest-environment node
//
// MoreSheet's "Close panel" button is the primary dismiss for the More
// sheet — tapped one-handed on a moving train, the exact case
// principle #3 ("touch targets ≥ 44px, no actions that require
// accuracy under jostle") exists to protect. This pins it at the
// 44px HIG minimum and rejects the old sub-44px size.
//
// Read from source rather than rendered: MoreSheet pulls in useLines,
// useAlerts, useCommute, useSheetDrag, the AlertsDialog, and the Radix
// Dialog primitives, so mounting it in a node/jsdom runner means
// standing up (and mocking) that whole graph for a single class-list
// assertion — not worth it for a Tailwind sizing contract. Same
// source-string approach as PR #132's marketingTitles test / PR #127's
// sitemap test: read the truth straight out of the file.
//
// The assertion is scoped to the close button's unique className
// signature (`opacity-85 hover:opacity-100 <size> -mr-1`) rather than a
// blanket "no w-9 h-9 anywhere" — MoreSheet legitimately uses w-9 h-9
// on the decorative icon-container spans inside list rows, and those
// are not interactive dismiss controls, so flagging them would be a
// false positive. The companion render-based tests for the sibling
// dismiss controls live in LinePicker.test.tsx and
// InstallPrompt.test.tsx (those components have test harnesses).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(resolve(__dirname, "MoreSheet.tsx"), "utf8");

describe("MoreSheet close-button touch target", () => {
  it("still renders a 'Close panel' control", () => {
    // If the dismiss is renamed or removed, the size contract below is
    // meaningless — pin the aria-label so the test fails loudly rather
    // than silently passing against a button that no longer exists.
    expect(SRC).toContain('aria-label="Close panel"');
  });

  it("sizes the close button to the 44px HIG minimum (principle #3)", () => {
    expect(SRC).toContain("opacity-85 hover:opacity-100 w-11 h-11 -mr-1");
  });

  it("no longer carries the old sub-44px close-button size", () => {
    expect(SRC).not.toContain("opacity-85 hover:opacity-100 w-9 h-9 -mr-1");
  });
});
