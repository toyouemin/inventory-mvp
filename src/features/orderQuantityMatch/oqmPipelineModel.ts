/**
 * OQM(주문 수량 매칭) 입력판·주문 row 생성: 재고 정규화 stockLines → 프로필 → RequestLineInput
 * (클라이언트/검증 스크립트 공용)
 */
import type { GarmentTypeId, NormalizedStockLine, RequestLineInput } from "./types";
import {
  CATEGORY_PROFILES,
  type SizePolicy,
  type StockScopeType,
  UNISEX_ALPHA_SIZES,
  UNISEX_NUMERIC_SIZES,
  inferSizePolicy,
  inferStockScopeType,
  linesForCategoryPolicyInference,
  normalizeSizeByPolicy,
  parseGenderAndSize,
  resolveCategorySizePolicy,
} from "./categoryPolicy";
import { isBundaeMergedSizeToken } from "./shortPantsBundaeStockNormalize";

const TRAINING_FEMALE_BASE = ["85", "90", "95", "100", "105"] as const;
const TRAINING_MALE_BASE = ["95", "100", "105", "110", "115"] as const;
const GENERAL_ITEM_PRESETS = ["라켓", "가방"] as const;
const ALPHA_SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"] as const;
const ALPHA_SIZE_RANK: Map<string, number> = new Map(ALPHA_SIZE_ORDER.map((s, i) => [s, i]));

function parseQty(raw: string): number {
  if (raw.trim() === "") return 0;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

export function normalizeOqmSizeToken(raw: string): string {
  const t = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!t) return "";
  if (t.startsWith("공용")) return t.replace(/^공용/, "");
  return t;
}

function compareOqmSize(a: string, b: string): number {
  const na = normalizeOqmSizeToken(a);
  const nb = normalizeOqmSizeToken(b);
  const bu = /^(\d+부)-?(\d{2,3})$/u;
  const ma = na.match(bu);
  const mb = nb.match(bu);
  if (ma && mb) {
    if (ma[1] !== mb[1]) return ma[1]!.localeCompare(mb[1]!, "ko", { numeric: true });
    return Number(ma[2]) - Number(mb[2]);
  }
  const an = Number(na);
  const bn = Number(nb);
  if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
  const ar = ALPHA_SIZE_RANK.get(na);
  const br = ALPHA_SIZE_RANK.get(nb);
  if (ar != null && br != null) return ar - br;
  return na.localeCompare(nb, "ko", { numeric: true });
}

function uniqueSortedOqm(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))].sort(compareOqmSize);
}

export function isOqmRecognizedSizeToken(raw: string): boolean {
  const original = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!original) return false;
  if (isBundaeMergedSizeToken(raw)) return true;
  let body = original;
  if (body.startsWith("공용")) body = body.slice(2);
  else if (body.startsWith("여") || body.startsWith("남")) body = body.slice(1);
  if (!body) return false;
  if (/^\d{2,3}$/.test(body)) return true;
  if (/^(XXS|XS|S|M|L|XL|XXL|XXXL|XXXXL|[2-9]XL)$/.test(body)) return true;
  return false;
}

export type OqmCategoryProfile = {
  stockScopeType: StockScopeType;
  sizePolicy: SizePolicy;
  needsPolicyChoice: boolean;
  recommendedPolicy: SizePolicy | null;
  unisexSizes: string[];
  unisexAlphaSizes: string[];
  femaleSizes: string[];
  maleSizes: string[];
  generalItems: string[];
  hasUnisexData: boolean;
  hasGenderSplitData: boolean;
};

export function buildOqmCategoryProfile(
  category: string,
  stockLines: NormalizedStockLine[],
  savedPolicyStore: Record<string, SizePolicy>
): OqmCategoryProfile {
  const cat = category.trim();
  const lines = stockLines.filter((l) => (l.dimensions.category ?? "").trim() === cat);
  const inferRows = linesForCategoryPolicyInference(cat, stockLines);
  const recommendedPolicy = inferSizePolicy(inferRows);
  const resolvedPolicy = resolveCategorySizePolicy(cat, inferRows, savedPolicyStore);
  const sizePolicy: SizePolicy = resolvedPolicy ?? "custom";
  const preset = CATEGORY_PROFILES[cat];
  const needsPolicyChoice = !preset?.sizePolicy && !savedPolicyStore[cat] && resolvedPolicy == null;
  const stockScopeType = preset?.stockScopeType ?? inferStockScopeType(cat);

  const items = uniqueSortedOqm(lines.map((l) => l.displayName || l.sku)).slice(0, 30);
  const parsedRows = lines.map((l) => {
    const parsed = parseGenderAndSize(`${l.dimensions.gender ?? ""}${l.dimensions.size ?? ""}`);
    const gender = (l.dimensions.gender ?? "").trim() || parsed.gender;
    const sizeRaw = (l.dimensions.size ?? "").trim() || parsed.size;
    return {
      gender,
      size: normalizeSizeByPolicy(sizePolicy, gender, sizeRaw),
    };
  });
  const femaleSizesRaw = uniqueSortedOqm(parsedRows.filter((r) => r.gender === "여").map((r) => normalizeOqmSizeToken(r.size)));
  const maleSizesRaw = uniqueSortedOqm(parsedRows.filter((r) => r.gender === "남").map((r) => normalizeOqmSizeToken(r.size)));
  const unisexSizesRaw = uniqueSortedOqm(parsedRows.filter((r) => r.gender === "공용").map((r) => normalizeOqmSizeToken(r.size)));
  const hasGenderSplitData = femaleSizesRaw.length > 0 || maleSizesRaw.length > 0;
  const hasUnisexData = unisexSizesRaw.length > 0;

  /** 공용·숫자형: 선택 범위 재고에 나온 사이즈만 입력판에 표시. 없을 때만 기본 눈금(85~). */
  const unisexNumericSizesForUi =
    unisexSizesRaw.length > 0 ? unisexSizesRaw : [...UNISEX_NUMERIC_SIZES];
  /** 공용·알파: 재고 알파 사이즈 집합 우선, 없으면 표준 눈금 */
  const unisexAlphaSizesForUi =
    unisexSizesRaw.length > 0 ? unisexSizesRaw : [...UNISEX_ALPHA_SIZES];

  return {
    stockScopeType,
    sizePolicy,
    needsPolicyChoice,
    recommendedPolicy,
    unisexSizes:
      sizePolicy === "free"
        ? ["FREE"]
        : sizePolicy === "unisexNumeric"
          ? unisexNumericSizesForUi
          : unisexSizesRaw,
    unisexAlphaSizes: sizePolicy === "unisexAlpha" ? unisexAlphaSizesForUi : unisexSizesRaw,
    femaleSizes: femaleSizesRaw.length > 0 ? femaleSizesRaw : sizePolicy === "custom" ? [...TRAINING_FEMALE_BASE] : [],
    maleSizes: maleSizesRaw.length > 0 ? maleSizesRaw : sizePolicy === "custom" ? [...TRAINING_MALE_BASE] : [],
    generalItems: items.length > 0 ? items : [...GENERAL_ITEM_PRESETS],
    hasUnisexData,
    hasGenderSplitData,
  };
}

