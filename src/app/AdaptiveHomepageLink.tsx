"use client";

import { useEffect, useState } from "react";

const DESKTOP_URL = "https://tagosports.co.kr/";
const MOBILE_URL = "https://m.tagosports.co.kr/";

export function AdaptiveHomepageLink() {
  const [href, setHref] = useState(DESKTOP_URL);

  useEffect(() => {
    const ua = (navigator.userAgent || "").toLowerCase();
    const isMobile =
      /android|iphone|ipad|ipod|mobile|windows phone/i.test(ua) ||
      window.matchMedia("(max-width: 768px)").matches;
    setHref(isMobile ? MOBILE_URL : DESKTOP_URL);
  }, []);

  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      홈페이지
    </a>
  );
}
