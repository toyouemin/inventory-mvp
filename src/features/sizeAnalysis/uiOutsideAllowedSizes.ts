import { normalizeSize, SIZE_ANALYSIS_ALLOWED_NUMERIC } from "./normalize";
import { preprocessSizeForGenderNumParse } from "./personSizePolicy";

const ALLOW = SIZE_ANALYSIS_ALLOWED_NUMERIC;

/** 기존 화면과 동일: 남성 + 90(M90 등)은 별도 확인 대상으로 취급 */
export function isMaleOutOfRange90Row(r: {
  genderNormalized?: string | null;
  genderRaw?: string | null;
  standardizedSize?: string | null;
  sizeRaw?: string | null;
}): boolean {
  const gender = String(r.genderNormalized ?? r.genderRaw ?? "")
    .trim()
    .toLowerCase();
  const isMale = gender === "남" || gender === "남자" || gender === "m";
  if (!isMale) return false;
  const size = String(r.standardizedSize ?? r.sizeRaw ?? "")
    .trim()
    .toUpperCase();
  return size === "90" || size === "M90" || size === "90M";
}

/**
 * 전체보기 테이블용 확인 필터: 정규화된/입력 사이즈가 분석 정책 허용 목록을 벗어난 경우.
 * 집계·중복 로직과 무관(UI 전용).
 */
export function uiRowOutsideAllowedSizesForAssistFilter(r: {
  sizeRaw?: string | null;
  standardizedSize?: string | null;
}): boolean {
  const raw = String(r.sizeRaw ?? "").trim();
  const std = String(r.standardizedSize ?? "").trim();
  if (!raw && !std) return false;

  if (isMaleOutOfRange90Row(r)) return true;

  const mwm = std.match(/^([MW])(\d{2,3})$/i);
  if (mwm) {
    const num = mwm[2]!.replace(/^0+/, "") || mwm[2]!;
    return !ALLOW.has(num);
  }

  if (std) {
    const canon = normalizeSize(std);
    if (canon == null) return true;
    if (/^\d+$/.test(canon)) return !ALLOW.has(canon);
  }

  if (!std && raw) return rawHasGarmentNumericOutOfBand(raw);
  return false;
}

function rawHasGarmentNumericOutOfBand(raw: string): boolean {
  const s = preprocessSizeForGenderNumParse(raw);
  if (!s) return false;
  const re = /(?<![0-9])(\d{2,3})(?![0-9])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const token = m[1]!;
    if (ALLOW.has(token)) continue;
    const n = Number(token);
    if (n >= 70 && n <= 150) return true;
  }
  return false;
}

/** 중복 판정으로 제외(parseStatus 제외 · duplicate_*). 집계와 무관한 UI 카운트·표시 신뢰도 보정에 공통 사용 */
export function uiRowExcludedAsDuplicateExcluded(r: {
  parseStatus?: string | null;
  excludeReason?: string | null;
}): boolean {
  if (String(r.parseStatus ?? "") !== "excluded") return false;
  return String(r.excludeReason ?? "").trim().startsWith("duplicate_");
}

/**
 * 결과 요약·필터 표시 전용 행 개수 (집계/parse 필드 수정 없음).
 * - 허용 밖 표기(UI 기준): uiRowOutsideAllowedSizesForAssistFilter
 * - 제외 행 중 duplicate_* 만 카운트에서 제외 (다른 제외 행은 포함)
 */
export function countUiOutsideAllowedSizesAssistEligibleRows(rows: Iterable<{
  parseStatus?: string | null;
  excludeReason?: string | null;
  sizeRaw?: string | null;
  standardizedSize?: string | null;
}>): number {
  let n = 0;
  for (const r of rows) {
    if (uiRowExcludedAsDuplicateExcluded(r)) continue;
    if (uiRowOutsideAllowedSizesForAssistFilter(r)) n++;
  }
  return n;
}

/**
 * 화면 표시만: 범위 밖 행은 신뢰도를 낮게 보임. 원본 parseConfidence 필드는 그대로.
 * 중복으로 제외된 행(parseStatus 제외 · duplicate_* )은 표시 신뢰도도 원본 유지.
 */
export const OUT_OF_RANGE_UI_DISPLAY_CONFIDENCE = 0.36;

export function displayParseConfidenceUi(r: {
  parseConfidence?: number | null;
  sizeRaw?: string | null;
  standardizedSize?: string | null;
  parseStatus?: string | null;
  excludeReason?: string | null;
}): number {
  const base = Number(r.parseConfidence ?? 0);
  const fallback = Number.isFinite(base) ? base : 0;
  if (uiRowExcludedAsDuplicateExcluded(r)) return fallback;
  if (!uiRowOutsideAllowedSizesForAssistFilter(r)) return fallback;
  return OUT_OF_RANGE_UI_DISPLAY_CONFIDENCE;
}

/**
 * 상태 열·모바일 뱃지: 범위 밖이면 '사이즈 확인'을 corrected/자동확정보다 우선(제외·중복 행은 제외).
 */
export function shouldPrioritizeSizeCheckUiDisplay(r: {
  parseStatus?: string | null;
  excludeReason?: string | null;
  excluded?: boolean | null;
  genderNormalized?: string | null;
  genderRaw?: string | null;
  sizeRaw?: string | null;
  standardizedSize?: string | null;
}): boolean {
  if (Boolean(r.excluded) || String(r.parseStatus ?? "") === "excluded") return false;
  return uiRowOutsideAllowedSizesForAssistFilter(r);
}

/** 표시 전용 접미(실제 저장 parseReason 변경 없음). `사이즈 불명`(제외 라벨)과 별도 문구 유지 */
export function outsideAllowedSizesDisplayTail(r: {
  genderNormalized?: string | null;
  genderRaw?: string | null;
  sizeRaw?: string | null;
  standardizedSize?: string | null;
}): string {
  if (isMaleOutOfRange90Row(r)) return "";
  return uiRowOutsideAllowedSizesForAssistFilter(r) ? "허용 사이즈 밖 표기(확인)" : "";
}
