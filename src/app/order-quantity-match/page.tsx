/**
 * 주문 수량 매칭 페이지 — 분석 레이어만.
 * 서버에서 재고 스냅샷을 읽어 정규화한 뒤 클라이언트에 전달하며, DB·기존 재고 수량을 변경하지 않는다.
 */
import { normalizeProductCatalogToStockLines } from "@/features/orderQuantityMatch/normalizeInventory";
import { loadProductsAndVariantsForMatch } from "./inventoryForMatch.server";
import { OrderQuantityMatchClient } from "./OrderQuantityMatchClient";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function OrderQuantityMatchPage() {
  const { products, variantsByProductId, categories, error } = await loadProductsAndVariantsForMatch();

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>주문 수량 매칭</h1>
        <p style={{ color: "crimson" }}>데이터를 불러오지 못했습니다: {error}</p>
      </div>
    );
  }

  const stockLines = normalizeProductCatalogToStockLines(products, variantsByProductId);
  const productImageById: Record<string, string | null> = Object.fromEntries(
    products.map((p) => [p.id, p.imageUrl != null && String(p.imageUrl).trim() ? String(p.imageUrl) : null])
  );

  return <OrderQuantityMatchClient categories={categories} stockLines={stockLines} productImageById={productImageById} />;
}
