// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `lib/db.ts` is the lazy wrapper around `@neondatabase/serverless::neon`
// every push-notification API route (`/api/notifications/{subscribe,
// unsubscribe,stats}`, `/api/cron/{dispatch-alerts,cleanup-subscriptions}`)
// imports. Three contracts are load-bearing:
//
//   1. Lazy first-call init — the module DOES NOT crash at import time
//      on a build environment that doesn't have DATABASE_URL, because
//      that same module gets pulled into bundle analysis on every
//      `npm run build` regardless of whether the deploy target has
//      Postgres provisioned. Lib-side comment documents this.
//
//   2. First-use error message — when DATABASE_URL is missing at call
//      time the thrown Error names the env var AND the recovery
//      command (`npx vercel env pull .env.local`), so an operator
//      looking at the Vercel function log sees the fix without having
//      to grep the codebase.
//
//   3. Cache invariant — `neon()` is called exactly once per process;
//      subsequent `getDb()` calls return the same NeonQueryFunction.
//      Re-creating the client per call would defeat the HTTP keepalive
//      Neon uses to dodge the connection-pool exhaustion pattern that
//      bites long-running `pg` clients inside Vercel functions.
//
// Each contract gets a test. The module uses module-scope state
// (`cached`), so we `vi.resetModules()` before every case to start
// from a clean slate — same pattern as `rateLimit.test.ts` and
// `observability.test.ts`.

const neonMock = vi.fn();

vi.mock("@neondatabase/serverless", () => ({
  neon: neonMock,
}));

async function loadFresh() {
  vi.resetModules();
  // Re-import so the module-scope `cached` is fresh per test.
  return await import("./db");
}

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

beforeEach(() => {
  neonMock.mockReset();
});

afterEach(() => {
  if (ORIGINAL_DATABASE_URL === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
  }
});

describe("getDb — lazy init + clear error + cache", () => {
  it("does not call neon() at module import time", async () => {
    // Pre-emptively set a valid URL so even an aggressive import-time
    // resolution wouldn't have to throw. We're asserting laziness, not
    // env-var behavior.
    process.env.DATABASE_URL = "postgres://example.invalid/test";
    await loadFresh();
    expect(neonMock).not.toHaveBeenCalled();
  });

  it("throws a recovery-friendly error when DATABASE_URL is missing", async () => {
    delete process.env.DATABASE_URL;
    const { getDb } = await loadFresh();
    expect(() => getDb()).toThrowError(/DATABASE_URL is not set/);
    expect(() => getDb()).toThrowError(/vercel env pull/);
    // The throw must short-circuit before neon() runs — otherwise
    // upstream sees a useless `TypeError: Cannot read properties of
    // undefined` from inside the driver instead of our named error.
    expect(neonMock).not.toHaveBeenCalled();
  });

  it("does not cache the missing-env failure — a later call with the var set succeeds", async () => {
    // Regression guard: a naive implementation that memoizes the
    // thrown error (or stores a falsy `cached` after a failure)
    // would lock the process into "db unreachable" mode even after
    // the env var is wired. We don't want that — the first
    // successful call after the env is set must still produce a
    // usable client.
    delete process.env.DATABASE_URL;
    const { getDb } = await loadFresh();
    expect(() => getDb()).toThrow();
    process.env.DATABASE_URL = "postgres://example.invalid/test";
    const fakeClient = vi.fn();
    neonMock.mockReturnValueOnce(fakeClient);
    expect(getDb()).toBe(fakeClient);
  });

  it("passes the DATABASE_URL through to neon() verbatim on first call", async () => {
    process.env.DATABASE_URL = "postgres://user:pass@db.example.invalid:5432/standclear?sslmode=require";
    const fakeClient = vi.fn();
    neonMock.mockReturnValueOnce(fakeClient);
    const { getDb } = await loadFresh();
    getDb();
    expect(neonMock).toHaveBeenCalledTimes(1);
    expect(neonMock).toHaveBeenCalledWith(
      "postgres://user:pass@db.example.invalid:5432/standclear?sslmode=require",
    );
  });

  it("caches the NeonQueryFunction — repeated calls return the same client without re-invoking neon()", async () => {
    process.env.DATABASE_URL = "postgres://example.invalid/test";
    const fakeClient = vi.fn();
    neonMock.mockReturnValueOnce(fakeClient);
    const { getDb } = await loadFresh();
    const first = getDb();
    const second = getDb();
    const third = getDb();
    expect(first).toBe(fakeClient);
    expect(second).toBe(fakeClient);
    expect(third).toBe(fakeClient);
    // Critical: connection-pool exhaustion guard. neon() must only run
    // once per process, even across many getDb() invocations.
    expect(neonMock).toHaveBeenCalledTimes(1);
  });

  it("ignores a DATABASE_URL change after the first successful call (cache is sticky)", async () => {
    // Documents the actual behavior: once the client is cached, a
    // mid-process env-var change does NOT swap to a new database.
    // This is fine in practice (Vercel functions don't mutate
    // DATABASE_URL between invocations on the same instance), but a
    // future refactor that adds a `getDb({ override })` path needs
    // to be a separate API, not a silent re-init on env change.
    process.env.DATABASE_URL = "postgres://first.invalid/test";
    const firstClient = vi.fn();
    const secondClient = vi.fn();
    neonMock.mockReturnValueOnce(firstClient).mockReturnValueOnce(secondClient);
    const { getDb } = await loadFresh();
    const a = getDb();
    process.env.DATABASE_URL = "postgres://second.invalid/test";
    const b = getDb();
    expect(a).toBe(firstClient);
    expect(b).toBe(firstClient);
    expect(neonMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty-string DATABASE_URL with the same recovery error (not a silent neon() call with '')", async () => {
    // Vercel surfaces unset env vars as `undefined`, but a misconfigured
    // .env.local can produce `DATABASE_URL=` which parses to the empty
    // string. The `if (!url)` falsy check catches both — pin it so a
    // future refactor to `=== undefined` doesn't regress.
    process.env.DATABASE_URL = "";
    const { getDb } = await loadFresh();
    expect(() => getDb()).toThrowError(/DATABASE_URL is not set/);
    expect(neonMock).not.toHaveBeenCalled();
  });
});
