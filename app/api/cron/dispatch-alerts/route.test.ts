// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

const dispatchSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/pushDispatch", () => ({
  dispatchAlerts: dispatchSpy,
}));

vi.mock("@/lib/observability", () => ({
  captureException: vi.fn(),
}));

import { GET } from "./route";

function mkReq(authHeader: string | null): Request {
  const headers: Record<string, string> = {};
  if (authHeader !== null) headers["authorization"] = authHeader;
  return new Request("http://localhost/api/cron/dispatch-alerts", {
    method: "GET",
    headers,
  });
}

describe("GET /api/cron/dispatch-alerts", () => {
  beforeEach(() => {
    dispatchSpy.mockReset();
    process.env.CRON_SECRET = "test-secret";
  });

  it("rejects requests without an authorization header", async () => {
    const res = await GET(mkReq(null));
    expect(res.status).toBe(401);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("rejects requests with the wrong bearer token", async () => {
    const res = await GET(mkReq("Bearer wrong-secret"));
    expect(res.status).toBe(401);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("refuses to run when CRON_SECRET is unset (misconfigured deploy)", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(mkReq("Bearer test-secret"));
    expect(res.status).toBe(401);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("runs dispatch on valid bearer + returns the summary", async () => {
    dispatchSpy.mockResolvedValue({
      alertsConsidered: 2,
      dispatched: 5,
      pruned: 1,
      errors: 0,
    });
    const res = await GET(mkReq("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      alertsConsidered: 2,
      dispatched: 5,
      pruned: 1,
      errors: 0,
    });
    expect(dispatchSpy).toHaveBeenCalledOnce();
  });

  it("returns 500 if dispatch throws", async () => {
    dispatchSpy.mockRejectedValue(new Error("boom"));
    const res = await GET(mkReq("Bearer test-secret"));
    expect(res.status).toBe(500);
  });
});
