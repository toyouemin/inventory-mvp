import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function readEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  const out = {};
  if (!fs.existsSync(envPath)) return out;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    const value = m[2].replace(/^['"]|['"]$/g, "");
    out[key] = value;
  }
  return out;
}

const env = readEnvLocal();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error("missing env");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const targets = ["AIR-9", "RUSH-505BL", "WOVEN-NOTE-8000", "WOVEN-MASTERPRO-30"];

const { data: products, error: pe } = await supabase
  .from("products")
  .select("id,sku,name,category,stock,updated_at")
  .in("sku", targets)
  .order("sku", { ascending: true });
if (pe) throw new Error(pe.message);

const productIds = (products ?? []).map((p) => p.id);
const { data: variants, error: ve } = await supabase
  .from("product_variants")
  .select("product_id,stock")
  .in("product_id", productIds);
if (ve) throw new Error(ve.message);

let moves = [];
let movesSource = "none";
{
  const tryMoves = await supabase
    .from("moves")
    .select("product_id,delta,created_at")
    .in("product_id", productIds)
    .order("created_at", { ascending: true });
  if (!tryMoves.error) {
    moves = tryMoves.data ?? [];
    movesSource = "moves";
  } else {
    const tryStockMoves = await supabase
      .from("stock_moves")
      .select("product_id,delta,created_at")
      .in("product_id", productIds)
      .order("created_at", { ascending: true });
    if (!tryStockMoves.error) {
      moves = tryStockMoves.data ?? [];
      movesSource = "stock_moves";
    }
  }
}

const variantSumById = new Map(productIds.map((id) => [id, 0]));
for (const row of variants ?? []) {
  const prev = variantSumById.get(row.product_id) ?? 0;
  const n = Number(row.stock);
  variantSumById.set(row.product_id, prev + (Number.isFinite(n) ? Math.max(0, n) : 0));
}

const movesDeltaSumById = new Map(productIds.map((id) => [id, 0]));
const movesCountById = new Map(productIds.map((id) => [id, 0]));
for (const row of moves ?? []) {
  const prev = movesDeltaSumById.get(row.product_id) ?? 0;
  movesDeltaSumById.set(row.product_id, prev + (Number(row.delta) || 0));
  movesCountById.set(row.product_id, (movesCountById.get(row.product_id) ?? 0) + 1);
}

const result = (products ?? []).map((p) => ({
  sku: p.sku,
  id: p.id,
  name: p.name,
  category: p.category,
  products_stock_now: p.stock,
  variant_sum: variantSumById.get(p.id) ?? 0,
  moves_delta_sum: movesDeltaSumById.get(p.id) ?? 0,
  moves_count: movesCountById.get(p.id) ?? 0,
  updated_at: p.updated_at,
  moves_source: movesSource,
}));

console.log(JSON.stringify(result, null, 2));
