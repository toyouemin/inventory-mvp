import { normalizeGenderValue } from "./clothingDimensionProfile";
import {
  parseGenderAndSize,
  normalizeSizeByPolicy,
  type SizePolicy,
} from "./categoryPolicy";
import type { OqmApparelSizeType, OqmCategoryProfile, OqmQuickCategoryKind } from "./oqmPipelineModel";
import { normalizeOqmSizeToken } from "./oqmPipelineModel";
import type { NormalizedStockLine } from "./types";

const TSHIRT_LIKE_CATEGORIES = new Set(["티셔츠", "티셔츠(아울렛)"]);

/** 티셔츠류 남/여 분리 — 입력판 표준 전사이즈 눈금 */
const TSHIRT_FULL_FEMALE = ["85", "90", "95", "100"] as const;
const TSHIRT_FULL_MALE = ["95", "100", "105", "110"] as const;

const TRAINING_FULL_FEMALE = ["85", "90", "95", "100", "105"] as const;
const TRAINING_FULL_MALE = ["95", "100", "105", "110", "115"] as const;

/** 전 사이즈 가능: 여성 105·115·120 은 없어도 됨 */
const OPTIONAL_FEMALE_SIZES = new Set(["105", "115", "120"]);

export type OqmFullSizeRequirements =
  | { kind: "genderSplit"; female: readonly string[]; male: readonly string[] }
  | { kind: "unisex"; sizes: readonly string[] };

/** 카테고리·입력판(칸) 기준으로 필요한 전사이즈 목록 */
export function resolveOqmFullSizeRequirements(
  category: string,
  profile: OqmCategoryProfile,
  categoryKind: OqmQuickCategoryKind,
  apparelSizeType: OqmApparelSizeType
): OqmFullSizeRequirements | null {
  const cat = category.trim();
  if (!cat || categoryKind === "general") return null;

  if (categoryKind === "training") {
    const female = profile.femaleSizes.length > 0 ? profile.femaleSizes : [...TRAINING_FULL_FEMALE];
    const male = profile.maleSizes.length > 0 ? profile.maleSizes : [...TRAINING_FULL_MALE];
    return { kind: "genderSplit", female, male };
  }

  if (categoryKind !== "apparel") return null;

  const useGenderSplit =
    apparelSizeType === "genderSplit" &&
    (profile.sizePolicy === "genderSplit" ||
      profile.hasGenderSplitData ||
      TSHIRT_LIKE_CATEGORIES.has(cat));

  if (useGenderSplit) {
    if (TSHIRT_LIKE_CATEGORIES.has(cat)) {
      return { kind: "genderSplit", female: TSHIRT_FULL_FEMALE, male: TSHIRT_FULL_MALE };
    }
    const female = profile.femaleSizes;
    const male = profile.maleSizes;
    if (female.length === 0 && male.length === 0) return null;
    return { kind: "genderSplit", female, male };
  }

  const sizes =
    profile.sizePolicy === "unisexAlpha" ? profile.unisexAlphaSizes : profile.unisexSizes;
  if (sizes.length === 0) return null;
  return { kind: "unisex", sizes };
}

/** 전 사이즈 가능 판정용 — 여 105·115·120 제외 */
export function resolveOqmStockCapableRequirements(
  category: string,
  profile: OqmCategoryProfile,
  categoryKind: OqmQuickCategoryKind,
  apparelSizeType: OqmApparelSizeType
): OqmFullSizeRequirements | null {
  const base = resolveOqmFullSizeRequirements(category, profile, categoryKind, apparelSizeType);
  if (!base) return null;
  if (base.kind === "genderSplit") {
    const female = base.female.filter((s) => !OPTIONAL_FEMALE_SIZES.has(normalizeOqmSizeToken(s)));
    return { kind: "genderSplit", female, male: base.male };
  }
  return base;
}

function sizeKey(gender: string, size: string): string {
  const g = gender === "공용" ? "공용" : gender;
  return `${g}|${normalizeOqmSizeToken(size)}`;
}

function lineToSizeKey(line: NormalizedStockLine, sizePolicy: SizePolicy): string | null {
  const parsed = parseGenderAndSize(`${line.dimensions.gender ?? ""}${line.dimensions.size ?? ""}`);
  const gender = normalizeGenderValue((line.dimensions.gender ?? "").trim() || parsed.gender);
  const sizeRaw = (line.dimensions.size ?? "").trim() || parsed.size;
  const size = normalizeSizeByPolicy(sizePolicy, gender, sizeRaw);
  if (!size) return null;
  const genderKey = gender || "공용";
  return sizeKey(genderKey, size);
}

