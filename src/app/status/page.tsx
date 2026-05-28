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
    const { data: variantsData, error: variantsError } = await supabaseServer
      .from("product_variants")
      .select("product_id, stock, wholesale_price")
      .in("product_id", productIds);
    if (variantsError) {
      return (
        <div style={{ padding: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>재고 현황</h1>
          <p style={{ color: "crimson" }}>Supabase error: {variantsError.message}</p>
        </div>
      );
    }
    for (const v of variantsData ?? []) {
      const pid = String((v as { product_id?: string }).product_id ?? "");
      const qty = Number((v as { stock?: number }).stock ?? 0) || 0;
      const wpRaw = (v as { wholesale_price?: number | string | null }).wholesale_price;
      const wp = wpRaw != null ? Number(wpRaw) : Number.NaN;
      variantsByProductId.set(pid, (variantsByProductId.get(pid) ?? 0) + qty);
      if (Number.isFinite(wp) && wp > 0) {
        variantPricedStockByProductId.set(pid, (variantPricedStockByProductId.get(pid) ?? 0) + qty);
        variantAssetByProductId.set(pid, (variantAssetByProductId.get(pid) ?? 0) + qty * wp);
      }
    }
  }

  const rows = products.map((r) => {
    const hasVariants = variantsByProductId.has(r.id);
    const stock = hasVariants ? variantsByProductId.get(r.id) ?? 0 : r.stock ?? 0;
    const displayName = (r.name ?? r.sku).trim() || r.sku;
    const productWholesalePrice =
      r.wholesale_price != null && Number.isFinite(Number(r.wholesale_price))
        ? Number(r.wholesale_price)
        : null;
    const pricedStock = hasVariants
      ? variantPricedStockByProductId.get(r.id) ?? 0
      : productWholesalePrice != null && productWholesalePrice > 0
        ? stock
        : 0;
    const assetValue = hasVariants
      ? variantAssetByProductId.get(r.id) ?? 0
      : productWholesalePrice != null && productWholesalePrice > 0
        ? stock * productWholesalePrice
        : 0;
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
