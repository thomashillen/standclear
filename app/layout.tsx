import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import RegisterSW from "@/components/RegisterSW";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "StandClear — NYC Subway Tracker",
  description: "Real-time NYC subway visualization across all 23 lines, powered by Mapbox.",
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
    title: "StandClear",
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
  return (
    <html lang="en" className="dark">
      <body
        className={`${inter.className} bg-gray-950 text-white overflow-hidden overscroll-none touch-manipulation antialiased`}
        style={{ height: "100dvh" }}
      >
        {children}
        <RegisterSW />
        <Analytics />
      </body>
    </html>
  );
}
