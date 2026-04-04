import { supabaseServer } from "@/lib/supabaseClient";
import type { ParsedCsvRow } from "./csvProductPipeline";
import {
  CATEGORY_ORDER_FALLBACK,
  orderedUniqueCategoryKeysFromRows,
} from "./categorySortOrder.utils";

function chunkArray<T>(arr: T[], chunkSize: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += chunkSize) out.push(arr.slice(i, i + chunkSize));
  return out;
}

async function deleteAllCategorySortOrders(): Promise<void> {
  if (!supabaseServer) return;
  const { data, error } = await supabaseServer.from("category_sort_order").select("category");
  if (error) throw new Error(error.message);
  const cats = (data ?? []).map((r: { category: string }) => r.category);
  for (const chunk of chunkArray(cats, 500)) {
    if (chunk.length === 0) continue;
    const { error: delErr } = await supabaseServer.from("category_sort_order").delete().in("category", chunk);
    if (delErr) throw new Error(delErr.message);
  }
}

async function upsertCategoryOrderRows(categories: string[]): Promise<void> {
  if (!supabaseServer) return;
  const rows = categories.map((category, position) => ({ category, position }));
  for (const chunk of chunkArray(rows, 200)) {
    const { error } = await supabaseServer.from("category_sort_order").upsert(chunk, { onConflict: "category" });
    if (error) throw new Error(error.message);
  }
}

export async function fetchCategoryOrderMap(): Promise<Record<string, number>> {
  if (!supabaseServer) return {};
  const { data, error } = await supabaseServer
    .from("category_sort_order")
    .select("category, position")
    .order("position", { ascending: true });
  if (error || !data) return {};
  const m: Record<string, number> = {};
  for (const row of data as { category: string; position: number }[]) {
    m[row.category] = row.position;
  }
  return m;
}

/** CSV 업로드(merge/reset) 직후 호출: 이번 파일에서의 카테고리 첫 등장 순을 반영 */
export async function syncCategorySortOrderAfterCsv(rows: ParsedCsvRow[], mode: "merge" | "reset"): Promise<void> {
  if (!supabaseServer) return;
  const orderedFromCsv = orderedUniqueCategoryKeysFromRows(rows);

  if (mode === "reset") {
    await deleteAllCategorySortOrders();
    await upsertCategoryOrderRows(orderedFromCsv);
    return;
  }

  const { data: prodRows, error: pe } = await supabaseServer.from("products").select("category");
  if (pe) throw new Error(pe.message);
  const allCats = new Set<string>();
  for (const p of prodRows ?? []) {
    allCats.add(String((p as { category?: string | null }).category ?? "").trim());
  }
  const inCsv = new Set(orderedFromCsv);
  const { data: existing, error: ee } = await supabaseServer.from("category_sort_order").select("category, position");
  if (ee) throw new Error(ee.message);
  const posBy = new Map<string, number>();
  for (const r of existing ?? []) {
    const row = r as { category: string; position: number };
    posBy.set(row.category, Number(row.position));
  }
  const rest = [...allCats].filter((c) => !inCsv.has(c)).sort((a, b) => {
    const pa = posBy.get(a) ?? CATEGORY_ORDER_FALLBACK;
    const pb = posBy.get(b) ?? CATEGORY_ORDER_FALLBACK;
    if (pa !== pb) return pa - pb;
    return a.localeCompare(b, "ko");
  });
  const finalOrder = [...orderedFromCsv, ...rest];
  await deleteAllCategorySortOrders();
  await upsertCategoryOrderRows(finalOrder);
}

/** 수동 상품 추가 시 새 카테고리면 맨 뒤 position 부여 */
export async function ensureCategorySortOrderRow(category: string | null | undefined): Promise<void> {
  if (!supabaseServer) return;
  const c = (category ?? "").trim();
  const { data: ex } = await supabaseServer.from("category_sort_order").select("category").eq("category", c).maybeSingle();
  if (ex) return;
  const { data: maxRow } = await supabaseServer
    .from("category_sort_order")
    .select("position")
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const next = (maxRow?.position != null ? Number(maxRow.position) : -1) + 1;
  const { error } = await supabaseServer.from("category_sort_order").insert({ category: c, position: next });
  if (error) throw new Error(error.message);
}
