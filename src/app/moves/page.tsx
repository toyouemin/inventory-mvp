import { supabaseServer } from "@/lib/supabaseClient";
import { MovesClient } from "./MovesClient";
import type { MoveRow } from "./type";

export const dynamic = "force-dynamic";

export default async function MovesPage() {
  if (!supabaseServer) {
    return (
      <div style={{ padding: 24, color: "crimson" }}>
        Supabase server client not ready. Check env (.env.local) and restart server.
      </div>
    );
  }

  const { data, error } = await supabaseServer
    .from("moves")
    .select("id, product_id, type, qty, note, created_at, products:products(sku, name_spec)")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Moves</h1>
        <p style={{ color: "crimson" }}>Supabase error: {error.message}</p>
      </div>
    );
  }

  const moves: MoveRow[] = (data ?? []).map((r: any) => ({
    id: r.id,
    productId: r.product_id,
    type: r.type,
    qty: r.qty,
    note: r.note,
    createdAt: r.created_at,
    sku: r.products?.sku ?? null,
    nameSpec: r.products?.name_spec ?? null,
  }));

  return <MovesClient moves={moves} />;
}