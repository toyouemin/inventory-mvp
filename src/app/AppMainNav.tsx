"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AdaptiveHomepageLink } from "./AdaptiveHomepageLink";

const NAV_ITEMS = [
  { href: "/products", label: "상품" },
  { href: "/status", label: "재고현황" },
  { href: "/transaction-statement", label: "거래명세서" },
  { href: "/order-quantity-match", label: "주문수량매칭" },
  { href: "/size-analysis", label: "사이즈분석" },
] as const;

export function AppMainNav() {
  const pathname = usePathname();
  const [homepageOpen, setHomepageOpen] = useState(false);

  useEffect(() => {
    setHomepageOpen(false);
  }, [pathname]);

  const closeHomepage = () => setHomepageOpen(false);

  const onNavPointerDownCapture = (event: React.PointerEvent<HTMLElement>) => {
    if (!homepageOpen) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest(".nav-dropdown")) return;
    if (target.closest(".app-main-nav > a[href]")) closeHomepage();
  };

  return (
    <nav className="app-main-nav" aria-label="주요 메뉴" onPointerDownCapture={onNavPointerDownCapture}>
      {NAV_ITEMS.slice(0, 2).map((item) => (
        <Link key={item.href} href={item.href} onClick={closeHomepage}>
          {item.label}
        </Link>
      ))}
      <AdaptiveHomepageLink open={homepageOpen} onOpenChange={setHomepageOpen} />
      {NAV_ITEMS.slice(2).map((item) => (
        <Link key={item.href} href={item.href} onClick={closeHomepage}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
