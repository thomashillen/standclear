// @vitest-environment node
import { describe, expect, it } from "vitest";
import { formatAlertWindow } from "./alertWindow";

// All test reference times are unix seconds. We pin `now` to a known NYC
// wall-clock and compute target points off of it so the assertions are
// readable. EDT vs EST flips matter: Sat May 9 2026 is EDT (UTC-4), and
// Jan 11 2026 is EST (UTC-5). Each test picks a `now` whose tz offset
// matches the expected label.

// Saturday 2026-05-09 06:00 NYC (EDT, UTC-4) — 10:00 UTC.
const NOW_SAT_MAY_9_6AM = Date.UTC(2026, 4, 9, 10, 0, 0) / 1000;

describe("formatAlertWindow", () => {
  it("returns null when both timestamps are missing", () => {
    expect(
      formatAlertWindow({
        startTime: null,
        endTime: null,
        now: NOW_SAT_MAY_9_6AM,
      }),
    ).toBeNull();
  });

  it("returns null when endTime is in the past (defensive — the API filter should drop these)", () => {
    expect(
      formatAlertWindow({
        startTime: NOW_SAT_MAY_9_6AM - 3600,
        endTime: NOW_SAT_MAY_9_6AM - 60,
        now: NOW_SAT_MAY_9_6AM,
      }),
    ).toBeNull();
  });

  it("returns null when endTime is more than 14 days away (sentinel year-2099 'indefinite')", () => {
    expect(
      formatAlertWindow({
        startTime: NOW_SAT_MAY_9_6AM - 86_400,
        endTime: NOW_SAT_MAY_9_6AM + 15 * 86_400,
        now: NOW_SAT_MAY_9_6AM,
      }),
    ).toBeNull();
  });

  it("returns null for non-finite inputs", () => {
    expect(
      formatAlertWindow({
        startTime: null,
        endTime: Number.POSITIVE_INFINITY,
        now: NOW_SAT_MAY_9_6AM,
      }),
    ).toBeNull();
    expect(
      formatAlertWindow({
        startTime: null,
        endTime: 1000,
        now: Number.NaN,
      }),
    ).toBeNull();
  });

  it("renders 'Ends in N min' when less than an hour remains", () => {
    expect(
      formatAlertWindow({
        startTime: null,
        endTime: NOW_SAT_MAY_9_6AM + 45 * 60,
        now: NOW_SAT_MAY_9_6AM,
      }),
    ).toBe("Ends in 45 min");
  });

  it("rounds up sub-minute remaining to 1 min so the rider never sees 'Ends in 0 min'", () => {
    expect(
      formatAlertWindow({
        startTime: null,
        endTime: NOW_SAT_MAY_9_6AM + 30,
        now: NOW_SAT_MAY_9_6AM,
      }),
    ).toBe("Ends in 1 min");
  });

  it("renders same-NYC-day endings as a clock time, no weekday", () => {
    // 11 PM NYC on Sat May 9 2026 (EDT, UTC-4) = 03:00 UTC May 10.
    const endsAt11pm = Date.UTC(2026, 4, 10, 3, 0, 0) / 1000;
    expect(
      formatAlertWindow({
        startTime: null,
        endTime: endsAt11pm,
        now: NOW_SAT_MAY_9_6AM,
      }),
    ).toBe("Until 11 PM");
  });

  it("keeps the ':30' on non-hour endings", () => {
    // 6:30 PM NYC on Sat May 9 2026 (EDT) = 22:30 UTC.
    const endsAt630pm = Date.UTC(2026, 4, 9, 22, 30, 0) / 1000;
    expect(
      formatAlertWindow({
        startTime: null,
        endTime: endsAt630pm,
        now: NOW_SAT_MAY_9_6AM,
      }),
    ).toBe("Until 6:30 PM");
  });

  it("renders next-NYC-day endings with the weekday prefix", () => {
    // 5 AM NYC on Mon May 11 2026 (EDT) = 09:00 UTC. From Sat 6 AM that's
    // dayDelta=2, so still inside the within-a-week branch.
    const endsAt5amMon = Date.UTC(2026, 4, 11, 9, 0, 0) / 1000;
    expect(
      formatAlertWindow({
        startTime: null,
        endTime: endsAt5amMon,
        now: NOW_SAT_MAY_9_6AM,
      }),
    ).toBe("Until Mon 5 AM");
  });

  it("renders endings within a week with the weekday prefix", () => {
    // 11 PM NYC on Fri May 15 2026 (EDT) = 03:00 UTC May 16. dayDelta=6.
    const endsAt11pmFri = Date.UTC(2026, 4, 16, 3, 0, 0) / 1000;
    expect(
      formatAlertWindow({
        startTime: null,
        endTime: endsAt11pmFri,
        now: NOW_SAT_MAY_9_6AM,
      }),
    ).toBe("Until Fri 11 PM");
  });

  it("renders endings beyond a week with a month/day label", () => {
    // 5 AM NYC on Tue May 19 2026 (EDT) = 09:00 UTC. dayDelta=10.
    const endsAt5amMay19 = Date.UTC(2026, 4, 19, 9, 0, 0) / 1000;
    expect(
      formatAlertWindow({
        startTime: null,
        endTime: endsAt5amMay19,
        now: NOW_SAT_MAY_9_6AM,
      }),
    ).toBe("Until May 19");
  });

  it("renders future-scheduled alerts with a 'Starts' prefix", () => {
    // 11 PM NYC on Fri May 8 2026 — wait that's the past. Use a clearly
    // future start. 5 AM NYC on Sun May 10 (EDT) = 09:00 UTC.
    const startsAt5amSun = Date.UTC(2026, 4, 10, 9, 0, 0) / 1000;
    expect(
      formatAlertWindow({
        startTime: startsAt5amSun,
        endTime: startsAt5amSun + 3600,
        now: NOW_SAT_MAY_9_6AM,
      }),
    ).toBe("Starts Sun 5 AM");
  });

  it("ignores startTime when the alert is already active", () => {
    // start was an hour ago, end is in 30 minutes — render the end, not
    // the start.
    expect(
      formatAlertWindow({
        startTime: NOW_SAT_MAY_9_6AM - 3600,
        endTime: NOW_SAT_MAY_9_6AM + 30 * 60,
        now: NOW_SAT_MAY_9_6AM,
      }),
    ).toBe("Ends in 30 min");
  });

  it("renders consistently across an EST/EDT seam by pinning to NYC tz", () => {
    // Pin `now` to mid-January (EST, UTC-5) and an end-time later that
    // day, and confirm the wall-clock label matches NYC wall time, not
    // the test runner's local tz.
    const nowSatJan10Noon = Date.UTC(2026, 0, 10, 17, 0, 0) / 1000; // 12 PM NYC EST
    const endsAt9pmJan10 = Date.UTC(2026, 0, 11, 2, 0, 0) / 1000; // 9 PM NYC EST
    expect(
      formatAlertWindow({
        startTime: null,
        endTime: endsAt9pmJan10,
        now: nowSatJan10Noon,
      }),
    ).toBe("Until 9 PM");
  });
});
