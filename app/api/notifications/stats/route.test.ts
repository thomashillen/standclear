// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

const sqlSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ getDb: () => sqlSpy }));

vi.mock("@/lib/observability", () => ({
  captureException: vi.fn(),
}));

import { GET } from "./route";

function mkReq(authHeader: string | null): Request {
  const headers: Record<string, string> = {};
  if (authHeader !== null) headers["authorization"] = authHeader;
  return new Request("http://localhost/api/notifications/stats", {
    method: "GET",
    headers,
  });
}

describe("GET /api/notifications/stats", () => {
  beforeEach(() => {
    sqlSpy.mockReset();
    process.env.CRON_SECRET = "test-secret";
  });

  it("rejects unauthorized requests", async () => {
    const res = await GET(mkReq(null));
    expect(res.status).toBe(401);
    expect(sqlSpy).not.toHaveBeenCalled();
  });

  it("rejects wrong bearer", async () => {
    const res = await GET(mkReq("Bearer wrong"));
    expect(res.status).toBe(401);
    expect(sqlSpy).not.toHaveBeenCalled();
  });

  it("refuses to run when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(mkReq("Bearer test-secret"));
    expect(res.status).toBe(401);
  });

  it("returns the four counts on valid bearer", async () => {
    sqlSpy
      .mockResolvedValueOnce([{ n: 42 }]) // active
      .mockResolvedValueOnce([{ n: 3 }]) // pendingPurge
      .mockResolvedValueOnce([{ n: 12 }]) // 24h
      .mockResolvedValueOnce([{ n: 89 }]); // 7d

    const res = await GET(mkReq("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.active).toBe(42);
    expect(body.pendingPurge).toBe(3);
    expect(body.dispatchedLast24h).toBe(12);
    expect(body.dispatchedLast7d).toBe(89);
    expect(typeof body.generatedAt).toBe("number");
  });

  it("returns 500 on DB error", async () => {
    sqlSpy.mockRejectedValue(new Error("connection lost"));
    const res = await GET(mkReq("Bearer test-secret"));
    expect(res.status).toBe(500);
  });
});
