import { normalizeCategoryLabel, normalizeCategoryOrderMapKeys } from "./categoryNormalize";

/** CSV에 없거나 아직 등록 안 된 카테고리 — 목록 뒤로 */
export const CATEGORY_ORDER_FALLBACK = 9999;

export type CategoryOrderMergePath =
  | "noProductCategories"
  | "emptyDb→appearanceOnly"
  | "noKeyOverlap→appearanceOnly"
  | "fullDbCover→dbPositions"
  | "partialMerge→db+appearanceTail";

function warnIfCategoryMergeNotFullDbCover(
  path: CategoryOrderMergePath,
  detail: Record<string, number | string>
): void {
  if (path === "fullDbCover→dbPositions" || path === "noProductCategories") return;
  if (typeof console !== "undefined" && typeof console.warn === "function") {
    console.warn(
      "[category_order_merge] mergePath가 fullDbCover→dbPositions가 아닙니다. 화면은 DB·상품 키 불일치 또는 빈 테이블로 인해 appearance/부분 병합을 쓸 수 있습니다.",
      { path, ...detail }
    );
  }
}

/** merge / 진단 공통: 상품 카테고리 집합·정규화된 DB 맵으로 병합 분기 결정 */
export function computeCategoryOrderMergePath(
  labels: ReadonlySet<string>,
  dbNorm: Record<string, number>
): CategoryOrderMergePath {
  if (labels.size === 0) return "noProductCategories";
  if (Object.keys(dbNorm).length === 0) return "emptyDb→appearanceOnly";
  const inDb = [...labels].filter((c) => dbNorm[c] !== undefined);
  if (inDb.length === 0) return "noKeyOverlap→appearanceOnly";
  if (inDb.length === labels.size) return "fullDbCover→dbPositions";
  return "partialMerge→db+appearanceTail";
}

/** merged 맵을 position 오름차순 카테고리 배열로 (진단·DB 순서 대조용) */
export function categoryOrderMapToCategoriesSortedByPosition(map: Record<string, number>): string[] {
  return Object.entries(map)
    .filter(([, pos]) => Number.isFinite(pos))
    .sort((a, b) => {
      if (a[1] !== b[1]) return a[1] - b[1];
      return a[0].localeCompare(b[0], "ko");
    })
    .map(([cat]) => cat);
}

export type CategoryOrderProductLike = {
  category?: string | null;
  createdAt?: string | null;
  id?: string;
  sku?: string;
};

/**
 * DB 상품 행 기준 카테고리 첫 등장 순서(created_at 오름차순 → id).
 * CSV 업로드 직후 삽입된 행은 보통 앞쪽 시각이라, 테이블 `category_sort_order`가 비어 있을 때의 대체 순서로 사용.
 */
export function buildCategoryOrderMapFromProductFirstAppearance(
  products: readonly CategoryOrderProductLike[]
): Record<string, number> {
  const sorted = [...products].sort((a, b) => {
    const ac = (a.createdAt ?? "").trim();
    const bc = (b.createdAt ?? "").trim();
    if (ac !== bc) {
      if (!ac) return 1;
      if (!bc) return -1;
      return ac.localeCompare(bc);
    }
    return String(a.id ?? "").localeCompare(String(b.id ?? ""));
  });
  const seen = new Set<string>();
  const out: Record<string, number> = {};
  let i = 0;
  for (const p of sorted) {
    const c = normalizeCategoryLabel(p.category);
    if (!c || seen.has(c)) continue;
    seen.add(c);
    out[c] = i++;
  }
  return out;
}

/**
 * 화면·다운로드 정렬용: `category_sort_order`(CSV 업로드 시 등장 순)가 있으면 우선, 없는 카테고리만 products의 created_at 첫 등장(appearance)으로 보강.
 * 테이블이 비었거나 현재 상품과 겹치지 않으면 appearance만 사용.
 * DB·상품 키는 trim + 공백 축소 + NFC로 맞춤.
 *
 * **정렬에 쓰는 맵은 이 함수 반환값만 사용** (`compareProductsByCategoryOrder`의 세 번째 인자).
 * `fullDbCover→dbPositions`일 때는 appearance를 섞지 않고 DB position만 사용.
 */
