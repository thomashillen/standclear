// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { isCronAuthorized } from "./cronAuth";

// CRON_SECRET is read at call time (not import time) so each case
// can pin a fresh value via process.env without module mocking.
function withSecret<T>(secret: string | undefined, fn: () => T): T {
  const prev = process.env.CRON_SECRET;
  if (secret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = secret;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prev;
  }
}

function reqWith(headers: Record<string, string> = {}): Request {
  return new Request("https://standclear.app/api/cron/dispatch-alerts", {
    headers,
  });
}

describe("isCronAuthorized", () => {
  // Restore env after every case so a `withSecret` early-return can't
  // leak the secret into the next test.
  let prevSecret: string | undefined;
  beforeEach(() => {
    prevSecret = process.env.CRON_SECRET;
  });
  afterEach(() => {
    if (prevSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prevSecret;
  });

  it("returns true on an exact Bearer match", () => {
    withSecret("topsecret", () => {
      const r = reqWith({ Authorization: "Bearer topsecret" });
      expect(isCronAuthorized(r)).toBe(true);
    });
  });

  it("refuses to run when CRON_SECRET is unset (misconfigured deploy)", () => {
    // Pinning the no-secret = refuse branch — silently fanning out
    // pushes on every public hit is the failure mode this exists to
    // prevent.
    withSecret(undefined, () => {
      const r = reqWith({ Authorization: "Bearer anything" });
      expect(isCronAuthorized(r)).toBe(false);
    });
  });

  it("refuses to run when CRON_SECRET is the empty string", () => {
    // Same intent as the unset case — an empty string can't be a
    // valid bearer secret and should be treated as missing config.
    // A literal `Bearer ` (with no value) must not authorize.
    withSecret("", () => {
      const r = reqWith({ Authorization: "Bearer " });
      expect(isCronAuthorized(r)).toBe(false);
    });
  });

  it("rejects a request with no Authorization header", () => {
    withSecret("topsecret", () => {
      expect(isCronAuthorized(reqWith())).toBe(false);
    });
  });

  it("rejects a request with the wrong secret", () => {
    withSecret("topsecret", () => {
      const r = reqWith({ Authorization: "Bearer wrongsecret" });
      expect(isCronAuthorized(r)).toBe(false);
    });
  });

  it("rejects a non-Bearer scheme even with the right value", () => {
    // Vercel Cron uses Bearer specifically; a request that swaps the
    // scheme (e.g. Basic, token) must not slip through.
    withSecret("topsecret", () => {
      const r = reqWith({ Authorization: "topsecret" });
      expect(isCronAuthorized(r)).toBe(false);
    });
  });

  it("treats the scheme prefix as case-sensitive", () => {
    // The header check is a literal === — `bearer topsecret` does
    // not match `Bearer topsecret`. Vercel always sends `Bearer`
    // (capitalized) so this is the right tradeoff today, but pin
    // the behavior so a future refactor that lowercases for
    // tolerance has to take an explicit decision.
    withSecret("topsecret", () => {
      const r = reqWith({ Authorization: "bearer topsecret" });
      expect(isCronAuthorized(r)).toBe(false);
    });
  });

  it("reads CRON_SECRET at call time, not import time", () => {
    // The dispatch-alerts cron is the kind of module that the bundler
    // pulls in regardless of whether the deploy actually has Postgres
    // provisioned. If `isCronAuthorized` cached process.env.CRON_SECRET
    // at import time, swapping the env var mid-process (e.g. test
    // setup, or a vercel env rotation seen by a long-running function)
    // would lock the wrong secret in.
    const r1 = reqWith({ Authorization: "Bearer first" });
    const r2 = reqWith({ Authorization: "Bearer second" });
    withSecret("first", () => {
      expect(isCronAuthorized(r1)).toBe(true);
      expect(isCronAuthorized(r2)).toBe(false);
    });
    withSecret("second", () => {
      expect(isCronAuthorized(r1)).toBe(false);
      expect(isCronAuthorized(r2)).toBe(true);
    });
  });
});
