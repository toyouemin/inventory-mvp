import { supabaseServer } from "@/lib/supabaseClient";
import { ProductsClient } from "./ProductsClient";
import type { Product } from "./types";

export const dynamic = "force-dynamic";

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
    .select("id, sku, category, name_spec, image_url, ship_price, wholesale_price, msrp_price, sale_price, memo, stock, created_at, updated_at")
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Products</h1>
        <p style={{ color: "crimson" }}>Supabase error: {error.message}</p>
      </div>
    );
  }

  const products: Product[] = (data ?? []).map((row: any) => ({
    id: row.id,
    sku: row.sku,
    category: row.category,
    nameSpec: row.name_spec ?? row.sku,
    imageUrl: row.image_url,
    shipPrice: row.ship_price,

    wholesalePrice: row.wholesale_price,
    msrpPrice: row.msrp_price,
    salePrice: row.sale_price,

    memo: row.memo,
    stock: row.stock ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  return <ProductsClient products={products} />;
}