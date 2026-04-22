/**
 * 재고(상품+옵션) → 정규화 라인. 의류 MVP.
 */

import type { Product, ProductVariant } from "@/app/products/types";
import type { GarmentTypeId, GarmentTypeInferenceMeta, NormalizedStockLine } from "./types";
import { CLOTHING_DIMENSION_ORDER, buildClothingDimensionValues } from "./clothingDimensionProfile";
import {
  inferGarmentTypeFromProductTextDetailed,
  type GarmentTypeInferenceRule,
} from "./inventoryGarmentTypeInference";
import { buildMatchKey } from "./matchKey";
import { tryMergeBundaeShortPantsVariant } from "./shortPantsBundaeStockNormalize";
import { normalizeText } from "./textNormalize";

export type CatalogStockNormalizationOptions = {
  /** 상품 단위로 재고 측 garmentType을 확정값으로 덮어쓴다(엑셀 정규화·수동 보정). */
  garmentTypeOverrideByProductId?: Record<string, GarmentTypeId>;
  /** 키워드 추론 규칙 교체(테스트·확장용). 미지정 시 기본 규칙. */
  inferenceRules?: readonly GarmentTypeInferenceRule[];
};

function resolveGarmentTypeForProduct(
  product: Product,
  rules: readonly GarmentTypeInferenceRule[] | undefined,
  override: GarmentTypeId | undefined
): { garmentType: GarmentTypeId; inference: GarmentTypeInferenceMeta } {
  if (override !== undefined) {
    return {
      garmentType: override,
      inference: {
        source: "override",
        confidence: "high",
        matchedRuleIds: [],
      },
    };
  }
  const detailed = inferGarmentTypeFromProductTextDetailed(
    {
      name: product.name ?? "",
      category: product.category ?? "",
      memo: product.memo ?? "",
      memo2: product.memo2 ?? "",
    },
    rules
  );
  const inference: GarmentTypeInferenceMeta = {
    source: "keyword_inference",
    confidence: detailed.confidence,
    matchedRuleIds: detailed.matchedRuleIds,
    ...(detailed.competingGarmentTypes ? { competingGarmentTypes: detailed.competingGarmentTypes } : {}),
  };
  return { garmentType: detailed.garmentType, inference };
}

export function normalizeVariantToStockLines(
  product: Product,
  variant: ProductVariant,
  options?: {
    rules?: readonly GarmentTypeInferenceRule[];
    garmentTypeOverride?: GarmentTypeId;
  }
): NormalizedStockLine[] {
  const category = normalizeText(product.category ?? "");
  const { garmentType, inference } = resolveGarmentTypeForProduct(
    product,
    options?.rules,
    options?.garmentTypeOverride
  );
  const bundae = tryMergeBundaeShortPantsVariant(product, variant);
  const gender = bundae?.gender ?? variant.gender ?? "";
  const size = bundae?.size ?? variant.size ?? "";
  const dimensions = buildClothingDimensionValues({
    category,
    garmentType,
    gender,
    size,
  });
  const stock = Math.max(0, Math.floor(Number(variant.stock) || 0));
  const displayName = normalizeText((product.name ?? "").trim() || product.sku);
  return [
    {
      productId: product.id,
      sku: product.sku,
      displayName,
      dimensions,
      stock,
      garmentTypeInference: inference,
    },
  ];
}

export function normalizeProductCatalogToStockLines(
  products: Product[],
  variantsByProductId: Map<string, ProductVariant[]>,
  options?: CatalogStockNormalizationOptions
): NormalizedStockLine[] {
  const overrides = options?.garmentTypeOverrideByProductId;
  const out: NormalizedStockLine[] = [];
  for (const p of products) {
    const override = overrides?.[p.id];
    const vars = variantsByProductId.get(p.id) ?? [];
    if (vars.length === 0) {
      const synthetic: ProductVariant = {
        id: `synthetic-${p.id}`,
        productId: p.id,
        sku: p.sku,
        color: "",
        gender: "",
        size: "",
        stock: Math.max(0, Number(p.stock) || 0),
      };
      out.push(
        ...normalizeVariantToStockLines(p, synthetic, {
          garmentTypeOverride: override,
          rules: options?.inferenceRules,
        })
      );
      continue;
    }
    for (const v of vars) {
      out.push(
        ...normalizeVariantToStockLines(p, v, {
          garmentTypeOverride: override,
          rules: options?.inferenceRules,
        })
      );
    }
  }
  return out;
}

export function aggregateStockByKey(
  lines: NormalizedStockLine[],
  dimensionOrder: readonly string[] = CLOTHING_DIMENSION_ORDER
): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of lines) {
    const key = buildMatchKey(dimensionOrder, line.dimensions);
    map.set(key, (map.get(key) ?? 0) + line.stock);
  }
  return map;
}
