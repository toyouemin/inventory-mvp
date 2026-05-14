import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { AdaptiveHomepageLink } from "./AdaptiveHomepageLink";
import { HeaderActionButtons } from "./HeaderActionButtons";
import { ProductImageExcelDownloadProvider } from "./ProductImageExcelDownloadProvider";
import { withAssetVersion } from "@/lib/assetVersion";

const icon192 = withAssetVersion("/icons/icon-192.png");
const icon512 = withAssetVersion("/icons/icon-512.png");

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

export const metadata: Metadata = {
  appleWebApp: {
    capable: true,
    title: "재고관리",
    statusBarStyle: "default",
  },
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
        <div className="app-global-header">
          <header className="app-site-header">
            <div className="app-site-header__top">
              <h1 className="app-site-title">재고관리 프로그램</h1>
              <HeaderActionButtons />
            </div>
          </header>
          <nav className="app-main-nav" aria-label="주요 메뉴">
            <Link href="/products">상품</Link>
            <Link href="/status">재고현황</Link>
            <AdaptiveHomepageLink />
            <Link href="/transaction-statement">거래명세서</Link>
            <Link href="/order-quantity-match">주문수량매칭</Link>
            <Link href="/size-analysis">사이즈분석</Link>
            {/* <Link href="/moves">재고 변동</Link> */}
          </nav>
        </div>
        <ProductImageExcelDownloadProvider>{children}</ProductImageExcelDownloadProvider>
      </body>
    </html>
  );
}