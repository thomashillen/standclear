import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import RegisterSW from "@/components/RegisterSW";
import { GlassTilt } from "@/components/GlassTilt";
import {
  AUTHOR_NAME,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TITLE,
  SITE_URL,
} from "@/lib/site";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    // Marketing pages set their own title; the template wraps it with
    // the site name for a consistent " · StandClear" suffix.
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: AUTHOR_NAME }],
  creator: AUTHOR_NAME,
  publisher: AUTHOR_NAME,
  category: "travel",
  keywords: [
    "NYC subway",
    "MTA",
    "real-time subway",
    "subway tracker",
    "subway map",
    "live arrivals",
    "transit",
    "GTFS",
    "GTFS-Realtime",
    "PWA",
    "New York City",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: "/",
    locale: "en_US",
    // /opengraph-image.tsx is auto-wired by Next; declaring it here
    // makes the absolute URL explicit in the rendered <head>.
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    creator: "@thomashillen",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: SITE_NAME,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0a0a",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // body uses min-h-dvh + overscroll-none rather than a fixed dvh
  // height with overflow-hidden — the latter blocked the marketing
  // routes (/about, /privacy, /terms, /changelog, /status) from
  // scrolling. The map page itself locks the viewport with its
  // own `<div className="h-dvh w-screen overflow-hidden">` wrapper
  // (see app/page.tsx), so removing the body lock doesn't change
  // anything for that route.
  return (
    <html lang="en" className="dark">
      <body
        className={`${inter.className} bg-gray-950 text-white overscroll-none touch-manipulation antialiased`}
        style={{ minHeight: "100dvh" }}
      >
        {children}
        <GlassTilt />
        <RegisterSW />
        <Analytics />
      </body>
    </html>
  );
}