export function mergeCategoryOrderMapForDisplay(
  products: readonly CategoryOrderProductLike[],
  dbMap: Record<string, number>,
  options?: { silent?: boolean }
): Record<string, number> {
  const silent = options?.silent === true;
  const dbNorm = normalizeCategoryOrderMapKeys(dbMap);
  const appearance = buildCategoryOrderMapFromProductFirstAppearance(products);
  const labels = new Set<string>();
  for (const p of products) {
    const c = normalizeCategoryLabel(p.category);
    if (c) labels.add(c);
  }

  const path = computeCategoryOrderMergePath(labels, dbNorm);
  const inDbCount = [...labels].filter((c) => dbNorm[c] !== undefined).length;

  const logWarn = () =>
    !silent &&
    warnIfCategoryMergeNotFullDbCover(path, {
      labelCount: labels.size,
      dbKeyCount: Object.keys(dbNorm).length,
      inDbCount,
    });

  if (labels.size === 0) {
    logWarn();
    return {};
  }

  if (Object.keys(dbNorm).length === 0) {
    logWarn();
    return appearance;
  }

  const inDb = [...labels].filter((c) => dbNorm[c] !== undefined);
  if (inDb.length === 0) {
    logWarn();
    return appearance;
  }

  if (inDb.length === labels.size) {
    const sortedCats = [...labels].sort((a, b) => (dbNorm[a] ?? 0) - (dbNorm[b] ?? 0));
    const out: Record<string, number> = {};
    for (const c of sortedCats) {
      out[c] = dbNorm[c]!;
    }
    logWarn();
    return out;
  }

  const merged: Record<string, number> = {};
  for (const c of labels) {
    if (dbNorm[c] !== undefined) merged[c] = dbNorm[c]!;
  }
  const missing = [...labels].filter((c) => merged[c] === undefined);
  missing.sort((a, b) => (appearance[a] ?? 0) - (appearance[b] ?? 0));
  const maxPos = Math.max(...Object.values(merged));
  let p = maxPos + 1;
  for (const c of missing) {
    merged[c] = p++;
  }
  if (!silent) {
    warnIfCategoryMergeNotFullDbCover(path, {
      labelCount: labels.size,
      dbKeyCount: Object.keys(dbNorm).length,
      inDbCount: inDb.length,
      missingCategoryCount: missing.length,
    });
  }
  return merged;
}

