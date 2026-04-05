/**
 * 카테고리 정렬·매칭용 키 정규화.
 * - 앞뒤 공백, 연속 공백 축소
 * - Unicode NFC (한글 자모 분해/조합 차이 통일)
 */
export function normalizeCategoryLabel(raw: string | null | undefined): string {
  if (raw == null) return "";
  let s = String(raw).trim();
  if (!s) return "";
  s = s.replace(/\s+/g, " ");
  try {
    s = s.normalize("NFC");
  } catch {
    /* ignore */
  }
  return s;
}

/** DB `category_sort_order` 등에서 읽은 맵: 키를 정규화하고 동일 키는 더 작은 position 유지 */
export function normalizeCategoryOrderMapKeys(dbMap: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, pos] of Object.entries(dbMap)) {
    const nk = normalizeCategoryLabel(k);
    if (!nk) continue;
    const p = Number(pos);
    if (!Number.isFinite(p)) continue;
    const prev = out[nk];
    out[nk] = prev === undefined ? p : Math.min(prev, p);
  }
  return out;
}
