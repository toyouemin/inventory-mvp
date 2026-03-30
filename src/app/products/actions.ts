"use server";

import { supabaseServer } from "@/lib/supabaseClient";
import { revalidatePath } from "next/cache";

const LOG_MOVES = process.env.LOG_MOVES === "1";

/**
 * imageUrl이 비어 있을 때만 SKU 기반 경로로 보완.
 * - 우선순위: 명시 URL(trim 후) > 환경변수 기반 URL > `/images/{sku}.jpg`
 * - 스토리지 절대 URL: PRODUCT_IMAGE_SKU_BASE_URL 예) https://xxx.supabase.co/storage/v1/object/public/bucket/products
 */
function resolveProductImageUrl(sku: string, imageUrl: string | null | undefined): string | null {
  const explicit = (imageUrl ?? "").trim();
  if (explicit) return explicit;
  const s = (sku ?? "").trim();
  if (!s) return null;
  const base = (process.env.PRODUCT_IMAGE_SKU_BASE_URL ?? "").trim().replace(/\/$/, "");
  if (base) {
    return `${base}/${encodeURIComponent(s)}.jpg`;
  }
  return `/images/${encodeURIComponent(s)}.jpg`;
}

/* -----------------------------
 * Helpers: CSV delimiter detect + robust parsing
 * ----------------------------- */
function detectDelimiter(line: string) {
  const comma = (line.match(/,/g) ?? []).length;
  const tab = (line.match(/\t/g) ?? []).length;
  const semi = (line.match(/;/g) ?? []).length;

  if (tab >= comma && tab >= semi) return "\t";
  if (semi >= comma && semi >= tab) return ";";
  return ",";
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];

    if (c === '"') {
      // CSV rule: "" -> "
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (c === delimiter && !inQuotes) {
      result.push(current.trim());
      current = "";
      continue;
    }

    current += c;
  }

  result.push(current.trim());
  return result;
}

function toIntOrNaN(v: string | undefined) {
  if (v == null) return NaN;
  const s = String(v).trim();
  if (!s) return NaN;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : NaN;
}

type CsvColMap = { sku: number; category: number; name: number; imageUrl: number; size: number; stock: number; wholesale: number; msrp: number; sale: number; memo: number };

type ParsedCsvRow = {
  sku: string;
  category: string | null;
  nameSpec: string;
  imageUrl: string | null;
  size: string;
  stockVal: number;
  wholesale: number | null;
  msrp: number | null;
  sale: number | null;
  memo: string | null;
  /** 헤더 제외, 유효 SKU가 있는 데이터 행 기준 번호(1부터) */
  dataRowIndex: number;
};

/** 다운로드와 동일하게 영문 10컬럼만 허용(표기·대소문자 무관, 공백 무시). */
const REQUIRED_CSV_COLUMNS = [
  "sku",
  "category",
  "name",
  "imageurl",
  "size",
  "stock",
  "wholesaleprice",
  "msrpprice",
  "saleprice",
  "memo",
] as const;

function assertStrictProductCsvHeaders(rawHeaders: string[]): CsvColMap {
  const normalized = rawHeaders.map((h) => h.trim().toLowerCase().replace(/\s/g, ""));
  if (normalized.length !== REQUIRED_CSV_COLUMNS.length) {
    throw new Error(
      `CSV 오류: 헤더는 정확히 10개 컬럼이어야 합니다.\n필요: sku, category, name, imageUrl, size, stock, wholesalePrice, msrpPrice, salePrice, memo\n현재 ${normalized.length}개: ${rawHeaders.join(", ")}`
    );
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`CSV 오류: 헤더에 중복된 컬럼명이 있습니다. (${rawHeaders.join(", ")})`);
  }
  for (const req of REQUIRED_CSV_COLUMNS) {
    if (!normalized.includes(req)) {
      throw new Error(
        `CSV 오류: 필수 컬럼이 없습니다 (누락: ${req}).\n필요(순서 무관): sku, category, name, imageUrl, size, stock, wholesalePrice, msrpPrice, salePrice, memo\n현재: ${rawHeaders.join(", ")}`
      );
    }
  }
  const idx = (key: (typeof REQUIRED_CSV_COLUMNS)[number]) => normalized.indexOf(key);
  return {
    sku: idx("sku"),
    category: idx("category"),
    name: idx("name"),
    imageUrl: idx("imageurl"),
    size: idx("size"),
    stock: idx("stock"),
    wholesale: idx("wholesaleprice"),
    msrp: idx("msrpprice"),
    sale: idx("saleprice"),
    memo: idx("memo"),
  };
}

