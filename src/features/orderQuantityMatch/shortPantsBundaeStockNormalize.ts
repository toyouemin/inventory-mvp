import type { Product, ProductVariant } from "@/app/products/types";
import { normalizeGenderValue } from "./clothingDimensionProfile";
import { normalizeText } from "./textNormalize";

/**
 * 옵션(color) 예: "3부-여", "4부-남" — 길이(×부) + 성별. 사이즈 컬럼은 85, 90 등 숫자만.
 * 재고 매칭 키는 length + 숫자를 합쳐 "3부-85" 형으로 유지 (동일 85라도 3부/4부 구분).
 */
const BUNDAE_COLOR_GENDER = /^(\d+부)\s*[-/－–]?\s*(여|남|공용)\s*$/u;

/** 이미 "3부-85" 처럼 병합된 size */
const BUNDAE_SIZE_MERGED = /^(\d+부)-?(\d{2,3})$/u;

const BUNDAE_CATEGORY_SHORTS = new Set(["반바지", "7부바지"]);

function normalizedBundaeSizeToken(s: string): string {
  return normalizeText(s).toUpperCase().replace(/\s+/g, "");
}

/**
 * @returns gender·size를 덮어써야 하면 { gender, size }, 아니면 null
 */
export function tryMergeBundaeShortPantsVariant(product: Product, variant: ProductVariant): { gender: string; size: string } | null {
  if (!BUNDAE_CATEGORY_SHORTS.has(normalizeText(product.category ?? ""))) return null;

  const colorRaw = normalizeText(variant.color ?? "");
  const sizeRaw = normalizeText(variant.size ?? "");
  const genderDb = normalizeText(variant.gender ?? "");

  const mColor = colorRaw.match(BUNDAE_COLOR_GENDER);
  if (!mColor) return null;

  const lengthPart = mColor[1]!; // 3부
  const gFromColor = mColor[2]! as "여" | "남" | "공용";
  const genderResolved = pickBundaeGender(genderDb, gFromColor);

  if (/^\d{2,3}$/.test(sizeRaw)) {
    return { gender: genderResolved, size: `${lengthPart}-${sizeRaw}` };
  }

  const merged = sizeRaw.match(BUNDAE_SIZE_MERGED);
  if (merged && merged[1] === lengthPart) {
    return { gender: genderResolved, size: `${merged[1]}-${merged[2]}` };
  }

  return null;
}

function pickBundaeGender(db: string, fromColor: "여" | "남" | "공용"): string {
  if (db) {
    const g = normalizeGenderValue(db);
    if (g) return g;
  }
  return normalizeGenderValue(fromColor) || fromColor;
}

/** "3부-85" 등 반바지 병합 size (입력판·추천에서 유효 size로 인정) */
export function isBundaeMergedSizeToken(raw: string | null | undefined): boolean {
  const t = normalizedBundaeSizeToken(String(raw ?? ""));
  return /^\d+부-?\d{2,3}$/u.test(t);
}
