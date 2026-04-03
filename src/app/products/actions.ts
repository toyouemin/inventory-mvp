"use server";

import { supabaseServer } from "@/lib/supabaseClient";
import { revalidatePath } from "next/cache";
import { csvGroupUsesVariantStock, runProductCsvPipeline, type ParsedCsvRow } from "./csvProductPipeline";
import { decomposeVariantSize, variantCompositeKey } from "./variantOptions";

const LOG_MOVES = process.env.LOG_MOVES === "1";
/** CSV 업로드 행별 재고 디버그: .env에 LOG_CSV_STOCK=1 */
const LOG_CSV_STOCK = process.env.LOG_CSV_STOCK === "1";

function resolveProductImageUrl(sku: string, imageUrl: string | null | undefined): string | null {
  const explicit = (imageUrl ?? "").trim();
  if (explicit) return explicit;
  return null;
}

async function zeroAllVariantStocks(productId: string): Promise<void> {
  const { error } = await supabaseServer.from("product_variants").update({ stock: 0 }).eq("product_id", productId);
  if (error) throw new Error(error.message);
}

/** CSV에 없는 기존 size(variant 행)는 재고 0으로 동기화 (행 삭제 없음). */
async function zeroVariantStockNotInSizes(productId: string, sizesInCsv: Set<string>): Promise<void> {
  const { data: variants, error } = await supabaseServer
    .from("product_variants")
    .select("id, option1, option2, size")
    .eq("product_id", productId);
  if (error) throw new Error(error.message);
  for (const v of variants ?? []) {
    const row = v as { id: string; option1?: string | null; option2?: string | null; size?: string | null };
    const key = variantCompositeKey(row.option1, row.option2, row.size);
    if (!sizesInCsv.has(key)) {
      const { error: uErr } = await supabaseServer.from("product_variants").update({ stock: 0 }).eq("id", row.id);
      if (uErr) throw new Error(uErr.message);
    }
  }
}

async function deleteProductsNotInCsv(csvSkus: Set<string>): Promise<void> {
  const { data: all } = await supabaseServer.from("products").select("id, sku");
  if (!all) return;
  for (const p of all) {
    if (!csvSkus.has((p as { sku: string }).sku)) {
      await supabaseServer.from("products").delete().eq("id", (p as { id: string }).id);
    }
  }
}

/**
 * SKU별로 그룹 적용. variant 모드: products.stock=0, CSV에 없는 기존 size는 variant 재고 0.
 * 단일 재고 모드: products.stock 반영, 해당 상품의 모든 variant 재고 0.
 */
