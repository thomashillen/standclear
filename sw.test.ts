// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// public/sw.js is a classic service-worker script, not a module: it
// registers handlers via `self.addEventListener` and is never imported
// by the app. To regression-test its runtime behavior we load the real
// shipped file from disk and evaluate it inside a mocked worker global
// (same "assert the real artifact" shape as app/sitemap.test.ts and
// app/marketingTitles.test.ts), then dispatch synthetic fetch events.
//
// The contract under test is the stale-while-revalidate lifetime fix:
// on a cache hit, respondWith() settles immediately with the cached
// body, so the browser may terminate the SW before the background
// revalidation's cache.put() lands. The handler must call
// event.waitUntil(networkPromise) so the refresh actually completes —
// otherwise riders get an even staler /api/trains, /api/alerts, or
// gtfsData.json on the next (often underground) cold launch.

const SW_SRC = readFileSync(join(__dirname, "public", "sw.js"), "utf8");

class ResponseStub {
  body: unknown;
  status: number;
  ok: boolean;
  constructor(body: unknown, init?: { status?: number }) {
    this.body = body;
    this.status = init?.status ?? 200;
    this.ok = this.status < 400;
  }
  clone() {
    return this;
  }
}

interface CacheStore {
  match(req: { url: string }): Promise<unknown>;
  put(req: { url: string }, res: unknown): Promise<void>;
  add(): Promise<void>;
  _store: Map<string, unknown>;
  _putCalls: { url: string; res: unknown }[];
}

function makeCacheStore(): CacheStore {
  const store = new Map<string, unknown>();
  const putCalls: { url: string; res: unknown }[] = [];
  return {
    async match(req) {
      return store.get(req.url);
    },
    async put(req, res) {
      putCalls.push({ url: req.url, res });
      store.set(req.url, res);
    },
    async add() {},
    _store: store,
    _putCalls: putCalls,
  };
}

function makeCaches() {
  const byName = new Map<string, CacheStore>();
  return {
    _byName: byName,
    async open(name: string) {
      if (!byName.has(name)) byName.set(name, makeCacheStore());
      return byName.get(name)!;
    },
    async keys() {
      return [...byName.keys()];
    },
    async delete(n: string) {
      return byName.delete(n);
    },
    async match() {
      return undefined;
    },
  };
}

type Listener = (event: unknown) => void;

function loadSw(fetchImpl: (req: unknown) => Promise<unknown>) {
  const handlers: Record<string, Listener> = {};
  const self = {
    addEventListener: (type: string, cb: Listener) => {
      handlers[type] = cb;
    },
    location: { origin: "https://example.test" },
    registration: { showNotification: vi.fn() },
    clients: {
      matchAll: async () => [],
      openWindow: async () => {},
      claim: async () => {},
    },
    skipWaiting: () => {},
  };
  const caches = makeCaches();
  const fetchSpy = vi.fn(fetchImpl);
  const run = new Function(
    "self",
    "caches",
    "fetch",
    "Response",
    "Request",
    "URL",
    SW_SRC,
  );
  run(self, caches, fetchSpy, ResponseStub, global.Request, global.URL);
  return { handlers, caches, fetchSpy };
}

function makeFetchEvent(
  url: string,
  opts: { method?: string; mode?: string } = {},
) {
  const request = { url, method: opts.method ?? "GET", mode: opts.mode ?? "cors" };
  const waited: Promise<unknown>[] = [];
  let responded: Promise<unknown> | undefined;
  const event = {
    request,
    respondWith: vi.fn((p: Promise<unknown>) => {
      responded = p;
    }),
    waitUntil: vi.fn((p: Promise<unknown>) => {
      waited.push(p);
    }),
    get response() {
      return responded;
    },
    waited,
  };
  return event;
}

const TRAINS_URL = "https://example.test/api/trains";
const GTFS_URL = "https://example.test/gtfsData.json";

// Drive one miss-path request to completion so the cache is populated
// before the next dispatch. cache.put() is fired (not awaited) inside
// the network .then(), so the follow-up request only sees a hit once
// this resolves.
async function seed(
  handlers: Record<string, Listener>,
  url: string,
): Promise<void> {
  const e = makeFetchEvent(url);
  handlers.fetch(e);
  await e.response;
  await Promise.all(e.waited);
}

