import { supabaseServer } from "@/lib/supabaseClient";
import { StatusClient } from "./StatusClient";

export const dynamic = "force-dynamic";

export default async function StatusPage() {
  const { data, error } = await supabaseServer
    .from("products")
    .select("id, sku, category, name_spec, stock, wholesale_price, msrp_price, sale_price")
    .order("sku", { ascending: true });

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>재고 현황</h1>
        <p style={{ color: "crimson" }}>Supabase error: {error.message}</p>
      </div>
    );
  }

  const products = (data ?? []) as Array<{
    id: string;
    sku: string;
    category: string | null;
    name_spec: string | null;
    stock: number | null;
    wholesale_price: number | null;
    msrp_price: number | null;
    sale_price: number | null;
  }>;
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
    return {
      id: r.id,
      sku: r.sku,
      category: r.category ?? null,
      name: r.name_spec ?? r.sku,
      stock,
      wholesalePrice: r.wholesale_price ?? null,
      msrpPrice: r.msrp_price ?? null,
      salePrice: r.sale_price ?? null,
    };
  });
  const categories = Array.from(
    new Set(
      products.map((p) => p.category).filter((c): c is string => Boolean(c?.trim()))
    )
  ).sort((a, b) => a.localeCompare(b, "ko"));

  return <StatusClient rows={rows} categories={categories} />;
}