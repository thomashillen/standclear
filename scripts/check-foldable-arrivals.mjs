// Opt-in browser regression; requires the QA environment's existing Playwright.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const { chromium } = createRequire(import.meta.url)("playwright");
const origin = process.env.FOLD_QA_ORIGIN || "http://localhost:3001";
const output = process.env.FOLD_QA_OUTPUT || "/tmp/standclear-foldable-arrivals";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ["--no-sandbox"], ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } } : {}) });
const results = [];
try {
  for (const scenario of [
    { name: "fold-unfold", width: 382, height: 580, touch: true, permission: "granted" },
    { name: "wide-start-reduced-motion", width: 820, height: 740, touch: true, permission: "prompt", motion: "reduce" },
    { name: "wide-denied", width: 820, height: 740, touch: true, permission: "denied" },
    { name: "fine-pointer-desktop", width: 1024, height: 768, touch: false, permission: "prompt" },
  ]) {
    const context = await browser.newContext({ viewport: { width: scenario.width, height: scenario.height }, hasTouch: scenario.touch, isMobile: scenario.touch, reducedMotion: scenario.motion || "no-preference", serviceWorkers: "block" });
    const page = await context.newPage(); page.setDefaultTimeout(20_000);
    const errors = []; page.on("pageerror", e => errors.push(e.message));
    await page.addInitScript(({ permission }) => {
      const callbacks = new Map(); let next = 0;
      const position = () => ({ coords: { longitude: -74.012, latitude: 40.707, accuracy: 10 }, timestamp: Date.now() });
      window.__geo = { starts: 0, clears: 0, fast: 0, fixed: false, hidden: false, callbacks,
        fix() { this.fixed = true; for (const callback of callbacks.values()) callback(position()); },
      };
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => window.__geo.hidden ? "hidden" : "visible" });
      Object.defineProperty(navigator, "permissions", { configurable: true, value: { query: async () => Object.assign(new EventTarget(), { state: permission }) } });
      Object.defineProperty(navigator, "geolocation", { configurable: true, value: {
        getCurrentPosition() { window.__geo.fast++; },
        watchPosition(callback) { const id = ++next; window.__geo.starts++; callbacks.set(id, callback); if (window.__geo.fixed) queueMicrotask(() => { if (callbacks.has(id)) callback(position()); }); return id; },
        clearWatch(id) { window.__geo.clears++; callbacks.delete(id); },
      } });
    }, { permission: scenario.permission });
    await page.route("**/api/trains", route => route.fulfill({ json: { generatedAt: Date.now(), trains: [], arrivals: ["N", "S"].map((direction, i) => ({ routeId: "1", stopId: "139", direction, eta: Date.now() / 1000 + 120 + i * 180, tripId: `qa-${direction}` })) } }));
    await page.route("**/api/alerts", route => route.fulfill({ json: { generatedAt: Date.now(), alerts: [] } }));
    const region = () => page.getByRole("region", { name: "Nearby train arrivals", exact: true });
    const metrics = () => page.evaluate(() => ({ starts: window.__geo.starts, active: window.__geo.callbacks.size, clears: window.__geo.clears }));
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Find nearby stations", exact: true }).filter({ visible: true }).waitFor();
    assert.equal(await page.evaluate(() => matchMedia("(pointer: coarse)").matches), scenario.touch);
    if (!scenario.touch) {
      await page.waitForTimeout(300);
      assert.equal((await metrics()).starts, 0);
      assert.equal(await page.locator(".map-glance-space").isVisible(), false);
    } else if (scenario.permission === "denied") {
      await page.getByRole("status").filter({ hasText: "Location is blocked" }).waitFor();
      assert.equal((await metrics()).starts, 0);
      assert.equal(await region().count(), 0);
    } else {
      await page.getByRole("status").filter({ hasText: "Finding nearby arrivals" }).waitFor();
      if (scenario.motion === "reduce") {
        const skeleton = page.getByRole("status").filter({ hasText: "Finding nearby arrivals" }).locator("[aria-hidden]");
        assert.equal(await skeleton.evaluate(e => getComputedStyle(e).animationName), "none");
      }
      await page.waitForFunction(() => window.__geo.starts === 1);
      await page.evaluate(() => window.__geo.fix());
      await region().waitFor();
      const sizes = scenario.name === "fold-unfold" ? [
        { width: 382, height: 580 }, { width: 639, height: 740 }, { width: 640, height: 740 },
        { width: 744, height: 740 }, { width: 820, height: 740 }, { width: 1024, height: 768 },
        { width: 951, height: 620 }, { width: 382, height: 580 },
      ] : [{ width: scenario.width, height: scenario.height }];
      for (const viewport of sizes) {
        await page.setViewportSize(viewport);
        await region().waitFor();
        // Wait for the actual layout, not just React's pre-resize region state.
        const button = region().getByRole("button").first();
        await button.waitFor({ state: "visible" });
        const box = await button.boundingBox();
        assert.ok(box.width >= 43.99 && box.height >= 43.99);
        assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 0.01 && box.y + box.height <= viewport.height + 0.01);
        if (viewport.width >= 640) {
          const toolbar = await page.locator(".map-toolbar").boundingBox();
          assert.ok(box.y >= toolbar.y + toolbar.height, "arrivals must sit below the wide toolbar");
        }
        assert.deepEqual(await metrics(), { starts: 1, active: 1, clears: 0 }, "folding must retain the shared watch and current fix");
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        results.push({ scenario: scenario.name, viewport, box, passed: true });
        await page.screenshot({ path: path.join(output, `${scenario.name}-${viewport.width}.png`) });
      }
      // Explicit panel coverage and backgrounding still pause GPS on wide touch.
      await page.setViewportSize({ width: 820, height: 740 });
      await region().getByRole("button").first().click();
      const station = page.getByRole("region", { name: "Rector St station", exact: true });
      await station.waitFor();
      assert.equal(await page.locator(".map-glance-space").isVisible(), false);
      assert.equal((await metrics()).active, 0);
      await station.getByRole("button", { name: "Close panel", exact: true }).click();
      await region().waitFor(); assert.equal((await metrics()).active, 1);
      await page.getByRole("button", { name: "Find nearby stations", exact: true }).filter({ visible: true }).click();
      await page.getByRole("region", { name: "Near me", exact: true }).waitFor();
      assert.equal(await page.locator(".map-glance-space").isVisible(), false);
      assert.equal((await metrics()).active, 1, "Near me shares one watch");
      await page.getByRole("button", { name: "Close panel", exact: true }).filter({ visible: true }).click();
      await region().waitFor(); assert.equal((await metrics()).active, 1);
      await page.evaluate(() => { window.__geo.hidden = true; document.dispatchEvent(new Event("visibilitychange")); });
      await page.waitForFunction(() => window.__geo.callbacks.size === 0);
      assert.equal(await region().count(), 0);
      await page.evaluate(() => { window.__geo.hidden = false; document.dispatchEvent(new Event("visibilitychange")); });
      await region().waitFor(); assert.equal((await metrics()).active, 1);
    }
    assert.deepEqual(errors, []);
    results.push({ scenario: scenario.name, lifecyclePassed: true });
    console.log(`PASS ${scenario.name}: layout, permission and location lifecycle`);
    await context.close();
  }
} finally {
  await writeFile(path.join(output, "results.json"), JSON.stringify({ origin, results }, null, 2));
  await browser.close();
}
