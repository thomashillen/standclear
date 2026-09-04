import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DragHandle } from "./DragHandle";

describe("DragHandle", () => {
  it("keeps the visible pill and flow height while adding centered 44px hit slop", () => {
    render(<DragHandle onTap={() => {}} ariaLabel="Collapse panel" />);

    const button = screen.getByRole("button", { name: "Collapse panel" });
    expect(button.className).toContain("h-7");
    expect(button.className).toContain("relative");
    expect(button.className).toContain("sm:hidden");

    const pill = button.querySelector("div");
    expect(pill?.className).toContain("w-9");
    expect(pill?.className).toContain("h-[5px]");

    const hitSlop = button.querySelector('span[aria-hidden="true"]');
    expect(hitSlop).not.toBeNull();
    for (const className of [
      "absolute",
      "left-1/2",
      "-translate-x-1/2",
      "top-0",
      "h-11",
      "w-[120px]",
      "z-10",
    ]) {
      expect(hitSlop?.className).toContain(className);
    }
  });

  it("forwards the accessible name and lets hit-slop clicks bubble to onTap", () => {
    const onTap = vi.fn();
    render(<DragHandle onTap={onTap} ariaLabel="Expand panel" />);

    const button = screen.getByRole("button", { name: "Expand panel" });
    const hitSlop = button.querySelector('span[aria-hidden="true"]');
    expect(hitSlop).not.toBeNull();

    fireEvent.click(hitSlop!);
    expect(onTap).toHaveBeenCalledOnce();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});
