import type { NormalizedRow } from "./types";
import { extractSizeGenderQty, normalizeGender, normalizeSize } from "./normalize";

const NUMERIC_SIZES = new Set(["80", "85", "90", "95", "100", "105", "110", "115", "120"]);

/** M100 / W90 (공백 허용) */
const MW_NUMERIC = /^([MWmw])\s*(\d{2,3})$/;
/** size가 숫자만 */
const DIGITS_ONLY = /^(\d{2,3})$/;

export type PersonSizePolicyResult = {
  standardizedSize: string | undefined;
  genderNormalized: "남" | "여" | "공용" | undefined;
  parseStatus: NormalizedRow["parseStatus"];
  parseConfidence: number;
  parseReason: string;
};

/**
 * size 열·성별 열 기준 (사이즈분석 people 경로) 정규화.
 * - M/W+숫자 → 최우선, gender와 불일치해도 인정 → 자동확정
 * - 숫자만(80~120) → 남→M, 여→W 보정 → 수정완료(corrected)
 * - 그 외 S/M/L/XL 등 → normalizeSize → 자동확정
 * - size 없음/비정상 → 검토필요
 */
export function normalizePersonSizePolicy(sizeRaw: string | undefined, genderRaw: string | undefined): PersonSizePolicyResult {
  const genderFromCol = normalizeGender(genderRaw);
  const raw = String(sizeRaw ?? "").trim();
  if (!raw) {
    return {
      standardizedSize: undefined,
      genderNormalized: genderFromCol,
      parseStatus: "needs_review",
      parseConfidence: 0.2,
      parseReason: "사이즈 없음",
    };
  }

  const m1 = raw.match(MW_NUMERIC);
  if (m1) {
    const letter = m1[1]!.toUpperCase() as "M" | "W";
    const num = m1[2]!;
    if (NUMERIC_SIZES.has(num)) {
      return {
        standardizedSize: `${letter}${num}`,
        genderNormalized: genderFromCol,
        parseStatus: "auto_confirmed",
        parseConfidence: 0.95,
        parseReason: "접두(M/W) 사이즈",
      };
    }
    return {
      standardizedSize: undefined,
      genderNormalized: genderFromCol,
      parseStatus: "needs_review",
      parseConfidence: 0.25,
      parseReason: "M/W+숫자이나 유효 치수가 아님",
    };
  }

  const m2 = raw.match(DIGITS_ONLY);
  if (m2) {
    const num = m2[1]!;
    if (NUMERIC_SIZES.has(num)) {
      if (genderFromCol === "남") {
        return {
          standardizedSize: `M${num}`,
          genderNormalized: genderFromCol,
          parseStatus: "corrected",
          parseConfidence: 0.9,
          parseReason: "숫자 사이즈 + 성별(남) → M접두",
        };
      }
      if (genderFromCol === "여") {
        return {
          standardizedSize: `W${num}`,
          genderNormalized: genderFromCol,
          parseStatus: "corrected",
          parseConfidence: 0.9,
          parseReason: "숫자 사이즈 + 성별(여) → W접두",
        };
      }
      return {
        standardizedSize: undefined,
        genderNormalized: genderFromCol,
        parseStatus: "needs_review",
        parseConfidence: 0.35,
        parseReason: "숫자만 — 성별(남/여)로 접두 보정 불가(공용/미입력)",
      };
    }
  }

  const st = normalizeSize(raw);
  if (st) {
    return {
      standardizedSize: st,
      genderNormalized: genderFromCol,
      parseStatus: "auto_confirmed",
      parseConfidence: 0.86,
      parseReason: "알파/기존 토큰 사이즈",
    };
  }

  return {
    standardizedSize: undefined,
    genderNormalized: genderFromCol,
    parseStatus: "needs_review",
    parseConfidence: 0.3,
    parseReason: "사이즈 정규화 불가",
  };
}

/** size/성별 열로 실패한 경우에만 합쳐진 텍스트로 보조(레거시) */
export function normalizePersonWithFallback(sizeRaw: string | undefined, genderRaw: string | undefined, mergedFallback: string): PersonSizePolicyResult {
  const primary = normalizePersonSizePolicy(sizeRaw, genderRaw);
  if (primary.standardizedSize) return primary;
  const p = extractSizeGenderQty(mergedFallback);
  if (p.size) {
    return {
      standardizedSize: p.size,
      genderNormalized: p.gender ?? primary.genderNormalized,
      parseStatus: p.status as NormalizedRow["parseStatus"],
      parseConfidence: p.confidence,
      parseReason: `레거시 텍스트 파싱: ${p.reason}`,
    };
  }
  return primary;
}

/**
 * “클럽+이름+동일 사이즈” **사람 기준** 중복은 적용하지 않습니다.
 * 동일 원본 셀(시트+행)에서 **완전히 같은 주문 시그니처**가 둘 이상이면
 * `analyzeDuplicateRows`에서만 중복으로 잡습니다.
 */
export function applyDuplicateSizePolicy(rows: NormalizedRow[]): NormalizedRow[] {
  return rows.map((r) => ({ ...r }));
}
