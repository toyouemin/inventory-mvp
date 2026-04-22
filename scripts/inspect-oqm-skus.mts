/**
 * 지정 SKU의 product_variants 원본 + normalizeVariantToStockLines + 스코프된 stockLines(2개 선택 시뮬)
 * 실행: npx tsx scripts/inspect-oqm-skus.mts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Product, ProductVariant } from "../src/app/products/types";
import { normalizeCategoryLabel } from "../src/app/products/categoryNormalize";
import { normalizeProductCatalogToStockLines, normalizeVariantToStockLines } from "../src/features/orderQuantityMatch/normalizeInventory";
import { buildOqmCategoryProfile } from "../src/features/orderQuantityMatch/oqmPipelineModel";
import type { NormalizedStockLine } from "../src/features/orderQuantityMatch/types";

/** 조회할 품번 (DB `products.sku` 그대로; 하이픈 없는 행이면 그 문자열 사용) */
const SKUS = ["T24HP-4011DG", "T24HP4010NY"] as const;

/** DB에 없을 때 비슷한 sku 검색용 */
async function findSimilarSkus(supabase: ReturnType<typeof createClient>, needle: string): Promise<string[]> {
  const { data, error } = await supabase.from("products").select("sku").ilike("sku", `%${needle}%`);
  if (error || !data) return [];
  return [...new Set(data.map((r) => String((r as { sku: string }).sku)))].sort();
}

function loadEnvLocal(): void {
  const envPath = resolve(process.cwd(), ".env.local");
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

function mapProduct(row: Record<string, unknown>): Product {
  const sku = String(row.sku ?? "");
  const catNorm = normalizeCategoryLabel(row.category as string | null);
  return {
    id: String(row.id),
    sku,
    category: catNorm || null,
    name: String((row.name as string) ?? sku ?? ""),
    imageUrl: row.image_url != null && String(row.image_url).trim() ? String(row.image_url) : null,
    wholesalePrice: row.wholesale_price != null ? Number(row.wholesale_price) : null,
    msrpPrice: row.msrp_price != null ? Number(row.msrp_price) : null,
    salePrice: row.sale_price != null ? Number(row.sale_price) : null,
    extraPrice: row.extra_price != null ? Number(row.extra_price) : null,
    memo: (row.memo as string) ?? null,
    memo2: (row.memo2 as string) ?? null,
    stock: row.stock != null ? Number(row.stock) : 0,
    createdAt: row.created_at as string | null,
    updatedAt: row.updated_at as string | null,
    stockUpdatedAt: row.stock_updated_at as string | null,
  };
}

function mapVariant(row: Record<string, unknown>): ProductVariant {
  return {
    id: String(row.id),
    productId: String(row.product_id),
    sku: String(row.sku ?? ""),
    color: String(row.color ?? ""),
    gender: String(row.gender ?? ""),
    size: String(row.size ?? ""),
    stock: Number(row.stock ?? 0),
    wholesalePrice: row.wholesale_price != null ? Number(row.wholesale_price) : null,
    msrpPrice: row.msrp_price != null ? Number(row.msrp_price) : null,
    salePrice: row.sale_price != null ? Number(row.sale_price) : null,
    extraPrice: row.extra_price != null ? Number(row.extra_price) : null,
    memo: (row.memo as string) ?? null,
    memo2: (row.memo2 as string) ?? null,
  };
}

loadEnvLocal();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / key missing after .env.local load");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const { data: prodRows, error: pErr } = await supabase
  .from("products")
  .select(
    "id, sku, category, name, image_url, wholesale_price, msrp_price, sale_price, extra_price, memo, memo2, stock, created_at, updated_at, stock_updated_at"
  )
  .in("sku", [...SKUS]);

if (pErr) {
  console.error("products error", pErr);
  process.exit(1);
}

const products = (prodRows ?? []).map((r) => mapProduct(r as Record<string, unknown>));
const bySku = new Map(products.map((p) => [p.sku, p]));

for (const sku of SKUS) {
  const p = bySku.get(sku);
  if (!p) {
    console.log(`\n=== SKU ${sku}: DB에 없음 ===`);
    const tail = sku.replace(/[^A-Z0-9]/gi, "");
    const similar = await findSimilarSkus(supabase, tail.length >= 4 ? tail.slice(-6) : tail);
    if (similar.length) console.log("  ilike sku (일부):", similar.slice(0, 20));
    console.log("");
    continue;
  }

  const { data: vRows, error: vErr } = await supabase
    .from("product_variants")
    .select("id, product_id, sku, color, gender, size, stock, memo, memo2")
    .eq("product_id", p.id);

  if (vErr) {
    console.error("variants error", sku, vErr);
    continue;
  }

  const variants = (vRows ?? []).map((r) => mapVariant(r as Record<string, unknown>));

  console.log(`\n========== ${sku} (product id: ${p.id}) ==========`);
  console.log("product.category (normalized):", JSON.stringify(p.category));
  console.log("product.name:", JSON.stringify(p.name));

  for (const v of variants) {
    console.log("\n--- variant id:", v.id);
    console.log("  RAW color:", JSON.stringify(v.color));
    console.log("  RAW size:", JSON.stringify(v.size));
    console.log("  RAW gender:", JSON.stringify(v.gender));
    const lines = normalizeVariantToStockLines(p, v);
    for (let i = 0; i < lines.length; i++) {
      const L = lines[i]!;
      console.log(`  normalizeVariantToStockLines[${i}].dimensions:`, L.dimensions);
      console.log(`  normalizeVariantToStockLines[${i}] garmentTypeInference:`, L.garmentTypeInference);
    }
  }
}

/** UI에서 반바지 + 두 품목만 선택한 것과 동일: 해당 카테고리 stockLines 중 productId ∈ 선택 */
const cat = "반바지";
const selectedIds = new Set(products.filter((p) => SKUS.includes(p.sku as (typeof SKUS)[number])).map((p) => p.id));
const variantsByProductId = new Map<string, ProductVariant[]>();
for (const p of products) {
  if (!selectedIds.has(p.id)) continue;
  const { data: vRows } = await supabase
    .from("product_variants")
    .select("id, product_id, sku, color, gender, size, stock, memo, memo2")
    .eq("product_id", p.id);
  variantsByProductId.set(p.id, (vRows ?? []).map((r) => mapVariant(r as Record<string, unknown>)));
}

const scopedProducts = products.filter((p) => selectedIds.has(p.id));
const allLinesForSelected = normalizeProductCatalogToStockLines(scopedProducts, variantsByProductId);
const stockLinesForProfile: NormalizedStockLine[] = allLinesForSelected.filter(
  (l) => (l.dimensions.category ?? "").trim() === cat
);

console.log("\n========== buildOqmCategoryProfile 직전 (선택 2개 SKU, category === 반바지만) ==========");
console.log("stockLines count:", stockLinesForProfile.length);
console.log(
  "sample dimensions (최대 12줄):",
  stockLinesForProfile.slice(0, 12).map((l) => ({
    productId: l.productId,
    sku: l.sku,
    dimensions: l.dimensions,
  }))
);

const profile = buildOqmCategoryProfile(cat, stockLinesForProfile, {});
console.log("\nbuildOqmCategoryProfile 결과:", {
  sizePolicy: profile.sizePolicy,
  femaleSizes: profile.femaleSizes,
  maleSizes: profile.maleSizes,
  unisexSizes: profile.unisexSizes,
  hasGenderSplitData: profile.hasGenderSplitData,
  hasUnisexData: profile.hasUnisexData,
});
