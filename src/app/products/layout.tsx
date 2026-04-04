import type { ReactNode } from "react";

/** 상품·CSV/XLSX 다운로드 등 /products 하위는 재고 데이터와 연동되므로 캐시 비활성화 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default function ProductsLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
