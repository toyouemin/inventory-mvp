"use server";

import { supabaseServer } from "@/lib/supabaseClient";
import { revalidatePath } from "next/cache";
import { runProductCsvPipeline, type ParsedCsvRow } from "./csvProductPipeline";
import {
  aggregateDuplicateVariantsByCompositeKey,
  PRODUCT_VARIANTS_ON_CONFLICT,
  variantCompositeKey,
} from "./variantOptions";
import { ensureCategorySortOrderRow, syncCategorySortOrderAfterCsv } from "./categorySortOrder.server";

const LOG_MOVES = process.env.LOG_MOVES === "1";
/** CSV 업로드 행별 재고 디버그: .env에 LOG_CSV_STOCK=1 */
const LOG_CSV_STOCK = process.env.LOG_CSV_STOCK === "1";

function resolveProductImageUrl(sku: string, imageUrl: string | null | undefined): string | null {
  const explicit = (imageUrl ?? "").trim();
  if (explicit) return explicit;
  return null;
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
  const sku = (data.sku ?? "").trim();
  if (!sku) return;

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
  if (data.sku !== undefined) updateData.sku = data.sku.trim();
  if (data.category !== undefined) updateData.category = data.category?.trim() || null;
  if (data.name !== undefined) updateData.name = data.name?.trim();
  if (data.imageUrl !== undefined) {
    let skuForImg = data.sku?.trim() ?? "";
    if (!skuForImg) {
      const { data: row } = await supabaseServer.from("products").select("sku").eq("id", productId).maybeSingle();
      skuForImg = (row?.sku as string | undefined)?.trim() ?? "";
    }
    updateData.image_url = resolveProductImageUrl(skuForImg, data.imageUrl);
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

  const { error } = await supabaseServer.from("products").update(updateData).eq("id", productId);
  if (error) throw new Error(error.message);

  if (data.category !== undefined) {
    await ensureCategorySortOrderRow(data.category?.trim() || null);
  }

  const { data: prodRow } = await supabaseServer.from("products").select("sku").eq("id", productId).maybeSingle();
  const productSku = String((prodRow?.sku as string | undefined) ?? "").trim();

  if (data.variants) {
    const { updates, deleteIds } = data.variants;
    for (const id of deleteIds) {
      if (id) {
        await supabaseServer.from("product_variants").delete().eq("id", id);
      }
    }
    const withId = updates.filter((u) => u.id);
    const withoutId = updates.filter((u) => !u.id);

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
    }
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

/** Upload image to Supabase Storage bucket product-images; returns public URL. */
export async function uploadProductImage(formData: FormData): Promise<{ url: string }> {
  const file = formData.get("file") as File | null;
  if (!file || !(file instanceof File)) throw new Error("파일이 없습니다.");

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
    upsert: true,
  });

  if (error) throw new Error(error.message);

  const { data: urlData } = supabaseServer.storage.from("product-images").getPublicUrl(path);
  return { url: urlData.publicUrl };
}

/* -----------------------------
 * Stock: adjust + moves record
 * ----------------------------- */

// 재고 조정 (delta만큼 stock 변경 + moves 기록)
export async function adjustStock(productId: string, delta: number, note?: string | null) {
  if (!productId) return;
  if (!Number.isFinite(delta) || delta === 0) return;

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

  const { error: upErr } = await supabaseServer.from("products").update({ stock: next }).eq("id", productId);
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

  revalidatePath("/products");
  revalidatePath("/status");
}

// 입고/출고 기록 (필요하면 UI에서 이걸 쓰게 만들 수 있음)
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
    .select("stock")
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

  if (LOG_MOVES) {
    const { data: v } = await supabaseServer.from("product_variants").select("product_id").eq("id", variantId).single();
    if (v?.product_id) {
      await supabaseServer.from("moves").insert({
        product_id: v.product_id,
        type: "adjust",
        qty: Math.abs(actualDelta),
        note: note?.trim() || null,
      });
    }
    revalidatePath("/moves");
  }

  revalidatePath("/products");
  revalidatePath("/status");
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
  await syncCategorySortOrderAfterCsv(rows, mode);
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

async function deleteByIdChunks(table: string, ids: string[], chunkSize = 500): Promise<void> {
  if (ids.length === 0) return;
  for (const chunk of chunkArray(ids, chunkSize)) {
    const { error } = await supabaseServer.from(table).delete().in("id", chunk);
    if (error) throw new Error(error.message);
  }
}

/** CSV merge: SKU별 상품 upsert/update, variant는 (sku,color,gender,size)로 upsert. CSV에 없는 variant는 삭제하지 않음. */
async function mergeProductsAndVariantsFromCsv(rows: ParsedCsvRow[]): Promise<void> {
  const { data: existingRaw, error: exErr } = await supabaseServer.from("products").select("id, sku");
  if (exErr) throw new Error(exErr.message);

  const skuToProductId = new Map<string, string>();
  for (const p of existingRaw ?? []) {
    const s = String((p as { sku: string }).sku ?? "").trim();
    if (s) skuToProductId.set(s, String((p as { id: string }).id));
  }

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

  for (const sku of skuOrder) {
    const group = bySku.get(sku)!;
    const row0 = group[0];

    const payloadBase = {
      sku,
      category: row0.category || null,
      name: row0.name,
      image_url: resolveProductImageUrl(sku, row0.imageUrl || null),
      wholesale_price: null as number | null,
      msrp_price: null as number | null,
      sale_price: null as number | null,
      extra_price: null as number | null,
      stock: 0,
      memo: null as string | null,
      memo2: null as string | null,
    };

    let productId = skuToProductId.get(sku);
    if (!productId) {
      const { data: inserted, error: insErr } = await supabaseServer
        .from("products")
        .insert(payloadBase as Record<string, unknown>)
        .select("id")
        .single();
      if (insErr) throw new Error(insErr.message);
      productId = inserted.id as string;
      skuToProductId.set(sku, productId);
    } else {
      const { error: upErr } = await supabaseServer
        .from("products")
        .update({
          category: row0.category || null,
          name: row0.name,
          image_url: resolveProductImageUrl(sku, row0.imageUrl || null),
        })
        .eq("id", productId);
      if (upErr) throw new Error(upErr.message);
    }

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
        sku,
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

    for (const sku of skuOrder) {
      const group = bySku.get(sku)!;
      const row0 = group[0];

      const payloadBase = {
        sku,
        category: row0.category || null,
        name: row0.name,
        image_url: resolveProductImageUrl(sku, row0.imageUrl || null),
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
        sku,
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
