import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SubwaySurfer — NYC Subway Tracker",
  description: "Real-time NYC subway visualization across all 23 lines, powered by Mapbox.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark h-full">
      <body className={`${inter.className} h-full bg-gray-950 text-white`}>{children}</body>
    </html>
  );
}
