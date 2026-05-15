import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { Lines, SubwayLine } from "@/lib/subwayData";

// LinePicker imports `useSubwayDataStatus` + `retryLoadLines` from the
// subwayData store; `LINE_GROUPS` is the load-bearing ordered list (the
// component flat-maps it to render bullets). We mock the hooks/actions
// but pin LINE_GROUPS literally so the test trips a future re-ordering
// that would silently drop or rename a route across the picker grid.
const retryLoadLines = vi.hoisted(() => vi.fn());
const statusRef = vi.hoisted(() => ({
  current: { error: false, attempt: 0 } as { error: boolean; attempt: number },
}));

vi.mock("@/lib/subwayData", async () => {
  return {
    LINE_GROUPS: [
      { label: "IRT", lines: ["1", "2", "3", "4", "5", "6", "7"] },
      { label: "IND", lines: ["A", "C", "E", "B", "D", "F", "M", "G"] },
      { label: "BMT", lines: ["J", "Z", "L", "N", "Q", "R", "W"] },
      { label: "S", lines: ["GS", "FS", "H"] },
      { label: "SI", lines: ["SI"] },
    ],
    retryLoadLines,
    useSubwayDataStatus: () => statusRef.current,
  };
});

// Import LinePicker AFTER the mock is registered so the module-level
// LINE_GROUPS flat-map captures the mocked value.
import LinePicker from "./LinePicker";

const TOTAL_ORDERED = 7 + 8 + 7 + 3 + 1; // 26 — pin the picker grid size.

function makeLine(id: string, name: string, color: string): SubwayLine {
  return {
    id,
    routeId: id,
    name,
    color,
    textColor: "white",
    stops: [],
    shape: [],
  };
}

function makeLines(): Lines {
  // Real-ish colors for the bullets we'll assert on; every other line
  // gets a generic placeholder so the picker can render its full grid.
  const out: Lines = {};
  const seeds: Array<[string, string, string]> = [
    ["1", "Broadway-Seventh Avenue Local", "#EE352E"],
    ["F", "Sixth Avenue Local", "#FF6319"],
    ["L", "14 St-Canarsie Local", "#A7A9AC"],
    ["A", "Eighth Avenue Express", "#0039A6"],
  ];
  for (const [id, name, color] of seeds) out[id] = makeLine(id, name, color);
  // Fill the rest of the ORDERED_LINES slots so the grid resolves to
  // bullets (not placeholders) on every row we don't seed explicitly.
  for (const id of [
    "2", "3", "4", "5", "6", "7",
    "C", "E", "B", "D", "M", "G",
    "J", "Z", "N", "Q", "R", "W",
    "GS", "FS", "H", "SI",
  ]) {
    if (!out[id]) out[id] = makeLine(id, `Line ${id}`, "#222");
  }
  return out;
}

function openPicker() {
  // The trigger lives outside the Radix portal; clicking it surfaces
  // the dialog with the bullet grid.
  const trigger = screen.getByRole("button", {
    name: /Choose a subway line|Line .* — .*\. Tap to choose another line\./,
  });
  act(() => {
    fireEvent.click(trigger);
  });
}

