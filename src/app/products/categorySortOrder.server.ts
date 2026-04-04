import { supabaseServer } from "@/lib/supabaseClient";
import type { ParsedCsvRow } from "./csvProductPipeline";
import {
  CATEGORY_ORDER_FALLBACK,
  orderedUniqueCategoryKeysFromRows,
} from "./categorySortOrder.utils";

/** PostgREST: 테이블이 스키마에 없을 때(마이그레이션 미적용 등) */
function isCategorySortOrderTableMissingError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const code = String(err.code ?? "");
  const msg = String(err.message ?? "").toLowerCase();
  if (code === "PGRST205") return true;
  if (msg.includes("could not find the table") && msg.includes("category_sort_order")) return true;
  if (msg.includes("schema cache") && msg.includes("category_sort_order")) return true;
  return false;
}

function devWarnCategorySortOrder(message: string, detail?: string) {
  if (process.env.NODE_ENV !== "development") return;
  if (detail) console.warn(`[category_sort_order] ${message}`, detail);
  else console.warn(`[category_sort_order] ${message}`);
}

/**
 * `category_sort_order` 테이블 사용 가능 여부(한 번의 lightweight select).
 * 테이블이 없으면 false — CSV/상품 흐름은 계속 진행하고 순서 동기화만 생략.
 */
export async function isCategorySortOrderAvailable(): Promise<boolean> {
  if (!supabaseServer) return false;
  const { error } = await supabaseServer.from("category_sort_order").select("category").limit(1);
  if (!error) return true;
  if (isCategorySortOrderTableMissingError(error)) {
    devWarnCategorySortOrder(
      "테이블이 없어 카테고리 순서 동기화를 건너뜁니다. supabase_category_sort_order.sql 적용 후 자동으로 반영됩니다."
    );
    return false;
  }
  devWarnCategorySortOrder("테이블 확인 중 오류 — 카테고리 순서 동기화를 건너뜁니다.", error.message);
  return false;
}

function chunkArray<T>(arr: T[], chunkSize: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += chunkSize) out.push(arr.slice(i, i + chunkSize));
  return out;
}

async function deleteAllCategorySortOrders(): Promise<void> {
  if (!supabaseServer) return;
  const { data, error } = await supabaseServer.from("category_sort_order").select("category");
  if (error) {
    if (isCategorySortOrderTableMissingError(error)) return;
    throw new Error(error.message);
  }
  const cats = (data ?? []).map((r: { category: string }) => r.category);
  for (const chunk of chunkArray(cats, 500)) {
    if (chunk.length === 0) continue;
    const { error: delErr } = await supabaseServer.from("category_sort_order").delete().in("category", chunk);
    if (delErr) {
      if (isCategorySortOrderTableMissingError(delErr)) return;
      throw new Error(delErr.message);
    }
  }
}

async function upsertCategoryOrderRows(categories: string[]): Promise<void> {
  if (!supabaseServer) return;
  const rows = categories.map((category, position) => ({ category, position }));
  for (const chunk of chunkArray(rows, 200)) {
    const { error } = await supabaseServer.from("category_sort_order").upsert(chunk, { onConflict: "category" });
    if (error) {
      if (isCategorySortOrderTableMissingError(error)) return;
      throw new Error(error.message);
    }
  }
}

export async function fetchCategoryOrderMap(): Promise<Record<string, number>> {
  if (!supabaseServer) return {};
  const { data, error } = await supabaseServer
    .from("category_sort_order")
    .select("category, position")
    .order("position", { ascending: true });
  if (error) return {};
  if (!data) return {};
  const m: Record<string, number> = {};
  for (const row of data as { category: string; position: number }[]) {
    m[row.category] = row.position;
  }
  return m;
}

/** CSV 업로드(merge/reset) 직후 호출: 이번 파일에서의 카테고리 첫 등장 순을 반영 */
export async function syncCategorySortOrderAfterCsv(rows: ParsedCsvRow[], mode: "merge" | "reset"): Promise<void> {
  if (!supabaseServer) return;
  if (!(await isCategorySortOrderAvailable())) return;

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
  if (ee) {
    if (isCategorySortOrderTableMissingError(ee)) return;
    throw new Error(ee.message);
  }
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
  if (!c) return;
  if (!(await isCategorySortOrderAvailable())) return;

  const { data: ex, error: exErr } = await supabaseServer
    .from("category_sort_order")
    .select("category")
    .eq("category", c)
    .maybeSingle();
  if (exErr) {
    if (isCategorySortOrderTableMissingError(exErr)) return;
    throw new Error(exErr.message);
  }
  if (ex) return;
  const { data: maxRow, error: maxErr } = await supabaseServer
    .from("category_sort_order")
    .select("position")
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (maxErr) {
    if (isCategorySortOrderTableMissingError(maxErr)) return;
    throw new Error(maxErr.message);
  }
  const next = (maxRow?.position != null ? Number(maxRow.position) : -1) + 1;
  const { error } = await supabaseServer.from("category_sort_order").insert({ category: c, position: next });
  if (error) {
    if (isCategorySortOrderTableMissingError(error)) return;
    throw new Error(error.message);
  }
}
