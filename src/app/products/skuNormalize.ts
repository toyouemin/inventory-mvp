import type { Product, ProductVariant } from "./types";

/**
 * DB·CSV·화면 병합용 SKU 정규화:
 * 제로폭·전각 영문 등 제거/통일(NFKC), trim, 공백 축소, 대문자.
 * `T25KT1033BL` vs 전각·숨은 문자로 다른 문자열이 되어 카드가 2개로 갈라지는 것을 막음.
 */
export function normalizeSkuForMatch(raw: string | null | undefined): string {
  let s = String(raw ?? "")
    .replace(/\uFEFF/g, "")
    .replace(/[\u200B-\u200D\u2060]/g, "")
    .replace(/\u00A0/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  /* 하이픈류 → ASCII - (유니코드 대시 혼용) */
  s = s.replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-");
  try {
    s = s.normalize("NFKC");
  } catch {
    try {
      s = s.normalize("NFC");
    } catch {
      /* ignore */
    }
  }
  return s.toUpperCase().trim().replace(/\s+/g, " ");
}

/**
 * `products.sku`가 비었을 때: variant들의 정규화 SKU **빈도 최댓값**을 그룹 키로 씀.
 * (첫 행만 보다가 오타·다른 품번 한 줄 때문에 카드가 둘로 갈라지는 경우 완화)
 */
export function dominantNormSkuFromVariantSkus(variants: { sku: string }[]): {
  normSku: string;
  representativeRawSku: string | null;
} {
  const counts = new Map<string, number>();
  for (const v of variants) {
    const k = normalizeSkuForMatch(v.sku);
    if (!k) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  if (counts.size === 0) return { normSku: "", representativeRawSku: null };
  let bestK = "";
  let bestC = -1;
  for (const [k, c] of counts) {
    if (c > bestC || (c === bestC && k.localeCompare(bestK) < 0)) {
      bestK = k;
      bestC = c;
    }
  }
  const raw = (variants.find((v) => normalizeSkuForMatch(v.sku) === bestK)?.sku ?? "").trim();
  return { normSku: bestK, representativeRawSku: raw || null };
}

export type ProductNormSkuSource = {
  normSku: string;
  /** DB `products.sku` 원문(트림 전 문자열은 그대로 두고, 표시용으로 String) */
  rawProductSku: string;
  /** `products.sku`가 비었을 때: 다수결 norm에 쓰인 대표 variant 원문 sku */
  fallbackVariantSku: string | null;
};

/**
 * `products.sku`가 비어 있어도 `product_variants.sku`로 같은 품목을 묶음.
 * (옵션만 다른 행으로 잘못 들어간 중복 product 대응)
 */
export function productNormSkuSource(
  p: Product,
  variantsByProductId: Record<string, ProductVariant[]>
): ProductNormSkuSource {
  const rawProductSku = String(p.sku ?? "");
  const fromProduct = normalizeSkuForMatch(p.sku);
  if (fromProduct) {
    return { normSku: fromProduct, rawProductSku, fallbackVariantSku: null };
  }
  const { normSku, representativeRawSku } = dominantNormSkuFromVariantSkus(variantsByProductId[p.id] ?? []);
  return {
    normSku,
    rawProductSku,
    fallbackVariantSku: representativeRawSku,
  };
}

export function productNormSku(
  p: Product,
  variantsByProductId: Record<string, ProductVariant[]>
): string {
  return productNormSkuSource(p, variantsByProductId).normSku;
}

/**
 * SKU 표시 그룹(`groupNormSku`)에 올릴 variant인지.
 * `variant.sku`가 비어 있으면 해당 product가 그 그룹에 속한 행으로만 수집되므로 포함.
 * `variant.sku`가 있으면 정규화 값이 그룹과 같을 때만 포함 → 다른 SKU 행이 (color,gender,size)만 같아도 섞이지 않음.
 */
export function variantMatchesNormSku(v: ProductVariant, groupNormSku: string): boolean {
  const vn = normalizeSkuForMatch(v.sku);
  if (!vn) return true;
  return vn === groupNormSku;
}

/** 디버그: `variantMatchesNormSku`가 false인 이유(정규화 값) */
export function explainVariantMatchesNormSku(
  v: ProductVariant,
  groupNormSku: string
): { ok: boolean; variantNormSku: string; groupNormSku: string; reason: string } {
  const vn = normalizeSkuForMatch(v.sku);
  if (!vn) {
    return {
      ok: true,
      variantNormSku: "",
      groupNormSku,
      reason: "variant.sku가 비어 있거나 정규화 후 빈 문자열 → 그룹에 항상 포함",
    };
  }
  const ok = vn === groupNormSku;
  return {
    ok,
    variantNormSku: vn,
    groupNormSku,
    reason: ok
      ? "정규화 variant.sku === groupNormSku"
      : `불일치: variantNormSku="${vn}" !== groupNormSku="${groupNormSku}"`,
  };
}