describe("sw.js stale-while-revalidate", () => {
  it("serves the cached body on a hit but keeps the worker alive to revalidate", async () => {
    const res1 = new ResponseStub("snapshot-1");
    const res2 = new ResponseStub("snapshot-2");
    const queue = [res1, res2];
    const { handlers, caches } = loadSw(async () => queue.shift());

    // First request: cache miss → network fills the cache with res1.
    const e1 = makeFetchEvent(TRAINS_URL);
    handlers.fetch(e1);
    expect(e1.respondWith).toHaveBeenCalledOnce();
    expect(await e1.response).toBe(res1);

    // Second request: cache HIT. The stale res1 must be served
    // immediately, AND the handler must register the revalidation with
    // waitUntil so res2 actually lands in the cache. Pre-fix this
    // waitUntil call is absent and the assertion below fails.
    const e2 = makeFetchEvent(TRAINS_URL);
    handlers.fetch(e2);
    expect(await e2.response).toBe(res1);
    expect(e2.waitUntil).toHaveBeenCalledOnce();

    // Let the protected revalidation finish, then prove the cache was
    // freshened to res2 (the "revalidate" half that the SW-termination
    // race would otherwise silently drop).
    await Promise.all(e2.waited);
    const dataCache = [...caches._byName.values()].find((c) =>
      c._store.has(TRAINS_URL),
    )!;
    expect(dataCache._store.get(TRAINS_URL)).toBe(res2);
    expect(dataCache._putCalls).toHaveLength(2);
  });

  it("does not delay the cached response on a hit (stale served before revalidation resolves)", async () => {
    const res1 = new ResponseStub("cached");
    let releaseNetwork: (v: unknown) => void = () => {};
    const slow = new Promise((r) => {
      releaseNetwork = r;
    });
    const queue: unknown[] = [res1];
    const { handlers } = loadSw(async () => {
      if (queue.length) return queue.shift();
      await slow; // second (revalidation) fetch hangs until released
      return new ResponseStub("fresh");
    });

    await seed(handlers, TRAINS_URL);

    const e2 = makeFetchEvent(TRAINS_URL);
    handlers.fetch(e2);
    // Resolves to the stale body even though the revalidation fetch is
    // still pending — that's the whole point of SWR.
    expect(await e2.response).toBe(res1);
    expect(e2.waitUntil).toHaveBeenCalledOnce();
    releaseNetwork(undefined);
    await Promise.all(e2.waited);
  });

  it("a failed revalidation still serves the cached body and never rejects waitUntil", async () => {
    const res1 = new ResponseStub("cached");
    let calls = 0;
    const { handlers } = loadSw(async () => {
      calls += 1;
      if (calls === 1) return res1;
      throw new Error("offline mid-revalidate");
    });

    await seed(handlers, TRAINS_URL);

    const e2 = makeFetchEvent(TRAINS_URL);
    handlers.fetch(e2);
    expect(await e2.response).toBe(res1);
    expect(e2.waitUntil).toHaveBeenCalledOnce();
    // networkPromise .catch()es to null, so the waitUntil promise
    // resolves cleanly — a throw here would surface as an unhandled
    // rejection inside the worker.
    await expect(Promise.all(e2.waited)).resolves.toBeDefined();
  });

  it("falls back to a 504 when there is no cache and the network is down", async () => {
    const { handlers } = loadSw(async () => {
      throw new Error("no network");
    });
    const e = makeFetchEvent(TRAINS_URL);
    handlers.fetch(e);
    const r = (await e.response) as ResponseStub;
    expect(r.status).toBe(504);
  });

  it("routes gtfsData.json through the same revalidation-protected path", async () => {
    const g1 = new ResponseStub("gtfs-1");
    const g2 = new ResponseStub("gtfs-2");
    const queue = [g1, g2];
    const { handlers } = loadSw(async () => queue.shift());

    await seed(handlers, GTFS_URL);

    const e2 = makeFetchEvent(GTFS_URL);
    handlers.fetch(e2);
    expect(await e2.response).toBe(g1);
    // The second SWR call site (isStaticGtfs) must also thread `event`
    // so the 430KB payload's background refresh isn't cut on hot launch.
    expect(e2.waitUntil).toHaveBeenCalledOnce();
    await Promise.all(e2.waited);
  });

  it("bypasses non-GET and cross-origin requests entirely", async () => {
    const { handlers, fetchSpy } = loadSw(async () => new ResponseStub("x"));

    const post = makeFetchEvent(TRAINS_URL, { method: "POST" });
    handlers.fetch(post);
    expect(post.respondWith).not.toHaveBeenCalled();

    const cross = makeFetchEvent("https://tiles.mapbox.com/v4/whatever.png");
    handlers.fetch(cross);
    expect(cross.respondWith).not.toHaveBeenCalled();

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
