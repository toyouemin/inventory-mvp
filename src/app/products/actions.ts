"use server";

import { supabaseServer } from "@/lib/supabaseClient";
import { revalidatePath } from "next/cache";
import { runProductCsvPipeline, type ParsedCsvRow } from "./csvProductPipeline";
import { dominantNormSkuFromVariantSkus, normalizeSkuForMatch } from "./skuNormalize";
import {
  aggregateDuplicateVariantsByCompositeKey,
  PRODUCT_VARIANTS_ON_CONFLICT,
  variantCompositeKey,
} from "./variantOptions";
import { ensureCategorySortOrderRow, syncCategorySortOrderAfterCsv } from "./categorySortOrder.server";
import { buildCategoryOrderMapFromCsvRows } from "./categorySortOrder.utils";
import {
  reconnectProductsImageUrlsFromStorageBySku,
  removeReplacedProductImageFromStorage,
} from "@/lib/productImagesStorage";

const LOG_MOVES = process.env.LOG_MOVES === "1";
/** CSV 업로드 행별 재고 디버그: .env에 LOG_CSV_STOCK=1 */
const LOG_CSV_STOCK = process.env.LOG_CSV_STOCK === "1";
/** 상품 수정·옵션 저장 분기: .env에 LOG_PRODUCT_UPDATE=1 */
const LOG_PRODUCT_UPDATE = process.env.LOG_PRODUCT_UPDATE === "1";

function resolveProductImageUrl(sku: string, imageUrl: string | null | undefined): string | null {
  const explicit = (imageUrl ?? "").trim();
  if (explicit) return explicit;
  return null;
}

function hasExplicitImageUrl(imageUrl: string | null | undefined): boolean {
  return String(imageUrl ?? "").trim() !== "";
}

/* -----------------------------
 * Products: create / update
 * ----------------------------- */

// 상품 추가 (variants 있으면 product_variants 삽입)
export async function createProduct(data: {
  sku: string;
  category?: string | null;
  name: string;
  imageUrl?: string | null;
  memo?: string | null;
  memo2?: string | null;
  variants?: {
    color: string;
    gender: string;
    size: string;
    stock: number;
    wholesalePrice?: number | null;
    msrpPrice?: number | null;
    salePrice?: number | null;
    extraPrice?: number | null;
    memo?: string | null;
    memo2?: string | null;
  }[];
}) {
  const sku = normalizeSkuForMatch(data.sku ?? "");
  if (!sku) return;

  const { data: dupP } = await supabaseServer.from("products").select("id").eq("sku", sku).limit(1).maybeSingle();
  if (dupP?.id) {
    throw new Error(
      `동일 SKU(${sku})의 상품이 이미 있습니다. 목록에서 해당 상품을 수정하거나 CSV 병합 업로드를 사용하세요.`
    );
  }
  const { data: dupV } = await supabaseServer.from("product_variants").select("id").eq("sku", sku).limit(1);
  if (dupV && dupV.length > 0) {
    throw new Error(`SKU ${sku}이(가) 이미 다른 상품의 옵션(variant)에 등록되어 있습니다.`);
  }

  const hasVariants = Array.isArray(data.variants) && data.variants.length > 0;

  const { data: inserted, error } = await supabaseServer.from("products").insert({
    sku,
    category: data.category?.trim() || null,
    name: (data.name ?? "").trim(),
    image_url: resolveProductImageUrl(sku, data.imageUrl),
    wholesale_price: null,
    msrp_price: null,
    sale_price: null,
    extra_price: null,
    memo: data.memo?.trim() || null,
    memo2: data.memo2?.trim() || null,
    stock: 0,
  }).select("id").single();

  if (error) throw new Error(error.message);
  const productId = inserted.id;

  await ensureCategorySortOrderRow(data.category);

  if (hasVariants && data.variants) {
    const deduped = aggregateDuplicateVariantsByCompositeKey(data.variants);
    const variantRows = deduped.map((v) => {
      const stock = Number.isFinite(Number(v.stock)) ? Math.max(0, Number(v.stock)) : 0;
      return {
        product_id: productId,
        sku,
        color: String(v.color ?? "").trim(),
        gender: String(v.gender ?? "").trim(),
        size: String(v.size ?? "").trim(),
        stock,
        wholesale_price:
          v.wholesalePrice != null && Number.isFinite(v.wholesalePrice) ? Math.round(v.wholesalePrice) : 0,
        msrp_price: v.msrpPrice != null && Number.isFinite(v.msrpPrice) ? Math.round(v.msrpPrice) : 0,
        sale_price: v.salePrice != null && Number.isFinite(v.salePrice) ? Math.round(v.salePrice) : 0,
        extra_price: v.extraPrice != null && Number.isFinite(v.extraPrice) ? Math.round(v.extraPrice) : 0,
        memo: v.memo?.trim() || null,
        memo2: v.memo2?.trim() || null,
      };
    });
    const { error: vErr } = await supabaseServer
      .from("product_variants")
      .upsert(variantRows, { onConflict: PRODUCT_VARIANTS_ON_CONFLICT });
    if (vErr) throw new Error(vErr.message);
  }

  await syncProductsStockFromVariantSums([String(productId)], new Date().toISOString());

  revalidatePath("/products");
  revalidatePath("/status");
}