export function orderedUniqueCategoryKeysFromRows(rows: { category: string }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const c = normalizeCategoryLabel(r.category);
    if (!c || seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}

/**
 * CSV 파싱 행을 위→아래 순서 그대로 두고, category 첫 등장마다 position 0,1,2… 부여.
 * (`normalizeCategoryLabel` = 업로드 파이프라인과 동일)
 */
export function buildCategoryOrderMapFromCsvRows(rows: { category: string }[]): Record<string, number> {
  const ordered = orderedUniqueCategoryKeysFromRows(rows);
  const out: Record<string, number> = {};
  for (let i = 0; i < ordered.length; i++) {
    out[ordered[i]!] = i;
  }
  return out;
}

export function compareProductsByCategoryOrder(
  a: { category?: string | null; sku?: string; createdAt?: string | null },
  b: { category?: string | null; sku?: string; createdAt?: string | null },
  orderMap: Record<string, number>
): number {
  const aCat = normalizeCategoryLabel(a.category);
  const bCat = normalizeCategoryLabel(b.category);
  const ao = orderMap[aCat] ?? CATEGORY_ORDER_FALLBACK;
  const bo = orderMap[bCat] ?? CATEGORY_ORDER_FALLBACK;
  if (ao !== bo) return ao - bo;
  const sku = (a.sku ?? "").localeCompare(b.sku ?? "", "ko");
  if (sku !== 0) return sku;
  const ac = a.createdAt ?? "";
  const bc = b.createdAt ?? "";
  return bc.localeCompare(ac);
}

export function sortCategoryFilterLabels(labels: string[], orderMap: Record<string, number>): string[] {
  return [...labels].sort((a, b) => {
    const na = normalizeCategoryLabel(a);
    const nb = normalizeCategoryLabel(b);
    const ao = orderMap[na] ?? CATEGORY_ORDER_FALLBACK;
    const bo = orderMap[nb] ?? CATEGORY_ORDER_FALLBACK;
    if (ao !== bo) return ao - bo;
    return na.localeCompare(nb, "ko");
  });
}

/** `/api/debug/category-order` 응답 `diagnosis.mergePath` 값 설명 */
export const MERGE_PATH_DESCRIPTIONS: Record<string, string> = {
  noProductCategories: "상품에 비어 있지 않은 category가 하나도 없음.",
  "emptyDb→appearanceOnly":
    "category_sort_order가 비어 있음. DB 순서 없이 products의 created_at 첫 등장 순(appearance)만 사용.",
  "noKeyOverlap→appearanceOnly":
    "테이블에 행은 있으나, 정규화한 상품 카테고리 라벨과 테이블 category 키가 하나도 겹치지 않음(과거 NFD/공백 불일치 등). DB position을 쓰지 못하고 appearance로만 정렬.",
  "fullDbCover→dbPositions":
    "현재 상품에 나오는 모든 카테고리가 category_sort_order(정규화 키)에 있음. merge된 맵은 테이블 position 순서를 그대로 사용.",
  "partialMerge→db+appearanceTail":
    "일부 카테고리만 테이블에 있음. 있는 것은 DB position, 없는 것은 products created_at appearance 순으로 뒤에 붙임.",
};

/** `?debugCategoryOrder=1` / API 진단용 — 병합 분기·맵·정렬 후 카테고리 시퀀스 */
export function diagnoseCategoryOrderPipeline(
  products: readonly CategoryOrderProductLike[],
  dbMapRaw: Record<string, number>
): {
  mergePath: CategoryOrderMergePath;
  mergePathArrowAscii: string;
  dbMapRawKeyCount: number;
  dbNormKeyCount: number;
  labelCount: number;
  labelsInDbCount: number;
  appearance: Record<string, number>;
  dbNorm: Record<string, number>;
  merged: Record<string, number>;
  /** merged의 position 오름차순 카테고리 (= DB position 순서와 동일해야 함, fullDbCover 시) */
  mergedCategoriesSortedByPosition: string[];
  /** category_sort_order 테이블과 동일 순서(정규화 키 기준 position 오름차순) */
  dbNormCategoriesSortedByPosition: string[];
  /** 테이블 전체 position 순서 중, 현재 상품에 등장하는 카테고리만 골랐을 때의 순서 */
  dbNormCategoriesForProductsOnly: string[];
  /** fullDbCover일 때 merged 순서가 위와 동일하면 true (DB subset 순서 일치) */
  fullDbCoverMergedOrderMatchesDbSubset: boolean;
  sortedCategories: string[];
  sampleProducts: Array<{ id?: string; sku?: string; category: string }>;
} {
  const dbNorm = normalizeCategoryOrderMapKeys(dbMapRaw);
  const appearance = buildCategoryOrderMapFromProductFirstAppearance(products);
  const labels = new Set<string>();
  for (const p of products) {
    const c = normalizeCategoryLabel(p.category);
    if (c) labels.add(c);
  }
  const inDb = [...labels].filter((c) => dbNorm[c] !== undefined);
  const mergePath = computeCategoryOrderMergePath(labels, dbNorm);
  const merged = mergeCategoryOrderMapForDisplay(products, dbMapRaw, { silent: true });
  const mergedCategoriesSortedByPosition = categoryOrderMapToCategoriesSortedByPosition(merged);
  const dbNormCategoriesSortedByPosition = categoryOrderMapToCategoriesSortedByPosition(dbNorm);
  const dbNormCategoriesForProductsOnly = dbNormCategoriesSortedByPosition.filter((c) => labels.has(c));
  const fullDbCoverMergedOrderMatchesDbSubset =
    mergePath === "fullDbCover→dbPositions" &&
    mergedCategoriesSortedByPosition.length === dbNormCategoriesForProductsOnly.length &&
    mergedCategoriesSortedByPosition.every((c, i) => c === dbNormCategoriesForProductsOnly[i]);
  const sorted = [...products].sort((a, b) => compareProductsByCategoryOrder(a, b, merged));
  return {
    mergePath,
    mergePathArrowAscii: mergePath.replace(/→/g, "->"),
    dbMapRawKeyCount: Object.keys(dbMapRaw).length,
    dbNormKeyCount: Object.keys(dbNorm).length,
    labelCount: labels.size,
    labelsInDbCount: inDb.length,
    appearance,
    dbNorm,
    merged,
    mergedCategoriesSortedByPosition,
    dbNormCategoriesSortedByPosition,
    dbNormCategoriesForProductsOnly,
    fullDbCoverMergedOrderMatchesDbSubset,
    sortedCategories: sorted.map((p) => normalizeCategoryLabel(p.category)),
    sampleProducts: sorted.slice(0, 30).map((p) => ({
      id: p.id,
      sku: p.sku,
      category: normalizeCategoryLabel(p.category),
    })),
  };
}
