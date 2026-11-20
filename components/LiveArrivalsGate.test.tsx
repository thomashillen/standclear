import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const startLiveDemo = vi.hoisted(() => vi.fn());
vi.mock("@/lib/useTrains", () => ({ startLiveDemo }));

import { LiveArrivalsGate } from "./LiveArrivalsGate";

describe("LiveArrivalsGate", () => {
  it.each([false, true])("labels demo-off state and starts the bounded session (compact=%s)", (compact) => {
    startLiveDemo.mockClear();
    render(<LiveArrivalsGate compact={compact} />);
    expect(screen.getByText("Live arrivals are off to save data.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start 5-minute demo" }));
    expect(startLiveDemo).toHaveBeenCalledTimes(1);
  });
});