function collectProductSizeKeys(
  lines: NormalizedStockLine[],
  sizePolicy: SizePolicy
): Map<string, Set<string>> {
  const byProduct = new Map<string, Set<string>>();
  for (const line of lines) {
    const key = lineToSizeKey(line, sizePolicy);
    if (!key) continue;
    const set = byProduct.get(line.productId) ?? new Set<string>();
    set.add(key);
    byProduct.set(line.productId, set);
  }
  return byProduct;
}

function collectProductSizeStock(
  lines: NormalizedStockLine[],
  sizePolicy: SizePolicy
): Map<string, Map<string, number>> {
  const byProduct = new Map<string, Map<string, number>>();
  for (const line of lines) {
    const key = lineToSizeKey(line, sizePolicy);
    if (!key) continue;
    const map = byProduct.get(line.productId) ?? new Map<string, number>();
    map.set(key, (map.get(key) ?? 0) + Math.max(0, line.stock));
    byProduct.set(line.productId, map);
  }
  return byProduct;
}

function hasGenderSizes(keys: Set<string>, gender: "여" | "남", sizes: readonly string[]): boolean {
  return sizes.every((size) => keys.has(sizeKey(gender, size)));
}

function hasUnisexSizes(keys: Set<string>, sizes: readonly string[]): boolean {
  return sizes.every((size) => {
    const token = normalizeOqmSizeToken(size);
    return keys.has(sizeKey("공용", token)) || keys.has(sizeKey("", token));
  });
}

function productMeetsFullSize(keys: Set<string>, requirements: OqmFullSizeRequirements): boolean {
  if (requirements.kind === "genderSplit") {
    if (requirements.female.length > 0 && !hasGenderSizes(keys, "여", requirements.female)) return false;
    if (requirements.male.length > 0 && !hasGenderSizes(keys, "남", requirements.male)) return false;
    return requirements.female.length > 0 || requirements.male.length > 0;
  }
  return hasUnisexSizes(keys, requirements.sizes);
}

function hasGenderSizesWithStock(
  stockByKey: Map<string, number>,
  gender: "여" | "남",
  sizes: readonly string[]
): boolean {
  return sizes.every((size) => (stockByKey.get(sizeKey(gender, size)) ?? 0) > 0);
}

function hasUnisexSizesWithStock(stockByKey: Map<string, number>, sizes: readonly string[]): boolean {
  return sizes.every((size) => {
    const token = normalizeOqmSizeToken(size);
    const stock =
      stockByKey.get(sizeKey("공용", token)) ?? stockByKey.get(sizeKey("", token)) ?? 0;
    return stock > 0;
  });
}

function productMeetsStockCapable(
  stockByKey: Map<string, number>,
  requirements: OqmFullSizeRequirements
): boolean {
  if (requirements.kind === "genderSplit") {
    if (requirements.female.length > 0 && !hasGenderSizesWithStock(stockByKey, "여", requirements.female)) {
      return false;
    }
    if (requirements.male.length > 0 && !hasGenderSizesWithStock(stockByKey, "남", requirements.male)) {
      return false;
    }
    return requirements.female.length > 0 || requirements.male.length > 0;
  }
  return hasUnisexSizesWithStock(stockByKey, requirements.sizes);
}

/** 카테고리 재고 중 전사이즈 옵션(SKU)을 모두 갖춘 productId 목록 */
export function listOqmProductIdsWithFullSizes(
  linesInCategory: NormalizedStockLine[],
  requirements: OqmFullSizeRequirements | null,
  sizePolicy: SizePolicy
): string[] {
  if (!requirements) return [];
  const byProduct = collectProductSizeKeys(linesInCategory, sizePolicy);
  const out: string[] = [];
  for (const [productId, keys] of byProduct) {
    if (productMeetsFullSize(keys, requirements)) out.push(productId);
  }
  return out;
}

/** 필수 사이즈마다 재고 1 이상인 productId (여 105·115·120 제외 규칙은 requirements에 반영) */
export function listOqmProductIdsWithStockCapableSizes(
  linesInCategory: NormalizedStockLine[],
  requirements: OqmFullSizeRequirements | null,
  sizePolicy: SizePolicy
): string[] {
  if (!requirements) return [];
  const byProduct = collectProductSizeStock(linesInCategory, sizePolicy);
  const out: string[] = [];
  for (const [productId, stockByKey] of byProduct) {
    if (productMeetsStockCapable(stockByKey, requirements)) out.push(productId);
  }
  return out;
}
