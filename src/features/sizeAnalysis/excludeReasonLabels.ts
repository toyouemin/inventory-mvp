/**
 * 화면·엑셀 표시 전용: API/DB `parseStatus`·코드 값은 그대로 두고,
 * 짧은 상태/사유 라벨만 파생해 보여줍니다.
 */

/** UI 표시용 — 행 `parseStatus` + 제외 메타 */
export const DISPLAY_STATUS = {
  /** `excluded` + duplicate_* (excludeReason) */
  duplicate: "중복자",
  corrected: "수정완료",
  needs_review: "검토필요",
  unresolved: "미분류",
  auto_confirmed: "자동",
  /** 중복이 아닌 기타 제외(빈 수량 등) */
  excluded_other: "제외",
} as const;

/** UI 사유(짧은 코드) — `excludeReason`/`parseReason`에서 표시용으로만 매핑 */
export const DISPLAY_REASON = {
  same_club_name: "동일 클럽+이름",
  no_size: "사이즈 없음",
  no_gender: "성별 없음",
  size_ambiguous: "사이즈 불명",
} as const;

function isDuplicateExcluded(r: {
  parseStatus?: string | null;
  excludeReason?: string | null;
}): boolean {
  if (String(r.parseStatus ?? "") !== "excluded") return false;
  const code = String(r.excludeReason ?? "").trim();
  if (code.startsWith("duplicate_")) return true;
  return false;
}

/**
 * 한 줄(테이블·엑셀)용 표시 **상태** — `parseStatus` / 제외만 반영(판정 로직 없음)
 */
export function labelSizeAnalysisParseStatusForRow(r: {
  parseStatus?: string | null;
  excludeReason?: string | null;
}): string {
  const st = String(r.parseStatus ?? "");
  if (st === "excluded") {
    return isDuplicateExcluded(r) ? DISPLAY_STATUS.duplicate : DISPLAY_STATUS.excluded_other;
  }
  if (st === "needs_review") return DISPLAY_STATUS.needs_review;
  if (st === "unresolved") return DISPLAY_STATUS.unresolved;
  if (st === "corrected") return DISPLAY_STATUS.corrected;
  if (st === "auto_confirmed") return DISPLAY_STATUS.auto_confirmed;
  return st;
}

/**
 * `excludeReason` / `excludeDetail` → 짧은 사유 (제외·중복 행)
 */
function reasonFromExcludeMeta(r: {
  excludeReason?: string | null;
  excludeDetail?: string | null;
}): string {
  const code = String(r.excludeReason ?? "").trim();
  const det = String(r.excludeDetail ?? "").trim();

  if (
    code === "duplicate_person_group" ||
    det === "same_club_same_name_keep_one" ||
    det === "same_club_same_name_same_size_keep_one"
  ) {
    return DISPLAY_REASON.same_club_name;
  }
  if (code === "duplicate_gender_filter") {
    return DISPLAY_REASON.no_gender;
  }
  if (
    code === "duplicate_same_size" ||
    (code === "duplicate_first_row_kept" && det === "duplicate_same_size") ||
    det === "duplicate_same_size" ||
    code === "duplicate_first_row_kept"
  ) {
    return DISPLAY_REASON.size_ambiguous;
  }
  return "";
}

/**
 * `parseReason` 긴 문장(저장 값) → 짧은 사유(표시). 키워드/부분일치만 사용.
 */
