/**
 * Prisma/클라이언트: 제외(중복) 사유를 사람이 읽는 한 줄로. 제외·parseStatus=excluded 일 때만 사용.
 */
const EXCLUDE_REASON_USER_LABEL: Record<string, string> = {
  duplicate_gender_filter: "중복 (성별 기준 필터)",
  duplicate_same_size: "중복 (동일 사이즈)",
  duplicate_first_row_kept: "중복 (대표값 유지)",
};

const EXCLUDE_REASON_DETAIL_LABEL: Record<string, string> = {
  /** 동일 토큰 사이즈 반복(그룹 내 첫 행은 유지) */
  duplicate_same_size: "동일 사이즈",
  /** first_row + 동일 사이즈 메커니즘을 둘 다 표기할 때 reason과 조합 */
  first_row_keeper: "대표값 유지",
};

/**
 * @returns 제외가 아닌 행이면 "".
 */
export function labelExcludeForDisplay(
  r: { excluded?: boolean; parseStatus?: string; excludeReason?: string | null; excludeDetail?: string | null }
): string {
  const isEx = Boolean(r.excluded) || r.parseStatus === "excluded";
  if (!isEx) return "";
  const code = (r.excludeReason ?? "").trim();
  const det = (r.excludeDetail ?? "").trim();
  if (code === "duplicate_first_row_kept" && det === "duplicate_same_size") {
    return "중복 (동일 사이즈 · 대표값 유지)";
  }
  if (code) {
    const base = EXCLUDE_REASON_USER_LABEL[code] ?? code;
    if (det) {
      if (code === "duplicate_first_row_kept" && det === "duplicate_same_size") {
        return "중복 (동일 사이즈 · 대표값 유지)";
      }
      const dlab = EXCLUDE_REASON_DETAIL_LABEL[det] ?? det;
      return `${base} · ${dlab}`;
    }
    return base;
  }
  if (det) {
    return EXCLUDE_REASON_USER_LABEL[det] ?? det;
  }
  return "";
}

/** DB에 excludeReason이 없는 예전 제외 행(레거시) */
export function labelExcludeForDisplayWithFallback(
  r: { excluded?: boolean; parseStatus?: string; parseReason?: string | null; excludeReason?: string | null; excludeDetail?: string | null }
): string {
  const s = labelExcludeForDisplay(r);
  if (s) return s;
  const isEx = Boolean(r.excluded) || r.parseStatus === "excluded";
  if (isEx) {
    const p = (r.parseReason ?? "").trim();
    if (p) return p;
  }
  return "";
}

export { EXCLUDE_REASON_USER_LABEL, EXCLUDE_REASON_DETAIL_LABEL };
