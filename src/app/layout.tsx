import "./globals.css";
import type { ReactNode } from "react";
import { AdaptiveHomepageLink } from "./AdaptiveHomepageLink";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <h1>재고관리 프로그램</h1>
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
        </nav>
        <hr/>
        {children}
      </body>
    </html>
  );
}