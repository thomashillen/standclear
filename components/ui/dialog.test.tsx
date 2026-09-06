import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "./dialog";

function renderDialog() {
  render(
    <Dialog>
      <DialogTrigger>Open information</DialogTrigger>
      <DialogContent>
        <DialogTitle>Information</DialogTitle>
        <DialogDescription>Current service information.</DialogDescription>
      </DialogContent>
    </Dialog>,
  );

  const trigger = screen.getByRole("button", { name: "Open information" });
  fireEvent.click(trigger);
  return trigger;
}

describe("DialogContent close control", () => {
  it("uses one focusable native button and dismisses when its outer target is clicked", async () => {
    const trigger = renderDialog();
    const close = screen.getByRole("button", { name: "Close" });

    expect(close).toBeInstanceOf(HTMLButtonElement);
    expect(close.getAttribute("type")).toBe("button");
    expect(close.tabIndex).toBe(0);
    close.focus();
    expect(document.activeElement).toBe(close);
    expect(close.querySelector("button, [role=button], [tabindex]")).toBeNull();

    fireEvent.click(close);
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("lets taps on the decorative circle dismiss through the same button", async () => {
    const trigger = renderDialog();
    const close = screen.getByRole("button", { name: "Close" });
    const circle = close.querySelector('span[aria-hidden="true"]');
    expect(circle).not.toBeNull();

    fireEvent.click(circle!);
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
