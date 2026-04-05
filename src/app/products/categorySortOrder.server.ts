import { supabaseServer } from "@/lib/supabaseClient";
import { normalizeCategoryLabel, normalizeCategoryOrderMapKeys } from "./categoryNormalize";
import { categoryOrderMapToCategoriesSortedByPosition } from "./categorySortOrder.utils";

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
 * `public.category_sort_order` — products 와 동일하게 supabase-js 기본 스키마(public)의 .from().
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
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const raw of categories) {
    const n = normalizeCategoryLabel(raw);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    unique.push(n);
  }
  const rows = unique.map((category, position) => ({ category, position }));
  for (const chunk of chunkArray(rows, 200)) {
    const { error } = await supabaseServer.from("category_sort_order").upsert(chunk, { onConflict: "category" });
    if (error) {
      if (isCategorySortOrderTableMissingError(error)) return;
      throw new Error(error.message);
    }
  }
}

/**
 * 저장 category가 정규형이 아니거나, 서로 다른 행이 정규화 후 동일 키가 되면 true.
 * 이 경우 fetch 시 테이블을 한 번 정규화 재작성한다.
 */
export function categorySortOrderRowsNeedRecanonicalize(
  rows: readonly { category: string; position: number }[]
): boolean {
  const norms: string[] = [];
  for (const r of rows) {
    const n = normalizeCategoryLabel(r.category);
    if (!n) return true;
    if (n !== r.category) return true;
    norms.push(n);
  }
  return new Set(norms).size !== norms.length;
}

/**
 * 기존 position 순서를 유지하며 category 키만 정규형으로 합친 뒤,
 * products에만 있는 카테고리는 가나다순(locale ko)으로 뒤에 붙인다.
 * (created_at 기준은 쓰지 않음 — CSV 업로드 순서가 진실의 원천)
 */
async function rebuildCategorySortOrderTableCanonical(
  rows: readonly { category: string; position: number }[]
): Promise<void> {
  if (!supabaseServer) return;

  const sorted = [...rows].sort((a, b) => Number(a.position) - Number(b.position));
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const r of sorted) {
    const n = normalizeCategoryLabel(r.category);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    merged.push(n);
  }

  const { data: prows, error: pe } = await supabaseServer.from("products").select("category");
  if (pe) throw new Error(pe.message);

  const extraSet = new Set<string>();
  for (const p of prows ?? []) {
    const n = normalizeCategoryLabel((p as { category?: string | null }).category);
    if (!n || seen.has(n)) continue;
    extraSet.add(n);
  }
  const extra = [...extraSet].sort((a, b) => a.localeCompare(b, "ko"));

  const finalOrder = [...merged, ...extra];
  await deleteAllCategorySortOrders();
  await upsertCategoryOrderRows(finalOrder);
}

/**
 * CSV 없이 category_sort_order를 현재 테이블 position 순으로 다시 쓴다.
 * 상품에만 있는 카테고리는 뒤에 가나다순으로 붙인다. (created_at 미사용)
 */
export async function rebuildCategorySortOrderFromDatabase(): Promise<{ categories: string[] }> {
  if (!supabaseServer) throw new Error("Supabase server client not ready");
  if (!(await isCategorySortOrderAvailable())) {
    throw new Error("category_sort_order 테이블을 사용할 수 없습니다.");
  }
  const { data, error } = await supabaseServer.from("category_sort_order")
    .select("category, position")
    .order("position", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { category: string; position: number }[];
  await rebuildCategorySortOrderTableCanonical(rows);
  const { data: out, error: e2 } = await supabaseServer.from("category_sort_order")
    .select("category")
    .order("position", { ascending: true });
  if (e2) throw new Error(e2.message);
  return { categories: (out ?? []).map((r: { category: string }) => r.category) };
}

export async function fetchCategoryOrderMap(): Promise<Record<string, number>> {
  if (!supabaseServer) return {};
  const { data, error } = await supabaseServer.from("category_sort_order")
    .select("category, position")
    .order("position", { ascending: true });
  if (error) {
    console.warn("[category_sort_order] fetch 실패 — categoryOrder 빈 객체:", error.message);
    return {};
  }
  if (!data) return {};

  let rows = data as { category: string; position: number }[];
  if (rows.length > 0 && categorySortOrderRowsNeedRecanonicalize(rows) && (await isCategorySortOrderAvailable())) {
    try {
      await rebuildCategorySortOrderTableCanonical(rows);
      const again = await supabaseServer.from("category_sort_order")
        .select("category, position")
        .order("position", { ascending: true });
      if (!again.error && again.data) {
        rows = again.data as { category: string; position: number }[];
      }
    } catch (e) {
      devWarnCategorySortOrder("category_sort_order 정규화 재작성 실패", String(e));
    }
  }

  const m: Record<string, number> = {};
  for (const row of rows) {
    m[row.category] = row.position;
  }
  return normalizeCategoryOrderMapKeys(m);
}

/**
 * CSV 업로드 직후: `csvCategoryPositionMap`의 position(0,1,2…) 순으로 테이블을 다시 씀.
 * merge 모드에서는 DB에만 있고 이번 CSV에 없는 카테고리를 가나다순으로 뒤에 붙임(기존 테이블 position·created_at 미사용).
 */
export async function syncCategorySortOrderAfterCsv(
  csvCategoryPositionMap: Record<string, number>,
  mode: "merge" | "reset"
): Promise<void> {
  if (!supabaseServer) return;
  if (!(await isCategorySortOrderAvailable())) return;

  const orderedFromCsv = categoryOrderMapToCategoriesSortedByPosition(
    normalizeCategoryOrderMapKeys(csvCategoryPositionMap)
  );

  if (mode === "reset") {
    await deleteAllCategorySortOrders();
    await upsertCategoryOrderRows(orderedFromCsv);
    return;
  }

  const { data: prodRows, error: pe } = await supabaseServer.from("products").select("category");
  if (pe) throw new Error(pe.message);
  const allCats = new Set<string>();
  for (const p of prodRows ?? []) {
    const n = normalizeCategoryLabel((p as { category?: string | null }).category);
    if (n) allCats.add(n);
  }
  const inCsv = new Set(orderedFromCsv);
  const rest = [...allCats].filter((c) => !inCsv.has(c)).sort((a, b) => a.localeCompare(b, "ko"));
  const finalOrder = [...orderedFromCsv, ...rest];
  await deleteAllCategorySortOrders();
  await upsertCategoryOrderRows(finalOrder);
}

/** 수동 상품 추가 시 새 카테고리면 맨 뒤 position 부여 */
export async function ensureCategorySortOrderRow(category: string | null | undefined): Promise<void> {
  if (!supabaseServer) return;
  const c = normalizeCategoryLabel(category);
  if (!c) return;
  if (!(await isCategorySortOrderAvailable())) return;

  const { data: ex, error: exErr } = await supabaseServer.from("category_sort_order")
    .select("category")
    .eq("category", c)
    .maybeSingle();
  if (exErr) {
    if (isCategorySortOrderTableMissingError(exErr)) return;
    throw new Error(exErr.message);
  }
  if (ex) return;
  const { data: maxRow, error: maxErr } = await supabaseServer.from("category_sort_order")
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
