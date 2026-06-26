import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "見積もり自動化システム",
  description:
    "会社を選んで、区分・人数・日数を入れるだけで見積金額が自動で出ます。",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icon.png", type: "image/png" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: "/icon512.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#1d4ed8",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>
        {children}
        <Script
          src="https://kaizen.takagi.bz/widget.js"
          data-sys="mitsumori"
          strategy="lazyOnload"
        />
      </body>
    </html>
  );
}
