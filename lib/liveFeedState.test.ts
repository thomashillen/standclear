// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  deriveLiveFeedState,
  liveFeedAnnouncement,
  type LiveFeedState,
} from "./liveFeedState";

describe("deriveLiveFeedState", () => {
  it("returns 'offline' when the device is offline regardless of other flags", () => {
    expect(deriveLiveFeedState(false, true, false, false)).toBe("offline");
    expect(deriveLiveFeedState(false, false, true, true)).toBe("offline");
    expect(deriveLiveFeedState(false, true, true, true)).toBe("offline");
  });

  it("returns 'connecting' when online but no data has arrived yet", () => {
    expect(deriveLiveFeedState(true, false, false, false)).toBe("connecting");
    // Even with degraded/stale flags raised — without data they're
    // meaningless. Cold boot reads as connecting.
    expect(deriveLiveFeedState(true, false, true, true)).toBe("connecting");
  });

  it("returns 'degraded' when feed health is degraded and data is present", () => {
    expect(deriveLiveFeedState(true, true, true, false)).toBe("degraded");
    // Degraded outranks stale — a consecutive-failure streak is a
    // stronger signal than a single old snapshot.
    expect(deriveLiveFeedState(true, true, true, true)).toBe("degraded");
  });

  it("returns 'stale' when the snapshot is old but the feed isn't degraded", () => {
    expect(deriveLiveFeedState(true, true, false, true)).toBe("stale");
  });

  it("returns 'live' in the calm-default happy path", () => {
    expect(deriveLiveFeedState(true, true, false, false)).toBe("live");
  });
});

describe("liveFeedAnnouncement", () => {
  it("returns a full sentence for every state", () => {
    const states: LiveFeedState[] = [
      "offline",
      "connecting",
      "degraded",
      "stale",
      "live",
    ];
    for (const state of states) {
      const msg = liveFeedAnnouncement(state);
      expect(msg.length).toBeGreaterThan(0);
      // Each announcement ends with a period so the screen-reader
      // pauses cleanly between it and any adjacent live region.
      expect(msg.endsWith(".")).toBe(true);
    }
  });

  it("omits the train count from every announcement", () => {
    // Train count changes every 8 s on a successful poll; including
    // it would make the live region fire on every tick. Guard the
    // intent with a digit check across all states.
    const states: LiveFeedState[] = [
      "offline",
      "connecting",
      "degraded",
      "stale",
      "live",
    ];
    for (const state of states) {
      expect(liveFeedAnnouncement(state)).not.toMatch(/\d/);
    }
  });

  it("uses distinct text for each state", () => {
    const messages = new Set(
      (["offline", "connecting", "degraded", "stale", "live"] as const).map(
        liveFeedAnnouncement,
      ),
    );
    expect(messages.size).toBe(5);
  });
});
