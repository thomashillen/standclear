import type { MetadataRoute } from "next";
import { SITE_NAME, SITE_SHORT_DESCRIPTION, SITE_TITLE } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    // Explicit, stable app identity. Per the W3C manifest spec `id`
    // defaults to `start_url` when omitted — so the day we ship a
    // campaign deep-link or scoped start_url (e.g. `/?utm=...` or
    // `/nearby`), every already-installed home-screen app would be
    // treated as a *different* app: the OS spawns a duplicate icon
    // and the existing install stops receiving updates. Pinning `id`
    // to a constant now decouples identity from start_url forever, so
    // start_url can change without orphaning the installed base.
    id: "/",
    name: SITE_TITLE,
    short_name: SITE_NAME,
    description: SITE_SHORT_DESCRIPTION,
    // Primary language + base direction for the manifest string
    // fields (name/short_name/description) as rendered in the OS
    // install prompt and app-store wrapper listing. Matches the
    // root <html lang="en"> and the OpenGraph `en_US` locale.
    lang: "en-US",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    categories: ["travel", "navigation", "utilities"],
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
