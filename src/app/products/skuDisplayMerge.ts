import type { Product, ProductVariant } from "./types";
import {
  explainVariantMatchesNormSku,
  productNormSku,
  productNormSkuSource,
  variantMatchesNormSku,
} from "./skuNormalize";
import { sortVariantsForDisplay, variantCompositeKey } from "./variantOptions";

export type SkuDisplayGroupTrace = {
  representativeProductId: string;
  groupProductIds: string[];
  cardNormSku: string;
  representativeRawProductSku: string;
  representativeFallbackVariantSku: string | null;
  cardTitle: string;
  productsInGroup: Array<{
    productId: string;
    rawProductSku: string;
    normSku: string;
    fallbackVariantSku: string | null;
    name: string;
  }>;
};

export type SkuDisplayGroup = {
  /** 정규화 SKU — React key·표시 통일 */
  normSku: string;
  /** 수정/삭제/상품 메모용 대표 product (필터 결과에서 해당 SKU 첫 행) */
  product: Product;
  /** 같은 SKU 전체 product에서 모은 옵션(동일 조합은 재고 합산, API는 원래 productId 유지) */
  variants: ProductVariant[];
  /** `buildSkuDisplayGroups`에 `debugDisplayGroups: true`일 때만 설정 */
  trace?: SkuDisplayGroupTrace;
};

/** 카드/그룹 단위 총재고 — 옵션 있으면 병합된 variant 재고 합, 없으면 `product.stock` (병합 로직과 동일한 음수·비유한값 처리) */
export function totalStockForSkuDisplayGroup(group: SkuDisplayGroup): number {
  if (group.variants.length > 0) {
    let sum = 0;
    for (const v of group.variants) {
      const x = Number(v.stock);
      sum += Number.isFinite(x) ? Math.max(0, Math.trunc(x)) : 0;
    }
    return sum;
  }
  const ps = Number(group.product.stock);
  return Number.isFinite(ps) ? Math.max(0, Math.trunc(ps)) : 0;
}

export type BuildSkuDisplayGroupsOptions = {
  /** true면 `trace` 채움 + `products.sku` 빈 행 normSku 출처 콘솔 로그 */
  debugDisplayGroups?: boolean;
  /** `?debugVariantTrace=1&traceProductId=...` — 해당 product 버킷·카드 병합·SKU 필터 단계 로그 */
  traceProductId?: string;
};

/**
 * 동일 `normSku` 그룹 안에서만 (color,gender,size) 병합.
 * 맵 키에 normSku를 넣어 다른 SKU 슬립인 방지.
 */
function mergeVariantsForSameCompositeKey(
  variants: ProductVariant[],
  canonicalProductId: string,
  normSku: string
): ProductVariant[] {
  const map = new Map<string, ProductVariant[]>();
  for (const v of variants) {
    if (!variantMatchesNormSku(v, normSku)) continue;
    const k = `${normSku}\0${variantCompositeKey(v.color, v.gender, v.size)}`;
    const arr = map.get(k) ?? [];
    arr.push(v);
    map.set(k, arr);
  }
  const out: ProductVariant[] = [];
  for (const [, bucket] of map) {
    if (bucket.length === 1) {
      out.push(bucket[0]!);
      continue;
    }
    const preferred = bucket.filter((v) => v.productId === canonicalProductId);
    const primary =
      [...preferred].sort((a, b) => a.id.localeCompare(b.id))[0] ??
      [...bucket].sort((a, b) => a.id.localeCompare(b.id))[0]!;
    let stock = 0;
    for (const v of bucket) {
      stock += Number.isFinite(Number(v.stock)) ? Math.max(0, Math.trunc(Number(v.stock))) : 0;
    }
    const memo = bucket.map((v) => (v.memo ?? "").trim()).find(Boolean) ?? null;
    const memo2 = bucket.map((v) => (v.memo2 ?? "").trim()).find(Boolean) ?? null;
    out.push({
      ...primary,
      stock,
      memo,
      memo2,
    });
  }
  return sortVariantsForDisplay(out);
}

function canonicalProductForSku(
  skuKey: string,
  productsPassingFilter: Product[],
  variantsByProductId: Record<string, ProductVariant[]>
): Product | undefined {
  for (const p of productsPassingFilter) {
    if (productNormSku(p, variantsByProductId) === skuKey) return p;
  }
  return undefined;
}

/**
 * 화면: 정규화 SKU당 1행만.
 * - `productsPassingFilter`: 검색·카테고리를 통과한 상품 목록(행이 여러 개일 수 있음)
 * - `allProductsInCategoryOrder`: 같은 카테고리 범위의 정렬된 전체 상품(동일 SKU 다른 product_id까지 포함해 variant 수집)
 */