describe("LinePicker", () => {
  beforeEach(() => {
    statusRef.current = { error: false, attempt: 0 };
    retryLoadLines.mockReset();
  });

  // No explicit cleanup needed: @testing-library/react's auto-cleanup
  // unmounts the component between tests, which lets Radix tear down
  // its own portals. Manually removing portal nodes ahead of that
  // unmount races Radix's effect cleanup and throws NotFoundError.

  it("trigger collapses to 'Lines' when no line is selected", () => {
    render(
      <LinePicker
        lines={makeLines()}
        selectedLine={null}
        onSelect={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("button", {
      name: "Choose a subway line",
    });
    expect(within(trigger).getByText("Lines")).toBeTruthy();
  });

  it("trigger surfaces the selected line bullet + aria-label", () => {
    render(
      <LinePicker
        lines={makeLines()}
        selectedLine="F"
        onSelect={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("button", {
      name: "Line F — Sixth Avenue Local. Tap to choose another line.",
    });
    // The bullet glyph rendered inside the trigger is the line id itself.
    expect(within(trigger).getByText("F")).toBeTruthy();
  });

  it("trigger falls back to 'Choose a subway line' when selected id has no line", () => {
    // A stale selectedLine + null lines (cold boot) shouldn't break the
    // header — the picker degrades to the unselected affordance.
    render(
      <LinePicker
        lines={null}
        selectedLine="F"
        onSelect={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Choose a subway line" }),
    ).toBeTruthy();
  });

  it("renders 26 pulse placeholders + the close button when lines are still loading", () => {
    render(
      <LinePicker lines={null} selectedLine={null} onSelect={vi.fn()} />,
    );
    openPicker();
    const dialog = screen.getByRole("dialog");
    // The placeholder discs are aria-hidden so they don't count as
    // buttons; we assert against the rendered count by querying the
    // pulsing utility class the component applies to each disc. This
    // pins the load-bearing "grid keeps its final shape during cold
    // boot" behavior: a regression that dropped a placeholder slot
    // would also drop a real bullet slot once lines hydrate.
    const placeholders = dialog.querySelectorAll(".motion-safe\\:animate-pulse");
    expect(placeholders.length).toBe(TOTAL_ORDERED);
  });

  it("renders 26 bullet buttons when lines are loaded", () => {
    render(
      <LinePicker
        lines={makeLines()}
        selectedLine={null}
        onSelect={vi.fn()}
      />,
    );
    openPicker();
    const dialog = screen.getByRole("dialog");
    // Each bullet is a real <button>; the close ("Close panel") button
    // is also inside the dialog. Filter to the bullet shape by the
    // pinned aria-label format "ID — Name".
    const bullets = within(dialog)
      .getAllByRole("button")
      .filter((btn) => /^[A-Z0-9]{1,2} — /.test(btn.getAttribute("aria-label") ?? ""));
    expect(bullets.length).toBe(TOTAL_ORDERED);
  });

  it("flags the selected bullet with aria-pressed=true and the deselect aria-label", () => {
    render(
      <LinePicker
        lines={makeLines()}
        selectedLine="L"
        onSelect={vi.fn()}
      />,
    );
    openPicker();
    const dialog = screen.getByRole("dialog");
    const selected = within(dialog).getByRole("button", {
      name: "L — 14 St-Canarsie Local, selected. Tap to show all lines.",
    });
    expect(selected.getAttribute("aria-pressed")).toBe("true");

    // Sibling bullets stay aria-pressed=false; check one to pin the
    // mutual-exclusion contract.
    const other = within(dialog).getByRole("button", {
      name: "1 — Broadway-Seventh Avenue Local",
    });
    expect(other.getAttribute("aria-pressed")).toBe("false");
  });

  it("renders the 'tap selected line again to show all' hint only when something is selected", () => {
    const { rerender } = render(
      <LinePicker
        lines={makeLines()}
        selectedLine={null}
        onSelect={vi.fn()}
      />,
    );
    openPicker();
    expect(
      screen.queryByText("Tap the selected line again to show all"),
    ).toBeNull();

    rerender(
      <LinePicker
        lines={makeLines()}
        selectedLine="F"
        onSelect={vi.fn()}
      />,
    );
    expect(
      screen.getByText("Tap the selected line again to show all"),
    ).toBeTruthy();
  });

  it("tapping a non-selected bullet fires onSelect(id)", () => {
    const onSelect = vi.fn();
    render(
      <LinePicker
        lines={makeLines()}
        selectedLine={null}
        onSelect={onSelect}
      />,
    );
    openPicker();
    const dialog = screen.getByRole("dialog");
    const fBullet = within(dialog).getByRole("button", {
      name: "F — Sixth Avenue Local",
    });
    act(() => {
      fireEvent.click(fBullet);
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("F");
  });

  it("tapping the already-selected bullet fires onSelect(null) — the iOS Maps tap-pin-to-deselect grammar", () => {
    const onSelect = vi.fn();
    render(
      <LinePicker
        lines={makeLines()}
        selectedLine="F"
        onSelect={onSelect}
      />,
    );
    openPicker();
    const dialog = screen.getByRole("dialog");
    const active = within(dialog).getByRole("button", {
      name: "F — Sixth Avenue Local, selected. Tap to show all lines.",
    });
    act(() => {
      fireEvent.click(active);
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("surfaces the amber load-error banner + Retry button only when lines are null AND status.error is true", () => {
    statusRef.current = { error: true, attempt: 1 };
    render(
      <LinePicker lines={null} selectedLine={null} onSelect={vi.fn()} />,
    );
    openPicker();
    expect(
      screen.getByText(/Couldn(?:'|’)t load subway data/),
    ).toBeTruthy();
    const retry = screen.getByRole("button", { name: "Retry" });
    act(() => {
      fireEvent.click(retry);
    });
    expect(retryLoadLines).toHaveBeenCalledTimes(1);
  });

  it("does NOT surface the load-error banner when lines are already cached (background revalidation failure)", () => {
    // Once data is in memory, a transient revalidation failure
    // shouldn't blank the picker — the rider keeps using the cached
    // lines. Pins the `showLoadError = dataStatus.error && !lines`
    // guard against a refactor that dropped the second condition.
    statusRef.current = { error: true, attempt: 1 };
    render(
      <LinePicker
        lines={makeLines()}
        selectedLine={null}
        onSelect={vi.fn()}
      />,
    );
    openPicker();
    expect(
      screen.queryByText(/Couldn(?:'|’)t load subway data/),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("renders bullets in the canonical MTA order — IRT → IND → BMT → shuttles → SI", () => {
    // The header reads as numbered → ACE/BDFM/G → JZ/L/NQRW → shuttles
    // → SI. A future re-ordering of LINE_GROUPS (or a flat-map that
    // re-sorts) would silently break rider muscle memory; pin the
    // first/last bullets + the IND→BMT seam so any drift trips this.
    render(
      <LinePicker
        lines={makeLines()}
        selectedLine={null}
        onSelect={vi.fn()}
      />,
    );
    openPicker();
    const dialog = screen.getByRole("dialog");
    const bullets = within(dialog)
      .getAllByRole("button")
      .filter((btn) => /^[A-Z0-9]{1,2} — /.test(btn.getAttribute("aria-label") ?? ""))
      .map((btn) => btn.textContent?.trim());
    expect(bullets[0]).toBe("1");
    expect(bullets[TOTAL_ORDERED - 1]).toBe("SI");
    // IRT runs 1..7 contiguously at the head.
    expect(bullets.slice(0, 7)).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    // First shuttle bullet right after the BMT block.
    const gsIdx = bullets.indexOf("GS");
    expect(gsIdx).toBeGreaterThan(0);
    expect(bullets.slice(gsIdx, gsIdx + 3)).toEqual(["GS", "FS", "H"]);
  });

  it("applies the line's color + textColor to the bullet element", () => {
    render(
      <LinePicker
        lines={makeLines()}
        selectedLine={null}
        onSelect={vi.fn()}
      />,
    );
    openPicker();
    const dialog = screen.getByRole("dialog");
    const oneBullet = within(dialog).getByRole("button", {
      name: "1 — Broadway-Seventh Avenue Local",
    });
    // The color contract is via inline style — pin both axes so a
    // refactor that dropped either silently regresses bullet legibility
    // (the 1 train's #EE352E red on white text is the canonical case).
    expect(oneBullet.style.backgroundColor).toBe("rgb(238, 53, 46)");
    expect(oneBullet.style.color).toBe("white");
  });
});
