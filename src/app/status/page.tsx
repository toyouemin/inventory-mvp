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
    .select("id, sku, category, name, stock, created_at")
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
      created_at: string | null;
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
  if (productIds.length > 0) {
    const { data: variantsData, error: variantsError } = await supabaseServer
      .from("product_variants")
      .select("product_id, stock")
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
      variantsByProductId.set(pid, (variantsByProductId.get(pid) ?? 0) + qty);
    }
  }

  const rows = products.map((r) => {
    const hasVariants = variantsByProductId.has(r.id);
    const stock = hasVariants ? variantsByProductId.get(r.id) ?? 0 : r.stock ?? 0;
    const displayName = (r.name ?? r.sku).trim() || r.sku;
    return {
      id: r.id,
      sku: r.sku,
      category: r.category ?? null,
      name: displayName,
      stock,
    };
  });
  const categoriesRaw = Array.from(
    new Set(products.map((p) => p.category).filter((c): c is string => Boolean(c)))
  );
  const categories = sortCategoryFilterLabels(categoriesRaw, categoryOrder);

  return <StatusClient rows={rows} categories={categories} />;
}
