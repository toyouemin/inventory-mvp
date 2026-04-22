import type { NormalizedStockLine } from "./types";
import { normalizeText } from "./textNormalize";

export type StockScopeType = "top" | "bottom" | "outer" | "set" | "single" | "other";

export type SizePolicy = "genderSplit" | "unisexNumeric" | "unisexAlpha" | "free" | "custom";

export type CategoryProfile = {
  label: string;
  stockScopeType: StockScopeType;
  sizePolicy?: SizePolicy;
};

export const CATEGORY_PROFILES: Record<string, CategoryProfile> = {
  긴팔티: { label: "긴팔티", stockScopeType: "top", sizePolicy: "genderSplit" },
  맨투맨: { label: "맨투맨", stockScopeType: "top", sizePolicy: "unisexNumeric" },
  바람막이: { label: "바람막이", stockScopeType: "outer", sizePolicy: "unisexNumeric" },
  반바지: { label: "반바지", stockScopeType: "bottom", sizePolicy: "genderSplit" },
  "7부바지": { label: "7부바지", stockScopeType: "bottom", sizePolicy: "genderSplit" },
  스커트: { label: "스커트", stockScopeType: "bottom", sizePolicy: "genderSplit" },
  오버핏: { label: "오버핏", stockScopeType: "top", sizePolicy: "unisexNumeric" },
  "트레이닝(아울렛)": { label: "트레이닝(아울렛)", stockScopeType: "set", sizePolicy: "custom" },
  트레이닝복: { label: "트레이닝복", stockScopeType: "set", sizePolicy: "custom" },
  티셔츠: { label: "티셔츠", stockScopeType: "top", sizePolicy: "genderSplit" },
  "티셔츠(아울렛)": { label: "티셔츠(아울렛)", stockScopeType: "top", sizePolicy: "genderSplit" },
};

const CATEGORY_POLICY_STORAGE_KEY = "oqm.categoryPolicyStore.v1";

const NUM_TO_ALPHA: Record<string, string> = {
  "85": "S",
  "90": "M",
  "95": "L",
  "100": "XL",
  "105": "2XL",
  "110": "3XL",
  "115": "4XL",
};

const ALPHA_TO_NUM: Record<string, string> = Object.fromEntries(
  Object.entries(NUM_TO_ALPHA).map(([num, alpha]) => [alpha, num])
);

export const UNISEX_NUMERIC_SIZES = ["85", "90", "95", "100", "105", "110", "115"] as const;
export const UNISEX_ALPHA_SIZES = ["S", "M", "L", "XL", "2XL", "3XL", "4XL"] as const;

function normalizeSizeToken(raw: string | null | undefined): string {
  return normalizeText(raw).toUpperCase().replace(/\s+/g, "");
}

export function normalizeGenderLabel(raw: string | null | undefined): "여" | "남" | "공용" | "" {
  const t = normalizeText(raw).toUpperCase().replace(/\s+/g, "");
  if (!t) return "";
  if (["여", "여자", "여성", "F", "FEMALE", "W", "WOMAN", "WOMEN"].includes(t)) return "여";
  if (["남", "남자", "남성", "M", "MALE", "MAN", "MEN", "MENS"].includes(t)) return "남";
  if (["공용", "남녀공용", "유니섹스", "UNISEX", "UNI", "U"].includes(t)) return "공용";
  return "";
}

export function parseGenderAndSize(raw: string): { gender: "여" | "남" | "공용" | ""; size: string } {
  const compact = normalizeText(raw).replace(/\s+/g, "");
  if (!compact) return { gender: "", size: "" };

  const pairs: Array<{ prefix: string; gender: "여" | "남" | "공용" }> = [
    { prefix: "남녀공용", gender: "공용" },
    { prefix: "유니섹스", gender: "공용" },
    { prefix: "공용", gender: "공용" },
    { prefix: "여성", gender: "여" },
    { prefix: "여자", gender: "여" },
    { prefix: "여", gender: "여" },
    { prefix: "남성", gender: "남" },
    { prefix: "남자", gender: "남" },
    { prefix: "남", gender: "남" },
  ];
  for (const p of pairs) {
    if (compact.startsWith(p.prefix)) {
      return { gender: p.gender, size: normalizeSizeToken(compact.slice(p.prefix.length)) };
    }
  }
  return { gender: "", size: normalizeSizeToken(compact) };
}