/** 같은 SKU에서 사이즈 있음/없음 혼재 금지. 사이즈 없음은 해당 SKU당 1행만. */
function validateSkuVariantRules(rows: ParsedCsvRow[]): void {
  const bySku = new Map<string, ParsedCsvRow[]>();
  for (const r of rows) {
    const arr = bySku.get(r.sku) ?? [];
    arr.push(r);
    bySku.set(r.sku, arr);
  }
  for (const [sku, arr] of bySku) {
    const hasEmpty = arr.some((r) => r.size === "");
    const hasFilled = arr.some((r) => r.size !== "");
    if (hasEmpty && hasFilled) {
      const nums = arr.map((r) => r.dataRowIndex).join(", ");
      throw new Error(
        `CSV 오류 (SKU: ${sku}): 사이즈가 비어 있는 행과 사이즈가 있는 행이 함께 있습니다. (데이터 행: ${nums})\n한 SKU는「전부 사이즈 비움(products.stock)」또는「전부 사이즈 지정(variant)」만 가능합니다.`
      );
    }
    if (hasEmpty && arr.length > 1) {
      throw new Error(
        `CSV 오류 (SKU: ${sku}): 사이즈가 없을 때는 한 SKU당 1행만 허용합니다. (${arr.length}행, 데이터 행: ${arr.map((r) => r.dataRowIndex).join(", ")})`
      );
    }
  }
}

async function zeroAllVariantStocks(productId: string): Promise<void> {
  const { error } = await supabaseServer.from("product_variants").update({ stock: 0 }).eq("product_id", productId);
  if (error) throw new Error(error.message);
}

/** CSV에 없는 기존 size(variant 행)는 재고 0으로 동기화 (행 삭제 없음). */
async function zeroVariantStockNotInSizes(productId: string, sizesInCsv: Set<string>): Promise<void> {
  const { data: variants, error } = await supabaseServer
    .from("product_variants")
    .select("id, size")
    .eq("product_id", productId);
  if (error) throw new Error(error.message);
  for (const v of variants ?? []) {
    if (!sizesInCsv.has(v.size)) {
      const { error: uErr } = await supabaseServer.from("product_variants").update({ stock: 0 }).eq("id", v.id);
      if (uErr) throw new Error(uErr.message);
    }
  }
}