export type OqmApparelSizeType = "unisex" | "genderSplit";
export type OqmQuickCategoryKind = "apparel" | "training" | "general";

export function buildOqmQuickRequestLines(input: {
  createRow: (r: Omit<RequestLineInput, "rowId">) => RequestLineInput;
  quickCategory: string;
  quickCategoryKind: OqmQuickCategoryKind;
  apparelSizeType: OqmApparelSizeType;
  categoryProfile: OqmCategoryProfile;
  activeApparelSizes: string[];
  apparelGarmentType: GarmentTypeId;
  apparelQtyByKey: Record<string, string>;
  trainingSetQtyByKey: Record<string, string>;
  generalEntries: { id: string; quantity: string }[];
}): RequestLineInput[] {
  const {
    createRow,
    quickCategory,
    quickCategoryKind,
    apparelSizeType,
    categoryProfile,
    activeApparelSizes,
    apparelGarmentType,
    apparelQtyByKey,
    trainingSetQtyByKey,
    generalEntries,
  } = input;
  const out: RequestLineInput[] = [];
  if (quickCategoryKind === "apparel") {
    if (apparelSizeType === "genderSplit") {
      for (const size of categoryProfile.femaleSizes) {
        const qty = parseQty(apparelQtyByKey[`여|${size}`] ?? "");
        if (qty <= 0) continue;
        out.push(
          createRow({
            category: quickCategory.trim() || "의류",
            garmentType: apparelGarmentType,
            gender: "여",
            size,
            quantity: qty,
            bundleKey: "",
          })
        );
      }
      for (const size of categoryProfile.maleSizes) {
        const qty = parseQty(apparelQtyByKey[`남|${size}`] ?? "");
        if (qty <= 0) continue;
        out.push(
          createRow({
            category: quickCategory.trim() || "의류",
            garmentType: apparelGarmentType,
            gender: "남",
            size,
            quantity: qty,
            bundleKey: "",
          })
        );
      }
      return out;
    }
    for (const size of activeApparelSizes) {
      const qty = parseQty(apparelQtyByKey[`공용|${size}`] ?? "");
      if (qty <= 0) continue;
      out.push(
        createRow({
          category: quickCategory.trim() || "의류",
          garmentType: apparelGarmentType,
          gender: "공용",
          size,
          quantity: qty,
          bundleKey: "",
        })
      );
    }
    return out;
  }
  if (quickCategoryKind === "training") {
    for (const size of categoryProfile.femaleSizes) {
      const qty = parseQty(trainingSetQtyByKey[`여|${size}`] ?? "");
      if (qty <= 0) continue;
      out.push(
        createRow({
          category: quickCategory.trim() || "트레이닝복",
          garmentType: "single",
          gender: "여",
          size,
          quantity: qty,
          bundleKey: `SET-여-${size}`,
        })
      );
    }
    for (const size of categoryProfile.maleSizes) {
      const qty = parseQty(trainingSetQtyByKey[`남|${size}`] ?? "");
      if (qty <= 0) continue;
      out.push(
        createRow({
          category: quickCategory.trim() || "트레이닝복",
          garmentType: "single",
          gender: "남",
          size,
          quantity: qty,
          bundleKey: `SET-남-${size}`,
        })
      );
    }
    return out;
  }
  for (const entry of generalEntries) {
    const qty = parseQty(entry.quantity);
    if (qty <= 0) continue;
    out.push(
      createRow({
        category: quickCategory.trim() || "기타 사이즈 없음",
        garmentType: "single",
        gender: "",
        size: entry.id,
        quantity: qty,
        bundleKey: "",
      })
    );
  }
  return out;
}
