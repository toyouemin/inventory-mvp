import { supabaseServer } from "@/lib/supabaseClient";
import { normalizeCategoryLabel } from "@/app/products/categoryNormalize";
import { fetchCategoryOrderMap } from "@/app/products/categorySortOrder.server";
import {
  compareProductsByCategoryOrder,
  mergeCategoryOrderMapForDisplay,
  sortCategoryFilterLabels,
} from "@/app/products/categorySortOrder.utils";
import { StatusClient } from "./StatusClient";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
const PRODUCT_VARIANTS_PAGE_SIZE = 1000;

function toNonNegativeInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

export default async function StatusPage() {
  const categoryOrderFromDb = await fetchCategoryOrderMap();

  const { data, error } = await supabaseServer
    .from("products")
    .select("id, sku, category, name, stock, memo, memo2, created_at, wholesale_price")
    .order("sku", { ascending: true });

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>재고 현황</h1>
        <p style={{ color: "crimson" }}>Supabase error: {error.message}</p>
      </div>
    );
  }

  const products = (data ?? []).map((r) => {
    const row = r as {
      id: string;
      sku: string;
      category: string | null;
      name: string | null;
      stock: number | null;
      memo: string | null;
      memo2: string | null;
      created_at: string | null;
      wholesale_price: number | string | null;
    };
    return {
      ...row,
      category: normalizeCategoryLabel(row.category) || null,
    };
  });
  const categoryOrder = mergeCategoryOrderMapForDisplay(
    products.map((p) => ({ category: p.category, createdAt: p.created_at, id: p.id })),
    categoryOrderFromDb
  );
  products.sort((a, b) =>
    compareProductsByCategoryOrder(
      { category: a.category, sku: a.sku, createdAt: a.created_at },
      { category: b.category, sku: b.sku, createdAt: b.created_at },
      categoryOrder
    )
  );
  const productIds = products.map((p) => p.id);

  let variantsByProductId = new Map<string, number>();
  let variantAssetByProductId = new Map<string, number>();
  let variantPricedStockByProductId = new Map<string, number>();
  if (productIds.length > 0) {
    for (let offset = 0; ; offset += PRODUCT_VARIANTS_PAGE_SIZE) {
      const { data: variantsData, error: variantsError } = await supabaseServer
        .from("product_variants")
        .select("product_id, stock, wholesale_price")
        .in("product_id", productIds)
        .order("id", { ascending: true })
        .range(offset, offset + PRODUCT_VARIANTS_PAGE_SIZE - 1);
      if (variantsError) {
        return (
          <div style={{ padding: 24 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700 }}>재고 현황</h1>
            <p style={{ color: "crimson" }}>Supabase error: {variantsError.message}</p>
          </div>
        );
      }
      const chunk = variantsData ?? [];
      for (const v of chunk) {
        const pid = String((v as { product_id?: string }).product_id ?? "");
        const qty = toNonNegativeInt((v as { stock?: number }).stock ?? 0);
        const wpRaw = (v as { wholesale_price?: number | string | null }).wholesale_price;
        const wp = wpRaw != null ? Number(wpRaw) : Number.NaN;
        variantsByProductId.set(pid, (variantsByProductId.get(pid) ?? 0) + qty);
        if (Number.isFinite(wp) && wp > 0) {
          variantPricedStockByProductId.set(pid, (variantPricedStockByProductId.get(pid) ?? 0) + qty);
          variantAssetByProductId.set(pid, (variantAssetByProductId.get(pid) ?? 0) + qty * wp);
        }
      }
      if (chunk.length < PRODUCT_VARIANTS_PAGE_SIZE) break;
    }
  }

  const rows = products.map((r) => {
    const hasVariants = variantsByProductId.has(r.id);
    const stock = hasVariants ? variantsByProductId.get(r.id) ?? 0 : toNonNegativeInt(r.stock ?? 0);
    const displayName = (r.name ?? r.sku).trim() || r.sku;
    const productWholesalePrice =
      r.wholesale_price != null && Number.isFinite(Number(r.wholesale_price))
        ? Number(r.wholesale_price)
        : null;
    let pricedStock = 0;
    let assetValue = 0;
    if (hasVariants) {
      const variantPricedStock = variantPricedStockByProductId.get(r.id) ?? 0;
      const variantAsset = variantAssetByProductId.get(r.id) ?? 0;
      const unpricedVariantStock = Math.max(0, stock - variantPricedStock);
      // 옵션 도매가가 비어 있어도 상품 기본 도매가가 있으면 보완 계산
      const fallbackPricedStock =
        productWholesalePrice != null && productWholesalePrice > 0 ? unpricedVariantStock : 0;
      pricedStock = variantPricedStock + fallbackPricedStock;
      assetValue = variantAsset + fallbackPricedStock * (productWholesalePrice ?? 0);
    } else if (productWholesalePrice != null && productWholesalePrice > 0) {
      pricedStock = stock;
      assetValue = stock * productWholesalePrice;
    }
    return {
      id: r.id,
      sku: r.sku,
      category: r.category ?? null,
      name: displayName,
      stock,
      pricedStock,
      assetValue,
      memo: (r.memo ?? "").trim(),
      memo2: (r.memo2 ?? "").trim(),
    };
  });
  const categoriesRaw = Array.from(
    new Set(products.map((p) => p.category).filter((c): c is string => Boolean(c)))
  );
  const categories = sortCategoryFilterLabels(categoriesRaw, categoryOrder);

  return <StatusClient rows={rows} categories={categories} />;
}
