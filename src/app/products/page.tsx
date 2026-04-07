import { createHash } from "crypto";

import { supabaseServer } from "@/lib/supabaseClient";
import { normalizeCategoryLabel } from "./categoryNormalize";
import { getLocalImageHrefBySkuLower } from "./localProductImages.server";
import { fetchCategoryOrderMap } from "./categorySortOrder.server";
import {
  compareProductsByCategoryOrder,
  diagnoseCategoryOrderPipeline,
  mergeCategoryOrderMapForDisplay,
  sortCategoryFilterLabels,
} from "./categorySortOrder.utils";
import { ProductsClient } from "./ProductsClient";
import type { Product, ProductVariant } from "./types";
import { normalizeSkuForMatch, productNormSku, variantMatchesNormSku } from "./skuNormalize";
import { variantCompositeKey } from "./variantOptions";
import { VARIANT_AUDIT_TARGET_SKUS } from "./variantAuditTargets";

export const dynamic = "force-dynamic";

function mapProduct(row: Record<string, unknown>): Product {
  const sku = String(row.sku ?? "");
  const rawImageUrl = (row.image_url as string) ?? null;
  const explicit = rawImageUrl && rawImageUrl.trim() !== "" ? rawImageUrl.trim() : null;
  const imageUrl = explicit;

  const catNorm = normalizeCategoryLabel(row.category as string | null);
  return {
    id: String(row.id),
    sku,
    category: catNorm || null,
    name: String((row.name as string) ?? sku ?? ""),
    imageUrl,
    wholesalePrice: row.wholesale_price != null ? Number(row.wholesale_price) : null,
    msrpPrice: row.msrp_price != null ? Number(row.msrp_price) : null,
    salePrice: row.sale_price != null ? Number(row.sale_price) : null,
    extraPrice: row.extra_price != null ? Number(row.extra_price) : null,
    memo: (row.memo as string) ?? null,
    memo2: (row.memo2 as string) ?? null,
    stock: row.stock != null ? Number(row.stock) : 0,
    createdAt: row.created_at as string | null,
    updatedAt: row.updated_at as string | null,
  };
}

function mapVariant(row: Record<string, unknown>): ProductVariant {
  return {
    id: String(row.id),
    productId: String(row.product_id),
    sku: String(row.sku ?? ""),
    color: String(row.color ?? ""),
    gender: String(row.gender ?? ""),
    size: String(row.size ?? ""),
    stock: Number(row.stock ?? 0),
    wholesalePrice: row.wholesale_price != null ? Number(row.wholesale_price) : null,
    msrpPrice: row.msrp_price != null ? Number(row.msrp_price) : null,
    salePrice: row.sale_price != null ? Number(row.sale_price) : null,
    extraPrice: row.extra_price != null ? Number(row.extra_price) : null,
    memo: (row.memo as string) ?? null,
    memo2: (row.memo2 as string) ?? null,
    createdAt: (row.created_at as string) ?? null,
  };
}

const VARIANT_SELECT =
  "id, product_id, sku, color, gender, size, stock, wholesale_price, msrp_price, sale_price, extra_price, memo, memo2, created_at";

/** PostgREST 기본 행 상한(보통 1000)을 넘기면 `.select()` 한 번에 잘림 → 일부 product의 variant가 통째로 빠질 수 있음 */
const PRODUCT_VARIANTS_PAGE_SIZE = 1000;

async function fetchAllProductVariantRowsForProductIds(
  productIds: string[]
): Promise<{ rows: Record<string, unknown>[]; error: { message: string } | null }> {
  if (productIds.length === 0) return { rows: [], error: null };
  const out: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += PRODUCT_VARIANTS_PAGE_SIZE) {
    const { data, error } = await supabaseServer
      .from("product_variants")
      .select(VARIANT_SELECT)
      .in("product_id", productIds)
      .order("id", { ascending: true })
      .range(offset, offset + PRODUCT_VARIANTS_PAGE_SIZE - 1);
    if (error) return { rows: [], error };
    const chunk = data ?? [];
    out.push(...chunk);
    if (chunk.length < PRODUCT_VARIANTS_PAGE_SIZE) break;
  }
  return { rows: out, error: null };
}

/** `variantsSyncDigest`용 — id만이 아니라 행 내용 변경(재고·가격·옵션·메모)에도 digest가 바뀌게 함 */
function variantRowSyncFingerprint(v: ProductVariant): string {
  return [
    v.id,
    v.productId,
    normalizeSkuForMatch(v.sku),
    variantCompositeKey(v.color, v.gender, v.size),
    v.stock,
    v.wholesalePrice ?? "",
    v.msrpPrice ?? "",
    v.salePrice ?? "",
    v.extraPrice ?? "",
    (v.memo ?? "").trim(),
    (v.memo2 ?? "").trim(),
  ].join("\x1f");
}

