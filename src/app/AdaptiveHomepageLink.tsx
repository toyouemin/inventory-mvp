"use client";

import { useEffect, useState } from "react";

const DESKTOP_URL = "https://tagosports.co.kr/";
const MOBILE_URL = "https://m.tagosports.co.kr/";
const WHOLESALE_URL =
  "https://tagosports.cafe24.com/intro/member.html?returnUrl=%2Findex.html";
const ECOUNT_URL = "https://login.ecount.com/Login/";

type AdaptiveHomepageLinkProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function AdaptiveHomepageLink({ open, onOpenChange }: AdaptiveHomepageLinkProps) {
  /** 타고스포츠 링크: PC·넓은 화면은 데스크톱 사이트, 모바일 UA·좁은 화면은 모바일 사이트 */
  const [tagosportsHref, setTagosportsHref] = useState(DESKTOP_URL);

  useEffect(() => {
    const apply = () => {
      const ua = (navigator.userAgent || "").toLowerCase();
      const mobile =
        /android|iphone|ipad|ipod|mobile|windows phone/i.test(ua) ||
        window.matchMedia("(max-width: 768px)").matches;
      setTagosportsHref(mobile ? MOBILE_URL : DESKTOP_URL);
    };
    apply();
    const mq = window.matchMedia("(max-width: 768px)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const closeMenu = () => onOpenChange(false);

  return (
    <details
      className="nav-dropdown"
      open={open}
      onToggle={(e) => onOpenChange(e.currentTarget.open)}
    >
      <summary className="nav-dropdown__summary">홈페이지</summary>
      <div className="nav-dropdown__menu">
        <a href={tagosportsHref} target="_blank" rel="noopener noreferrer" onClick={closeMenu}>
          타고스포츠
        </a>
        <a href={WHOLESALE_URL} target="_blank" rel="noopener noreferrer" onClick={closeMenu}>
          도매몰
        </a>
        <a href={ECOUNT_URL} target="_blank" rel="noopener noreferrer" onClick={closeMenu}>
          이카운트
        </a>
      </div>
    </details>
  );
}