function parseCsvRows(
  lines: string[],
  delimiter: string,
  col: CsvColMap,
  headerLineIndex: number
): { rows: ParsedCsvRow[]; skippedRows: number[] } {
  const rows: ParsedCsvRow[] = [];
  const skippedRows: number[] = [];

  let dataRowIndex = 0; // 유효 SKU가 있는 데이터 행 기준(에러 메시지용)

  for (let i = headerLineIndex + 1; i < lines.length; i++) {
    if (!lines[i] || lines[i].trim() === "") continue;

    const cols = parseCsvLine(lines[i], delimiter);
    const sku = (cols[col.sku] ?? "").trim();
    if (!sku) {
      // Excel/CSV에서 사용자가 보는 "파일 라인 번호(헤더 포함)" 기준으로 반환
      skippedRows.push(i + 1);
      continue;
    }

    dataRowIndex += 1;

    const category = col.category >= 0 ? (cols[col.category] ?? "").trim() || null : null;
    const nameSpec = col.name >= 0 ? (cols[col.name] ?? "").trim() : "";
    const imageUrl = col.imageUrl >= 0 ? (cols[col.imageUrl] ?? "").trim() || null : null;
    const size = col.size >= 0 ? (cols[col.size] ?? "").trim() || "" : "";
    const stockRaw = col.stock >= 0 ? toIntOrNaN(cols[col.stock]) : NaN;
    const stockVal = Number.isFinite(stockRaw) ? Math.max(0, stockRaw) : 0;
    const wholesale = col.wholesale >= 0 ? toIntOrNaN(cols[col.wholesale]) : null;
    const msrp = col.msrp >= 0 ? toIntOrNaN(cols[col.msrp]) : null;
    const sale = col.sale >= 0 ? toIntOrNaN(cols[col.sale]) : null;
    const memo = col.memo >= 0 ? (cols[col.memo] ?? "").trim() || null : null;

    rows.push({
      sku,
      category,
      nameSpec,
      imageUrl,
      size,
      stockVal,
      wholesale: wholesale != null && Number.isFinite(wholesale) ? wholesale : null,
      msrp: msrp != null && Number.isFinite(msrp) ? msrp : null,
      sale: sale != null && Number.isFinite(sale) ? sale : null,
      memo,
      dataRowIndex,
    });
  }

  return { rows, skippedRows };
}

/** Within each SKU group, fill empty category/name/imageUrl/prices/memo from another row with same SKU. Do NOT fill size or stock. If two non-empty values conflict, throw. Run before validateSkuConsistency. */
function normalizeSkuGroups(rows: ParsedCsvRow[]): void {
  const bySku = new Map<string, ParsedCsvRow[]>();
  for (const r of rows) {
    const arr = bySku.get(r.sku) ?? [];
    arr.push(r);
    bySku.set(r.sku, arr);
  }
  const fillableKeys: (keyof ParsedCsvRow)[] = ["category", "nameSpec", "imageUrl", "wholesale", "msrp", "sale", "memo"];
  const isEmpty = (val: unknown): boolean =>
    val === null || val === undefined || (typeof val === "string" && val.trim() === "");

  for (const [, group] of bySku) {
    if (group.length <= 1) continue;
    const canon: Partial<ParsedCsvRow> = {};
    for (const r of group) {
      for (const key of fillableKeys) {
        const val = r[key];
        if (isEmpty(val)) continue;
        const existing = canon[key];
        if (existing !== undefined && String(existing) !== String(val)) {
          const skus = [...new Set(group.map((x) => x.sku))].join(", ");
          throw new Error(
            `CSV 오류 (SKU: ${skus}): 동일한 SKU의 상품 정보(카테고리·품명·이미지·가격·비고 등)가 서로 다릅니다. (데이터 행: ${group.map((x) => x.dataRowIndex).join(", ")})`
          );
        }
        if (existing === undefined) (canon as Record<string, unknown>)[key] = val;
      }
    }
    for (const r of group) {
      for (const key of fillableKeys) {
        if (isEmpty(r[key]) && (canon as Record<string, unknown>)[key] !== undefined) {
          (r as Record<string, unknown>)[key] = (canon as Record<string, unknown>)[key];
        }
      }
    }
  }
}

