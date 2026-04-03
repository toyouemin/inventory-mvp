import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdaptiveHomepageLink } from "./AdaptiveHomepageLink";
import { withAssetVersion } from "@/lib/assetVersion";

const icon192 = withAssetVersion("/icons/icon-192.png");
const icon512 = withAssetVersion("/icons/icon-512.png");

export const metadata: Metadata = {
  appleWebApp: {
    capable: true,
    title: "재고관리",
    statusBarStyle: "default",
  },
  themeColor: "#ffffff",
  icons: {
    icon: [
      { url: icon192, sizes: "192x192", type: "image/png" },
      { url: icon512, sizes: "512x512", type: "image/png" },
    ],
    apple: icon192,
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