async function applyCsvProductRowsGrouped(rows: ParsedCsvRow[]): Promise<Set<string>> {
  const skuOrder: string[] = [];
  const bySku = new Map<string, ParsedCsvRow[]>();
  for (const r of rows) {
    if (!bySku.has(r.sku)) {
      skuOrder.push(r.sku);
      bySku.set(r.sku, []);
    }
    bySku.get(r.sku)!.push(r);
  }

  const csvSkus = new Set<string>();
  for (const sku of skuOrder) {
    const group = bySku.get(sku)!;
    csvSkus.add(sku);
    const row0 = group[0];
    const variantMode = csvGroupUsesVariantStock(group);

    const payload = {
      category: row0.category,
      name_spec: row0.nameSpec?.trim() || sku,
      image_url: resolveProductImageUrl(sku, row0.imageUrl),
      wholesale_price: row0.wholesale,
      msrp_price: row0.msrp,
      sale_price: row0.sale,
      extra_price: row0.extra,
    };

    const stockVal = variantMode ? 0 : row0.stockVal;
    let productId: string;
    const { data: existing } = await supabaseServer.from("products").select("id").eq("sku", sku).maybeSingle();
    if (existing?.id) {
      productId = existing.id;
      const { error: upErr } = await supabaseServer
        .from("products")
        .update({ ...payload, stock: stockVal })
        .eq("id", productId);
      if (upErr) throw new Error(upErr.message);
    } else {
      const { data: inserted, error: insErr } = await supabaseServer
        .from("products")
        .insert({ sku, ...payload, stock: stockVal })
        .select("id")
        .single();
      if (insErr) throw new Error(insErr.message);
      productId = inserted.id;
    }

    if (variantMode) {
      const sizesInCsv = new Set<string>();
      const mergedBySize = new Map<
        string,
        {
          option1: string;
          option2: string;
          sizePure: string;
          stockVal: number;
          memo: string | null;
          memo2: string | null;
        }
      >();
      for (const r of group) {
        const key = variantCompositeKey(r.variantOption1, r.variantOption2, r.variantSizePure);
        const prev = mergedBySize.get(key);
        if (!prev) {
          mergedBySize.set(key, {
            option1: r.variantOption1 ?? "",
            option2: r.variantOption2 ?? "",
            sizePure: r.variantSizePure ?? "",
            stockVal: r.stockVal,
            memo: r.memo ?? null,
            memo2: r.memo2 ?? null,
          });
        } else {
          mergedBySize.set(key, {
            option1: prev.option1,
            option2: prev.option2,
            sizePure: prev.sizePure,
            stockVal: prev.stockVal + r.stockVal,
            memo: prev.memo ?? r.memo ?? null,
            memo2: prev.memo2 ?? r.memo2 ?? null,
          });
        }
      }

      for (const r of mergedBySize.values()) {
        sizesInCsv.add(variantCompositeKey(r.option1, r.option2, r.sizePure));
        const { error: upsertErr } = await supabaseServer.from("product_variants").upsert(
          {
            product_id: productId,
            option1: r.option1,
            option2: r.option2,
            size: r.sizePure,
            stock: r.stockVal,
            memo: r.memo,
            memo2: r.memo2,
          },
          { onConflict: "product_id,option1,option2,size" }
        );
        if (upsertErr) throw new Error(upsertErr.message);
      }
      await zeroVariantStockNotInSizes(productId, sizesInCsv);
    } else {
      await zeroAllVariantStocks(productId);
    }
  }
  return csvSkus;
}

/* -----------------------------
 * Products: create / update
 * ----------------------------- */

