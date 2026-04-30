"use client";

import { usePathname } from "next/navigation";
import { DevMapButton } from "./DevMapButton";
import { DevSourceButton } from "@/features/devSourceMap/DevSourceButton";
import type { DevSourcePageKey } from "@/features/devSourceMap/devSourceMap";

function devSourceKeyFromPathname(pathname: string): DevSourcePageKey | null {
  if (pathname.startsWith("/products")) return "products";
  if (pathname.startsWith("/size-analysis")) return "sizeAnalysis";
  if (pathname.startsWith("/transaction-statement")) return "transactionStatement";
  if (pathname.startsWith("/inventory") || pathname.startsWith("/status")) return "inventory";
  if (pathname.startsWith("/order-matching") || pathname.startsWith("/order-quantity-match")) return "orderMatching";
  return null;
}

export function HeaderActionButtons() {
  const pathname = usePathname();
  const pageKey = devSourceKeyFromPathname(pathname);

  return (
    <div className="app-header-actions">
      {pageKey ? <DevSourceButton pageKey={pageKey} variant="icon" /> : null}
      <DevMapButton />
    </div>
  );
}
