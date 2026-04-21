/**
 * 공용 숫자형 의류 카테고리: 재고/주문 사이즈 표기(숫자·영문)를 동일 매칭 키로 맞춘다.
 * 공용 전제 하에 S↔85, M↔90 등으로 정규화한다.
 */

import { normalizeText } from "./textNormalize";

export const UNISEX_NUMERIC_APPAREL_CATEGORIES = ["맨투맨", "티셔츠", "바람막이"] as const;

/** 매칭·입력 키에 쓰는 공용 사이즈(숫자) 열 */
export const UNISEX_NUMERIC_APPAREL_SIZES = ["85", "90", "95", "100", "105", "110", "115"] as const;

const KNOWN_NUM = new Set<string>(UNISEX_NUMERIC_APPAREL_SIZES);

/** 입력칸 라벨 (통일 표기) */
export const UNISEX_NUMERIC_APPAREL_INPUT_LABELS: Record<string, string> = {
  "85": "공용S(85)",
  "90": "공용M(90)",
  "95": "공용L(95)",
  "100": "공용XL(100)",
  "105": "공용2XL(105)",
  "110": "공용3XL(110)",
  "115": "공용4XL(115)",
};

function stripUnisexPrefixFromSizeToken(raw: string): string {
  let s = normalizeText(raw).replace(/\s+/g, "");
  const lower = s.toLowerCase();
  for (const p of ["공용", "남녀", "남여", "unisex", "u"]) {
    if (lower.startsWith(p.toLowerCase())) {
      s = s.slice(p.length);
      break;
    }
  }
  return s;
}

/**
 * category·gender가 공용 숫자형 의류+공용일 때만 숫자 토큰으로 통일, 그 외에는 `sizeRaw` 그대로 반환.
 */
export function isUnisexNumericApparelCategory(categoryNormalized: string): boolean {
  return (UNISEX_NUMERIC_APPAREL_CATEGORIES as readonly string[]).includes(categoryNormalized);
}

export function normalizeCommonUnisexSizeToken(sizeRaw: string): string {
  const s0 = normalizeText(sizeRaw);
  if (!s0) return "";

  const rest = stripUnisexPrefixFromSizeToken(s0);
  if (!rest) return s0;

  if (/^\d+$/.test(rest)) {
    return KNOWN_NUM.has(rest) ? rest : s0;
  }

  const upper = rest.toUpperCase().replace(/\s+/g, "");
  const alphaToNum: Record<string, string> = {
    S: "85",
    M: "90",
    L: "95",
    XL: "100",
    XXL: "105",
    "2XL": "105",
    XXXL: "110",
    "3XL": "110",
    XXXXL: "115",
    "4XL": "115",
  };
  return alphaToNum[upper] ?? s0;
}

export function normalizeUnisexNumericApparelSizeForMatch(
  categoryNormalized: string,
  genderNormalized: string,
  sizeRaw: string
): string {
  if (!isUnisexNumericApparelCategory(categoryNormalized)) return sizeRaw;
  if (genderNormalized !== "공용") return sizeRaw;
  return normalizeCommonUnisexSizeToken(sizeRaw);
}

export function formatUnisexNumericApparelInputLabel(matchSizeToken: string): string {
  return UNISEX_NUMERIC_APPAREL_INPUT_LABELS[matchSizeToken] ?? `공용${matchSizeToken}`;
}
