// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

const cleanupSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/pushCleanup", () => ({
  cleanupSubscriptions: cleanupSpy,
}));

vi.mock("@/lib/observability", () => ({
  captureException: vi.fn(),
}));

import { GET } from "./route";

function mkReq(authHeader: string | null): Request {
  const headers: Record<string, string> = {};
  if (authHeader !== null) headers["authorization"] = authHeader;
  return new Request("http://localhost/api/cron/cleanup-subscriptions", {
    method: "GET",
    headers,
  });
}

describe("GET /api/cron/cleanup-subscriptions", () => {
  beforeEach(() => {
    cleanupSpy.mockReset();
    process.env.CRON_SECRET = "test-secret";
  });

  it("rejects unauthorized requests", async () => {
    const res = await GET(mkReq(null));
    expect(res.status).toBe(401);
    expect(cleanupSpy).not.toHaveBeenCalled();
  });

  it("rejects wrong bearer", async () => {
    const res = await GET(mkReq("Bearer wrong"));
    expect(res.status).toBe(401);
    expect(cleanupSpy).not.toHaveBeenCalled();
  });

  it("refuses to run when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(mkReq("Bearer test-secret"));
    expect(res.status).toBe(401);
    expect(cleanupSpy).not.toHaveBeenCalled();
  });

  it("returns the cleanup summary on valid bearer", async () => {
    cleanupSpy.mockResolvedValue({
      subscriptionsPurged: 5,
      dispatchLogPurged: 47,
    });
    const res = await GET(mkReq("Bearer test-secret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      subscriptionsPurged: 5,
      dispatchLogPurged: 47,
    });
  });

  it("returns 500 if cleanup throws", async () => {
    cleanupSpy.mockRejectedValue(new Error("boom"));
    const res = await GET(mkReq("Bearer test-secret"));
    expect(res.status).toBe(500);
  });
});
