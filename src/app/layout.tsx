import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AppMainNav } from "./AppMainNav";
import { HeaderActionButtons } from "./HeaderActionButtons";
import { ProductImageExcelDownloadProvider } from "./ProductImageExcelDownloadProvider";
import { withAssetVersion } from "@/lib/assetVersion";

const icon192 = withAssetVersion("/icons/icon-192.png");
const icon512 = withAssetVersion("/icons/icon-512.png");

export const viewport: Viewport = {
  themeColor: "#1a3059",
};

export const metadata: Metadata = {
  title: "재고관리",
  description: "타고스포츠 재고관리 프로그램",
  applicationName: "재고관리",
  manifest: "/manifest.webmanifest",
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
    apple: [{ url: icon192, sizes: "192x192", type: "image/png" }],
    shortcut: icon192,
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
          <AppMainNav />
        </div>
        <ProductImageExcelDownloadProvider>{children}</ProductImageExcelDownloadProvider>
      </body>
    </html>
  );
}