// 상품 추가 (variants 있으면 product_variants 삽입, 없으면 products.stock 사용)
export async function createProduct(data: {
  sku: string;
  category?: string | null;
  nameSpec: string;
  imageUrl?: string | null;
  wholesalePrice?: number | null;
  msrpPrice?: number | null;
  salePrice?: number | null;
  extraPrice?: number | null;
  memo?: string | null;
  memo2?: string | null;
  variants?: {
    size: string;
    stock: number;
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
    name_spec: (data.nameSpec ?? "").trim(),
    image_url: resolveProductImageUrl(sku, data.imageUrl),
    wholesale_price:
      data.wholesalePrice != null && Number.isFinite(data.wholesalePrice) ? data.wholesalePrice : null,
    msrp_price: data.msrpPrice != null && Number.isFinite(data.msrpPrice) ? data.msrpPrice : null,
    sale_price: data.salePrice != null && Number.isFinite(data.salePrice) ? data.salePrice : null,
    extra_price: data.extraPrice != null && Number.isFinite(data.extraPrice) ? data.extraPrice : null,
    stock: 0,
  }).select("id").single();

  if (error) throw new Error(error.message);
  const productId = inserted.id;

  if (hasVariants && data.variants) {
    for (const v of data.variants) {
      const combined = (v.size ?? "").trim();
      const d = decomposeVariantSize(combined);
      const stock = Number.isFinite(Number(v.stock)) ? Math.max(0, Number(v.stock)) : 0;
      const { error: vErr } = await supabaseServer.from("product_variants").insert({
        product_id: productId,
        option1: d.option1,
        option2: d.option2,
        size: d.size,
        stock,
        memo: v.memo?.trim() || null,
        memo2: v.memo2?.trim() || null,
      });
      if (vErr) throw new Error(vErr.message);
    }
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
    nameSpec?: string;
    imageUrl?: string | null;

    wholesalePrice?: number | null;
    msrpPrice?: number | null;
    salePrice?: number | null;
    extraPrice?: number | null;

    memo?: string | null;
    memo2?: string | null;
    variants?: {
      updates: Array<{
        id?: string;
        size: string;
        stock: number;
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
  if (data.nameSpec !== undefined) updateData.name_spec = data.nameSpec?.trim();
  if (data.imageUrl !== undefined) {
    let skuForImg = data.sku?.trim() ?? "";
    if (!skuForImg) {
      const { data: row } = await supabaseServer.from("products").select("sku").eq("id", productId).maybeSingle();
      skuForImg = (row?.sku as string | undefined)?.trim() ?? "";
    }
    updateData.image_url = resolveProductImageUrl(skuForImg, data.imageUrl);
  }

  if (data.wholesalePrice !== undefined) {
    updateData.wholesale_price =
      data.wholesalePrice != null && Number.isFinite(data.wholesalePrice) ? data.wholesalePrice : null;
  }
  if (data.msrpPrice !== undefined) {
    updateData.msrp_price = data.msrpPrice != null && Number.isFinite(data.msrpPrice) ? data.msrpPrice : null;
  }
  if (data.salePrice !== undefined) {
    updateData.sale_price = data.salePrice != null && Number.isFinite(data.salePrice) ? data.salePrice : null;
  }
  if (data.extraPrice !== undefined) {
    updateData.extra_price = data.extraPrice != null && Number.isFinite(data.extraPrice) ? data.extraPrice : null;
  }
  if (data.memo !== undefined) {
    updateData.memo = data.memo?.trim() || null;
  }
  if (data.memo2 !== undefined) {
    updateData.memo2 = data.memo2?.trim() || null;
  }

  if (data.stock !== undefined)
    updateData.stock = Number.isFinite(Number(data.stock)) ? Math.max(0, Number(data.stock)) : 0;
  if (data.variants && data.variants.updates.length > 0)
    updateData.stock = 0;

  const { error } = await supabaseServer.from("products").update(updateData).eq("id", productId);
  if (error) throw new Error(error.message);

  if (data.variants) {
    const { updates, deleteIds } = data.variants;
    for (const id of deleteIds) {
      if (id) {
        await supabaseServer.from("product_variants").delete().eq("id", id);
      }
    }
    for (const u of updates) {
      const combined = (u.size ?? "").trim();
      const d = decomposeVariantSize(combined);
      const stock = Number.isFinite(Number(u.stock)) ? Math.max(0, Number(u.stock)) : 0;
      if (u.id) {
        await supabaseServer
          .from("product_variants")
          .update({
            option1: d.option1,
            option2: d.option2,
            size: d.size,
            stock,
            memo: u.memo?.trim() || null,
            memo2: u.memo2?.trim() || null,
          })
          .eq("id", u.id);
      } else {
        await supabaseServer.from("product_variants").insert({
          product_id: productId,
          option1: d.option1,
          option2: d.option2,
          size: d.size,
          stock,
          memo: u.memo?.trim() || null,
          memo2: u.memo2?.trim() || null,
        });
      }
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
 * Size-based variants (product_variants table)
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
 * CSV Upload: 고정 10컬럼 + SKU 그룹 variant 동기화(stock 0)
 * ----------------------------- */

// 상품 CSV 업로드: DB 상태를 CSV 내용으로 완전 덮어쓰기.
// 정책:
// - 업로드 시작 시점에 기존 `product_variants`, `products`를 전부 삭제
// - 실패하면 업로드 전 스냅샷을 기반으로 이전 상태를 복구(중간 상태 방지)
export async function uploadProductsCsv(formData: FormData) {
  const file = formData.get("file") as File | null;
  if (!file) return;

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
  await replaceAllProductsAndVariantsFromCsv(rows);
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
  // 업로드 실패 시 복구를 위해 업로드 전 스냅샷을 확보
  const { data: oldProductsRaw, error: oldProductsErr } = await supabaseServer
    .from("products")
    .select("id, sku, category, name_spec, image_url, wholesale_price, msrp_price, sale_price, extra_price, memo, memo2, stock");
  if (oldProductsErr) throw new Error(oldProductsErr.message);
  const oldProducts = (oldProductsRaw ?? []) as Array<Record<string, unknown>>;

  const { data: oldVariantsRaw, error: oldVariantsErr } = await supabaseServer
    .from("product_variants")
    .select("id, product_id, option1, option2, size, stock, memo, memo2");
  if (oldVariantsErr) throw new Error(oldVariantsErr.message);
  const oldVariants = (oldVariantsRaw ?? []) as Array<Record<string, unknown>>;

  const snapshot = { products: oldProducts, variants: oldVariants };

  try {
    // 1) 기존 전부 삭제
    const oldVariantIds = oldVariants.map((v) => String((v as any).id));
    const oldProductIds = oldProducts.map((p) => String((p as any).id));
    await deleteByIdChunks("product_variants", oldVariantIds);
    await deleteByIdChunks("products", oldProductIds);

    // 2) CSV로 새로 insert
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
      const variantMode = csvGroupUsesVariantStock(group);

      const payloadBase = {
        sku,
        category: row0.category,
        name_spec: (row0.nameSpec ?? sku).trim(),
        image_url: resolveProductImageUrl(sku, row0.imageUrl),
        wholesale_price: row0.wholesale,
        msrp_price: row0.msrp,
        sale_price: row0.sale,
        extra_price: row0.extra,
        stock: variantMode ? 0 : row0.stockVal,
        // variant mode에서는 memo/memo2를 variant에 넣는 정책이므로 product memo/memo2는 null로 유지
        memo: variantMode ? null : row0.memo,
        memo2: variantMode ? null : row0.memo2,
      };

      const { data: inserted, error: insErr } = await supabaseServer
        .from("products")
        .insert(payloadBase as any)
        .select("id")
        .single();
      if (insErr) throw new Error(insErr.message);
      const productId = inserted.id as string;

      let mergedBySize: Map<
        string,
        {
          option1: string;
          option2: string;
          sizePure: string;
          stockVal: number;
          memo: string | null;
          memo2: string | null;
        }
      > | null = null;

      if (variantMode) {
        mergedBySize = new Map<
          string,
          {
            option1: string;
            option2: string;
            sizePure: string;
            stockVal: number;
            memo: string | null;
            memo2: string | null;
          }
        >();

        for (const r of group) {
          const key = variantCompositeKey(r.variantOption1, r.variantOption2, r.variantSizePure);
          const prev = mergedBySize.get(key);
          if (!prev) {
            mergedBySize.set(key, {
              option1: r.variantOption1 ?? "",
              option2: r.variantOption2 ?? "",
              sizePure: r.variantSizePure ?? "",
              stockVal: r.stockVal,
              memo: r.memo,
              memo2: r.memo2,
            });
          } else {
            mergedBySize.set(key, {
              option1: prev.option1,
              option2: prev.option2,
              sizePure: prev.sizePure,
              stockVal: prev.stockVal + r.stockVal,
              memo: prev.memo ?? r.memo,
              memo2: prev.memo2 ?? r.memo2,
            });
          }
        }

        const variantsToInsert = [...mergedBySize.values()].map((v) => ({
          product_id: productId,
          option1: v.option1,
          option2: v.option2,
          size: v.sizePure,
          stock: v.stockVal,
          memo: v.memo,
          memo2: v.memo2,
        }));

        if (variantsToInsert.length > 0) {
          const { error: vInsErr } = await supabaseServer.from("product_variants").insert(variantsToInsert as any);
          if (vInsErr) throw new Error(vInsErr.message);
        }
      }

      if (LOG_CSV_STOCK) {
        const savedProductStock = variantMode ? 0 : row0.stockVal;
        const savedSku = sku;
        for (const r of group) {
          const key = variantCompositeKey(r.variantOption1, r.variantOption2, r.variantSizePure);
          const merged = mergedBySize?.get(key);
          console.info(
            "[CSV-STOCK-DEBUG]",
            JSON.stringify({
              rawSkuFromCsv: r.rawSkuFromCsv,
              savedSku,
              rawStockFromCsv: r.rawStockFromCsv,
              parsedStockVal: r.stockVal,
              savedProductStock,
              savedVariantStock: variantMode ? merged?.stockVal ?? null : null,
              variantMode,
              dataRowIndex: r.dataRowIndex,
            })
          );
        }
      }
    }
  } catch (err) {
    // 3) 복구: 기존 스냅샷으로 되돌리기
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
