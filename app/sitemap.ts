import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { getAllStationsServer, getLinesServer } from "@/lib/stations.server";
import { stationSlug } from "@/lib/stationSlug";
import { lineSlug } from "@/lib/lineSlug";

// Marketing-surface sitemap. Per-station SEO pages live at
// /station/[slug] — about ~470 entries pulled in from the GTFS index.
// Per-line landing pages live at /line/[id] — 27 entries (the GTFS
// line keys including the three shuttle routes split out separately).
// Modern crawlers handle 50k URLs per sitemap fine; if we ever exceed
// that, switch to a sitemap index with chunked children.
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const stationEntries: MetadataRoute.Sitemap = getAllStationsServer().map(
    (s) => ({
      url: `${SITE_URL}/station/${stationSlug(s)}`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.5,
    }),
  );
  const lineEntries: MetadataRoute.Sitemap = Object.keys(getLinesServer()).map(
    (id) => ({
      url: `${SITE_URL}/line/${lineSlug(id)}`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.6,
    }),
  );
  return [
    {
      url: SITE_URL,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${SITE_URL}/about`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/changelog`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.6,
    },
    {
      url: `${SITE_URL}/status`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.5,
    },
    {
      url: `${SITE_URL}/privacy`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/terms`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    ...lineEntries,
    ...stationEntries,
  ];
}