export function inferSizePolicy(rows: Array<{ gender?: string; size?: string }>): SizePolicy | null {
  let hasMaleOrFemale = false;
  let numericCount = 0;
  let alphaCount = 0;
  let freeCount = 0;
  let unisexCount = 0;

  for (const r of rows) {
    const g = normalizeGenderLabel(r.gender);
    const merged = parseGenderAndSize(`${r.gender ?? ""}${r.size ?? ""}`);
    const gender = g || merged.gender;
    const size = normalizeSizeToken(r.size) || merged.size;
    if (gender === "여" || gender === "남") hasMaleOrFemale = true;
    if (gender === "공용") unisexCount += 1;
    if (size === "F" || size === "FREE") freeCount += 1;
    if (/^\d{2,3}$/.test(size)) numericCount += 1;
    if (/^(XXS|XS|S|M|L|XL|XXL|XXXL|XXXXL|[2-9]XL)$/.test(size)) alphaCount += 1;
  }

  if (hasMaleOrFemale) return "genderSplit";
  if (freeCount > 0 && freeCount === rows.length) return "free";
  if (unisexCount > 0 && numericCount >= alphaCount) return "unisexNumeric";
  if (unisexCount > 0 && alphaCount > numericCount) return "unisexAlpha";
  if (numericCount > 0 && alphaCount === 0) return "unisexNumeric";
  if (alphaCount > 0 && numericCount === 0) return "unisexAlpha";
  if (numericCount > 0 && alphaCount > 0) return "custom";
  return null;
}

export function inferStockScopeType(categoryRaw: string): StockScopeType {
  const category = normalizeText(categoryRaw);
  const preset = CATEGORY_PROFILES[category];
  if (preset) return preset.stockScopeType;
  if (/트레이닝|세트/.test(category)) return "set";
  if (/바지|팬츠|하의|스커트/.test(category)) return "bottom";
  if (/바람막이|자켓|아우터|패딩/.test(category)) return "outer";
  if (/티|맨투맨|후드|상의/.test(category)) return "top";
  return "single";
}

export function resolveCategorySizePolicy(
  categoryRaw: string,
  rows?: Array<{ gender?: string; size?: string }>,
  savedStore?: Record<string, SizePolicy>
): SizePolicy | null {
  const category = normalizeText(categoryRaw);
  const saved = savedStore?.[category];
  if (saved) return saved;
  const preset = CATEGORY_PROFILES[category]?.sizePolicy;
  if (preset) return preset;
  if (rows && rows.length > 0) return inferSizePolicy(rows);
  return null;
}

export function normalizeSizeByPolicy(policy: SizePolicy, genderRaw: string, sizeRaw: string): string {
  const size = normalizeSizeToken(sizeRaw);
  const merged = parseGenderAndSize(`${genderRaw}${sizeRaw}`);
  const base = size || merged.size;
  if (!base) return "";
  if (policy === "free") {
    if (base === "F" || base === "FREE") return "FREE";
    return base;
  }
  if (policy === "unisexNumeric") {
    if (ALPHA_TO_NUM[base]) return ALPHA_TO_NUM[base];
    return base;
  }
  if (policy === "unisexAlpha") {
    if (NUM_TO_ALPHA[base]) return NUM_TO_ALPHA[base];
    if (base === "XXL") return "2XL";
    if (base === "XXXL") return "3XL";
    if (base === "XXXXL") return "4XL";
    return base;
  }
  return base;
}

export function getSavedCategoryPolicyStore(): Record<string, SizePolicy> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(CATEGORY_POLICY_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, SizePolicy>;
    return parsed ?? {};
  } catch {
    return {};
  }
}

export function saveCategoryPolicyStore(store: Record<string, SizePolicy>): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CATEGORY_POLICY_STORAGE_KEY, JSON.stringify(store));
}

export function linesForCategoryPolicyInference(categoryRaw: string, stockLines: NormalizedStockLine[]) {
  const category = normalizeText(categoryRaw);
  return stockLines
    .filter((l) => normalizeText(l.dimensions.category) === category)
    .map((l) => ({ gender: l.dimensions.gender, size: l.dimensions.size }));
}
