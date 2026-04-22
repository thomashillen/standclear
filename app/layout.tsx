import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import RegisterSW from "@/components/RegisterSW";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SubwaySurfer — NYC Subway Tracker",
  description: "Real-time NYC subway visualization across all 23 lines, powered by Mapbox.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "SubwaySurfer",
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
      </body>
    </html>
  );
}
