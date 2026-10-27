// Opt-in rendered QA; requires Playwright in the QA environment, no install.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const { chromium } = createRequire(import.meta.url)("playwright");
const origin = process.env.STATION_QA_ORIGIN || "http://localhost:3001";
const output = process.env.STATION_QA_OUTPUT || "/tmp/standclear-station-targets";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ["--no-sandbox"], ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } } : {}) });
const results = [];
try {
  const viewports = process.env.STATION_QA_VIEWPORTS ? JSON.parse(process.env.STATION_QA_VIEWPORTS) : [{ width: 280, height: 580 }, { width: 320, height: 568 }, { width: 382, height: 580 }, { width: 390, height: 844 }, { width: 594, height: 368 }, { width: 951, height: 620 }, { width: 1280, height: 800 }];
  for (const viewport of viewports) {
    for (const motion of ["no-preference", "reduce"]) {
      const context = await browser.newContext({ viewport, reducedMotion: motion, serviceWorkers: "block" });
      const page = await context.newPage(); page.setDefaultTimeout(15_000);
      const errors = []; page.on("pageerror", e => errors.push(e.message));
      await page.addInitScript(() => Object.defineProperty(navigator, "permissions", { configurable: true, value: { query: async () => Object.assign(new EventTarget(), { state: "denied" }) } }));
      // Synthetic arrivals exercise circle/diamond artwork, not actual service patterns.
      await page.route("**/api/trains", route => route.fulfill({ json: { generatedAt: Date.now(), trains: [], arrivals: ["1", "6X"].map((routeId, i) => ({ routeId, stopId: "127", direction: "N", eta: Date.now() / 1000 + 120 + i * 60, tripId: `qa-${i}` })) } }));
      await page.route("**/api/alerts", route => route.fulfill({ json: { generatedAt: Date.now(), alerts: [] } }));
      const station = () => page.getByRole("region", { name: "Times Sq-42 St station", exact: true });
      const open = async () => {
        await page.goto(origin, { waitUntil: "domcontentloaded" });
        await page.getByRole("button", { name: "Search stations and plan trips", exact: true }).filter({ visible: true }).click();
        await page.getByRole("searchbox", { name: "Search NYC" }).fill("Times");
        await page.getByRole("button", { name: /Times Sq-42 St/ }).first().click();
        await station().waitFor();
        await station().getByRole("button", { name: "View 6 express line", exact: true }).waitFor();
        await page.evaluate(async () => { await document.fonts.ready; });
      };
      await open();
      const targets = await station().getByRole("button").evaluateAll(elements => elements.map(e => {
        const r = e.getBoundingClientRect(), art = e.querySelector(".nyc-bullet")?.getBoundingClientRect();
        return { name: e.getAttribute("aria-label"), x: r.x, y: r.y, width: r.width, height: r.height, art: art ? { width: art.width, height: art.height } : null };
      }));
      const routes = targets.filter(t => /^View .* line$/.test(t.name));
      assert.ok(routes.length >= 9, "crowded interchange and fixture arrival routes must be present");
      for (const t of targets.filter(t => t.name !== "Expand panel" && t.name !== "Collapse panel")) {
        // DOMRect arithmetic may round 44px to 43.99997 at fractional sheet offsets.
        assert.ok(t.width >= 43.99 && t.height >= 43.99, `${t.name}: ${t.width}x${t.height}`);
        assert.ok(t.x >= 0 && t.x + t.width <= viewport.width + 1);
      }
      for (const [i, a] of targets.entries()) for (const b of targets.slice(i + 1)) {
        assert.ok(a.x + a.width <= b.x + 0.5 || b.x + b.width <= a.x + 0.5 || a.y + a.height <= b.y + 0.5 || b.y + b.height <= a.y + 0.5, `${a.name} overlaps ${b.name}`);
      }
      assert.ok(routes.every(t => t.art && [20, 28].includes(t.art.width) && t.art.width === t.art.height), "artwork keeps its original dimensions");
      const scroller = await station().locator(".ios-scroll").boundingBox();
      assert.ok(Math.min(scroller.y + scroller.height, viewport.height) - scroller.y >= 64, "header must leave visible arrival content");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: path.join(output, `${viewport.width}-${motion}.png`) });
      // Hit padding outside the small artwork: header and circular/express arrivals.
      for (const index of [0, routes.length - 2, routes.length - 1]) {
        if (index !== 0) await open();
        const target = station().getByRole("button", { name: routes[index].name, exact: true }).last();
        await target.scrollIntoViewIfNeeded();
        const base = routes[index].name.match(/^View (\S+)/)[1];
        await target.click({ position: { x: 2, y: 22 } });
        await page.getByRole("region", { name: `${base} line`, exact: true }).waitFor();
        assert.equal(await station().count(), 0, "line handoff replaces the station panel");
      }
      await open();
      const first = station().getByRole("button", { name: routes[0].name, exact: true }).first();
      await first.focus();
      await page.keyboard.press("Tab");
      const second = station().getByRole("button", { name: routes[1].name, exact: true }).first();
      assert.equal(await second.evaluate(e => e === document.activeElement && e.matches(":focus-visible") && getComputedStyle(e).outlineStyle !== "none"), true);
      assert.equal(await second.evaluate(e => getComputedStyle(e).transform), "none");
      await page.keyboard.press("Enter");
      await page.getByRole("region", { name: `${routes[1].name.match(/^View (\S+)/)[1]} line`, exact: true }).waitFor();
      assert.deepEqual(errors, []);
      results.push({ viewport, motion, targets, passed: true });
      console.log(`PASS ${viewport.width}x${viewport.height} ${motion}: native targets, fit, artwork, edge clicks and keyboard handoff`);
      await context.close();
    }
  }
} finally {
  await writeFile(path.join(output, "results.json"), JSON.stringify({ origin, results }, null, 2));
  await browser.close();
}
