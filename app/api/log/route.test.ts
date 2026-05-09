// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Lazy-import the route so the in-process rate limiter module-state
// is fresh between tests via vi.resetModules + per-test caller IPs.
async function loadPost() {
  vi.resetModules();
  const mod = await import("./route");
  return mod.POST;
}

function makeReq(body: unknown, ip?: string): NextRequest {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new NextRequest("http://localhost/api/log", {
    method: "POST",
    headers: {
      "x-forwarded-for":
        ip ?? `198.51.100.${Math.floor(Math.random() * 250) + 1}`,
      "Content-Type": "application/json",
      "Content-Length": String(text.length),
    },
    body: text,
  });
}

describe("/api/log", () => {
  let logEventSpy: ReturnType<typeof vi.fn>;
  let captureWarningSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    logEventSpy = vi.fn();
    captureWarningSpy = vi.fn();
    vi.doMock("@/lib/observability", () => ({
      logEvent: logEventSpy,
      captureWarning: captureWarningSpy,
    }));
  });

  afterEach(() => {
    vi.doUnmock("@/lib/observability");
    vi.restoreAllMocks();
  });

  it("re-emits a valid error record through logEvent", async () => {
    const POST = await loadPost();
    const res = await POST(
      makeReq({
        severity: "error",
        message: "boom",
        fields: { component: "MapView" },
        stack: "Error: boom\n  at MapView.tsx:1",
        href: "https://standclear.app/?address=secret",
        userAgent: "Mozilla/5.0",
      }),
    );

    expect(res.status).toBe(204);
    expect(logEventSpy).toHaveBeenCalledTimes(1);
    const [severity, message, fields] = logEventSpy.mock.calls[0];
    expect(severity).toBe("error");
    expect(message).toBe("boom");
    // Defense-in-depth sanitize: query string scrubbed.
    expect(fields.href).toBe("https://standclear.app/?[redacted]");
    expect(fields.source).toBe("client-forward");
    expect(fields.stack).toContain("Error: boom");
    expect(fields.userAgent).toBe("Mozilla/5.0");
    expect(captureWarningSpy).not.toHaveBeenCalled();
  });

  it("routes warn severity through captureWarning", async () => {
    const POST = await loadPost();
    const res = await POST(
      makeReq({ severity: "warn", message: "soft fail", fields: {} }),
    );

    expect(res.status).toBe(204);
    expect(captureWarningSpy).toHaveBeenCalledTimes(1);
    expect(logEventSpy).not.toHaveBeenCalled();
  });

  it("rejects info severity (out-of-spec for this endpoint)", async () => {
    const POST = await loadPost();
    const res = await POST(
      makeReq({ severity: "info", message: "trivia" }),
    );
    // Silently dropped — fire-and-forget contract on the client side.
    expect(res.status).toBe(204);
    expect(logEventSpy).not.toHaveBeenCalled();
    expect(captureWarningSpy).not.toHaveBeenCalled();
  });

  it("silently drops malformed JSON without re-emitting", async () => {
    const POST = await loadPost();
    const res = await POST(makeReq("not-json"));
    expect(res.status).toBe(204);
    expect(logEventSpy).not.toHaveBeenCalled();
  });

  it("rejects oversized bodies with 413", async () => {
    const POST = await loadPost();
    const fat = "x".repeat(5_000);
    const res = await POST(
      makeReq({ severity: "error", message: fat, fields: {} }),
    );
    expect(res.status).toBe(413);
    expect(logEventSpy).not.toHaveBeenCalled();
  });

  it("rate-limits a misbehaving caller", async () => {
    const POST = await loadPost();
    const ip = "203.0.113.7";
    let lastStatus = 0;
    // Limit is 30/min; 35 attempts should produce at least one 429.
    for (let i = 0; i < 35; i++) {
      const res = await POST(
        makeReq({ severity: "error", message: `iter-${i}` }, ip),
      );
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });

  it("truncates and caps fields", async () => {
    const POST = await loadPost();
    // 18 keys: first one carries a >1 KB value to exercise the
    // per-string truncate, the rest are short so the body stays
    // well below the 4 KB body cap. MAX_FIELDS=16 should drop two.
    const fields: Record<string, string> = { k00: "v".repeat(1_500) };
    for (let i = 1; i < 18; i++) fields[`k${String(i).padStart(2, "0")}`] = "x";
    await POST(makeReq({ severity: "error", message: "many", fields }));

    expect(logEventSpy).toHaveBeenCalledTimes(1);
    const out = logEventSpy.mock.calls[0][2] as Record<string, unknown>;
    const customKeys = Object.keys(out).filter((k) => k.startsWith("k"));
    expect(customKeys.length).toBeLessThanOrEqual(16);
    // Long value truncated with an ellipsis suffix.
    const sample = out.k00 as string;
    expect(typeof sample).toBe("string");
    expect(sample.endsWith("…")).toBe(true);
  });
});
