// Opt-in browser regression: run against `npm run build && npm run start -- --port 3001`.
// Requires Playwright in the QA environment (not part of the Vitest/CI dependency set).
// Set CHROMIUM_EXECUTABLE_PATH when using system Chromium instead of Playwright's browser.
// Browser emulation verifies web preferences, not physical iOS accessibility settings.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox"],
});
const origin = process.env.CONTROL_QA_ORIGIN || "http://localhost:3001";
const preferences = [
  { name: "normal" },
  { name: "reduced motion", motion: true },
  { name: "reduced transparency", transparency: true },
  { name: "increased contrast", contrast: true },
  { name: "combined", motion: true, transparency: true, contrast: true },
];
const styles = (locator) => locator.evaluate((element) => {
  const style = getComputedStyle(element);
  return Object.fromEntries(["backgroundColor", "backdropFilter", "borderTopColor", "transform", "filter", "opacity", "transitionDuration", "willChange"].map(key => [key, style[key]]).concat([
    ["before", getComputedStyle(element, "::before").display],
    ["after", getComputedStyle(element, "::after").display],
  ]));
});
function checkMaterial(style, preference, alpha) {
  if (preference.transparency || preference.contrast) {
    assert.equal(style.backgroundColor, "rgb(10, 10, 12)");
    assert.equal(style.backdropFilter, "none");
    assert.equal(style.before, "none");
    assert.equal(style.after, "none");
  } else {
    if (alpha) assert.equal(style.backgroundColor, `rgba(10, 10, 12, ${alpha})`);
    else {
      // DialogContent's existing bg-background can make its modal opaque.
      // Preserve that readable default rather than requiring extra translucency.
      const opacity = style.backgroundColor.startsWith("rgba(") ? Number(style.backgroundColor.slice(5, -1).split(",").at(-1)) : 1;
      assert.ok(opacity >= 0.7);
    }
    assert.match(style.backdropFilter, /blur/);
    assert.notEqual(style.before, "none");
  }
  if (preference.contrast) assert.equal(style.borderTopColor, "rgba(255, 255, 255, 0.6)");
}
try {
  for (const preference of preferences) {
    const page = await browser.newPage({ viewport: { width: 382, height: 580 }, serviceWorkers: "block" });
    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setEmulatedMedia", { features: [
      { name: "prefers-reduced-motion", value: preference.motion ? "reduce" : "no-preference" },
      { name: "prefers-reduced-transparency", value: preference.transparency ? "reduce" : "no-preference" },
      { name: "prefers-contrast", value: preference.contrast ? "more" : "no-preference" },
    ] });
    // Static fixtures isolate control rendering from the live MTA feed.
    await page.route("**/api/trains", route => route.fulfill({ json: { generatedAt: Date.now(), trains: [], arrivals: [] } }));
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    const pulse = page.getByRole("button", { name: /trains live — tap for system pulse/ });
    await pulse.waitFor();
    const supported = await page.evaluate(() => ["(prefers-reduced-motion: reduce)", "(prefers-reduced-transparency: reduce)", "(prefers-contrast: more)"].map(query => matchMedia(query).matches));
    assert.deepEqual(supported, [!!preference.motion, !!preference.transparency, !!preference.contrast]);
    const before = await styles(pulse);
    checkMaterial(before, preference, "0.42");
    const pulseBox = await pulse.boundingBox();
    const nearBox = await page.getByRole("button", { name: "Find nearby stations", exact: true }).filter({ visible: true }).boundingBox();
    assert.equal(pulseBox.height, 48);
    assert.equal(nearBox.height, 48);
    assert.ok(pulseBox.y >= 160, "compact home action must clear the camera region");
    await pulse.hover();
    await page.mouse.down();
    await page.waitForTimeout(200); // Allow the normal press transition to settle.
    const active = await styles(pulse);
    if (preference.motion) {
      assert.equal(active.transform, "none");
      assert.equal(active.transitionDuration, "0s");
      assert.equal(active.willChange, "auto");
      assert.equal(active.filter, "brightness(0.8)");
      assert.equal(active.opacity, before.opacity, "feedback must not reintroduce transparency");
    } else {
      assert.match(active.transform, /matrix\(0\.96,/);
    }
    await page.mouse.up();
    const dialog = page.getByRole("dialog", { name: "System Pulse" });
    await dialog.waitFor();
    checkMaterial(await styles(dialog), preference);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await pulse.focus();
    await page.keyboard.press("Enter");
    await dialog.waitFor();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await page.setViewportSize({ width: 951, height: 620 });
    assert.equal((await pulse.boundingBox()).height, 44);
    assert.equal((await page.getByRole("button", { name: "Find nearby stations", exact: true }).filter({ visible: true }).boundingBox()).height, 44);
    console.log(`PASS ${preference.name}: header/modal materials, press feedback, keyboard activation, mobile/desktop targets`);
    await page.close();
  }
} finally {
  await browser.close();
}
