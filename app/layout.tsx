import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "みつもりくん | 見積金額を一瞬で自動計算",
  description:
    "会社を選んで区分・人数・日数を入れるだけで、見積金額が自動で出ます。警備業の見積作成をシンプルに。",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icon.png", type: "image/png" },
    ],
    apple: "/icon512.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#3b82f6",
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
