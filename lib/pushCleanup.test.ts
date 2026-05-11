// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

const sqlSpy = vi.hoisted(() => vi.fn());
vi.mock("./db", () => ({ getDb: () => sqlSpy }));

import { cleanupSubscriptions, _internals } from "./pushCleanup";

describe("cleanupSubscriptions", () => {
  beforeEach(() => {
    sqlSpy.mockReset();
  });

  it("deletes stale subscriptions and old dispatch_log rows", async () => {
    sqlSpy
      // First call: subscriptions DELETE
      .mockResolvedValueOnce([{ id: "s1" }, { id: "s2" }, { id: "s3" }])
      // Second call: dispatch_log DELETE
      .mockResolvedValueOnce([
        { subscription_id: "s1" },
        { subscription_id: "s4" },
      ]);

    const summary = await cleanupSubscriptions();
    expect(summary).toEqual({
      subscriptionsPurged: 3,
      dispatchLogPurged: 2,
    });
    expect(sqlSpy).toHaveBeenCalledTimes(2);
  });

  it("returns zero counts when nothing is stale", async () => {
    sqlSpy.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const summary = await cleanupSubscriptions();
    expect(summary).toEqual({
      subscriptionsPurged: 0,
      dispatchLogPurged: 0,
    });
  });

  it("uses the documented retention windows", () => {
    // Lock the magic numbers so a future commit that quietly changes
    // them shows up in code review.
    expect(_internals.STALE_UNSUBSCRIBED_DAYS).toBe(30);
    expect(_internals.STALE_DISPATCH_LOG_DAYS).toBe(14);
  });
});
