import "./globals.css";
import type { ReactNode } from "react";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <h1>재고관리 프로그램</h1>
        <nav>
          <a href="/products">상품</a>
          {/*href="/moves">재고 변동</a>*/}
          <a href="/status">재고 현황</a>
          <a href="https://www.tagosprots.co.kr" target="_blank" rel="noopener noreferrer">홈페이지</a>
        </nav>
        <hr/>
        {children}
      </body>
    </html>
  );
}