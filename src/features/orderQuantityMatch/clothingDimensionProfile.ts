/**
 * 의류 MVP 차원 프로필: 키 ID와 표시 라벨, 값 정규화만 정의 (비즈니스 로직 없음).
 */

import type { DimensionValues, GarmentTypeId } from "./types";
import { normalizeSizeByPolicy, resolveCategorySizePolicy } from "./categoryPolicy";
import { normalizeText } from "./textNormalize";

export const CLOTHING_DIMENSION_ORDER = ["category", "garmentType", "gender", "size"] as const;

export type ClothingDimensionId = (typeof CLOTHING_DIMENSION_ORDER)[number];

const GENDER_CANON: ReadonlyArray<{ canon: string; aliases: readonly string[] }> = [
  { canon: "남", aliases: ["남", "남자", "남성", "m", "M", "male"] },
  { canon: "여", aliases: ["여", "여자", "여성", "f", "F", "female"] },
  { canon: "공용", aliases: ["공용", "남녀", "남여", "unisex", "U"] },
];

const GENDER_ALIAS_MAP = (() => {
  const m = new Map<string, string>();
  for (const { canon, aliases } of GENDER_CANON) {
    for (const a of aliases) {
      m.set(normalizeText(a).toLowerCase(), canon);
    }
  }
  return m;
})();

export function normalizeGenderValue(raw: string | null | undefined): string {
  const t = normalizeText(raw);
  if (!t) return "";
  const hit = GENDER_ALIAS_MAP.get(t.toLowerCase());
  return hit ?? t;
}

export function normalizeGarmentTypeId(raw: string | null | undefined): GarmentTypeId | null {
  const t = normalizeText(raw).toLowerCase();
  if (t === "single" || t === "단일") return "single";
  if (t === "top" || t === "상의") return "top";
  if (t === "bottom" || t === "하의") return "bottom";
  return null;
}

export const GARMENT_TYPE_LABELS: Record<GarmentTypeId, string> = {
  single: "단일",
  top: "상의",
  bottom: "하의",
};

export function labelForGarmentType(id: GarmentTypeId): string {
  return GARMENT_TYPE_LABELS[id];
}

export function buildClothingDimensionValues(input: {
  category: string;
  garmentType: GarmentTypeId;
  gender: string;
  size: string;
}): DimensionValues {
  const category = normalizeText(input.category);
  const gender = normalizeGenderValue(input.gender);
  const sizeRaw = normalizeText(input.size);
  const policy = resolveCategorySizePolicy(category);
  const size = policy ? normalizeSizeByPolicy(policy, gender, sizeRaw) : sizeRaw;
  return {
    category,
    garmentType: input.garmentType,
    gender,
    size,
  };
}

function garmentTypeLabelFromStoredValue(v: string): string {
  const id =
    v === "single" || v === "top" || v === "bottom"
      ? (v as GarmentTypeId)
      : normalizeGarmentTypeId(v) ?? "single";
  return labelForGarmentType(id);
}

export function summarizeDimensions(d: DimensionValues, order: readonly string[]): string {
  const parts: string[] = [];
  for (const key of order) {
    const v = d[key];
    if (key === "garmentType" && v) {
      parts.push(garmentTypeLabelFromStoredValue(v));
      continue;
    }
    if (v) parts.push(String(v));
  }
  return parts.join(" · ") || "(조건 없음)";
}
