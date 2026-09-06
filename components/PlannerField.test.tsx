import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PlannerField } from "./panelUI";
import type { StationEntry } from "@/lib/stopsIndex";

const station: StationEntry = {
  stopId: "L03",
  stopIds: ["L03"],
  name: "1 Av",
  lat: 40.730953,
  lng: -73.981628,
  routes: [],
};

describe("PlannerField editing and clearing", () => {
  it.each(["From", "To"])("exposes separate native %s activation and clear actions", (label) => {
    const onTap = vi.fn();
    const onClear = vi.fn();
    render(
      <PlannerField label={label} station={station} active={false} query=""
        onQueryChange={vi.fn()} placeholder="Search station" accent="sky"
        onTap={onTap} onClear={onClear} />,
    );

    const activate = screen.getByRole("button", { name: `${label}: 1 Av` });
    const clear = screen.getByRole("button", { name: `Clear ${label.toLowerCase()}` });
    // Native siblings give keyboard and assistive-tech users two actions.
    // A role=button span inside the activation button is not equivalent.
    expect(clear.tagName).toBe("BUTTON");
    expect(clear.tabIndex).toBe(0);
    expect(activate.contains(clear)).toBe(false);
    clear.focus();
    expect(document.activeElement).toBe(clear);
    fireEvent.click(clear);
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onTap).not.toHaveBeenCalled();
    fireEvent.click(activate);
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("offers activation without a clear action for an empty endpoint", () => {
    const onTap = vi.fn();
    render(
      <PlannerField label="To" station={null} active={false} query=""
        onQueryChange={vi.fn()} placeholder="Search destination" accent="sky"
        onTap={onTap} onClear={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "To: Search destination" }));
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Clear to" })).toBeNull();
  });

  it("returns focus to the input when clearing a query, without clearing the selected endpoint", () => {
    const onClear = vi.fn();
    function EditingField() {
      const [query, setQuery] = useState("Union");
      return (
        <PlannerField label="From" station={station} active query={query}
          onQueryChange={setQuery} placeholder="Search origin" accent="emerald"
          onTap={vi.fn()} onClear={onClear} />
      );
    }
    render(<EditingField />);
    const input = screen.getByRole("textbox", { name: "From station search" }) as HTMLInputElement;
    const clear = screen.getByRole("button", { name: "Clear from search" });
    clear.focus();
    fireEvent.click(clear);
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
    expect(screen.queryByRole("button", { name: "Clear from search" })).toBeNull();
    expect(onClear).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "Grand" } });
    expect(input.value).toBe("Grand");
  });
});
