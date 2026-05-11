// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

process.env.NEXT_PUBLIC_VAPID_KEY = "BPx-placeholder";
process.env.VAPID_PRIVATE_KEY = "priv-placeholder";
process.env.VAPID_SUBJECT = "mailto:test@example.com";

const sendNotificationSpy = vi.hoisted(() => vi.fn());
const setVapidDetailsSpy = vi.hoisted(() => vi.fn());

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: setVapidDetailsSpy,
    sendNotification: sendNotificationSpy,
  },
}));

const fetchAlertsSpy = vi.hoisted(() => vi.fn());
vi.mock("./mtaAlerts", () => ({
  fetchActiveAlerts: fetchAlertsSpy,
}));

const sqlSpy = vi.hoisted(() => vi.fn());
vi.mock("./db", () => ({
  getDb: () => sqlSpy,
}));

vi.mock("./observability", () => ({
  captureException: vi.fn(),
}));

import { dispatchAlerts } from "./pushDispatch";

function severeAlert(id: string, routeIds: string[]) {
  return {
    id,
    header: `No [${routeIds[0]}] service`,
    description: "Suspended due to a track condition",
    effect: "NO_SERVICE",
    severity: "severe" as const,
    routeIds,
    stopIds: [],
    selectors: routeIds.map((r) => ({ routeId: r })),
    startTime: null,
    endTime: null,
  };
}

function warningAlert(id: string, routeIds: string[]) {
  return { ...severeAlert(id, routeIds), severity: "warning" as const };
}

// Sequenced sql() behavior: each call gets the next result in the
// stack. Lets us script (SELECT candidates → INSERT log RETURNING → …).
function scriptSql(results: unknown[]) {
  let i = 0;
  sqlSpy.mockImplementation(async () => {
    const out = results[i] ?? [];
    i++;
    return out;
  });
}