// 상품 수정
export async function updateProduct(
  productId: string,
  data: {
    sku?: string;
    category?: string | null;
    name?: string;
    imageUrl?: string | null;
    memo?: string | null;
    memo2?: string | null;
    variants?: {
      updates: Array<{
        id?: string;
        color: string;
        gender: string;
        size: string;
        stock: number;
        wholesalePrice?: number | null;
        msrpPrice?: number | null;
        salePrice?: number | null;
        extraPrice?: number | null;
        memo?: string | null;
        memo2?: string | null;
      }>;
      deleteIds: string[];
    };
    stock?: number;
  }
) {
  if (!productId) return;

  const updateData: Record<string, unknown> = {};
  let stockTimestampForProduct: string | null = null;
  let imageUrlReplaceForStorageCleanup: { prev: string; next: string } | null = null;

  if (data.sku !== undefined) updateData.sku = normalizeSkuForMatch(data.sku);
  if (data.category !== undefined) updateData.category = data.category?.trim() || null;
  if (data.name !== undefined) updateData.name = data.name?.trim();
  if (data.imageUrl !== undefined) {
    const { data: row } = await supabaseServer
      .from("products")
      .select("sku, image_url")
      .eq("id", productId)
      .maybeSingle();
    const previousUrlTrim = String((row?.image_url as string | null) ?? "").trim();
    let skuForImg = data.sku?.trim() ?? "";
    if (!skuForImg) {
      skuForImg = (row?.sku as string | undefined)?.trim() ?? "";
    }
    const resolved = resolveProductImageUrl(skuForImg, data.imageUrl);
    updateData.image_url = resolved;
    imageUrlReplaceForStorageCleanup = {
      prev: previousUrlTrim,
      next: String(resolved ?? "").trim(),
    };
  }

  if (data.memo !== undefined) {
    updateData.memo = data.memo?.trim() || null;
  }
  if (data.memo2 !== undefined) {
    updateData.memo2 = data.memo2?.trim() || null;
  }

  if (data.stock !== undefined)
    updateData.stock = Number.isFinite(Number(data.stock)) ? Math.max(0, Number(data.stock)) : 0;
  if (data.variants && data.variants.updates.length > 0) updateData.stock = 0;
  if (data.stock !== undefined) {
    stockTimestampForProduct = new Date().toISOString();
    updateData.stock_updated_at = stockTimestampForProduct;
  }
  if (Object.keys(updateData).length > 0) {
    // 상품 메타 수정 기준 시각(재고 변경 시각은 stock_updated_at으로 분리)
    updateData.updated_at = new Date().toISOString();
  }

  const { error } = await supabaseServer.from("products").update(updateData).eq("id", productId);
  if (error) throw new Error(error.message);

  if (imageUrlReplaceForStorageCleanup) {
    const rm = await removeReplacedProductImageFromStorage({
      previousPublicUrl: imageUrlReplaceForStorageCleanup.prev,
      newPublicUrl: imageUrlReplaceForStorageCleanup.next,
    });
    if (rm.errorMessage) {
      console.error("[products] 단건/수정: Storage 이전 이미지 삭제 실패(상품 URL은 갱신됨)", {
        productId,
        message: rm.errorMessage,
      });
    }
  }

  if (data.category !== undefined) {
    await ensureCategorySortOrderRow(data.category?.trim() || null);
  }

  const { data: prodRow } = await supabaseServer.from("products").select("sku").eq("id", productId).maybeSingle();
  const skuFromDb = normalizeSkuForMatch(String((prodRow?.sku as string | undefined) ?? ""));
  const skuFromRequest = data.sku !== undefined ? normalizeSkuForMatch(data.sku) : "";
  const productSku = skuFromDb || skuFromRequest;

  const hasVariantMutations =
    !!data.variants &&
    (data.variants.updates.length > 0 || data.variants.deleteIds.some((id) => String(id ?? "").trim() !== ""));

  if (hasVariantMutations && data.variants) {
    const { updates, deleteIds } = data.variants;
    const { data: prevVariantsRaw, error: prevVariantsErr } = await supabaseServer
      .from("product_variants")
      .select("id, stock")
      .eq("product_id", productId);
    if (prevVariantsErr) throw new Error(prevVariantsErr.message);
    const prevVariantRows = (prevVariantsRaw ?? []) as Array<{ id: string; stock: number | null }>;
    const prevStockById = new Map<string, number>();
    for (const v of prevVariantRows) {
      const n = Number(v.stock ?? 0);
      prevStockById.set(
        String(v.id),
        Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0
      );
    }
    const normalizedStock = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0);
    const stockChangedByVariantMutation =
      updates.some((u) => {
        if (!u.id) return normalizedStock(Number(u.stock ?? 0)) !== 0;
        return normalizedStock(Number(u.stock ?? 0)) !== (prevStockById.get(String(u.id)) ?? 0);
      }) ||
      deleteIds.some((id) => (prevStockById.get(String(id)) ?? 0) !== 0);
    if (stockChangedByVariantMutation) {
      stockTimestampForProduct = new Date().toISOString();
    }

    const withId = updates.filter((u) => u.id);
    const withoutId = updates.filter((u) => !u.id);

    if (LOG_PRODUCT_UPDATE) {
      console.info("[updateProduct][variants]", {
        productId,
        productSku,
        skuFromDb,
        skuFromRequest,
        deleteIdsCount: deleteIds.filter(Boolean).length,
        updateWithIdCount: withId.length,
        insertWithoutIdCount: withoutId.length,
        withoutIdPreview: withoutId.map((u) => ({
          color: (u.color ?? "").trim(),
          gender: (u.gender ?? "").trim(),
          size: (u.size ?? "").trim(),
          stock: u.stock,
        })),
      });
    }

    for (const id of deleteIds) {
      if (id) {
        await supabaseServer.from("product_variants").delete().eq("id", id);
      }
    }

    for (const u of withId) {
      const stock = Number.isFinite(Number(u.stock)) ? Math.max(0, Number(u.stock)) : 0;
      const row = {
        sku: productSku,
        color: (u.color ?? "").trim(),
        gender: (u.gender ?? "").trim(),
        size: (u.size ?? "").trim(),
        stock,
        wholesale_price:
          u.wholesalePrice != null && Number.isFinite(u.wholesalePrice) ? Math.round(u.wholesalePrice) : 0,
        msrp_price: u.msrpPrice != null && Number.isFinite(u.msrpPrice) ? Math.round(u.msrpPrice) : 0,
        sale_price: u.salePrice != null && Number.isFinite(u.salePrice) ? Math.round(u.salePrice) : 0,
        extra_price: u.extraPrice != null && Number.isFinite(u.extraPrice) ? Math.round(u.extraPrice) : 0,
        memo: u.memo?.trim() || null,
        memo2: u.memo2?.trim() || null,
      };
      await supabaseServer.from("product_variants").update(row).eq("id", u.id!);
    }

    if (withoutId.length > 0) {
      const dedupedNew = aggregateDuplicateVariantsByCompositeKey(withoutId);
      const newRows = dedupedNew.map((u) => {
        const stock = Number.isFinite(Number(u.stock)) ? Math.max(0, Number(u.stock)) : 0;
        return {
          product_id: productId,
          sku: productSku,
          color: (u.color ?? "").trim(),
          gender: (u.gender ?? "").trim(),
          size: (u.size ?? "").trim(),
          stock,
          wholesale_price:
            u.wholesalePrice != null && Number.isFinite(u.wholesalePrice) ? Math.round(u.wholesalePrice) : 0,
          msrp_price: u.msrpPrice != null && Number.isFinite(u.msrpPrice) ? Math.round(u.msrpPrice) : 0,
          sale_price: u.salePrice != null && Number.isFinite(u.salePrice) ? Math.round(u.salePrice) : 0,
          extra_price: u.extraPrice != null && Number.isFinite(u.extraPrice) ? Math.round(u.extraPrice) : 0,
          memo: u.memo?.trim() || null,
          memo2: u.memo2?.trim() || null,
        };
      });
      const { error: upErr } = await supabaseServer
        .from("product_variants")
        .upsert(newRows, { onConflict: PRODUCT_VARIANTS_ON_CONFLICT });
      if (upErr) throw new Error(upErr.message);
      if (LOG_PRODUCT_UPDATE) {
        console.info("[updateProduct][variants] upsert 신규 행 완료", {
          productId,
          rowCount: newRows.length,
        });
      }
    }

    await syncProductsStockFromVariantSums([productId], stockTimestampForProduct ?? undefined);
  }

  revalidatePath("/products");
  revalidatePath("/status");
}

