// Opt-in production-browser regression; requires Playwright in the QA environment.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const { chromium } = createRequire(import.meta.url)("playwright");
const origin = process.env.ARRIVAL_QA_ORIGIN || "http://localhost:3001";
const output = process.env.ARRIVAL_QA_OUTPUT || "/tmp/standclear-arrival-contrast";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox"],
  ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } } : {}),
});
const results = [];
const preferences = [
  { name: "normal" }, { name: "reduced-motion", motion: true },
  { name: "reduced-transparency", transparency: true },
  { name: "increased-contrast", contrast: true },
  { name: "combined", motion: true, transparency: true, contrast: true },
];
// Resolve modern CSS colors (including lab()) in the browser's sRGB canvas.
// These surfaces have opaque backgrounds; reject an ambiguous measurement.
const measure = locator => locator.evaluate(element => {
  const style = getComputedStyle(element);
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d");
  const rgba = color => {
    context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data];
  };
  const foreground = rgba(style.color);
  let ancestor = element;
  let background;
  while (ancestor) {
    background = rgba(getComputedStyle(ancestor).backgroundColor);
    if (background[3] === 255) break;
    if (background[3] !== 0) throw new Error("Translucent background needs compositing");
    ancestor = ancestor.parentElement;
  }
  if (!ancestor || foreground[3] !== 255) throw new Error("Contrast measurement must be opaque");
  const luminance = rgb => rgb.slice(0, 3).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return { foreground, background, ratio: (light + .05) / (dark + .05), underline: style.textDecorationLine.includes("underline"), focusVisible: element.matches(":focus-visible"), outline: style.outlineStyle, outlineWidth: parseFloat(style.outlineWidth) };
});
try {
  for (const viewport of [{ width: 382, height: 580 }, { width: 1280, height: 800 }]) {
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
      for (const [route, parameter, value] of [["/line/1", "line", "1"], ["/station/times-sq-42-st-127", "station", "127"]]) {
        await page.goto(new URL(route, origin).href, { waitUntil: "domcontentloaded" });
        assert.deepEqual(await page.evaluate(() => ["(prefers-reduced-motion: reduce)", "(prefers-reduced-transparency: reduce)", "(prefers-contrast: more)"].map(query => matchMedia(query).matches)), [!!preference.motion, !!preference.transparency, !!preference.contrast]);
        const link = page.getByRole("link", { name: /See live/ });
        await link.waitFor();
        const href = new URL(await link.getAttribute("href"), origin);
        assert.equal(href.searchParams.get(parameter), value);
        for (const state of ["normal", "hover", "focus", "pressed"]) {
          if (state === "normal") { await page.mouse.move(0, 0); await link.evaluate(e => e.blur()); }
          if (state === "hover") await link.hover();
          if (state === "focus") {
            await page.mouse.move(0, 0); await link.focus();
            await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab");
          }
          if (state === "pressed") { await link.hover(); await page.mouse.down(); }
          await page.waitForTimeout(200); // Allow the authored color transition to settle.
          const color = await measure(link);
          results.push({ viewport, preference: preference.name, route, state, ...color });
          if (preference.name === "normal") await page.screenshot({ path: path.join(output, `${viewport.width}-${parameter}-${state}.png`) });
          // A link press is released away from the target to avoid accidental navigation.
          if (state === "pressed") { await page.mouse.move(0, 0); await page.mouse.up(); }
          assert.ok(color.ratio >= 4.5, `${route} ${state}: ${color.ratio.toFixed(2)}:1 is below 4.5:1`);
          if (state === "focus") {
            assert.ok(color.focusVisible && color.outline !== "none" && color.outlineWidth > 0, "keyboard focus must be visible");
          }
        }
      }
      await page.goto(new URL("/about", origin).href, { waitUntil: "domcontentloaded" });
      const articleLink = page.locator('article p a[href="/privacy"]');
      for (const state of ["normal", "hover"]) {
        if (state === "hover") await articleLink.hover();
        else await page.mouse.move(0, 0);
        await page.waitForTimeout(200);
        const color = await measure(articleLink);
        results.push({ viewport, preference: preference.name, route: "/about", state, ordinaryLink: true, ...color });
        assert.ok(color.underline && color.foreground[1] > color.foreground[0] && color.foreground[1] > color.foreground[2], "ordinary article links must retain green underlined styling");
        assert.ok(color.ratio >= 4.5, "ordinary article links must remain readable");
      }
      console.log(`PASS ${viewport.width}x${viewport.height} ${preference.name}: both CTAs in four states and ordinary article links`);
      await context.close();
    }
  }
} finally {
  await writeFile(path.join(output, "results.json"), JSON.stringify({ origin, results }, null, 2));
  await browser.close();
}
