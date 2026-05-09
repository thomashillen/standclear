import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Block crawlers from the API surface (it returns ephemeral GTFS data
// behind aggressive polling — nothing useful in a search index) but
// allow everything else, including the per-station SEO pages under
// /station/.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