/** Same SKU must have identical category, name, imageUrl, wholesale, msrp, sale, memo. Only size and stock may differ. */
function validateSkuConsistency(rows: ParsedCsvRow[]): void {
  const bySku = new Map<string, ParsedCsvRow[]>();
  for (const r of rows) {
    const arr = bySku.get(r.sku) ?? [];
    arr.push(r);
    bySku.set(r.sku, arr);
  }
  for (const [, arr] of bySku) {
    if (arr.length <= 1) continue;
    const first = arr[0];
    for (let i = 1; i < arr.length; i++) {
      const r = arr[i];
      if (
        (first.category ?? "") !== (r.category ?? "") ||
        (first.nameSpec ?? "") !== (r.nameSpec ?? "") ||
        (first.imageUrl ?? "") !== (r.imageUrl ?? "") ||
        String(first.wholesale ?? "") !== String(r.wholesale ?? "") ||
        String(first.msrp ?? "") !== String(r.msrp ?? "") ||
        String(first.sale ?? "") !== String(r.sale ?? "") ||
        (first.memo ?? "") !== (r.memo ?? "")
      ) {
        throw new Error(
          `CSV 오류 (SKU: ${first.sku}): 동일한 SKU의 상품 정보가 일치하지 않습니다. (데이터 행: ${first.dataRowIndex}, ${r.dataRowIndex})`
        );
      }
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
    const variantMode = row0.size !== "";

    const payload = {
      category: row0.category,
      name_spec: row0.nameSpec?.trim() || sku,
      image_url: resolveProductImageUrl(sku, row0.imageUrl),
      wholesale_price: row0.wholesale,
      msrp_price: row0.msrp,
      sale_price: row0.sale,
      memo: row0.memo,
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
      for (const r of group) {
        sizesInCsv.add(r.size);
        const { error: upsertErr } = await supabaseServer.from("product_variants").upsert(
          { product_id: productId, size: r.size, stock: r.stockVal },
          { onConflict: "product_id,size" }
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
  memo?: string | null;
  variants?: { size: string; stock: number }[];
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
    memo: data.memo?.trim() || null,
    stock: 0,
  }).select("id").single();

  if (error) throw new Error(error.message);
  const productId = inserted.id;

  if (hasVariants && data.variants) {
    for (const v of data.variants) {
      const size = (v.size ?? "").trim();
      const stock = Number.isFinite(Number(v.stock)) ? Math.max(0, Number(v.stock)) : 0;
      const { error: vErr } = await supabaseServer.from("product_variants").insert({
        product_id: productId,
        size: size,
        stock,
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

    memo?: string | null;
    variants?: {
      updates: Array<{ id?: string; size: string; stock: number }>;
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

  if (data.memo !== undefined) updateData.memo = data.memo?.trim() || null;
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
      const size = (u.size ?? "").trim();
      const stock = Number.isFinite(Number(u.stock)) ? Math.max(0, Number(u.stock)) : 0;
      if (u.id) {
        await supabaseServer.from("product_variants").update({ size, stock }).eq("id", u.id);
      } else {
        await supabaseServer.from("product_variants").insert({
          product_id: productId,
          size,
          stock,
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

/* -----------------------------
 * CSV Upload: 고정 10컬럼 + SKU 그룹 variant 동기화(stock 0)
 * ----------------------------- */

// 상품 CSV 업로드 (sku 기준 upsert). fullSync=true면 CSV에 없는 기존 상품 삭제.
export async function uploadProductsCsv(formData: FormData, fullSync?: boolean) {
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

  const rawLines = text.split(/\r?\n/);
  const headerLineIndex = rawLines.findIndex((l) => (l ?? "").trim().length > 0);
  if (headerLineIndex < 0) {
    throw new Error("CSV 오류: 헤더 라인이 없습니다.");
  }

  const delimiter = detectDelimiter(rawLines[headerLineIndex] ?? "");

  const rawHeaders = parseCsvLine(rawLines[headerLineIndex] ?? "", delimiter);
  const col = assertStrictProductCsvHeaders(rawHeaders);

  const { rows, skippedRows } = parseCsvRows(rawLines, delimiter, col, headerLineIndex);
  if (rows.length === 0) {
    throw new Error("CSV 오류: 유효한 SKU가 있는 데이터 행이 없습니다.");
  }
  normalizeSkuGroups(rows);
  validateSkuVariantRules(rows);
  validateSkuConsistency(rows);
  const csvSkus = await applyCsvProductRowsGrouped(rows);
  if (fullSync) await deleteProductsNotInCsv(csvSkus);
  revalidatePath("/products");
  revalidatePath("/status");
  if (LOG_MOVES) revalidatePath("/moves");

  return {
    skippedCount: skippedRows.length,
    skippedRows,
  };
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