// 상품 삭제 (cascade로 product_variants 자동 삭제)
export async function deleteProduct(productId: string) {
  if (!productId) return;
  const { error } = await supabaseServer.from("products").delete().eq("id", productId);
  if (error) throw new Error(error.message);
  revalidatePath("/products");
  revalidatePath("/status");
}

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const SKU_IMAGE_CLEANUP_EXTENSIONS = ["jpg", "jpeg", "png", "webp"] as const;

/** Storage `product-images`에 새 객체로 업로드(매번 고유 경로 — 단건·일괄 공통). */
async function uploadImageFileToProductImagesBucket(file: File): Promise<string> {
  const type = file.type?.toLowerCase() ?? "";
  if (!ALLOWED_IMAGE_TYPES.includes(type)) {
    throw new Error("jpg, png, webp만 업로드할 수 있습니다.");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("파일 크기는 5MB 이하여야 합니다.");
  }

  const ext = type === "image/jpeg" ? "jpg" : type === "image/png" ? "png" : "webp";
  const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error } = await supabaseServer.storage.from("product-images").upload(path, file, {
    contentType: type,
    upsert: false,
  });

  if (error) throw new Error(error.message);

  const { data: urlData } = supabaseServer.storage.from("product-images").getPublicUrl(path);
  return urlData.publicUrl;
}

