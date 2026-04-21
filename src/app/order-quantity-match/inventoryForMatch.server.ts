/**
 * 주문 수량 매칭 전용 읽기 경로.
 *
 * - `products` / `product_variants`는 SELECT만 수행한다. insert·update·delete·upsert 없음.
 * - 기존 상품·재고 수정 로직을 재사용하지 않고, 이 파일의 매핑만으로 DTO를 만든다(기존 파이프라인 비침해).
 */
import { supabaseServer } from "@/lib/supabaseClient";
import { normalizeCategoryLabel } from "@/app/products/categoryNormalize";
import type { Product, ProductVariant } from "@/app/products/types";

const VARIANT_SELECT =
  "id, product_id, sku, color, gender, size, stock, wholesale_price, msrp_price, sale_price, extra_price, memo, memo2";

const PRODUCT_VARIANTS_PAGE_SIZE = 1000;
const PRODUCTS_PAGE_SIZE = 1000;

function mapProduct(row: Record<string, unknown>): Product {
  const sku = String(row.sku ?? "");
  const catNorm = normalizeCategoryLabel(row.category as string | null);
  return {
    id: String(row.id),
    sku,
    category: catNorm || null,
    name: String((row.name as string) ?? sku ?? ""),
    imageUrl: null,
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

async function fetchAllProductRows(): Promise<{ rows: Record<string, unknown>[]; error: { message: string } | null }> {
  const out: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += PRODUCTS_PAGE_SIZE) {
    const { data, error } = await supabaseServer
      .from("products")
      .select(
        "id, sku, category, name, wholesale_price, msrp_price, sale_price, extra_price, memo, memo2, stock, created_at, updated_at, stock_updated_at"
      )
      .order("sku", { ascending: true })
      .range(offset, offset + PRODUCTS_PAGE_SIZE - 1);
    if (error) return { rows: [], error };
    const chunk = data ?? [];
    out.push(...chunk);
    if (chunk.length < PRODUCTS_PAGE_SIZE) break;
  }
  return { rows: out, error: null };
}

async function fetchAllProductVariantRowsForProductIds(
  productIds: string[]
): Promise<{ rows: Record<string, unknown>[]; error: { message: string } | null }> {
  if (productIds.length === 0) return { rows: [], error: null };
  const out: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += PRODUCT_VARIANTS_PAGE_SIZE) {
    const { data, error } = await supabaseServer
      .from("product_variants")
      .select(VARIANT_SELECT)
      .in("product_id", productIds)
      .order("id", { ascending: true })
      .range(offset, offset + PRODUCT_VARIANTS_PAGE_SIZE - 1);
    if (error) return { rows: [], error };
    const chunk = data ?? [];
    out.push(...chunk);
    if (chunk.length < PRODUCT_VARIANTS_PAGE_SIZE) break;
  }
  return { rows: out, error: null };
}

export async function loadProductsAndVariantsForMatch(): Promise<{
  products: Product[];
  variantsByProductId: Map<string, ProductVariant[]>;
  categories: string[];
  error: string | null;
}> {
  const { rows, error } = await fetchAllProductRows();
  if (error) {
    return { products: [], variantsByProductId: new Map(), categories: [], error: error.message };
  }
  const products = (rows ?? []).map((row) => mapProduct(row));
  const productIds = products.map((p) => p.id);
  const variantsByProductId = new Map<string, ProductVariant[]>();
  if (productIds.length > 0) {
    const { rows: variantRows, error: vError } = await fetchAllProductVariantRowsForProductIds(productIds);
    if (vError) {
      return { products: [], variantsByProductId: new Map(), categories: [], error: vError.message };
    }
    for (const r of variantRows ?? []) {
      const v = mapVariant(r);
      const list = variantsByProductId.get(v.productId) ?? [];
      list.push(v);
      variantsByProductId.set(v.productId, list);
    }
  }
  const categoriesRaw = Array.from(
    new Set(products.map((p) => p.category).filter((c): c is string => Boolean(c)))
  );
  categoriesRaw.sort((a, b) => a.localeCompare(b, "ko"));
  return { products, variantsByProductId, categories: categoriesRaw, error: null };
}
