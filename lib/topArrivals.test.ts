// @vitest-environment node
import { describe, it, expect } from "vitest";
import { pickBalancedArrivals } from "./topArrivals";

const a = (eta: number, direction: "N" | "S", id = `t-${direction}-${eta}`) => ({
  eta,
  direction,
  tripId: id,
});

const NOW = 1_700_000_000;

describe("pickBalancedArrivals", () => {
  it("returns [] for empty input", () => {
    expect(pickBalancedArrivals([], 3, NOW)).toEqual([]);
  });

  it("returns [] when count <= 0", () => {
    expect(pickBalancedArrivals([a(NOW + 60, "N")], 0, NOW)).toEqual([]);
  });

  it("returns input when there are <= count arrivals", () => {
    const arr = [a(NOW + 60, "N"), a(NOW + 120, "S")];
    expect(pickBalancedArrivals(arr, 3, NOW)).toEqual(arr);
  });

  it("falls back to soonest when count < 2 (single slot can't balance)", () => {
    const arr = [a(NOW + 60, "N"), a(NOW + 120, "S"), a(NOW + 180, "N")];
    const picked = pickBalancedArrivals(arr, 1, NOW);
    expect(picked).toHaveLength(1);
    expect(picked[0].eta).toBe(NOW + 60);
    expect(picked[0].direction).toBe("N");
  });

  it("falls back to soonest when only one direction has arrivals", () => {
    const arr = [
      a(NOW + 60, "N", "n1"),
      a(NOW + 120, "N", "n2"),
      a(NOW + 180, "N", "n3"),
      a(NOW + 240, "N", "n4"),
    ];
    const picked = pickBalancedArrivals(arr, 3, NOW);
    expect(picked.map((p) => p.tripId)).toEqual(["n1", "n2", "n3"]);
  });

  it("returns naturally balanced top-N untouched", () => {
    const arr = [
      a(NOW + 60, "N", "n1"),
      a(NOW + 120, "S", "s1"),
      a(NOW + 180, "N", "n2"),
      a(NOW + 240, "S", "s2"),
    ];
    const picked = pickBalancedArrivals(arr, 3, NOW);
    expect(picked.map((p) => p.tripId)).toEqual(["n1", "s1", "n2"]);
  });

  it("forces the secondary direction in when the top slice is single-direction", () => {
    // Northbound rush: the next three trains are all uptown. The
    // soonest Southbound is six minutes out, well within horizon —
    // we want the rider to see "yes, downtown is also coming."
    const arr = [
      a(NOW + 60, "N", "n1"),
      a(NOW + 120, "N", "n2"),
      a(NOW + 180, "N", "n3"),
      a(NOW + 360, "S", "s1"),
      a(NOW + 720, "S", "s2"),
    ];
    const picked = pickBalancedArrivals(arr, 3, NOW);
    expect(picked.map((p) => p.tripId)).toEqual(["n1", "n2", "s1"]);
    // Sorted by ETA so the row reads chronologically.
    for (let i = 1; i < picked.length; i++) {
      expect(picked[i].eta).toBeGreaterThanOrEqual(picked[i - 1].eta);
    }
  });

  it("works symmetrically when the dominant direction is Southbound", () => {
    const arr = [
      a(NOW + 60, "S", "s1"),
      a(NOW + 120, "S", "s2"),
      a(NOW + 180, "S", "s3"),
      a(NOW + 600, "N", "n1"),
    ];
    const picked = pickBalancedArrivals(arr, 3, NOW);
    expect(picked.map((p) => p.tripId)).toEqual(["s1", "s2", "n1"]);
  });

  it("does NOT bump a near-term primary for a far-out secondary (beyond horizon)", () => {
    // Soonest Southbound is 35 min out — beyond the 30-min default
    // horizon. We keep the three uptown arrivals because a rider on
    // the platform is more likely acting on the 1/2/3-min uptown
    // train than budgeting against a 35-min downtown wait.
    const arr = [
      a(NOW + 60, "N", "n1"),
      a(NOW + 120, "N", "n2"),
      a(NOW + 180, "N", "n3"),
      a(NOW + 35 * 60, "S", "s1"),
    ];
    const picked = pickBalancedArrivals(arr, 3, NOW);
    expect(picked.map((p) => p.tripId)).toEqual(["n1", "n2", "n3"]);
  });

  it("respects a custom horizon", () => {
    const arr = [
      a(NOW + 60, "N", "n1"),
      a(NOW + 120, "N", "n2"),
      a(NOW + 180, "N", "n3"),
      a(NOW + 10 * 60, "S", "s1"),
    ];
    // 5-min horizon: 10-min Southbound is too far out, no balance.
    expect(
      pickBalancedArrivals(arr, 3, NOW, 5 * 60).map((p) => p.tripId),
    ).toEqual(["n1", "n2", "n3"]);
    // 15-min horizon: bring it in.
    expect(
      pickBalancedArrivals(arr, 3, NOW, 15 * 60).map((p) => p.tripId),
    ).toEqual(["n1", "n2", "s1"]);
  });

  it("re-sorts unsorted input defensively", () => {
    const arr = [
      a(NOW + 240, "N", "n2"),
      a(NOW + 60, "N", "n1"),
      a(NOW + 600, "S", "s1"),
      a(NOW + 120, "N", "n3"),
    ];
    const picked = pickBalancedArrivals(arr, 3, NOW);
    expect(picked.map((p) => p.tripId)).toEqual(["n1", "n3", "s1"]);
  });

  it("replaces the *latest* primary slot, preserving the two soonest", () => {
    const arr = [
      a(NOW + 60, "N", "n1"),
      a(NOW + 120, "N", "n2"),
      a(NOW + 180, "N", "n3"),
      a(NOW + 360, "S", "s1"),
    ];
    const picked = pickBalancedArrivals(arr, 3, NOW);
    expect(picked.map((p) => p.tripId)).toContain("n1");
    expect(picked.map((p) => p.tripId)).toContain("n2");
    expect(picked.map((p) => p.tripId)).toContain("s1");
    expect(picked.map((p) => p.tripId)).not.toContain("n3");
  });
});
