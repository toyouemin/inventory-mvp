import type { Product, ProductVariant } from "@/app/products/types";
import { normalizeGenderValue } from "./clothingDimensionProfile";
import { normalizeText } from "./textNormalize";

/**
 * 반바지/7부바지: `gender`에 "3부-여"·"4부-남"처럼 길이(×부)+성별,
 * 또는 `gender`가 일반 성별 + `size`가 "3부-95" 병합 형태일 때 매칭용 size "3부-95"로 통일.
 * color 컬럼은 읽지 않는다(라벨 전용).
 */
const BUNDAE_GENDER_TOKEN = /^(\d+부)\s*[-/－–]?\s*(여|남|공용)\s*$/u;

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

  const sizeRaw = normalizeText(variant.size ?? "");
  const genderDb = normalizeText(variant.gender ?? "");

  const mGender = genderDb.match(BUNDAE_GENDER_TOKEN);
  if (mGender) {
    const lengthPart = mGender[1]!;
    const genderResolved = resolveBundaeGenderFromToken(mGender[2]! as "여" | "남" | "공용");

    if (/^\d{2,3}$/.test(sizeRaw)) {
      return { gender: genderResolved, size: `${lengthPart}-${sizeRaw}` };
    }

    const merged = sizeRaw.match(BUNDAE_SIZE_MERGED);
    if (merged && merged[1] === lengthPart) {
      return { gender: genderResolved, size: `${merged[1]}-${merged[2]}` };
    }

    return null;
  }

  const mergedOnly = sizeRaw.match(BUNDAE_SIZE_MERGED);
  if (!mergedOnly) return null;
  const genderCanon = normalizeGenderValue(genderDb);
  if (genderCanon !== "여" && genderCanon !== "남" && genderCanon !== "공용") return null;

  return { gender: genderCanon, size: `${mergedOnly[1]}-${mergedOnly[2]}` };
}

function resolveBundaeGenderFromToken(token: "여" | "남" | "공용"): string {
  return normalizeGenderValue(token) || token;
}

/** "3부-85" 등 반바지 병합 size (입력판·추천에서 유효 size로 인정) */
export function isBundaeMergedSizeToken(raw: string | null | undefined): boolean {
  const t = normalizedBundaeSizeToken(String(raw ?? ""));
  return /^\d+부-?\d{2,3}$/u.test(t);
}