function safeSkuForImageFilename(rawSku: string): string {
  const normalized = normalizeSkuForMatch(rawSku);
  // Storage 경로 안전성: 경로 구분자/제어문자 제거
  return normalized.replace(/[\/\\:*?"<>|\u0000-\u001F]/g, "-").trim();
}

async function removeOtherSkuImageExtensions(skuBase: string, keepExt: string): Promise<void> {
  const removeTargets = SKU_IMAGE_CLEANUP_EXTENSIONS
    .filter((ext) => ext !== keepExt)
    .map((ext) => `${skuBase}.${ext}`);
  if (removeTargets.length === 0) return;
  const { error } = await supabaseServer.storage.from("product-images").remove(removeTargets);
  if (error) {
    console.warn("[product-images] SKU 이미지 확장자 정리 실패", {
      skuBase,
      keepExt,
      message: error.message,
    });
  }
}

/** 개별 업로드 전용: 원본 파일명 무시, `product-images/{SKU}.{ext}`로 저장(upsert). */
async function uploadImageFileToProductImagesBucketBySku(file: File, skuRaw: string): Promise<string> {
  const type = file.type?.toLowerCase() ?? "";
  if (!ALLOWED_IMAGE_TYPES.includes(type)) {
    throw new Error("jpg, png, webp만 업로드할 수 있습니다.");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("파일 크기는 5MB 이하여야 합니다.");
  }
  const skuBase = safeSkuForImageFilename(skuRaw);
  if (!skuBase) {
    throw new Error("SKU가 비어 있어 이미지를 업로드할 수 없습니다.");
  }

  const ext = type === "image/jpeg" ? "jpg" : type === "image/png" ? "png" : "webp";
  const path = `${skuBase}.${ext}`;

  const { error } = await supabaseServer.storage.from("product-images").upload(path, file, {
    contentType: type,
    upsert: true,
  });
  if (error) throw new Error(error.message);

  // 같은 SKU의 기존 확장자 파일(jpg/jpeg/png/webp) 중 현재 확장자 외는 정리
  await removeOtherSkuImageExtensions(skuBase, ext);

  const { data: urlData } = supabaseServer.storage.from("product-images").getPublicUrl(path);
  return urlData.publicUrl;
}

/** Upload image to Supabase Storage bucket product-images; returns public URL. */
export async function uploadProductImage(formData: FormData): Promise<{ url: string }> {
  const file = formData.get("file") as File | null;
  if (!file || !(file instanceof File)) throw new Error("파일이 없습니다.");
  const sku = String(formData.get("sku") ?? "");
  const url = await uploadImageFileToProductImagesBucketBySku(file, sku);
  return { url };
}

function imageFilenameBasename(name: string): string {
  const n = name.replace(/\\/g, "/").split("/").pop() ?? name;
  return n.trim();
}

function stemFromProductImageFilename(name: string): string {
  return imageFilenameBasename(name).replace(/\.(jpe?g|png|webp)$/i, "").trim();
}

export type BulkProductImageUploadResult = {
  successCount: number;
  matchFailedCount: number;
  uploadFailedCount: number;
  skippedExistingImageCount: number;
  /** 매칭 실패 파일명(최대 30개) */
  matchFailedSamples: string[];
  /** 업로드 오류 */
  uploadErrors: { filename: string; message: string }[];
  /** 이미지 있어 건너뜀(onlyIfEmpty 모드) */
  skippedExistingSamples: string[];
  /** 동일 정규화 SKU 상품이 DB에 여러 개일 때 첫 행만 사용한 normSku (참고) */
  duplicateNormSkuUsedFirst: string[];
  /** 교체 후 이전 Storage 객체 삭제 실패(최대 20건, 업로드·DB 반영은 성공한 경우만) */
  storageDeleteFailures: { filename: string; message: string }[];
};

/**
 * 여러 이미지 일괄 업로드: 파일명 stem → normalizeSkuForMatch → products.sku 매칭 후 image_url 갱신.
 * Storage는 매번 새 경로(덮어쓰기 아님). DB 갱신 성공 후 이전 product-images 객체는 공용 정리 로직으로 삭제 시도.
 */
export async function bulkUploadProductImages(formData: FormData): Promise<BulkProductImageUploadResult> {
  if (!supabaseServer) {
    throw new Error("Supabase server client not ready");
  }

  const onlyIfEmpty =
    formData.get("onlyIfEmpty") === "1" || String(formData.get("onlyIfEmpty") ?? "").toLowerCase() === "true";
  const rawFiles = formData.getAll("files");
  const files = rawFiles.filter((x): x is File => x instanceof File);

  const result: BulkProductImageUploadResult = {
    successCount: 0,
    matchFailedCount: 0,
    uploadFailedCount: 0,
    skippedExistingImageCount: 0,
    matchFailedSamples: [],
    uploadErrors: [],
    skippedExistingSamples: [],
    duplicateNormSkuUsedFirst: [],
    storageDeleteFailures: [],
  };

  if (files.length === 0) {
    return result;
  }

  const { data: productRows, error: pe } = await supabaseServer
    .from("products")
    .select("id, sku, image_url")
    .order("id", { ascending: true });
  if (pe) throw new Error(pe.message);

  /** 정규화 SKU → 대표 상품 1건 (동일 norm 여러 행이면 id 오름차순 첫 행) */
  const byNormSku = new Map<string, { id: string; image_url: string | null }>();
  const seenNormDuplicate = new Set<string>();
  for (const row of productRows ?? []) {
    const r = row as { id: string; sku: string | null; image_url: string | null };
    const n = normalizeSkuForMatch(r.sku);
    if (!n) continue;
    if (byNormSku.has(n)) {
      if (!seenNormDuplicate.has(n)) {
        seenNormDuplicate.add(n);
        result.duplicateNormSkuUsedFirst.push(n);
      }
      continue;
    }
    byNormSku.set(n, { id: r.id, image_url: r.image_url });
  }

  const pushSample = (arr: string[], s: string, max = 30) => {
    if (arr.length < max) arr.push(s);
  };

  for (const file of files) {
    const displayName = imageFilenameBasename(file.name);
    const stem = stemFromProductImageFilename(file.name);
    const norm = normalizeSkuForMatch(stem);

    if (!stem || !norm) {
      result.matchFailedCount++;
      pushSample(result.matchFailedSamples, displayName);
      continue;
    }

    const prod = byNormSku.get(norm);
    if (!prod) {
      result.matchFailedCount++;
      pushSample(result.matchFailedSamples, displayName);
      continue;
    }

    if (onlyIfEmpty && String(prod.image_url ?? "").trim() !== "") {
      result.skippedExistingImageCount++;
      pushSample(result.skippedExistingSamples, displayName);
      continue;
    }

    const previousPublicUrl = String(prod.image_url ?? "").trim();

    try {
      const url = await uploadImageFileToProductImagesBucket(file);
      const { error: upErr } = await supabaseServer
        .from("products")
        .update({ image_url: url })
        .eq("id", prod.id);
      if (upErr) throw new Error(upErr.message);
      result.successCount++;
      prod.image_url = url;

      const rm = await removeReplacedProductImageFromStorage({
        previousPublicUrl,
        newPublicUrl: url,
      });
      if (rm.errorMessage && result.storageDeleteFailures.length < 20) {
        result.storageDeleteFailures.push({ filename: displayName, message: rm.errorMessage });
      }
    } catch (e) {
      result.uploadFailedCount++;
      result.uploadErrors.push({
        filename: displayName,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  revalidatePath("/products");
  revalidatePath("/status");
  return result;
}

/* -----------------------------
 * Stock: adjust + moves record
 * ----------------------------- */

/**
 * 상품 단위 재고 ±조정 (`products.stock`만 변경).
 * **옵션(`product_variants`)이 하나라도 있으면 호출 불가** — 재고 원장은 variant 합계이며,
 * 옵션 상품은 `adjustVariantStock`으로만 조정해야 `products.stock` 합계 캐시와 일치합니다.
 */
export async function adjustStock(productId: string, delta: number, note?: string | null) {
  if (!productId) return;
  if (!Number.isFinite(delta) || delta === 0) return;

  const { count: variantCount, error: variantCountErr } = await supabaseServer
    .from("product_variants")
    .select("id", { count: "exact", head: true })
    .eq("product_id", productId);

  if (variantCountErr) throw new Error(variantCountErr.message);
  if ((variantCount ?? 0) > 0) {
    throw new Error(
      "옵션이 있는 상품은 상품 단위 재고(±)를 사용할 수 없습니다. 옵션별 재고의 ±1을 사용해 주세요. (상품 재고는 옵션 합계와 자동으로 맞춰집니다.)"
    );
  }

  const { data: product, error: readErr } = await supabaseServer
    .from("products")
    .select("stock")
    .eq("id", productId)
    .single();

  if (readErr) throw new Error(readErr.message);

  const prev = (product?.stock ?? 0) as number;
  const next = Math.max(0, prev + delta);
  const actualDelta = next - prev;
  if (actualDelta === 0) return;

  const touchedAt = new Date().toISOString();
  const { error: upErr } = await supabaseServer
    .from("products")
    .update({ stock: next, updated_at: touchedAt, stock_updated_at: touchedAt })
    .eq("id", productId);
  if (upErr) throw new Error(upErr.message);

  if (LOG_MOVES) {
    const { error: moveErr } = await supabaseServer.from("moves").insert({
      product_id: productId,
      type: "adjust",
      qty: Math.abs(actualDelta),
      note: note?.trim() || null,
    });
    if (moveErr) throw new Error(moveErr.message);

    revalidatePath("/moves");
  }

  /** `/products`는 RSC 재검증 시 `variantsSyncDigest`·클라 state가 뒤틀리거나 리마운트될 수 있어 ±조정에서는 생략(낙관적 UI는 클라가 유지). */
  revalidatePath("/status");
  return { productId, stock: next, stockUpdatedAt: touchedAt };
}

/** `adjustStock`과 동일 — 옵션 없는 상품만 가능 (`addMove` → `adjustStock`). */
export async function addMove(productId: string, type: "in" | "out", qty: number, note?: string | null) {
  if (!productId) return;
  if (!Number.isFinite(qty) || qty <= 0) return;

  const delta = type === "in" ? qty : -qty;
  await adjustStock(productId, delta, note ?? null);
}

/* -----------------------------
 * Variants: DB 유니크 (sku, color, gender, size) — product_variants
 * ----------------------------- */

export async function adjustVariantStock(
  variantId: string,
  delta: number,
  note?: string | null
) {
  if (!variantId || !Number.isFinite(delta) || delta === 0) return;

  const { data: row, error: readErr } = await supabaseServer
    .from("product_variants")
    .select("stock, product_id")
    .eq("id", variantId)
    .single();

  if (readErr || !row) throw new Error(readErr?.message ?? "Variant not found");

  const prev = Number(row.stock) ?? 0;
  const next = Math.max(0, prev + delta);
  const actualDelta = next - prev;
  if (actualDelta === 0) return;

  const { error: upErr } = await supabaseServer
    .from("product_variants")
    .update({ stock: next })
    .eq("id", variantId);

  if (upErr) throw new Error(upErr.message);

  const productId = String((row as { product_id?: string }).product_id ?? "").trim();
  let productStock = 0;
  let productUpdatedAt: string | null = null;
  if (productId) {
    const touchedAt = new Date().toISOString();
    await syncProductsStockFromVariantSums([productId], touchedAt);
    const { data: productRow, error: productReadErr } = await supabaseServer
      .from("products")
      .select("stock, updated_at, stock_updated_at")
      .eq("id", productId)
      .maybeSingle();
    if (productReadErr) throw new Error(productReadErr.message);
    productStock = Number(productRow?.stock ?? 0);
    productUpdatedAt =
      (productRow?.stock_updated_at as string | null) ??
      (productRow?.updated_at as string | null) ??
      touchedAt;
  }

  if (LOG_MOVES) {
    if (productId) {
      await supabaseServer.from("moves").insert({
        product_id: productId,
        type: "adjust",
        qty: Math.abs(actualDelta),
        note: note?.trim() || null,
      });
    }
    revalidatePath("/moves");
  }

  revalidatePath("/status");
  return { variantId, variantStock: next, productId, productStock, productUpdatedAt };
}

export async function updateVariantMemo(
  variantId: string,
  memo?: string | null,
  memo2?: string | null
) {
  if (!variantId) return;
  const { error } = await supabaseServer
    .from("product_variants")
    .update({
      memo: memo?.trim() || null,
      memo2: memo2?.trim() || null,
    })
    .eq("id", variantId);
  if (error) throw new Error(error.message);
  revalidatePath("/products");
  revalidatePath("/status");
}

export async function updateProductMemo(
  productId: string,
  memo?: string | null,
  memo2?: string | null
) {
  if (!productId) return;
  const { error } = await supabaseServer
    .from("products")
    .update({
      memo: memo?.trim() || null,
      memo2: memo2?.trim() || null,
    })
    .eq("id", productId);
  if (error) throw new Error(error.message);
  revalidatePath("/products");
  revalidatePath("/status");
}

/* -----------------------------
 * CSV Upload: FormData `mode`
 * - "merge": (sku,color,gender,size) 기준 upsert, CSV에 없는 기존 variant 유지
 * - "reset": 전체 삭제 후 CSV로 재삽입(실패 시 스냅샷 복구)
 * ----------------------------- */

export async function uploadProductsCsv(formData: FormData) {
  const file = formData.get("file") as File | null;
  if (!file) return;

  const modeRaw = String(formData.get("mode") ?? "merge")
    .trim()
    .toLowerCase();
  const mode: "merge" | "reset" = modeRaw === "reset" ? "reset" : "merge";

  const raw = await file.arrayBuffer();

  function decodeWithFallback(buf: ArrayBuffer) {
    // 1) utf-8 시도
    let t = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  
    // utf-8이 실패하면 보통 '�' (replacement char) 가 많이 생김
    const bad = (t.match(/\uFFFD/g) ?? []).length;
  
    // 2) 깨진 느낌이면 euc-kr 재시도 (엑셀/윈도우에서 흔함)
    if (bad > 0) {
      try {
        t = new TextDecoder("euc-kr", { fatal: false }).decode(buf);
      } catch {
        // 일부 환경에서 euc-kr 미지원이면 그대로 둠
      }
    }
  
    // BOM 제거
    return t.replace(/^\uFEFF/, "");
  }
  
  const text = decodeWithFallback(raw);

  const { rows, skippedRows } = runProductCsvPipeline(text);
  if (mode === "reset") {
    await replaceAllProductsAndVariantsFromCsv(rows);
  } else {
    await mergeProductsAndVariantsFromCsv(rows);
  }
  await syncCategorySortOrderAfterCsv(buildCategoryOrderMapFromCsvRows(rows), mode);
  revalidatePath("/products");
  revalidatePath("/status");
  if (LOG_MOVES) revalidatePath("/moves");

  return {
    skippedCount: skippedRows.length,
    skippedRows,
  };
}

function chunkArray<T>(arr: T[], chunkSize: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += chunkSize) out.push(arr.slice(i, i + chunkSize));
  return out;
}

/** `products.sku`가 비었을 때: 해당 product의 variant sku 정규화 값 **다수결**로 묶기 키(클라이언트 productNormSku와 동일 규칙). */
async function modeNormVariantSkuByProductId(productIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(productIds.filter(Boolean))];
  if (unique.length === 0) return out;
  for (const chunk of chunkArray(unique, 500)) {
    const { data: rows, error } = await supabaseServer
      .from("product_variants")
      .select("id, product_id, sku")
      .in("product_id", chunk)
      .order("id", { ascending: true });
    if (error) throw new Error(error.message);
    const byPid = new Map<string, { sku: string }[]>();
    for (const r of rows ?? []) {
      const pid = String((r as { product_id: string }).product_id);
      const arr = byPid.get(pid) ?? [];
      arr.push({ sku: String((r as { sku: string | null }).sku ?? "") });
      byPid.set(pid, arr);
    }
    for (const pid of chunk) {
      const list = byPid.get(pid) ?? [];
      const { normSku } = dominantNormSkuFromVariantSkus(list);
      if (normSku) out.set(pid, normSku);
    }
  }
  return out;
}

/** products.sku 또는 variant 첫 SKU로 본 정규화 키(빈 문자열이면 그룹 없음) */
function normSkuKeyForProductRow(
  p: { id: string; sku: string },
  variantKeyByPid: Map<string, string>
): string {
  return normalizeSkuForMatch(p.sku) || variantKeyByPid.get(String(p.id)) || "";
}

/**
 * 동일 normSku의 products 행이 2건 이상 남지 않을 때까지 consolidate를 반복 호출.
 */
async function ensureSingleProductPerNormSku(maxPasses = 6): Promise<void> {
  for (let pass = 0; pass < maxPasses; pass++) {
    const { data: products, error } = await supabaseServer
      .from("products")
      .select("id, sku")
      .order("id", { ascending: true });
    if (error) throw new Error(error.message);
    const list = (products ?? []) as { id: string; sku: string }[];
    const variantKeyByPid = await modeNormVariantSkuByProductId(list.map((p) => String(p.id)));
    const byNorm = new Map<string, string[]>();
    for (const p of list) {
      const k = normSkuKeyForProductRow(p, variantKeyByPid);
      if (!k) continue;
      const arr = byNorm.get(k) ?? [];
      arr.push(String(p.id));
      byNorm.set(k, arr);
    }
    let multi = 0;
    for (const [, ids] of byNorm) {
      if (ids.length > 1) multi++;
    }
    if (multi === 0) return;
    await consolidateDuplicateProductsByNormalizedSku();
  }
  console.warn("[CSV] ensureSingleProductPerNormSku: 최대 반복 후에도 중복 normSku 그룹이 남을 수 있습니다.");
}

/**
 * normSku당 최대 1개의 product id만 맵에 넣는다. 충돌이면 consolidate 후 재시도.
 */
async function buildSkuToProductIdMapRetry(maxRetries = 5): Promise<Map<string, string>> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { data: existingRaw, error: exErr } = await supabaseServer
      .from("products")
      .select("id, sku")
      .order("id", { ascending: true });
    if (exErr) throw new Error(exErr.message);
    const sortedExisting = [...(existingRaw ?? [])] as { id: string; sku: string }[];
    sortedExisting.sort((a, b) => a.id.localeCompare(b.id));
    const variantKeyByPid = await modeNormVariantSkuByProductId(sortedExisting.map((p) => p.id));
    const map = new Map<string, string>();
    let conflict = false;
    for (const p of sortedExisting) {
      const id = String(p.id);
      const s = normSkuKeyForProductRow(p, variantKeyByPid);
      if (!s) continue;
      const prev = map.get(s);
      if (prev != null && prev !== id) {
        conflict = true;
        break;
      }
      if (!map.has(s)) map.set(s, id);
    }
    if (!conflict) return map;
    await consolidateDuplicateProductsByNormalizedSku();
  }
  throw new Error("동일 정규화 SKU를 가진 중복 products 행을 통합하지 못했습니다. Supabase products·product_variants를 확인해 주세요.");
}

/**
 * CSV merge/신규 삽입 전: DB에 이미 같은 normSku를 가진 product가 있으면 그 id 반환.
 * products.sku 일치 → variant.sku 일치(해당 product의 유효 normSku와 일치할 때만).
 */
async function findExistingProductIdForNormSku(normSku: string, depth = 0): Promise<string | null> {
  if (!normSku || depth > 6) return null;
  const { data: direct, error: dErr } = await supabaseServer
    .from("products")
    .select("id")
    .eq("sku", normSku)
    .order("id", { ascending: true })
    .limit(2);
  if (dErr) throw new Error(dErr.message);
  if (direct?.[0]?.id) {
    if (direct.length > 1) {
      await consolidateDuplicateProductsByNormalizedSku();
      return findExistingProductIdForNormSku(normSku, depth + 1);
    }
    return String(direct[0].id);
  }

  const { data: vrows, error: vErr } = await supabaseServer
    .from("product_variants")
    .select("product_id")
    .eq("sku", normSku);
  if (vErr) throw new Error(vErr.message);
  const cand = [...new Set((vrows ?? []).map((r) => String((r as { product_id: string }).product_id)))].sort(
    (a, b) => a.localeCompare(b)
  );
  if (cand.length === 0) return null;
  const vmap = await modeNormVariantSkuByProductId(cand);
  for (const pid of cand) {
    const { data: prow, error: pErr } = await supabaseServer.from("products").select("sku").eq("id", pid).maybeSingle();
    if (pErr) throw new Error(pErr.message);
    const pk =
      normalizeSkuForMatch(String((prow as { sku?: string } | null)?.sku ?? "")) || vmap.get(pid) || "";
    if (pk === normSku) return pid;
  }
  return null;
}

async function deleteByIdChunks(table: string, ids: string[], chunkSize = 500): Promise<void> {
  if (ids.length === 0) return;
  for (const chunk of chunkArray(ids, chunkSize)) {
    const { error } = await supabaseServer.from(table).delete().in("id", chunk);
    if (error) throw new Error(error.message);
  }
}

/** product_variants.stock 합계를 products.stock에 반영(총재고 캐시). */
async function syncProductsStockFromVariantSums(
  productIds: string[],
  touchedAt?: string
): Promise<void> {
  const unique = [...new Set(productIds.filter(Boolean))];
  if (unique.length === 0) return;

  const nextTouchedAt = touchedAt ?? new Date().toISOString();
  for (const idChunk of chunkArray(unique, 200)) {
    const { data: rows, error } = await supabaseServer
      .from("product_variants")
      .select("product_id, stock")
      .in("product_id", idChunk);
    if (error) throw new Error(error.message);

    const sumByProduct = new Map<string, number>();
    for (const id of idChunk) sumByProduct.set(id, 0);
    for (const r of rows ?? []) {
      const pid = String((r as { product_id: string }).product_id);
      const n = Number((r as { stock: unknown }).stock);
      const add = Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
      sumByProduct.set(pid, (sumByProduct.get(pid) ?? 0) + add);
    }

    for (const [productId, total] of sumByProduct) {
      const payload: Record<string, unknown> = { stock: total, updated_at: nextTouchedAt };
      if (touchedAt) payload.stock_updated_at = nextTouchedAt;
      const { error: upErr } = await supabaseServer
        .from("products")
        .update(payload)
        .eq("id", productId);
      if (upErr) throw new Error(upErr.message);
    }
  }
}

/**
 * 동일 정규화 SKU의 products 행이 여러 개면 variant를 한 product로 모으고 나머지 상품 행 삭제.
 * (sku,color,gender,size) 유니크 충돌 시 재고 합산·메모 채워진 쪽 우선으로 1행만 남김.
 */
async function consolidateDuplicateProductsByNormalizedSku(): Promise<void> {
  const { data: products, error } = await supabaseServer
    .from("products")
    .select("id, sku")
    .order("id", { ascending: true });
  if (error) throw new Error(error.message);

  const list = (products ?? []) as { id: string; sku: string }[];
  const variantKeyByPid = await modeNormVariantSkuByProductId(list.map((p) => String(p.id)));
  const groups = new Map<string, { id: string; sku: string }[]>();
  for (const p of list) {
    const k = normSkuKeyForProductRow(p, variantKeyByPid);
    if (!k) continue;
    const g = groups.get(k) ?? [];
    g.push({ id: String(p.id), sku: p.sku ?? "" });
    groups.set(k, g);
  }

  const keepIdsForSync = new Set<string>();

  for (const [normSku, arr] of groups) {
    if (arr.length < 2) continue;

    arr.sort((a, b) => a.id.localeCompare(b.id));
    const keepId = arr[0]!.id;
    const dropIds = arr.slice(1).map((x) => x.id);
    const canonicalSku = normSku;
    const allPids = [keepId, ...dropIds];

    const { data: vars, error: vErr } = await supabaseServer
      .from("product_variants")
      .select(
        "id, product_id, sku, color, gender, size, stock, memo, memo2, wholesale_price, msrp_price, sale_price, extra_price"
      )
      .in("product_id", allPids);
    if (vErr) throw new Error(vErr.message);

    type VRow = {
      id: string;
      product_id: string;
      sku: string;
      color: string | null;
      gender: string | null;
      size: string | null;
      stock: number | null;
      memo: string | null;
      memo2: string | null;
      wholesale_price: number | null;
      msrp_price: number | null;
      sale_price: number | null;
      extra_price: number | null;
    };

    const byUk = new Map<string, VRow[]>();
    for (const v of vars ?? []) {
      const vr = v as VRow;
      const uk = `${normalizeSkuForMatch(vr.sku)}\0${variantCompositeKey(vr.color, vr.gender, vr.size)}`;
      const bucket = byUk.get(uk) ?? [];
      bucket.push(vr);
      byUk.set(uk, bucket);
    }

    const variantIdsToDelete: string[] = [];

    for (const [, bucket] of byUk) {
      if (bucket.length === 0) continue;
      const sorted = [...bucket].sort((a, b) => {
        const ak = a.product_id === keepId ? 0 : 1;
        const bk = b.product_id === keepId ? 0 : 1;
        if (ak !== bk) return ak - bk;
        return String(a.id).localeCompare(String(b.id));
      });
      const primary = sorted[0]!;
      let totalStock = 0;
      for (const row of sorted) {
        const n = Number(row.stock);
        totalStock += Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
      }
      const pickMemo = (a: string | null, b: string | null) => {
        const ta = (a ?? "").trim();
        const tb = (b ?? "").trim();
        if (ta && tb) return ta.length >= tb.length ? ta : tb;
        return ta || tb || null;
      };
      let m1: string | null = primary.memo;
      let m2: string | null = primary.memo2;
      for (const row of sorted.slice(1)) {
        m1 = pickMemo(m1, row.memo);
        m2 = pickMemo(m2, row.memo2);
      }
      for (const row of sorted.slice(1)) {
        variantIdsToDelete.push(String(row.id));
      }
      const { error: upErr } = await supabaseServer
        .from("product_variants")
        .update({
          product_id: keepId,
          sku: canonicalSku,
          stock: totalStock,
          memo: m1,
          memo2: m2,
        })
        .eq("id", primary.id);
      if (upErr) throw new Error(upErr.message);
    }

    if (variantIdsToDelete.length > 0) {
      for (const chunk of chunkArray(variantIdsToDelete, 200)) {
        const { error: delErr } = await supabaseServer.from("product_variants").delete().in("id", chunk);
        if (delErr) throw new Error(delErr.message);
      }
    }

    const { error: pUpErr } = await supabaseServer.from("products").update({ sku: canonicalSku }).eq("id", keepId);
    if (pUpErr) throw new Error(pUpErr.message);

    for (const did of dropIds) {
      const { error: dErr } = await supabaseServer.from("products").delete().eq("id", did);
      if (dErr) throw new Error(dErr.message);
    }

    keepIdsForSync.add(keepId);
    console.warn(
      `[merge] 중복 products 통합(SKU 정규화 동일): norm=${normSku} 유지=${keepId}, 삭제 product=${dropIds.join(",")}`
    );
  }

  if (keepIdsForSync.size > 0) {
    await syncProductsStockFromVariantSums([...keepIdsForSync], new Date().toISOString());
  }
}

/** CSV merge: SKU별 상품 upsert/update, variant는 (sku,color,gender,size)로 upsert. CSV에 없는 variant는 삭제하지 않음. */
async function mergeProductsAndVariantsFromCsv(rows: ParsedCsvRow[]): Promise<void> {
  await ensureSingleProductPerNormSku();
  let skuToProductId = await buildSkuToProductIdMapRetry();

  const skuOrder: string[] = [];
  const bySku = new Map<string, ParsedCsvRow[]>();
  for (const r of rows) {
    if (!bySku.has(r.sku)) {
      skuOrder.push(r.sku);
      bySku.set(r.sku, []);
    }
    bySku.get(r.sku)!.push(r);
  }

  const allVariantRows: Record<string, unknown>[] = [];
  const productIdsTouched = new Set<string>();

  for (const sku of skuOrder) {
    const normSku = normalizeSkuForMatch(sku);
    const group = bySku.get(sku)!;
    const row0 = group[0];

    const payloadBase = {
      sku: normSku,
      category: row0.category || null,
      name: row0.name,
      image_url: resolveProductImageUrl(normSku, row0.imageUrl || null),
      wholesale_price: null as number | null,
      msrp_price: null as number | null,
      sale_price: null as number | null,
      extra_price: null as number | null,
      stock: 0,
      memo: null as string | null,
      memo2: null as string | null,
    };

    let productId = skuToProductId.get(normSku) ?? null;
    if (!productId) {
      productId = await findExistingProductIdForNormSku(normSku);
      if (productId) skuToProductId.set(normSku, productId);
    }
    if (!productId) {
      const { data: inserted, error: insErr } = await supabaseServer
        .from("products")
        .insert(payloadBase as Record<string, unknown>)
        .select("id")
        .single();
      if (insErr) throw new Error(insErr.message);
      productId = inserted.id as string;
      skuToProductId.set(normSku, productId);
    } else {
      const nextImageUrl = resolveProductImageUrl(normSku, row0.imageUrl || null);
      const { error: upErr } = await supabaseServer
        .from("products")
        .update({
          sku: normSku,
          category: row0.category || null,
          name: row0.name,
          ...(hasExplicitImageUrl(row0.imageUrl) ? { image_url: nextImageUrl } : {}),
        })
        .eq("id", productId);
      if (upErr) throw new Error(upErr.message);
    }

    productIdsTouched.add(productId);

    const dedupedGroup = aggregateDuplicateVariantsByCompositeKey(
      group.map((r) => ({
        color: r.color,
        gender: r.gender,
        size: r.size,
        stock: r.stock,
        wholesalePrice: r.wholesale,
        msrpPrice: r.msrp,
        salePrice: r.sale,
        extraPrice: r.extra,
        memo: r.memo,
        memo2: r.memo2,
      }))
    );

    for (const v of dedupedGroup) {
      allVariantRows.push({
        product_id: productId,
        sku: normSku,
        color: String(v.color ?? "").trim(),
        gender: String(v.gender ?? "").trim(),
        size: String(v.size ?? "").trim(),
        stock: Number.isFinite(Number(v.stock)) ? Math.max(0, Number(v.stock)) : 0,
        memo: v.memo,
        memo2: v.memo2,
        wholesale_price:
          v.wholesalePrice != null && Number.isFinite(v.wholesalePrice) ? Math.round(v.wholesalePrice) : 0,
        msrp_price: v.msrpPrice != null && Number.isFinite(v.msrpPrice) ? Math.round(v.msrpPrice) : 0,
        sale_price: v.salePrice != null && Number.isFinite(v.salePrice) ? Math.round(v.salePrice) : 0,
        extra_price: v.extraPrice != null && Number.isFinite(v.extraPrice) ? Math.round(v.extraPrice) : 0,
      });
    }

    if (LOG_CSV_STOCK) {
      const aggregatedStockByKey = new Map<string, number>();
      for (const v of dedupedGroup) {
        aggregatedStockByKey.set(
          variantCompositeKey(v.color, v.gender, v.size),
          Number.isFinite(Number(v.stock)) ? Math.max(0, Number(v.stock)) : 0
        );
      }
      for (const r of group) {
        const key = variantCompositeKey(r.color, r.gender, r.size);
        console.info(
          "[CSV-STOCK-DEBUG][merge]",
          JSON.stringify({
            sku: r.sku,
            stock: r.stock,
            aggregatedStockForVariantKey: aggregatedStockByKey.get(key) ?? null,
            dataRowIndex: r.dataRowIndex,
          })
        );
      }
    }
  }

  for (const chunk of chunkArray(allVariantRows, 200)) {
    const { error: vUpsertErr } = await supabaseServer
      .from("product_variants")
      .upsert(chunk as any, { onConflict: PRODUCT_VARIANTS_ON_CONFLICT });
    if (vUpsertErr) throw new Error(vUpsertErr.message);
  }

  await syncProductsStockFromVariantSums([...productIdsTouched], new Date().toISOString());
  await ensureSingleProductPerNormSku();
}

async function restoreProductsAndVariantsSnapshot(snapshot: {
  products: Array<Record<string, unknown>>;
  variants: Array<Record<string, unknown>>;
}): Promise<void> {
  const oldProducts = snapshot.products ?? [];
  const oldVariants = snapshot.variants ?? [];

  const oldProductIds = oldProducts.map((p) => String((p as any).id));
  const oldVariantIds = oldVariants.map((v) => String((v as any).id));

  // 현재 데이터 제거(부분 insert가 있었을 가능성 대비)
  const { data: curProducts, error: curPErr } = await supabaseServer.from("products").select("id");
  if (curPErr) throw new Error(curPErr.message);
  const curProductIds = (curProducts ?? []).map((p: any) => String(p.id));

  const { data: curVariants, error: curVErr } = await supabaseServer.from("product_variants").select("id");
  if (curVErr) throw new Error(curVErr.message);
  const curVariantIds = (curVariants ?? []).map((v: any) => String(v.id));

  await deleteByIdChunks("product_variants", curVariantIds);
  await deleteByIdChunks("products", curProductIds);

  // 복구
  for (const chunk of chunkArray(oldProducts, 200)) {
    const { error } = await supabaseServer.from("products").insert(chunk);
    if (error) throw new Error(error.message);
  }
  for (const chunk of chunkArray(oldVariants, 200)) {
    const { error } = await supabaseServer.from("product_variants").insert(chunk);
    if (error) throw new Error(error.message);
  }

  // 타입/사용 목적상 반환값 없이 종료
  void oldProductIds;
  void oldVariantIds;
}

async function replaceAllProductsAndVariantsFromCsv(rows: ParsedCsvRow[]): Promise<void> {
  const { data: oldProductsRaw, error: oldProductsErr } = await supabaseServer.from("products").select("*");
  if (oldProductsErr) throw new Error(oldProductsErr.message);
  const oldProducts = (oldProductsRaw ?? []) as Array<Record<string, unknown>>;

  const { data: oldVariantsRaw, error: oldVariantsErr } = await supabaseServer.from("product_variants").select("*");
  if (oldVariantsErr) throw new Error(oldVariantsErr.message);
  const oldVariants = (oldVariantsRaw ?? []) as Array<Record<string, unknown>>;

  const snapshot = { products: oldProducts, variants: oldVariants };

  try {
    const oldVariantIds = oldVariants.map((v) => String((v as { id: string }).id));
    const oldProductIds = oldProducts.map((p) => String((p as { id: string }).id));
    await deleteByIdChunks("product_variants", oldVariantIds);
    await deleteByIdChunks("products", oldProductIds);

    const skuOrder: string[] = [];
    const bySku = new Map<string, ParsedCsvRow[]>();
    for (const r of rows) {
      if (!bySku.has(r.sku)) {
        skuOrder.push(r.sku);
        bySku.set(r.sku, []);
      }
      bySku.get(r.sku)!.push(r);
    }

    const resetProductIds: string[] = [];

    for (const sku of skuOrder) {
      const normSku = normalizeSkuForMatch(sku);
      const group = bySku.get(sku)!;
      const row0 = group[0];

      const payloadBase = {
        sku: normSku,
        category: row0.category || null,
        name: row0.name,
        image_url: resolveProductImageUrl(normSku, row0.imageUrl || null),
        wholesale_price: null as number | null,
        msrp_price: null as number | null,
        sale_price: null as number | null,
        extra_price: null as number | null,
        stock: 0,
        memo: null as string | null,
        memo2: null as string | null,
      };

      const { data: inserted, error: insErr } = await supabaseServer
        .from("products")
        .insert(payloadBase as Record<string, unknown>)
        .select("id")
        .single();
      if (insErr) throw new Error(insErr.message);
      const productId = inserted.id as string;
      resetProductIds.push(productId);

      const dedupedGroup = aggregateDuplicateVariantsByCompositeKey(
        group.map((r) => ({
          color: r.color,
          gender: r.gender,
          size: r.size,
          stock: r.stock,
          wholesalePrice: r.wholesale,
          msrpPrice: r.msrp,
          salePrice: r.sale,
          extraPrice: r.extra,
          memo: r.memo,
          memo2: r.memo2,
        }))
      );

      const variantsToInsert = dedupedGroup.map((v) => ({
        product_id: productId,
        sku: normSku,
        color: String(v.color ?? "").trim(),
        gender: String(v.gender ?? "").trim(),
        size: String(v.size ?? "").trim(),
        stock: Number.isFinite(Number(v.stock)) ? Math.max(0, Number(v.stock)) : 0,
        memo: v.memo,
        memo2: v.memo2,
        wholesale_price:
          v.wholesalePrice != null && Number.isFinite(v.wholesalePrice) ? Math.round(v.wholesalePrice) : 0,
        msrp_price: v.msrpPrice != null && Number.isFinite(v.msrpPrice) ? Math.round(v.msrpPrice) : 0,
        sale_price: v.salePrice != null && Number.isFinite(v.salePrice) ? Math.round(v.salePrice) : 0,
        extra_price: v.extraPrice != null && Number.isFinite(v.extraPrice) ? Math.round(v.extraPrice) : 0,
      }));

      const aggregatedStockByKey = new Map<string, number>();
      for (const v of dedupedGroup) {
        aggregatedStockByKey.set(
          variantCompositeKey(v.color, v.gender, v.size),
          Number.isFinite(Number(v.stock)) ? Math.max(0, Number(v.stock)) : 0
        );
      }

      if (variantsToInsert.length > 0) {
        const { error: vInsErr } = await supabaseServer.from("product_variants").insert(variantsToInsert as any);
        if (vInsErr) throw new Error(vInsErr.message);
      }

      if (LOG_CSV_STOCK) {
        for (const r of group) {
          const key = variantCompositeKey(r.color, r.gender, r.size);
          console.info(
            "[CSV-STOCK-DEBUG]",
            JSON.stringify({
              sku: r.sku,
              stock: r.stock,
              aggregatedStockForVariantKey: aggregatedStockByKey.get(key) ?? null,
              dataRowIndex: r.dataRowIndex,
            })
          );
        }
      }
    }

    await syncProductsStockFromVariantSums(resetProductIds, new Date().toISOString());
    await ensureSingleProductPerNormSku();
    const reconnect = await reconnectProductsImageUrlsFromStorageBySku({ onlyIfImageUrlEmpty: true });
    console.info("[CSV reset][image reconnect][summary]", {
      totalProducts: reconnect.productsChecked,
      reconnectSuccessCount: reconnect.updatedCount,
      failedCount: reconnect.failedCount,
    });
    if (reconnect.failedCount > 0) {
      console.warn("[CSV reset] SKU 기준 Storage 이미지 재연결 일부 실패", reconnect);
      console.warn(
        "[CSV reset][image reconnect][failed sku list]",
        reconnect.failedSamples.map((f) => f.sku)
      );
      for (const f of reconnect.failedSamples) {
        console.warn("[CSV reset][image reconnect][failed sku]", {
          sku: f.sku,
          productId: f.productId,
          message: f.message,
        });
      }
    }
  } catch (err) {
    await restoreProductsAndVariantsSnapshot(snapshot);
    throw err;
  }
}
/* -----------------------------
 * Stock: move between locations (stub/implementation)
 * ----------------------------- */
/*
// 재고 이동(로케이션 이동) — 지금은 기능 연결용으로 최소 구현
export async function moveStock(input: {
  productId: string;
  fromLocationId?: string | null;
  toLocationId?: string | null;
  qty: number;
  note?: string | null;
}) {
  // ✅ 지금 DB에 location/balance 테이블이 없거나 아직 구현 전이면,
  // 일단 빌드 통과 + UI 동작 방지용으로 에러를 던져도 되고,
  // 최소로는 adjustStock/addMove로 대체할 수도 있어.

  // 임시: 단순 조정으로 처리(“이동”을 로그로 남기고 싶다면 moves.type="move" 같은 걸로 확장)
  // 여기선 일단 안전하게 아무것도 안 하고 리턴만.
  // 필요하면 나중에 supabase RPC로 from->to 차감/증가 트랜잭션 구현하자.
  return { ok: true };
}*/
