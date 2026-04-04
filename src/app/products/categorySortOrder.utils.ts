/** CSV에 없거나 아직 등록 안 된 카테고리 — 목록 뒤로 */
export const CATEGORY_ORDER_FALLBACK = 9999;

export function orderedUniqueCategoryKeysFromRows(rows: { category: string }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const c = (r.category ?? "").trim();
    if (seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}

export function compareProductsByCategoryOrder(
  a: { category?: string | null; sku: string; createdAt?: string | null },
  b: { category?: string | null; sku: string; createdAt?: string | null },
  orderMap: Record<string, number>
): number {
  const aCat = (a.category ?? "").trim();
  const bCat = (b.category ?? "").trim();
  const ao = orderMap[aCat] ?? CATEGORY_ORDER_FALLBACK;
  const bo = orderMap[bCat] ?? CATEGORY_ORDER_FALLBACK;
  if (ao !== bo) return ao - bo;
  const sku = (a.sku ?? "").localeCompare(b.sku ?? "", "ko");
  if (sku !== 0) return sku;
  const ac = a.createdAt ?? "";
  const bc = b.createdAt ?? "";
  return bc.localeCompare(ac);
}

export function sortCategoryFilterLabels(labels: string[], orderMap: Record<string, number>): string[] {
  return [...labels].sort((a, b) => {
    const ao = orderMap[a.trim()] ?? CATEGORY_ORDER_FALLBACK;
    const bo = orderMap[b.trim()] ?? CATEGORY_ORDER_FALLBACK;
    if (ao !== bo) return ao - bo;
    return a.localeCompare(b, "ko");
  });
}
