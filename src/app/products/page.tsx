import { supabaseServer } from "@/lib/supabaseClient";
import { ProductsClient } from "./ProductsClient";
import type { Product, ProductVariant } from "./types";

export const dynamic = "force-dynamic";

function mapProduct(row: Record<string, unknown>): Product {
  const sku = String(row.sku ?? "");
  const rawImageUrl = (row.image_url as string) ?? null;
  const fallbackImagePath = `/images/${encodeURIComponent(sku)}.jpg`;
  const imageUrl =
    rawImageUrl && rawImageUrl.trim() !== "" && rawImageUrl !== fallbackImagePath ? rawImageUrl : null;

  return {
    id: String(row.id),
    sku,
    category: (row.category as string) ?? null,
    nameSpec: String(row.name_spec ?? sku ?? ""),
    imageUrl,
    wholesalePrice: row.wholesale_price != null ? Number(row.wholesale_price) : null,
    msrpPrice: row.msrp_price != null ? Number(row.msrp_price) : null,
    salePrice: row.sale_price != null ? Number(row.sale_price) : null,
    extraPrice: row.extra_price != null ? Number(row.extra_price) : null,
    memo: (row.memo as string) ?? null,
    memo2: (row.memo2 as string) ?? null,
    stock: row.stock != null ? Number(row.stock) : 0,
    createdAt: row.created_at as string | null,
    updatedAt: row.updated_at as string | null,
  };
}

function mapVariant(row: Record<string, unknown>): ProductVariant {
  return {
    id: String(row.id),
    productId: String(row.product_id),
    size: String(row.size ?? ""),
    stock: Number(row.stock ?? 0),
    memo: (row.memo as string) ?? null,
    memo2: (row.memo2 as string) ?? null,
    createdAt: (row.created_at as string) ?? null,
  };
}

export default async function ProductsPage() {
  if (!supabaseServer) {
    return (
      <div style={{ padding: 24, color: "crimson" }}>
        Supabase server client not ready. Check env (.env.local) and restart server.
      </div>
    );
  }

  const { data, error } = await supabaseServer
    .from("products")
    .select("id, sku, category, name_spec, image_url, wholesale_price, msrp_price, sale_price, extra_price, memo, memo2, stock, created_at, updated_at")
    .order("sku", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Products</h1>
        <p style={{ color: "crimson" }}>Supabase error: {error.message}</p>
      </div>
    );
  }

  const products: Product[] = (data ?? []).map((row: Record<string, unknown>) => mapProduct(row));
  const productIds = products.map((p) => p.id);

  let variantsByProductId: Record<string, ProductVariant[]> = {};
  if (productIds.length > 0) {
    try {
      const { data: variantsData, error: variantsError } = await supabaseServer
        .from("product_variants")
        .select("id, product_id, size, stock, memo, memo2, created_at")
        .in("product_id", productIds);
      if (variantsError) {
        const { data: fallbackData } = await supabaseServer
          .from("product_variants")
          .select("id, product_id, size, stock, memo, memo2, created_at")
          .in("product_id", productIds);
        const variants = (fallbackData ?? []).map((r: Record<string, unknown>) => mapVariant(r));
        variants.forEach((v) => {
          if (!variantsByProductId[v.productId]) variantsByProductId[v.productId] = [];
          variantsByProductId[v.productId].push(v);
        });
      } else {
        const variants = (variantsData ?? []).map((r: Record<string, unknown>) => mapVariant(r));
        variants.forEach((v) => {
          if (!variantsByProductId[v.productId]) variantsByProductId[v.productId] = [];
          variantsByProductId[v.productId].push(v);
        });
      }
    } catch {
      variantsByProductId = {};
    }
  }

  const categories = Array.from(
    new Set(
      (data ?? []).map((r: { category?: string | null }) => r.category).filter((c): c is string => Boolean(c?.trim()))
    )
  ).sort();

  return (
    <ProductsClient
      products={products}
      categories={categories}
      variantsByProductId={variantsByProductId}
    />
  );
}