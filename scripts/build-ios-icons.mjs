#!/usr/bin/env node
// ─── iOS asset generator ─────────────────────────────────────────────
// Renders the StandClear brand artwork into the asset sizes the iOS
// Xcode project expects:
//
//   • AppIcon-512@2x.png — 1024×1024, edge-to-edge (iOS applies its
//     own rounded-corner mask, no padding needed). iOS 14+ only
//     requires this single size; the OS down-scales for every other
//     slot in the app icon.
//
//   • splash-2732x2732{,-1,-2}.png — 2732×2732, dark background
//     with the train mark centered at ~22% of canvas. The iPhone
//     splash is shown center-cropped, so the canvas needs to be
//     square and the logo needs to live inside the central safe
//     zone (~50% of the canvas) to render correctly on every
//     device aspect ratio.
//
// Source artwork lives at public/icon-512.png (512×512, dark
// background, silver train glyph). Re-run this script whenever the
// brand artwork changes:
//
//   node scripts/build-ios-icons.mjs
//
// Then commit the regenerated PNGs in
// ios/App/App/Assets.xcassets/{AppIcon.appiconset,Splash.imageset}/.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const SOURCE = path.join(ROOT, "public", "icon-512.png");
const ICON_OUT = path.join(
  ROOT,
  "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png",
);
const SPLASH_OUTS = [
  path.join(
    ROOT,
    "ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png",
  ),
  path.join(
    ROOT,
    "ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-1.png",
  ),
  path.join(
    ROOT,
    "ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-2.png",
  ),
];

const BG = "#0a0a0a"; // Matches manifest theme_color + capacitor splash bg

async function main() {
  const source = readFileSync(SOURCE);

  // ─── App icon ───────────────────────────────────────────────────
  // Upscale 512 → 1024 with Lanczos3 resampling (sharp default).
  // The icon already fills the canvas edge-to-edge with its dark
  // background, so we just resize. iOS 14+ accepts this single
  // 1024×1024 master and synthesizes every other size.
  await sharp(source)
    .resize(1024, 1024, { fit: "cover", kernel: "lanczos3" })
    // Strip alpha channel — App Store rejects transparent
    // app icons. Background was already opaque, but PNG alpha
    // channels are tested, not visually inspected.
    .flatten({ background: BG })
    .png({ compressionLevel: 9 })
    .toFile(ICON_OUT);
  console.log(`✓ ${path.relative(ROOT, ICON_OUT)} (1024×1024)`);

  // ─── Splash ─────────────────────────────────────────────────────
  // 2732×2732 dark canvas with the train mark centered at 28% of
  // the canvas (~765px). The iPhone splash is shown center-cropped
  // (the device sees only the central ~43% of the canvas
  // horizontally, since 1179/2732 ≈ 0.43 on iPhone 15 Pro). Sizing
  // the logo at 28% of the full canvas means it occupies ~65% of
  // the visible splash width on a phone — comparable to the Maps
  // and Transit launch screens. Smaller (e.g. 22%) read as a
  // floating dot; larger (e.g. 35%) edges into iPad-app territory.
  const LOGO_FRACTION = 0.28;
  const CANVAS = 2732;
  const LOGO_SIZE = Math.round(CANVAS * LOGO_FRACTION);

  const logo = await sharp(source)
    .resize(LOGO_SIZE, LOGO_SIZE, { fit: "contain", kernel: "lanczos3" })
    // Make the source's dark background transparent so it composites
    // cleanly onto our canvas (rather than producing a slightly
    // visible border between source bg and canvas bg).
    .toBuffer();

  const splash = await sharp({
    create: {
      width: CANVAS,
      height: CANVAS,
      channels: 4,
      background: BG,
    },
  })
    .composite([{ input: logo, gravity: "center" }])
    .flatten({ background: BG })
    .png({ compressionLevel: 9 })
    .toBuffer();

  for (const out of SPLASH_OUTS) {
    writeFileSync(out, splash);
    console.log(`✓ ${path.relative(ROOT, out)} (${CANVAS}×${CANVAS})`);
  }
}

main().catch((err) => {
  console.error("Failed to build iOS icons:", err);
  process.exit(1);
});
