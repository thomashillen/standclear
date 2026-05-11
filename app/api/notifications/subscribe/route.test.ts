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
  return new Request("http://localhost/api/notifications/subscribe", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const valid = {
  anonymousId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  endpoint: "https://web.push.apple.com/QABCDE",
  keys: { p256dh: "BLcA1234567890==", auth: "k7abcdef" },
  lines: ["Q", "N"],
};

describe("POST /api/notifications/subscribe", () => {
  beforeEach(() => {
    sqlSpy.mockReset();
    sqlSpy.mockResolvedValue(undefined);
  });

  it("upserts a valid subscription", async () => {
    const res = await POST(mkReq(valid));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(sqlSpy).toHaveBeenCalledOnce();
  });

  it("rejects malformed JSON", async () => {
    const req = new Request("http://localhost/api/notifications/subscribe", {
      method: "POST",
      body: "not-json",
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(sqlSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["anonymousId", { ...valid, anonymousId: "" }],
    ["endpoint", { ...valid, endpoint: "" }],
    ["p256dh", { ...valid, keys: { ...valid.keys, p256dh: "" } }],
    ["auth", { ...valid, keys: { ...valid.keys, auth: "" } }],
    ["lines (not array)", { ...valid, lines: "Q" }],
    ["lines (non-string)", { ...valid, lines: [123] }],
    ["lines (empty string)", { ...valid, lines: [""] }],
    ["lines (too long)", { ...valid, lines: ["XYZWQ"] }], // > 4 chars
  ])("rejects bad %s", async (_, body) => {
    const res = await POST(mkReq(body));
    expect(res.status).toBe(400);
    expect(sqlSpy).not.toHaveBeenCalled();
  });

  it("accepts empty lines array (no per-line opt-ins)", async () => {
    const res = await POST(mkReq({ ...valid, lines: [] }));
    expect(res.status).toBe(200);
    expect(sqlSpy).toHaveBeenCalledOnce();
  });

  it("rejects oversized fields", async () => {
    const big = "x".repeat(3000);
    const res = await POST(mkReq({ ...valid, endpoint: big }));
    expect(res.status).toBe(400);
    expect(sqlSpy).not.toHaveBeenCalled();
  });

  it("rejects too many lines", async () => {
    const tooMany = Array.from({ length: 33 }, (_, i) => `L${i}`);
    const res = await POST(mkReq({ ...valid, lines: tooMany }));
    expect(res.status).toBe(400);
    expect(sqlSpy).not.toHaveBeenCalled();
  });

  it("returns 500 if the database errors", async () => {
    sqlSpy.mockRejectedValueOnce(new Error("connection lost"));
    const res = await POST(mkReq(valid));
    expect(res.status).toBe(500);
  });
});
