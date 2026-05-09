// @vitest-environment node

import { describe, expect, it } from "vitest";
import { trainStaleness } from "./trainStaleness";

const NOW_MS = new Date("2026-05-09T18:00:00Z").getTime();
const NOW_SEC = NOW_MS / 1000;

describe("trainStaleness", () => {
  it("treats short reports as fresh and returns no label", () => {
    const r = trainStaleness(NOW_SEC - 30, NOW_MS, NOW_SEC);
    expect(r.stale).toBe(false);
    expect(r.veryStale).toBe(false);
    expect(r.label).toBeNull();
    expect(r.ageSec).toBe(30);
  });

  it("treats exactly 90s as fresh (boundary matches marker-fade `ageSec <= 90`)", () => {
    const r = trainStaleness(NOW_SEC - 90, NOW_MS, NOW_SEC);
    expect(r.stale).toBe(false);
    expect(r.label).toBeNull();
  });

  it("flags stale just past 90s and renders an 'Updated Nm ago' label", () => {
    const r = trainStaleness(NOW_SEC - 120, NOW_MS, NOW_SEC);
    expect(r.stale).toBe(true);
    expect(r.veryStale).toBe(false);
    expect(r.label).toBe("Updated 2m ago");
  });

  it("treats exactly 360s as soft-stale, not hard-stale (boundary is inclusive)", () => {
    const r = trainStaleness(NOW_SEC - 360, NOW_MS, NOW_SEC);
    expect(r.stale).toBe(true);
    expect(r.veryStale).toBe(false);
    expect(r.label).toBe("Updated 6m ago");
  });

  it("flips to a hard-stale label past 360s", () => {
    const r = trainStaleness(NOW_SEC - 600, NOW_MS, NOW_SEC);
    expect(r.stale).toBe(true);
    expect(r.veryStale).toBe(true);
    expect(r.label).toBe("Stale · 10m");
  });

  it("falls back to the snapshot's generatedAt when the per-vehicle timestamp is missing", () => {
    // No per-vehicle ts; snapshot itself is well past the hard-stale
    // floor. Should surface as hard-stale so a silent-feed outage
    // doesn't hide behind missing per-vehicle data.
    const r = trainStaleness(undefined, NOW_MS, NOW_SEC - 600);
    expect(r.stale).toBe(true);
    expect(r.veryStale).toBe(true);
    expect(r.label).toMatch(/^Stale · /);
  });

  it("clamps negative ages to zero (clock skew defense)", () => {
    // A vehicle timestamp in the future shouldn't crash the formatter
    // or surface a negative-minute label. Treat it as fresh.
    const r = trainStaleness(NOW_SEC + 30, NOW_MS, NOW_SEC);
    expect(r.ageSec).toBe(0);
    expect(r.stale).toBe(false);
    expect(r.label).toBeNull();
  });
});
