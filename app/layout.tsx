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
        {/*
          カイゼンくんウィジェット：小窓は別オリジンiframeでGoogleログインが原理的に不可のため、
          ホスト（みつもりくん）のログイン済みユーザーを /api/me で取得し window.kaizenUser に
          セットしてから widget.js を読み込む（未ログイン/取得失敗でもウィジェット自体は出す）。
        */}
        <Script id="kaizen-widget-loader" strategy="lazyOnload">
          {`
            (function () {
              var appended = false;
              function loadWidget() {
                if (appended) return;
                appended = true;
                var s = document.createElement('script');
                s.src = 'https://kaizen.takagi.bz/widget.js';
                s.setAttribute('data-sys', 'mitsumori');
                document.head.appendChild(s);
              }
              try {
                var timeoutId = setTimeout(loadWidget, 3000);
                fetch('/api/me', { credentials: 'same-origin' })
                  .then(function (r) { return r.ok ? r.json() : null; })
                  .then(function (d) { if (d && typeof d.user === 'string' && d.user) window.kaizenUser = d.user; })
                  .catch(function () {})
                  .finally(function () {
                    clearTimeout(timeoutId);
                    loadWidget();
                  });
              } catch (e) {
                loadWidget();
              }
            })();
          `}
        </Script>
      </body>
    </html>
  );
}
