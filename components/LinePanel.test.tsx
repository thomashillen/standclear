import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { StopRow } from "./LinePanel";
import { trainStaleness } from "@/lib/trainStaleness";

const NOW_MS = new Date("2026-05-14T19:00:00Z").getTime();
const NOW_SEC = NOW_MS / 1000;

const lineColor = "#EE352E"; // red trunk (1/2/3)
const nBadge = { id: "1", color: lineColor, textColor: "white" as const };
const sBadge = { id: "2", color: lineColor, textColor: "white" as const };

const defaults = {
  stopId: "120",
  stopName: "Times Sq–42 St",
  lineColor,
  trainHere: false,
  hasData: true,
  showConnector: true,
  onTap: vi.fn(),
};

describe("StopRow staleness chrome", () => {
  it("keeps the ETA gray + plain aria-label when fresh", () => {
    const fresh = trainStaleness(NOW_SEC - 20, NOW_MS, NOW_SEC);
    render(
      <StopRow
        {...defaults}
        nEtaStr="3 min"
        sEtaStr="5 min"
        nBadge={nBadge}
        sBadge={sBadge}
        nStaleness={fresh}
        sStaleness={fresh}
      />,
    );
    const nChip = screen.getByLabelText("Northbound 3 min");
    const sChip = screen.getByLabelText("Southbound 5 min");
    // Fresh: gray ETA text, no amber tint, no "minute" suffix.
    expect(nChip.querySelector(".text-gray-200")).toBeTruthy();
    expect(nChip.querySelector(".text-amber-300\\/90")).toBeNull();
    expect(sChip.querySelector(".text-gray-200")).toBeTruthy();
    expect(sChip.querySelector(".text-amber-300\\/90")).toBeNull();
  });

  it("amber-tints the N chip + names minutes in aria when N's train is stale", () => {
    const fresh = trainStaleness(NOW_SEC - 20, NOW_MS, NOW_SEC);
    const stale = trainStaleness(NOW_SEC - 4 * 60, NOW_MS, NOW_SEC);
    render(
      <StopRow
        {...defaults}
        nEtaStr="3 min"
        sEtaStr="5 min"
        nBadge={nBadge}
        sBadge={sBadge}
        nStaleness={stale}
        sStaleness={fresh}
      />,
    );
    const nChip = screen.getByLabelText(
      "Northbound 3 min, position last updated 4 minutes ago",
    );
    expect(nChip.querySelector(".text-amber-300\\/90")).toBeTruthy();
    // S remains fresh — gray text, plain label.
    const sChip = screen.getByLabelText("Southbound 5 min");
    expect(sChip.querySelector(".text-gray-200")).toBeTruthy();
  });

  it("amber-tints only the S chip when only S is stale", () => {
    const fresh = trainStaleness(NOW_SEC - 20, NOW_MS, NOW_SEC);
    const stale = trainStaleness(NOW_SEC - 7 * 60, NOW_MS, NOW_SEC);
    render(
      <StopRow
        {...defaults}
        nEtaStr="2 min"
        sEtaStr="8 min"
        nStaleness={fresh}
        sStaleness={stale}
      />,
    );
    const sChip = screen.getByLabelText(
      "Southbound 8 min, position last updated 7 minutes ago",
    );
    expect(sChip.querySelector(".text-amber-300\\/90")).toBeTruthy();
    const nChip = screen.getByLabelText("Northbound 2 min");
    expect(nChip.querySelector(".text-gray-200")).toBeTruthy();
  });

  it("treats null staleness (arrivals-only trip without paired vehicle) as fresh", () => {
    // The LinePanel passes `null` when the predicting trip has no
    // VehiclePosition in the snapshot — by definition the prediction
    // is as fresh as the poll itself, so no amber tint should land.
    render(
      <StopRow
        {...defaults}
        nEtaStr="4 min"
        sEtaStr="9 min"
        nStaleness={null}
        sStaleness={null}
      />,
    );
    const nChip = screen.getByLabelText("Northbound 4 min");
    expect(nChip.querySelector(".text-amber-300\\/90")).toBeNull();
    expect(nChip.querySelector(".text-gray-200")).toBeTruthy();
  });

  it("speaks `trainStaleness.ariaLabel` verbatim — no inline re-derivation", () => {
    // `etaChipAria` no longer rounds `ageSec` itself; the spoken phrase
    // (incl. its rounded-minute count and singular/plural wording) is
    // single-sourced in `trainStaleness`. Pin the pass-through with a
    // synthetic object whose `ariaLabel` deliberately disagrees with
    // its `ageSec`: if the chip still derived from `ageSec` it would
    // say "5 minutes"; the contract is that it echoes `ariaLabel`. The
    // singular "1 minute" wording rides along, documenting that the
    // grammar now lives in the helper, not here.
    const synthetic = {
      stale: true,
      veryStale: false,
      label: "Updated 1m ago",
      ariaLabel: "position last updated 1 minute ago",
      ageSec: 300,
    };
    render(
      <StopRow
        {...defaults}
        nEtaStr="2 min"
        nStaleness={synthetic}
      />,
    );
    expect(
      screen.getByLabelText("Northbound 2 min, position last updated 1 minute ago"),
    ).toBeTruthy();
  });

  it("uses plural 'minutes' past the 1-minute boundary", () => {
    const stale = trainStaleness(NOW_SEC - 5 * 60, NOW_MS, NOW_SEC);
    render(
      <StopRow
        {...defaults}
        nEtaStr="3 min"
        nStaleness={stale}
      />,
    );
    expect(
      screen.getByLabelText("Northbound 3 min, position last updated 5 minutes ago"),
    ).toBeTruthy();
  });

  it("renders the empty state when both directions are absent", () => {
    render(<StopRow {...defaults} />);
    expect(screen.getByText("No upcoming trains")).toBeTruthy();
  });
});