function reasonFromFreeText(parseReason: string | null | undefined, parseStatus: string): string {
  const raw = String(parseReason ?? "").trim();
  if (!raw) {
    if (parseStatus === "unresolved") return DISPLAY_REASON.size_ambiguous;
    return "";
  }

  if (raw === "사이즈 없음" || raw.startsWith("사이즈 없음") || (raw.includes("빈") && raw.includes("수량") && !raw.includes("범위"))) {
    return DISPLAY_REASON.no_size;
  }
  if (
    raw === "0/빈 수량 제외" ||
    (raw.includes("0/빈") && raw.includes("수량")) ||
    (raw.includes("빈") && raw.includes("수량") && parseStatus === "excluded")
  ) {
    return DISPLAY_REASON.no_size;
  }
  if (
    raw.includes("성별") &&
    (raw.includes("없") || raw.includes("미입력") || raw.includes("불가") || raw.includes("공용") || raw.includes("필터"))
  ) {
    return DISPLAY_REASON.no_gender;
  }
  if (raw === "사이즈 정규화 불가" || raw === "M/W+숫자이나 유효 치수가 아님" || raw.includes("정규화 불가")) {
    return DISPLAY_REASON.size_ambiguous;
  }
  if (
    raw.includes("검토") ||
    raw.includes("FREE") ||
    raw.includes("혼합") ||
    raw.includes("범위 초과") ||
    raw.includes("나눌 수 없") ||
    (raw.includes("주문") && raw.includes("없"))
  ) {
    return DISPLAY_REASON.size_ambiguous;
  }
  if (raw.includes("레거시") || raw.includes("접두") || raw.startsWith("수동:")) {
    return DISPLAY_REASON.size_ambiguous;
  }
  if (parseStatus === "needs_review" && raw.length > 0) {
    return DISPLAY_REASON.size_ambiguous;
  }
  if (parseStatus === "unresolved") {
    return DISPLAY_REASON.size_ambiguous;
  }
  return "";
}

/**
 * **사유** 열(제외/비제외 모두) — DB 필드는 읽기만 하고, 표시는 짧은 코드로만.
 */
export function labelSizeAnalysisReasonForRow(r: {
  parseStatus?: string | null;
  parseReason?: string | null;
  excluded?: boolean;
  excludeReason?: string | null;
  excludeDetail?: string | null;
}): string {
  const st = String(r.parseStatus ?? "");
  const isEx = Boolean(r.excluded) || st === "excluded";

  if (isEx) {
    const fromCode = reasonFromExcludeMeta(r);
    if (fromCode) return fromCode;
    const fromText = reasonFromFreeText(r.parseReason, st);
    if (fromText) return fromText;
    return "";
  }

  if (st === "needs_review" || st === "unresolved") {
    return reasonFromFreeText(r.parseReason, st);
  }
  if (st === "corrected") {
    return "";
  }
  return "";
}

/**
 * @returns 제외가 아닌 행이면 "".
 * 제외(중복) 메타 → 짧은 **사유** (`labelSizeAnalysisReasonForRow`와 정합).
 */
export function labelExcludeForDisplay(
  r: { excluded?: boolean; parseStatus?: string; excludeReason?: string | null; excludeDetail?: string | null; parseReason?: string | null }
): string {
  const isEx = Boolean(r.excluded) || r.parseStatus === "excluded";
  if (!isEx) return "";
  return labelSizeAnalysisReasonForRow(r);
}

/** `excludeReason` 없는 옛 제외 행: `parseReason`에서 짧은 사유 시도 */
export function labelExcludeForDisplayWithFallback(
  r: {
    excluded?: boolean;
    parseStatus?: string;
    parseReason?: string | null;
    excludeReason?: string | null;
    excludeDetail?: string | null;
  }
): string {
  return labelSizeAnalysisReasonForRow(r);
}

const PARSE_STATUS_BASE: Record<string, string> = {
  auto_confirmed: DISPLAY_STATUS.auto_confirmed,
  needs_review: DISPLAY_STATUS.needs_review,
  unresolved: DISPLAY_STATUS.unresolved,
  corrected: DISPLAY_STATUS.corrected,
  excluded: DISPLAY_STATUS.excluded_other,
};

/** (레거시) 전역 필터/요약 — 짧은 라벨 */
export { PARSE_STATUS_BASE };

/** (레거시 export) — 빈 Record 대체로 외부에서 오래된 import 깨짐 방지 */
export const EXCLUDE_REASON_USER_LABEL: Record<string, string> = {};
export const EXCLUDE_REASON_DETAIL_LABEL: Record<string, string> = {};
