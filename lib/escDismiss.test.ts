// @vitest-environment node
import { describe, expect, it } from "vitest";
import { pickDismissTarget, type DismissablePanelState } from "./escDismiss";

const empty: DismissablePanelState = {
  searchOpen: false,
  stationOpen: false,
  lineOpen: false,
  nearbyOpen: false,
  moreOpen: false,
};

describe("pickDismissTarget", () => {
  it("returns null when nothing is open", () => {
    expect(pickDismissTarget(empty)).toBeNull();
  });

  it("dismisses SearchSheet ahead of every other panel", () => {
    expect(
      pickDismissTarget({
        ...empty,
        searchOpen: true,
        stationOpen: true,
        lineOpen: true,
        nearbyOpen: true,
        moreOpen: true,
      }),
    ).toBe("search");
  });

  it("dismisses station detail before line, nearby, and more", () => {
    expect(
      pickDismissTarget({
        ...empty,
        stationOpen: true,
        lineOpen: true,
        nearbyOpen: true,
        moreOpen: true,
      }),
    ).toBe("station");
  });

  it("dismisses line detail before nearby and more", () => {
    expect(
      pickDismissTarget({
        ...empty,
        lineOpen: true,
        nearbyOpen: true,
        moreOpen: true,
      }),
    ).toBe("line");
  });

  it("dismisses Nearby before More", () => {
    expect(
      pickDismissTarget({
        ...empty,
        nearbyOpen: true,
        moreOpen: true,
      }),
    ).toBe("nearby");
  });

  it("dismisses More when no other panel is open", () => {
    expect(
      pickDismissTarget({
        ...empty,
        moreOpen: true,
      }),
    ).toBe("more");
  });
});
