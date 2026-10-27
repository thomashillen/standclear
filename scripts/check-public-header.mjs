// Opt-in production-browser QA. Requires Playwright in the QA environment.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const { chromium } = createRequire(import.meta.url)("playwright");
const origin = process.env.HEADER_QA_ORIGIN || "http://localhost:3001";
const output = process.env.HEADER_QA_OUTPUT || "/tmp/standclear-public-header";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox"],
  ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } } : {}),
});
const results = [];
const viewports = [{ width: 280, height: 580 }, { width: 320, height: 568 }, { width: 382, height: 580 }, { width: 594, height: 368 }, { width: 768, height: 620 }, { width: 1280, height: 800 }];
const preferences = [{ name: "normal" }, { name: "reduced-motion", motion: true }, { name: "combined", motion: true, transparency: true, contrast: true }];
const routes = ["/about", "/status", "/line/1", "/station/times-sq-42-st-127", "/privacy", "/terms", "/changelog"];
try {
  for (const viewport of viewports) {
    for (const preference of preferences) {
      const context = await browser.newContext({ viewport, serviceWorkers: "block" });
      const page = await context.newPage();
      page.setDefaultTimeout(15_000);
      const session = await context.newCDPSession(page);
      await session.send("Emulation.setEmulatedMedia", { features: [
        { name: "prefers-reduced-motion", value: preference.motion ? "reduce" : "no-preference" },
        { name: "prefers-reduced-transparency", value: preference.transparency ? "reduce" : "no-preference" },
        { name: "prefers-contrast", value: preference.contrast ? "more" : "no-preference" },
      ] });
      // App-entry checks isolate header navigation from realtime/location services.
      await page.route("**/api/trains", route => route.fulfill({ json: { generatedAt: Date.now(), trains: [], arrivals: [] } }));
      await page.route("**/api/alerts", route => route.fulfill({ json: { generatedAt: Date.now(), alerts: [] } }));
      await page.addInitScript(() => Object.defineProperty(navigator, "permissions", { configurable: true, value: { query: async () => Object.assign(new EventTarget(), { state: "denied" }) } }));
      for (const route of routes) {
        await page.goto(new URL(route, origin).href, { waitUntil: "domcontentloaded" });
        await page.getByRole("heading", { level: 1 }).waitFor();
        await page.evaluate(async () => { await document.fonts.ready; });
        const header = page.getByRole("banner");
        const links = await header.locator("a").evaluateAll(elements => elements.map(e => {
          const r = e.getBoundingClientRect();
          const range = document.createRange(); range.selectNodeContents(e);
          const content = range.getBoundingClientRect();
          return { name: e.getAttribute("aria-label") || e.textContent.trim(), href: e.getAttribute("href"), x: r.x, y: r.y, width: r.width, height: r.height, content: { x: content.x, y: content.y, width: content.width, height: content.height } };
        }).filter(r => r.width > 0 && r.height > 0));
        results.push({ viewport, preference: preference.name, route, links });
        if (preference.name === "normal") await page.screenshot({ path: path.join(output, `${viewport.width}-${route.slice(1).replaceAll("/", "-")}.png`) });
        assert.equal(links.length, viewport.width < 640 ? 3 : 5);
        for (const link of links) {
          assert.ok(link.width >= 44 && link.height >= 44, `${route} ${link.name}: ${link.width}x${link.height} is below 44px`);
          assert.ok(link.x >= 0 && link.y >= 0 && link.x + link.width <= viewport.width + 1);
          assert.ok(link.content.x >= link.x - 1 && link.content.x + link.content.width <= link.x + link.width + 1, `${link.name}: artwork overflows its target`);
        }
        for (let i = 0; i < links.length; i++) {
          for (const other of links.slice(i + 1)) {
            const a = links[i];
            const overlaps = Math.min(a.x + a.width, other.x + other.width) - Math.max(a.x, other.x) > .1 && Math.min(a.y + a.height, other.y + other.height) - Math.max(a.y, other.y) > .1;
            assert.equal(overlaps, false, `${a.name} overlaps ${other.name}`);
          }
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        assert.equal((await header.boundingBox()).height, 57); // Existing 56px row plus border.
        if (route === "/about" && preference.name === "normal") {
          assert.deepEqual(await page.evaluate(() => ["(prefers-reduced-motion: reduce)", "(prefers-reduced-transparency: reduce)", "(prefers-contrast: more)"].map(q => matchMedia(q).matches)), [false, false, false]);
          const open = header.getByRole("link", { name: "Open app", exact: true });
          const label = await open.getByText("Open app", { exact: true }).evaluate(e => {
            const range = document.createRange(); range.selectNodeContents(e);
            return { height: range.getBoundingClientRect().height, lineHeight: parseFloat(getComputedStyle(e).lineHeight) };
          });
          assert.ok(label.height <= label.lineHeight + 1, "Open app must remain on one line");
          const rect = await open.boundingBox();
          // Hit the transparent outer edge, above the visible capsule.
          await open.click({ position: { x: rect.width / 2, y: 2 } });
          await page.getByRole("button", { name: "Search stations and plan trips", exact: true }).filter({ visible: true }).waitFor();
          await page.goBack();
          await header.getByRole("link", { name: "Open app", exact: true }).waitFor();
          const keyboardLinks = header.getByRole("link").filter({ visible: true });
          await keyboardLinks.first().focus();
          for (let i = 0; i < await keyboardLinks.count(); i++) {
            const link = keyboardLinks.nth(i);
            assert.equal(await link.evaluate(e => e === document.activeElement), true);
            if (i > 0) assert.ok(await link.evaluate(e => e.matches(":focus-visible") && getComputedStyle(e).outlineStyle !== "none"));
            if (i + 1 < await keyboardLinks.count()) await page.keyboard.press("Tab");
          }
          await page.keyboard.press("Enter");
          await page.getByRole("button", { name: "Search stations and plan trips", exact: true }).filter({ visible: true }).waitFor();
          console.log(`PASS ${viewport.width}: outer-edge click and native keyboard app entry`);
        }
      }
      assert.deepEqual(await page.evaluate(() => ["(prefers-reduced-motion: reduce)", "(prefers-reduced-transparency: reduce)", "(prefers-contrast: more)"].map(q => matchMedia(q).matches)), [!!preference.motion, !!preference.transparency, !!preference.contrast]);
      console.log(`PASS ${viewport.width}x${viewport.height} ${preference.name}: all seven public headers`);
      await context.close();
    }
  }
} finally {
  await writeFile(path.join(output, "results.json"), JSON.stringify({ origin, results }, null, 2));
  await browser.close();
}
