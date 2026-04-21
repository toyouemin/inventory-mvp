/**
 * 재고 측 상·하·단일 **임시 추론**(키워드 규칙).
 * 확정값이 아니며, `inferGarmentTypeFromProductTextDetailed`의 confidence·competingGarmentTypes로 애매함을 표현한다.
 * 확정값은 엑셀 정규화·수동 보정(override)으로 `dimensions.garmentType`에 덮어쓴다.
 */

import type { GarmentTypeId } from "./types";
import { normalizeText } from "./textNormalize";

export type GarmentTypeInferenceRule = {
  id: string;
  garmentType: GarmentTypeId;
  /** 대소문자 무시 부분 일치 */
  includes: readonly string[];
};

export type GarmentTypeInferenceResult = {
  /** 매칭 키에 쓰는 타입(ambiguous일 때도 규칙 순서상 첫 매칭 타입을 임시로 사용) */
  garmentType: GarmentTypeId;
  /** 키워드로 명확히 한 타입만 매칭 / 서로 다른 타입 규칙이 동시에 걸림 / 매칭 없음 */
  confidence: "high" | "ambiguous" | "defaulted";
  /** 이번 판단에 관여한 규칙 id(중복 없음) */
  matchedRuleIds: string[];
  /** confidence === "ambiguous"일 때 충돌한 타입 후보 */
  competingGarmentTypes?: GarmentTypeId[];
};

/**
 * 앞쪽 규칙이 우선(첫 매칭). `inferGarmentTypeFromProductTextDetailed`는 **모든** 규칙 적중을 수집해 애매함을 판별한다.
 */
export const DEFAULT_GARMENT_TYPE_INFERENCE_RULES: readonly GarmentTypeInferenceRule[] = [
  {
    id: "bottom_keywords",
    garmentType: "bottom",
    includes: ["하의", "바지", "팬츠", "스커트", "치마", "레깅스", "반바지", "슬랙스"],
  },
  {
    id: "top_keywords",
    garmentType: "top",
    includes: ["상의", "티셔츠", "셔츠", "탑", "재킷", "점퍼", "후드", "베스트", "가디건", "블라우스", "니트"],
  },
] as const;

function haystack(parts: { name: string; category: string; memo: string; memo2: string }): string {
  return normalizeText([parts.category, parts.name, parts.memo, parts.memo2].filter(Boolean).join(" ")).toLowerCase();
}

function ruleMatchesHay(rule: GarmentTypeInferenceRule, hay: string): boolean {
  for (const inc of rule.includes) {
    const needle = inc.toLowerCase();
    if (needle && hay.includes(needle)) return true;
  }
  return false;
}

export function inferGarmentTypeFromProductTextDetailed(
  parts: { name: string; category: string; memo: string; memo2: string },
  rules: readonly GarmentTypeInferenceRule[] = DEFAULT_GARMENT_TYPE_INFERENCE_RULES
): GarmentTypeInferenceResult {
  const hay = haystack(parts);
  if (!hay) {
    return { garmentType: "single", confidence: "defaulted", matchedRuleIds: [] };
  }

  const hitRules: GarmentTypeInferenceRule[] = [];
  for (const rule of rules) {
    if (ruleMatchesHay(rule, hay)) hitRules.push(rule);
  }

  if (hitRules.length === 0) {
    return { garmentType: "single", confidence: "defaulted", matchedRuleIds: [] };
  }

  const byId = new Map<string, GarmentTypeInferenceRule>();
  for (const r of hitRules) byId.set(r.id, r);
  const uniqueRules = [...byId.values()];

  const types = new Set(uniqueRules.map((r) => r.garmentType));
  const matchedRuleIds = uniqueRules.map((r) => r.id);

  if (types.size === 1) {
    const garmentType = uniqueRules[0]!.garmentType;
    return { garmentType, confidence: "high", matchedRuleIds };
  }

  const ordered = [...uniqueRules].sort((a, b) => rules.indexOf(a) - rules.indexOf(b));
  const garmentType = ordered[0]!.garmentType;
  return {
    garmentType,
    confidence: "ambiguous",
    matchedRuleIds,
    competingGarmentTypes: [...types],
  };
}

/** 축약 API — detailed 결과의 garmentType만 필요할 때 */
export function inferGarmentTypeFromProductText(
  parts: { name: string; category: string; memo: string; memo2: string },
  rules: readonly GarmentTypeInferenceRule[] = DEFAULT_GARMENT_TYPE_INFERENCE_RULES
): GarmentTypeId {
  return inferGarmentTypeFromProductTextDetailed(parts, rules).garmentType;
}
