// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

const sqlSpy = vi.fn();
vi.mock("@/lib/db", () => ({
  getDb: () => sqlSpy,
}));
vi.mock("@/lib/observability", () => ({
  captureException: vi.fn(),
}));

import { POST } from "./route";

function mkReq(body: unknown): Request {
  return new Request("http://localhost/api/notifications/unsubscribe", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/notifications/unsubscribe", () => {
  beforeEach(() => {
    sqlSpy.mockReset();
    sqlSpy.mockResolvedValue(undefined);
  });

  it("marks the subscription unsubscribed", async () => {
    const res = await POST(mkReq({ anonymousId: "uuid-1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(sqlSpy).toHaveBeenCalledOnce();
  });

  it("rejects malformed JSON", async () => {
    const req = new Request("http://localhost/api/notifications/unsubscribe", {
      method: "POST",
      body: "{not json",
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(sqlSpy).not.toHaveBeenCalled();
  });

  it("rejects missing anonymousId", async () => {
    const res = await POST(mkReq({}));
    expect(res.status).toBe(400);
    expect(sqlSpy).not.toHaveBeenCalled();
  });

  it("rejects empty anonymousId", async () => {
    const res = await POST(mkReq({ anonymousId: "" }));
    expect(res.status).toBe(400);
    expect(sqlSpy).not.toHaveBeenCalled();
  });

  it("rejects oversized anonymousId", async () => {
    const res = await POST(mkReq({ anonymousId: "x".repeat(100) }));
    expect(res.status).toBe(400);
    expect(sqlSpy).not.toHaveBeenCalled();
  });

  it("returns 500 if the database errors", async () => {
    sqlSpy.mockRejectedValueOnce(new Error("connection lost"));
    const res = await POST(mkReq({ anonymousId: "uuid-1" }));
    expect(res.status).toBe(500);
  });
});