describe("dispatchAlerts", () => {
  beforeEach(() => {
    sendNotificationSpy.mockReset();
    fetchAlertsSpy.mockReset();
    sqlSpy.mockReset();
  });

  it("returns zeroed summary when no severe alerts", async () => {
    fetchAlertsSpy.mockResolvedValue({ generatedAt: 0, alerts: [] });
    const summary = await dispatchAlerts();
    expect(summary).toEqual({
      alertsConsidered: 0,
      dispatched: 0,
      pruned: 0,
      errors: 0,
    });
    expect(sendNotificationSpy).not.toHaveBeenCalled();
  });

  it("skips non-severe alerts", async () => {
    fetchAlertsSpy.mockResolvedValue({
      generatedAt: 0,
      alerts: [warningAlert("w-1", ["Q"]), warningAlert("w-2", ["N"])],
    });
    const summary = await dispatchAlerts();
    expect(summary.alertsConsidered).toBe(0);
    expect(sqlSpy).not.toHaveBeenCalled();
  });

  it("skips severe alerts with no routeIds", async () => {
    fetchAlertsSpy.mockResolvedValue({
      generatedAt: 0,
      alerts: [severeAlert("s-1", [])],
    });
    const summary = await dispatchAlerts();
    expect(summary.alertsConsidered).toBe(0);
    expect(sendNotificationSpy).not.toHaveBeenCalled();
  });

  it("dispatches one push per (sub, alert) when log insert succeeds", async () => {
    fetchAlertsSpy.mockResolvedValue({
      generatedAt: 0,
      alerts: [severeAlert("s-1", ["Q"])],
    });
    scriptSql([
      // SELECT candidates
      [
        {
          id: "sub-1",
          endpoint: "https://x.example/sub1",
          p256dh: "p1",
          auth: "a1",
        },
        {
          id: "sub-2",
          endpoint: "https://x.example/sub2",
          p256dh: "p2",
          auth: "a2",
        },
      ],
      // INSERT log for sub-1 → new
      [{ "?column?": 1 }],
      // INSERT log for sub-2 → new
      [{ "?column?": 1 }],
    ]);
    sendNotificationSpy.mockResolvedValue({ statusCode: 201 });

    const summary = await dispatchAlerts();
    expect(summary.alertsConsidered).toBe(1);
    expect(summary.dispatched).toBe(2);
    expect(sendNotificationSpy).toHaveBeenCalledTimes(2);
    // Payload sanity check on the first push
    const [, payloadStr] = sendNotificationSpy.mock.calls[0];
    const payload = JSON.parse(payloadStr);
    expect(payload.title).toBe("Q line — service disruption");
    expect(payload.url).toBe("/line/Q");
    expect(payload.tag).toBe("alert:s-1");
    expect(payload.body).toContain("Q service");
  });

  it("does NOT fire push when log INSERT hits ON CONFLICT (already dispatched)", async () => {
    fetchAlertsSpy.mockResolvedValue({
      generatedAt: 0,
      alerts: [severeAlert("s-1", ["Q"])],
    });
    scriptSql([
      // candidates
      [
        { id: "sub-1", endpoint: "https://x/1", p256dh: "p1", auth: "a1" },
      ],
      // INSERT log → conflict, empty array
      [],
    ]);

    const summary = await dispatchAlerts();
    expect(summary.dispatched).toBe(0);
    expect(sendNotificationSpy).not.toHaveBeenCalled();
  });

  it("marks subscription unsubscribed on 410 GONE from push service", async () => {
    fetchAlertsSpy.mockResolvedValue({
      generatedAt: 0,
      alerts: [severeAlert("s-1", ["Q"])],
    });
    scriptSql([
      [{ id: "sub-1", endpoint: "https://x/1", p256dh: "p1", auth: "a1" }],
      [{ "?column?": 1 }], // log inserted
      [], // UPDATE unsubscribed
    ]);
    const err = Object.assign(new Error("Gone"), { statusCode: 410 });
    sendNotificationSpy.mockRejectedValue(err);

    const summary = await dispatchAlerts();
    expect(summary.dispatched).toBe(0);
    expect(summary.pruned).toBe(1);
    // 3 sql calls: select + insert log + update unsubscribed
    expect(sqlSpy).toHaveBeenCalledTimes(3);
  });

  it("counts transient errors without re-firing the push", async () => {
    fetchAlertsSpy.mockResolvedValue({
      generatedAt: 0,
      alerts: [severeAlert("s-1", ["Q"])],
    });
    scriptSql([
      [{ id: "sub-1", endpoint: "https://x/1", p256dh: "p1", auth: "a1" }],
      [{ "?column?": 1 }], // log inserted
    ]);
    const err = Object.assign(new Error("Internal"), { statusCode: 500 });
    sendNotificationSpy.mockRejectedValue(err);

    const summary = await dispatchAlerts();
    expect(summary.dispatched).toBe(0);
    expect(summary.pruned).toBe(0);
    expect(summary.errors).toBe(1);
  });

  it("strips [bracket] glyphs from the body for OS readability", async () => {
    const alert = {
      ...severeAlert("s-1", ["F"]),
      header: "No [F] service between Jay St and 2 Av",
    };
    fetchAlertsSpy.mockResolvedValue({ generatedAt: 0, alerts: [alert] });
    scriptSql([
      [{ id: "sub-1", endpoint: "https://x/1", p256dh: "p1", auth: "a1" }],
      [{ "?column?": 1 }],
    ]);
    sendNotificationSpy.mockResolvedValue({ statusCode: 201 });

    await dispatchAlerts();
    const [, payloadStr] = sendNotificationSpy.mock.calls[0];
    const payload = JSON.parse(payloadStr);
    expect(payload.body).toBe("No F service between Jay St and 2 Av");
  });

  it("multi-route alerts get all routes in the title", async () => {
    const alert = severeAlert("s-1", ["Q", "N", "R"]);
    fetchAlertsSpy.mockResolvedValue({ generatedAt: 0, alerts: [alert] });
    scriptSql([
      [{ id: "sub-1", endpoint: "https://x/1", p256dh: "p1", auth: "a1" }],
      [{ "?column?": 1 }],
    ]);
    sendNotificationSpy.mockResolvedValue({ statusCode: 201 });

    await dispatchAlerts();
    const [, payloadStr] = sendNotificationSpy.mock.calls[0];
    const payload = JSON.parse(payloadStr);
    expect(payload.title).toBe("Q · N · R — service disruption");
    expect(payload.url).toBe("/"); // multi-route → home, not /line/Q
  });

  it("returns noop summary when VAPID env is missing", async () => {
    delete process.env.VAPID_PRIVATE_KEY;
    const summary = await dispatchAlerts();
    expect(summary).toEqual({
      alertsConsidered: 0,
      dispatched: 0,
      pruned: 0,
      errors: 0,
    });
    expect(fetchAlertsSpy).not.toHaveBeenCalled();
    process.env.VAPID_PRIVATE_KEY = "priv-placeholder";
  });
});