function dedupeProductsById(products: Product[]): Product[] {
  const seen = new Set<string>();
  const out: Product[] = [];
  for (const p of products) {
    const id = String(p.id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(p);
  }
  return out;
}

const DEBUG_DUPES_QUERY = "debugProductsDupes";
const DEBUG_VARIANT_SKU_MIX_QUERY = "debugVariantSkuMix";
const DEBUG_DISPLAY_GROUPS_QUERY = "debugDisplayGroups";
const DEBUG_TARGET_SKUS_QUERY = "debugTargetSkus";
const DEBUG_CATEGORY_ORDER_QUERY = "debugCategoryOrder";
const DEBUG_VARIANT_TRACE_QUERY = "debugVariantTrace";
/** `?debugVariantSync=1` — 서버 digest + 클라 snapshot 동기화 useEffect(브라우저 콘솔) 로그 */
const DEBUG_VARIANT_SYNC_QUERY = "debugVariantSync";

function pickSearchParam(
  searchParams: Record<string, string | string[] | undefined> | undefined,
  key: string
): string {
  const v = searchParams?.[key];
  if (Array.isArray(v)) return String(v[0] ?? "").trim();
  return String(v ?? "").trim();
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const debugProductsDupes = searchParams?.[DEBUG_DUPES_QUERY] === "1";
  const debugVariantSkuMix = searchParams?.[DEBUG_VARIANT_SKU_MIX_QUERY] === "1";
  const debugDisplayGroups = searchParams?.[DEBUG_DISPLAY_GROUPS_QUERY] === "1";
  const debugTargetSkus = searchParams?.[DEBUG_TARGET_SKUS_QUERY] === "1";
  const debugCategoryOrder = searchParams?.[DEBUG_CATEGORY_ORDER_QUERY] === "1";
  const debugVariantTrace = searchParams?.[DEBUG_VARIANT_TRACE_QUERY] === "1";
  const debugVariantSync = searchParams?.[DEBUG_VARIANT_SYNC_QUERY] === "1";
  const traceProductId = pickSearchParam(searchParams, "traceProductId");
  const focusSku = pickSearchParam(searchParams, "focusSku");
  if (!supabaseServer) {
    return (
      <div style={{ padding: 24, color: "crimson" }}>
        Supabase server client not ready. Check env (.env.local) and restart server.
      </div>
    );
  }

  const { data, error } = await supabaseServer
    .from("products")
    .select(
      "id, sku, category, name, image_url, wholesale_price, msrp_price, sale_price, extra_price, memo, memo2, stock, created_at, updated_at"
    )
    .order("sku", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Products</h1>
        <p style={{ color: "crimson" }}>Supabase error: {error.message}</p>
      </div>
    );
  }

  const categoryOrderFromDb = await fetchCategoryOrderMap();
  /** `public/images` 파일명 stem ↔ `normalizeSkuForMatch`로 매칭 (jpg>jpeg>png>webp) */
  const localImageHrefBySkuLower = getLocalImageHrefBySkuLower();
  const products: Product[] = dedupeProductsById(
    (data ?? []).map((row: Record<string, unknown>) => mapProduct(row))
  );
  const categoryOrder = mergeCategoryOrderMapForDisplay(products, categoryOrderFromDb);

  if (debugCategoryOrder) {
    const { data: coRows } = await supabaseServer.from("category_sort_order")
      .select("category, position")
      .order("position", { ascending: true });
    const dbMapRaw: Record<string, number> = {};
    for (const r of (coRows ?? []) as { category: string; position: number }[]) {
      dbMapRaw[r.category] = Number(r.position);
    }
    const diag = diagnoseCategoryOrderPipeline(products, dbMapRaw);
    const unsortedHead = products.slice(0, 25).map((p) => ({ sku: p.sku, category: p.category ?? "" }));
    const sortedPreview = [...products].sort((a, b) => compareProductsByCategoryOrder(a, b, categoryOrder));
    const sortedHead = sortedPreview.slice(0, 40).map((p) => ({ sku: p.sku, category: p.category ?? "" }));
    console.info("[debugCategoryOrder][server] 1) category_sort_order 원본 행", coRows);
    console.info("[debugCategoryOrder][server] 2) mergePath & 카운트", diag.mergePath, {
      dbMapRawKeyCount: diag.dbMapRawKeyCount,
      dbNormKeyCount: diag.dbNormKeyCount,
      labelCount: diag.labelCount,
      labelsInDbCount: diag.labelsInDbCount,
    });
    console.info("[debugCategoryOrder][server] 3) appearance 맵", diag.appearance);
    console.info("[debugCategoryOrder][server] 4) dbNorm 맵(일부)", diag.dbNorm);
    console.info("[debugCategoryOrder][server] 5) merged 최종 맵", diag.merged);
    console.info("[debugCategoryOrder][server] 6) 정렬 직전 상품 category 샘플", unsortedHead);
    console.info("[debugCategoryOrder][server] 7) categoryOrder로 정렬 직후 category 순서(앞 40)", sortedHead);
    console.info("[debugCategoryOrder][server] 8) sortedCategories 연속", diag.sortedCategories.slice(0, 60));
  }

  products.sort((a, b) => compareProductsByCategoryOrder(a, b, categoryOrder));
  const productIds = products.map((p) => p.id);

  let flatVariantsFromDb: ProductVariant[] = [];
  let variantsByProductId: Record<string, ProductVariant[]> = {};
  if (productIds.length > 0) {
    const { rows: variantRows, error: variantsError } = await fetchAllProductVariantRowsForProductIds(productIds);
    if (!variantsError) {
      flatVariantsFromDb = variantRows.map((r) => mapVariant(r));
      flatVariantsFromDb.forEach((v) => {
        if (!variantsByProductId[v.productId]) variantsByProductId[v.productId] = [];
        const bucket = variantsByProductId[v.productId]!;
        if (bucket.some((x) => x.id === v.id)) return;
        bucket.push(v);
      });
    }
  }

  const variantsSyncDigest =
    flatVariantsFromDb.length === 0
      ? "0"
      : createHash("sha256")
          .update([...flatVariantsFromDb].map(variantRowSyncFingerprint).sort().join("\0"))
          .digest("hex");

  if (debugVariantSync && typeof console !== "undefined" && console.info) {
    const tracePid = traceProductId.trim();
    const traceBucket = tracePid ? (variantsByProductId[tracePid] ?? []) : [];
    console.info("[productsPipeline][server][debugVariantSync] 렌더 시점", {
      variantsSyncDigest,
      flatVariantRowCount: flatVariantsFromDb.length,
      productBucketKeys: Object.keys(variantsByProductId).length,
      traceProductId: tracePid || "(없음)",
      traceBucketLength: traceBucket.length,
      trace남120: traceBucket.filter((v) => (v.gender ?? "").trim() === "남" && (v.size ?? "").trim() === "120"),
    });
  }

  if (debugVariantTrace && traceProductId && typeof console !== "undefined" && console.info) {
    const bucket = variantsByProductId[traceProductId] ?? [];
    console.info("[productsPipeline][server] traceProductId → variantsByProductId 버킷", {
      traceProductId,
      variantCount: bucket.length,
      ids: bucket.map((v) => v.id),
      남120: bucket.filter((v) => (v.gender ?? "").trim() === "남" && (v.size ?? "").trim() === "120"),
    });
  }

  const categoriesRaw = Array.from(
    new Set(products.map((p) => p.category).filter((c): c is string => Boolean(c)))
  );
  const categories = sortCategoryFilterLabels(categoriesRaw, categoryOrder);

  if (debugTargetSkus) {
    for (const rawT of VARIANT_AUDIT_TARGET_SKUS) {
      const t = normalizeSkuForMatch(rawT);
      const perProduct: Array<{
        productId: string;
        productSku: string;
        variantRowCount: number;
        variantRowsMatchingGroupNormSku: number;
        distinctCompositeKeysAmongMatching: number;
      }> = [];
      const allMatching: ProductVariant[] = [];
      for (const p of products) {
        if (productNormSku(p, variantsByProductId) !== t) continue;
        const vars = variantsByProductId[p.id] ?? [];
        const matching = vars.filter((v) => variantMatchesNormSku(v, t));
        for (const v of matching) allMatching.push(v);
        perProduct.push({
          productId: p.id,
          productSku: p.sku,
          variantRowCount: vars.length,
          variantRowsMatchingGroupNormSku: matching.length,
          distinctCompositeKeysAmongMatching: new Set(
            matching.map((v) => variantCompositeKey(v.color, v.gender, v.size))
          ).size,
        });
      }
      const expectedCardOptionRows = new Set(
        allMatching.map((v) => variantCompositeKey(v.color, v.gender, v.size))
      ).size;
      const excludedBySkuFilter = products
        .filter((p) => productNormSku(p, variantsByProductId) === t)
        .reduce((sum, p) => {
          const vars = variantsByProductId[p.id] ?? [];
          return sum + vars.filter((v) => !variantMatchesNormSku(v, t)).length;
        }, 0);
      console.info("[variantAudit][server] mapProduct 이후 · DB→variantsByProductId", {
        targetNormSku: t,
        productRowsForNormSku: perProduct.length,
        perProduct,
        totalVariantRowsOnThoseProducts: perProduct.reduce((s, r) => s + r.variantRowCount, 0),
        totalRowsAfterVariantMatchesNormSku: allMatching.length,
        excludedVariantRowsWrongSku: excludedBySkuFilter,
        expectedCardOptionRowsAfterCompositeMerge: expectedCardOptionRows,
        mapProductNote: "variants는 mapVariant로만 변환되며 개수를 줄이지 않음",
      });
    }
  }

  if (debugProductsDupes) {
    const ids = products.map((p) => p.id);
    const skus = products.map((p) => p.sku);
    const focusSku = "T25KT1033BL";
    const focus = products.filter((p) => p.sku === focusSku);
    console.info("[productsPipeline][server] ProductsClient 직전 products", {
      length: products.length,
      ids,
      skus,
      uniqueIdCount: new Set(ids).size,
      items: products.map((p) => ({ id: p.id, sku: p.sku, name: p.name })),
      focusSku,
      focusCount: focus.length,
      focusIdsDistinct: new Set(focus.map((p) => p.id)).size,
      focusDetail: focus.map((p) => ({ id: p.id, sku: p.sku, name: p.name })),
    });
    const productIdSet = new Set(productIds);
    const orphanRefs = flatVariantsFromDb.filter((v) => !productIdSet.has(v.productId));
    const focusPids = new Set(focus.map((p) => p.id));
    const t25VariantsEverywhere = flatVariantsFromDb.filter(
      (v) => v.sku === focusSku || focusPids.has(v.productId)
    );
    const 남100ish = (v: ProductVariant) => {
      const g = (v.gender ?? "").trim();
      const s = (v.size ?? "").trim();
      const male = g.includes("남") || /^m$/i.test(g) || g === "남성";
      return male && (s === "100" || s === "100 ");
    };

    console.info("[productsPipeline][server] T25 variant 연결 요약", {
      focusSku,
      focusProductRows: focus.length,
      distinctFocusProductIds: focusPids.size,
      interpretation:
        focus.length > 1 && focusPids.size > 1
          ? "동일 SKU 상품이 products 테이블에 product_id가 다른 행으로 2건 이상 → 카드가 SKU당 여러 장 나올 수 있음"
          : focus.length === 1
            ? "products 상 SKU는 1행 — 카드 분리는 다른 원인(필터/클라이언트)"
            : "기타",
      orphanVariants_productIdNotInList: orphanRefs.length > 0 ? orphanRefs.map((v) => v.id) : "없음",
      t25RelatedVariantCount: t25VariantsEverywhere.length,
      남100_variants: t25VariantsEverywhere
        .filter(남100ish)
        .map((v) => ({
          variantId: v.id,
          productId: v.productId,
          color: v.color,
          gender: v.gender,
          size: v.size,
          stock: v.stock,
        })),
    });

    for (const row of focus) {
      const bucket = variantsByProductId[row.id] ?? [];
      const variantIds = bucket.map((v) => v.id);
      const variantIdSet = new Set(variantIds);
      console.info("[productsPipeline][server] variantsData→variantsByProductId 버킷(상세)", {
        focusSku,
        productId: row.id,
        productSku: row.sku,
        productName: row.name,
        bucketLength: bucket.length,
        variantIds,
        duplicateVariantIdsInBucket: variantIds.length > variantIdSet.size ? "yes" : "no",
        variants: bucket.map((v) => ({
          variantId: v.id,
          productId: v.productId,
          variantSku: v.sku,
          color: v.color,
          gender: v.gender,
          size: v.size,
          stock: v.stock,
          남100: 남100ish(v),
        })),
      });
    }
  }

  return (
    /* digest 변경 시 ProductsClient 리마운트 — router.refresh()만으로는 props가 안 붙는 경우에도 로컬 state가 서버와 맞춰짐(검색·필터 등 클라 전용 상태는 초기화될 수 있음). */
    <ProductsClient
      key={variantsSyncDigest}
      products={products}
      categories={categories}
      categoryOrder={categoryOrder}
      localImageHrefBySkuLower={localImageHrefBySkuLower}
      variantsByProductId={variantsByProductId}
      variantsSyncDigest={variantsSyncDigest}
      debugProductsDupes={debugProductsDupes}
      debugVariantSkuMix={debugVariantSkuMix}
      debugDisplayGroups={debugDisplayGroups}
      debugVariantTrace={debugVariantTrace}
      debugVariantSync={debugVariantSync}
      traceProductId={traceProductId}
      focusSku={focusSku}
      debugTargetSkus={debugTargetSkus}
      debugCategoryOrder={debugCategoryOrder}
    />
  );
}
