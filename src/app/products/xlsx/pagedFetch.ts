import { supabaseServer } from "@/lib/supabaseClient";

/**
 * NOTE:
 * Supabase(PostgREST) 조회는 기본 행 상한(환경에 따라 보통 1000)이 걸릴 수 있다.
 * 단발 `.select()`만 사용하면 대량 데이터에서 products/product_variants 일부가 잘려
 * CSV/XLSX 내보내기 행이 누락될 수 있으므로, export route는 반드시 페이지네이션 조회를 사용한다.
 */
export const XLSX_PRODUCTS_PAGE_SIZE = 1000;
export const XLSX_PRODUCT_VARIANTS_PAGE_SIZE = 1000;
export const XLSX_PRODUCT_ID_BATCH_SIZE = 200;

type QueryError = { message: string };

export async function fetchAllProductsPaged<T>(
  productSelect: string
): Promise<{ rows: T[]; error: QueryError | null }> {
  const out: T[] = [];
  for (let offset = 0; ; offset += XLSX_PRODUCTS_PAGE_SIZE) {
    const { data, error } = await supabaseServer
      .from("products")
      .select(productSelect)
      .order("sku", { ascending: true })
      .order("created_at", { ascending: false })
      .range(offset, offset + XLSX_PRODUCTS_PAGE_SIZE - 1);
    if (error) return { rows: [], error };
    const chunk = (data ?? []) as unknown as T[];
    out.push(...chunk);
    if (chunk.length < XLSX_PRODUCTS_PAGE_SIZE) break;
  }
  return { rows: out, error: null };
}

export async function fetchVariantsByProductIdsPaged<T extends { product_id: string }>(
  productIds: string[],
  variantSelect: string
): Promise<{ rows: T[]; error: QueryError | null }> {
  if (productIds.length === 0) return { rows: [], error: null };
  const out: T[] = [];
  for (let start = 0; start < productIds.length; start += XLSX_PRODUCT_ID_BATCH_SIZE) {
    const batchIds = productIds.slice(start, start + XLSX_PRODUCT_ID_BATCH_SIZE);
    for (let offset = 0; ; offset += XLSX_PRODUCT_VARIANTS_PAGE_SIZE) {
      const { data, error } = await supabaseServer
        .from("product_variants")
        .select(variantSelect)
        .in("product_id", batchIds)
        .order("product_id", { ascending: true })
        .order("color", { ascending: true })
        .order("gender", { ascending: true })
        .order("size", { ascending: true })
        .range(offset, offset + XLSX_PRODUCT_VARIANTS_PAGE_SIZE - 1);
      if (error) return { rows: [], error };
      const chunk = (data ?? []) as unknown as T[];
      out.push(...chunk);
      if (chunk.length < XLSX_PRODUCT_VARIANTS_PAGE_SIZE) break;
    }
  }
  return { rows: out, error: null };
}