export function buildSkuDisplayGroups(
  productsPassingFilter: Product[],
  allProductsInCategoryOrder: Product[],
  variantsByProductId: Record<string, ProductVariant[]>,
  options?: BuildSkuDisplayGroupsOptions
): SkuDisplayGroup[] {
  const debugDisplayGroups = options?.debugDisplayGroups === true;
  const traceProductId = (options?.traceProductId ?? "").trim();

  if (traceProductId && typeof console !== "undefined" && console.info) {
    const bucket = variantsByProductId[traceProductId] ?? [];
    console.info("[buildSkuDisplayGroups][trace] 입력 variantsByProductId 버킷", {
      traceProductId,
      variantCount: bucket.length,
      rows: bucket.map((v) => ({
        id: v.id,
        sku: v.sku,
        gender: (v.gender ?? "").trim(),
        size: (v.size ?? "").trim(),
        composite: variantCompositeKey(v.color, v.gender, v.size),
      })),
    });
  }

  if (debugDisplayGroups && typeof console !== "undefined" && console.info) {
    const seenPid = new Set<string>();
    for (const p of allProductsInCategoryOrder) {
      if (seenPid.has(p.id)) continue;
      seenPid.add(p.id);
      if (String(p.sku ?? "").trim() !== "") continue;
      const src = productNormSkuSource(p, variantsByProductId);
      if (!src.normSku) {
        console.info("[productsPipeline][emptyProductSku→noNorm]", {
          productId: p.id,
          name: (p.name ?? "").trim() || "(이름 없음)",
        });
      } else {
        console.info("[productsPipeline][emptyProductSku→normSku]", {
          productId: p.id,
          assignedNormSku: src.normSku,
          fallbackVariantSku: src.fallbackVariantSku,
          name: (p.name ?? "").trim() || "(이름 없음)",
        });
      }
    }
  }

  const skuKeys: string[] = [];
  const seen = new Set<string>();
  for (const p of productsPassingFilter) {
    const k = productNormSku(p, variantsByProductId);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    skuKeys.push(k);
  }
  if (skuKeys.length === 0) return [];

  const expanded = allProductsInCategoryOrder.filter(
    (p) => seen.has(productNormSku(p, variantsByProductId))
  );

  const groups = new Map<string, Product[]>();
  for (const p of expanded) {
    const k = productNormSku(p, variantsByProductId);
    if (!k) continue;
    const arr = groups.get(k) ?? [];
    arr.push(p);
    groups.set(k, arr);
  }

  const out: SkuDisplayGroup[] = [];
  for (const k of skuKeys) {
    const group = groups.get(k);
    if (!group?.length) continue;
    const canonical = canonicalProductForSku(k, productsPassingFilter, variantsByProductId) ?? group[0]!;
    const raw: ProductVariant[] = [];
    const traceThisCard = Boolean(traceProductId && group.some((p) => p.id === traceProductId));
    if (traceThisCard && typeof console !== "undefined" && console.info) {
      console.info("[buildSkuDisplayGroups][trace] 동일 카드 그룹", {
        cardNormSku: k,
        groupProductIds: group.map((p) => p.id),
      });
    }
    for (const p of group) {
      for (const v of variantsByProductId[p.id] ?? []) {
        if (traceThisCard && v.productId === traceProductId && typeof console !== "undefined") {
          const ex = explainVariantMatchesNormSku(v, k);
          if (!ex.ok) {
            console.warn("[buildSkuDisplayGroups][trace] variantMatchesNormSku=false", {
              variantId: v.id,
              rawSku: v.sku,
              ...ex,
            });
          }
        }
        if (!variantMatchesNormSku(v, k)) continue;
        raw.push(v);
      }
    }
    const variants = mergeVariantsForSameCompositeKey(raw, canonical.id, k);
    if (traceThisCard && typeof console !== "undefined" && console.info) {
      const 남120 = variants.filter((v) => (v.gender ?? "").trim() === "남" && (v.size ?? "").trim() === "120");
      console.info("[buildSkuDisplayGroups][trace] 카드 병합 후 variants", {
        cardNormSku: k,
        variantCount: variants.length,
        남120Count: 남120.length,
        남120Ids: 남120.map((v) => v.id),
      });
    }
    const repSrc = productNormSkuSource(canonical, variantsByProductId);
    const productsInGroup = group.map((p) => {
      const src = productNormSkuSource(p, variantsByProductId);
      return {
        productId: p.id,
        rawProductSku: src.rawProductSku,
        normSku: src.normSku,
        fallbackVariantSku: src.fallbackVariantSku,
        name: (p.name ?? "").trim(),
      };
    });
    const trace: SkuDisplayGroupTrace | undefined = debugDisplayGroups
      ? {
          representativeProductId: canonical.id,
          groupProductIds: group.map((p) => p.id),
          cardNormSku: k,
          representativeRawProductSku: repSrc.rawProductSku,
          representativeFallbackVariantSku: repSrc.fallbackVariantSku,
          cardTitle: (canonical.name ?? "").trim() || canonical.sku || k || "-",
          productsInGroup,
        }
      : undefined;

    out.push({
      normSku: k,
      product: { ...canonical, sku: k },
      variants,
      trace,
    });
  }
  return out;
}
