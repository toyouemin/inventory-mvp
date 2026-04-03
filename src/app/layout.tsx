import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdaptiveHomepageLink } from "./AdaptiveHomepageLink";

export const metadata: Metadata = {
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "재고관리",
    statusBarStyle: "default",
  },
  themeColor: "#ffffff",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/icon-192.png",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <header className="app-site-header">
          <h1 className="app-site-title">재고관리 프로그램</h1>
        </header>
        <nav>
          <a href="/products">상품</a>
          {/*href="/moves">재고 변동</a>*/}
          <a href="/status">재고 현황</a>
          <AdaptiveHomepageLink />
          <a
            href="https://tagosports.cafe24.com/intro/member.html?returnUrl=%2Findex.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            도매몰
          </a>
          <a
            href="https://login.ecount.com/Login/"
            target="_blank"
            rel="noopener noreferrer"
          >
            이카운트
          </a>
        </nav>
        <hr/>
        {children}
      </body>
    </html>
  );
}