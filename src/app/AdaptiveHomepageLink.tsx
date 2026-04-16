"use client";

import { useEffect, useState } from "react";

const DESKTOP_URL = "https://tagosports.co.kr/";
const MOBILE_URL = "https://m.tagosports.co.kr/";
const WHOLESALE_URL =
  "https://tagosports.cafe24.com/intro/member.html?returnUrl=%2Findex.html";
const ECOUNT_URL = "https://login.ecount.com/Login/";

export function AdaptiveHomepageLink() {
  const [href, setHref] = useState(DESKTOP_URL);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const ua = (navigator.userAgent || "").toLowerCase();
    const mobile =
      /android|iphone|ipad|ipod|mobile|windows phone/i.test(ua) ||
      window.matchMedia("(max-width: 768px)").matches;
    setIsMobile(mobile);
    setHref(mobile ? MOBILE_URL : DESKTOP_URL);
  }, []);

  if (isMobile) {
    return (
      <details className="nav-dropdown">
        <summary className="nav-dropdown__summary">홈페이지</summary>
        <div className="nav-dropdown__menu">
          <a href={DESKTOP_URL} target="_blank" rel="noopener noreferrer">
            타고스포츠
          </a>
          <a href={WHOLESALE_URL} target="_blank" rel="noopener noreferrer">
            도매몰
          </a>
          <a href={ECOUNT_URL} target="_blank" rel="noopener noreferrer">
            이카운트
          </a>
        </div>
      </details>
    );
  }

  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      홈페이지
    </a>
  );
}
