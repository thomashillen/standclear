// Opt-in production-browser regression. See docs/ui-audit-2026-10-27.md.
// Requires Playwright in the QA environment; does not install dependencies.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const { chromium } = createRequire(import.meta.url)("playwright");
const origin = process.env.UI_QA_ORIGIN || "http://localhost:3001";
const live = process.env.UI_QA_LIVE === "1";
const output = process.env.UI_QA_OUTPUT || "/tmp/standclear-ui-audit";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox"],
  ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } } : {}),
});
const results = [];
const viewports = process.env.UI_QA_VIEWPORTS ? JSON.parse(process.env.UI_QA_VIEWPORTS) : [
  { width: 382, height: 580 }, { width: 390, height: 844 },
  { width: 594, height: 368 }, { width: 951, height: 620 }, { width: 1280, height: 800 },
];
try {
  for (const viewport of viewports) {
    const key = `${viewport.width}x${viewport.height}`;
    const context = await browser.newContext({ viewport, serviceWorkers: "block", reducedMotion: "reduce", geolocation: { longitude: -73.9875, latitude: 40.7553 }, permissions: ["geolocation"] });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    const errors = [];
    let geocodeFailure = false;
    page.on("pageerror", error => errors.push(error.message));
    if (!live) {
      await page.route("**/api/trains", route => {
        const now = Date.now();
        return route.fulfill({ json: { generatedAt: now, trains: [], arrivals: ["N", "S"].map((direction, i) => ({ routeId: "1", stopId: "127", direction, eta: now / 1000 + 120 + i * 180, tripId: `qa-${direction}` })) } });
      });
      await page.route("**/api/alerts", route => route.fulfill({ json: { generatedAt: Date.now(), alerts: [] } }));
      await page.route("**/api/geocode?**", route => geocodeFailure ? route.fulfill({ status: 503, body: "unavailable" }) : route.fulfill({ json: { suggestions: [] } }));
    }
    const visibleButton = name => page.getByRole("button", { name, exact: true }).filter({ visible: true });
    const screenshot = name => page.screenshot({ path: path.join(output, `${key}-${name}.png`) });
    const home = async () => {
      await page.goto(origin, { waitUntil: "domcontentloaded" });
      await visibleButton("Search stations and plan trips").waitFor();
    };
    const search = async query => {
      await visibleButton("Search stations and plan trips").click();
      const field = page.getByRole("searchbox", { name: "Search NYC" });
      await field.fill(query);
      return field;
    };
    const station = () => page.getByRole("region", { name: "Times Sq-42 St station", exact: true });
    const openStation = async () => {
      await search("Times");
      await page.getByRole("button", { name: /Times Sq-42 St/ }).first().click();
      await station().waitFor();
    };
    const check = async (name, run) => {
      try { await run(); results.push({ viewport: key, name, passed: true }); console.log(`PASS ${key}: ${name}`); }
      catch (error) { results.push({ viewport: key, name, passed: false, error: error.message }); await screenshot("failure"); throw new Error(`${key} ${name}: ${error.message}`, { cause: error }); }
    };
    await check("home controls, containment and camera-clear compact actions", async () => {
      await home();
      for (const name of ["Search stations and plan trips", "Find nearby stations"]) {
        const box = await visibleButton(name).boundingBox();
        assert.ok(box.width >= 44 && box.height >= 44);
        assert.ok(box.x >= 0 && box.x + box.width <= viewport.width + 1);
        if (viewport.width < 640 && viewport.height <= 740) assert.ok(box.y >= 160);
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await screenshot("home");
    });
    await check("search, clear query, station details and persistent favorite", async () => {
      const field = await search("Times");
      await visibleButton("Clear search").click();
      assert.equal(await field.inputValue(), "");
      await field.fill("Times");
      const result = page.getByRole("button", { name: /Times Sq-42 St/ }).first();
      await result.focus();
      await page.keyboard.press("Enter");
      await station().waitFor();
      await station().getByRole("button", { name: "Add to favorites", exact: true }).click();
      assert.equal(await station().getByRole("button", { name: "Remove from favorites", exact: true }).getAttribute("aria-pressed"), "true");
      // Save measured target sizes as audit evidence, not a blanket accessibility pass.
      const targets = await station().getByRole("button", { name: /^View .* line$/ }).evaluateAll(elements => elements.map(e => ({ name: e.getAttribute("aria-label"), width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height })));
      results.push({ viewport: key, name: "station route target measurements", targets });
      await screenshot("station");
      await home();
      await openStation();
      await station().getByRole("button", { name: "Remove from favorites", exact: true }).waitFor();
    });
    if (!live) await check("empty search and address failure preserve station search", async () => {
      await home();
      const field = await search("zzzz-qa-no-match");
      await page.getByText(/No stations or places match/).waitFor();
      geocodeFailure = true;
      await field.fill("Times Square QA");
      await page.getByText("Address search is temporarily unavailable", { exact: true }).waitFor();
      await field.fill("Times");
      await page.getByRole("button", { name: /Times Sq-42 St/ }).first().waitFor();
      geocodeFailure = false;
      await visibleButton("Close panel").click();
    });
    await check("station directions prefill, selected origin, swap, details and back", async () => {
      await home();
      await openStation();
      {
        await station().getByRole("button", { name: "Get directions to Times Sq-42 St", exact: true }).click();
        await page.getByRole("button", { name: "To: Times Sq-42 St", exact: true }).waitFor();
        await visibleButton("Close panel").click();
      }
      await page.evaluate(() => {
        const state = JSON.parse(localStorage.getItem("standclear:commute:v3") || "{}");
        localStorage.setItem("standclear:commute:v3", JSON.stringify({ ...state, home: { kind: "station", stopId: "127" }, work: { kind: "station", stopId: "120" } }));
      });
      await home();
      await search("");
      await visibleButton("Directions to Work").click();
      const sheet = page.getByRole("region", { name: "Search and directions" });
      const fromButton = sheet.getByRole("button", { name: "From: Times Sq-42 St", exact: true });
      if (await fromButton.count()) await fromButton.click();
      const from = sheet.getByRole("textbox", { name: "From station search" });
      assert.equal(await from.getAttribute("placeholder"), "Times Sq-42 St");
      assert.match(await from.evaluate(e => document.getElementById(e.getAttribute("aria-describedby"))?.textContent), /Selected from: Times Sq-42 St/);
      await visibleButton("Refresh routes").waitFor();
      await screenshot("directions");
      await visibleButton("Swap from and to").click();
      // Swap should retain both selected endpoints.
      await sheet.getByRole("button", { name: "To: Times Sq-42 St", exact: true }).waitFor();
      assert.equal(await from.getAttribute("placeholder"), "96 St");
      await visibleButton("Swap from and to").click();
      await sheet.getByRole("button", { name: /Fastest/i }).first().click();
      await visibleButton("Back to route options").waitFor();
      await screenshot("route-detail");
      await visibleButton("Back to route options").click();
      await visibleButton("Back to search").click();
      await page.getByRole("searchbox", { name: "Search NYC" }).waitFor();
      await visibleButton("Close panel").click();
      await visibleButton("Search stations and plan trips").waitFor();
    });
    await check("Near me panel dismissal restores the map without competing sheets", async () => {
      await visibleButton("Find nearby stations").click();
      await page.getByRole("region", { name: "Near me", exact: true }).waitFor();
      assert.equal(await page.getByRole("region", { name: "Search and directions" }).count(), 0);
      await screenshot("nearby");
      await visibleButton("Close panel").click();
      await visibleButton("Search stations and plan trips").waitFor();
    });
    await check("More to line browsing and station navigation", async () => {
      await visibleButton("More options").click();
      await page.getByRole("button", { name: "Browse lines", exact: true }).click();
      await page.getByRole("button", { name: /^1 —/ }).click();
      const line = page.getByRole("region", { name: "1 line", exact: true });
      await line.waitFor();
      await screenshot("line");
      await line.getByRole("button", { name: /See all trains at Times Sq/ }).click();
      await station().waitFor();
      assert.equal(await line.count(), 0);
      await visibleButton("Close panel").click();
    });
    await check("alerts and About open from More, keyboard dismiss and modal containment", async () => {
      for (const [row, title] of [[/^Service alerts/, "Service alerts"], [/^About StandClear/, "StandClear"]]) {
        await visibleButton("More options").click();
        const more = page.getByRole("region", { name: "More", exact: true });
        await screenshot("more");
        await more.getByRole("button", { name: row }).click();
        const dialog = page.getByRole("dialog", { name: title, exact: true });
        await dialog.waitFor();
        assert.equal(await more.count(), 0);
        const box = await dialog.boundingBox();
        assert.ok(box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1);
        const focusedInside = await dialog.evaluate(element => element.contains(document.activeElement));
        assert.ok(focusedInside, "modal should receive keyboard focus");
        await screenshot(title === "StandClear" ? "about" : "alerts");
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
      }
    });
    await check("System Pulse keyboard activation, dismissal and page errors", async () => {
      const pulse = page.getByRole("button", { name: /trains live — tap for system pulse/ });
      await pulse.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "System Pulse", exact: true });
      await dialog.waitFor();
      await screenshot("pulse");
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label")?.includes("trains live — tap for system pulse"));
      assert.deepEqual(errors, []);
    });
    for (const route of ["/about", "/status", "/line/1", "/station/times-sq-42-st-127", "/privacy", "/terms", "/changelog"]) {
      await check(`public page ${route}: heading and horizontal containment`, async () => {
        const response = await page.goto(new URL(route, origin).href, { waitUntil: "domcontentloaded" });
        assert.equal(response.status(), 200);
        await page.getByRole("heading", { level: 1 }).waitFor();
        const targets = await page.locator("header a").evaluateAll(elements => elements.map(e => ({ name: e.getAttribute("aria-label") || e.textContent?.trim(), width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height, top: e.getBoundingClientRect().top })));
        results.push({ viewport: key, name: `public header target measurements ${route}`, targets });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        const arrivalCtas = await page.getByRole("link", { name: /See live/ }).evaluateAll(elements => elements.map(e => {
          const style = getComputedStyle(e);
          const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
          const context = canvas.getContext("2d"); context.fillStyle = style.color; context.fillRect(0, 0, 1, 1);
          const rgb = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
          const luminance = rgb.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
          return { text: e.textContent, color: style.color, background: style.backgroundColor, contrastOnWhite: style.backgroundColor === "rgb(255, 255, 255)" ? 1.05 / (luminance + .05) : null };
        }));
        if (arrivalCtas.length) results.push({ viewport: key, name: `arrival CTA contrast measurement ${route}`, measurements: arrivalCtas });
        await screenshot(`public-${route.slice(1).replaceAll("/", "-")}`);
      });
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
} finally {
  await writeFile(path.join(output, "results.json"), JSON.stringify({ origin, live, results }, null, 2));
  await browser.close();
}
