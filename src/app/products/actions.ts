"use server";

import { supabaseServer } from "@/lib/supabaseClient";
import { revalidatePath } from "next/cache";

const LOG_MOVES = process.env.LOG_MOVES === "1";
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
};

function parseCsvRows(lines: string[], delimiter: string, col: CsvColMap): ParsedCsvRow[] {
  const rows: ParsedCsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i], delimiter);
    const sku = (cols[col.sku] ?? "").trim();
    if (!sku) continue;
    const category = col.category >= 0 ? (cols[col.category] ?? "").trim() || null : null;
    const nameSpec = col.name >= 0 ? (cols[col.name] ?? "").trim() || sku : sku;
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
    });
  }
  return rows;
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
        throw new Error("CSV 오류: 동일한 SKU의 상품 정보가 서로 다릅니다.");
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

async function applyCsvRows(rows: ParsedCsvRow[]): Promise<Set<string>> {
  const csvSkus = new Set<string>();
  for (const row of rows) {
    csvSkus.add(row.sku);
    const payload = {
      category: row.category,
      name_spec: row.nameSpec,
      image_url: row.imageUrl,
      wholesale_price: row.wholesale,
      msrp_price: row.msrp,
      sale_price: row.sale,
      memo: row.memo,
    };
    let productId: string;
    const { data: existing } = await supabaseServer.from("products").select("id").eq("sku", row.sku).maybeSingle();
    if (existing?.id) {
      productId = existing.id;
      await supabaseServer.from("products").update(payload).eq("id", productId);
    } else {
      const { data: inserted, error: insErr } = await supabaseServer
        .from("products")
        .insert({ sku: row.sku, ...payload, stock: 0 })
        .select("id")
        .single();
      if (insErr) throw new Error(insErr.message);
      productId = inserted.id;
    }
    if (row.size !== "") {
      const { error: upsertErr } = await supabaseServer.from("product_variants").upsert(
        { product_id: productId, size: row.size, stock: row.stockVal },
        { onConflict: "product_id,size" }
      );
      if (upsertErr) throw new Error(upsertErr.message);
    } else {
      await supabaseServer.from("products").update({ stock: row.stockVal }).eq("id", productId);
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
    image_url: data.imageUrl?.trim() || null,
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
  }
) {
  if (!productId) return;

  const updateData: Record<string, unknown> = {};
  if (data.sku !== undefined) updateData.sku = data.sku.trim();
  if (data.category !== undefined) updateData.category = data.category?.trim() || null;
  if (data.nameSpec !== undefined) updateData.name_spec = data.nameSpec?.trim();
  if (data.imageUrl !== undefined) updateData.image_url = data.imageUrl?.trim() || null;

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

  const { error } = await supabaseServer.from("products").update(updateData).eq("id", productId);
  if (error) throw new Error(error.message);

  revalidatePath("/products");
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
 * CSV Upload: upsert + stock -> moves via RPC
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

  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return;

  const delimiter = detectDelimiter(lines[0]);

  const headers = parseCsvLine(lines[0], delimiter).map((h) => h.toLowerCase().replace(/\s/g, ""));
  const skuIdx = headers.findIndex((h) => h === "sku" || h === "품목코드");
  if (skuIdx < 0) {
    throw new Error(`CSV 헤더에 sku(또는 품목코드)가 없습니다. 현재 헤더: ${headers.join("|")}`);
  }

  const sizeIdx = headers.findIndex((h) => h === "size" || h === "사이즈");
  const hasSizeColumn = sizeIdx >= 0;

  if (hasSizeColumn) {
    const col: CsvColMap = {
      sku: skuIdx,
      category: headers.findIndex((h) => h === "category" || h === "카테고리"),
      name: headers.findIndex((h) => h === "name" || h === "품명" || h === "namespec"),
      imageUrl: headers.findIndex((h) => h === "imageurl" || h === "이미지url"),
      size: sizeIdx,
      stock: headers.findIndex((h) => h === "stock" || h === "재고"),
      wholesale: headers.findIndex((h) => h === "wholesaleprice" || h === "출고가"),
      msrp: headers.findIndex((h) => h === "msrpprice" || h === "소비자가"),
      sale: headers.findIndex((h) => h === "saleprice" || h === "실판매가" || h === "판매가"),
      memo: headers.findIndex((h) => h === "memo" || h === "비고"),
    };
    const rows = parseCsvRows(lines, delimiter, col);
    validateSkuConsistency(rows);
    const csvSkus = await applyCsvRows(rows);
    if (fullSync) await deleteProductsNotInCsv(csvSkus);
    revalidatePath("/products");
    revalidatePath("/status");
    if (LOG_MOVES) revalidatePath("/moves");
    return;
  }

  const csvSkus = new Set<string>();
  const catIdx = headers.findIndex((h) => h === "category" || h === "카테고리");
  const nameIdx = headers.findIndex((h) => h === "namespec" || h === "품명" || h === "name");
  const imgIdx = headers.findIndex((h) => h === "imageurl" || h === "이미지url");

  const wholesaleIdx = headers.findIndex((h) => h === "wholesaleprice" || h === "출고가");
  const msrpIdx = headers.findIndex((h) => h === "msrpprice" || h === "소비자가");
  const saleIdx = headers.findIndex((h) => h === "saleprice" || h === "실판매가" || h === "판매가");

  const memoIdx = headers.findIndex((h) => h === "memo" || h === "비고");
  const stockIdx = headers.findIndex((h) => h === "stock" || h === "재고");

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i], delimiter);

    const sku = (cols[skuIdx] ?? "").trim();
    if (!sku) continue;
    csvSkus.add(sku);

    const category = catIdx >= 0 ? (cols[catIdx] ?? "").trim() || null : null;
    const nameSpec = nameIdx >= 0 ? (cols[nameIdx] ?? "").trim() : "";
    const imageUrl = imgIdx >= 0 ? (cols[imgIdx] ?? "").trim() || null : null;

    const wholesalePrice = wholesaleIdx >= 0 ? toIntOrNaN(cols[wholesaleIdx]) : NaN;
    const msrpPrice = msrpIdx >= 0 ? toIntOrNaN(cols[msrpIdx]) : NaN;
    const salePrice = saleIdx >= 0 ? toIntOrNaN(cols[saleIdx]) : NaN;

    const memo = memoIdx >= 0 ? (cols[memoIdx] ?? "").trim() || null : null;
    const stock = stockIdx >= 0 ? toIntOrNaN(cols[stockIdx]) : NaN;

    // sku로 기존 상품 찾기
    const { data: existing, error: findErr } = await supabaseServer
      .from("products")
      .select("id")
      .eq("sku", sku)
      .maybeSingle();

    if (findErr) throw new Error(findErr.message);

    // ✅ stock은 여기서 직접 update하지 않음 (로그 남기기 위해 RPC가 담당)
    const payload: any = {
      category,
      name_spec: nameSpec || sku,
      image_url: imageUrl,

      wholesale_price: Number.isFinite(wholesalePrice) ? wholesalePrice : null,
      msrp_price: Number.isFinite(msrpPrice) ? msrpPrice : null,
      sale_price: Number.isFinite(salePrice) ? salePrice : null,

      memo,
    };

    if (existing?.id) {
      // 1) 일반 정보 업데이트
      const { error: upErr } = await supabaseServer.from("products").update(payload).eq("id", existing.id);
      if (upErr) throw new Error(upErr.message);

      // 2) ✅ stock이 있으면: RPC로 재고 세팅 + moves(adjust) 기록
      if (Number.isFinite(stock)) {
        const { error: rpcErr } = await supabaseServer.rpc("set_stock_with_move", {
          p_product_id: existing.id,
          p_new_stock: Math.max(0, stock),
          p_note: "CSV 업로드",
        });
        if (rpcErr) throw new Error(rpcErr.message);
      }
    } else {
      // 신규 insert (우선 stock 0으로 넣고)
      const { data: inserted, error: insErr } = await supabaseServer
        .from("products")
        .insert({
          sku,
          ...payload,
          stock: 0,
        })
        .select("id")
        .single();

      if (insErr) throw new Error(insErr.message);

      // ✅ 초기 재고도 기록 남기고 싶으면 RPC 호출
      if (Number.isFinite(stock)) {
        const { error: rpcErr } = await supabaseServer.rpc("set_stock_with_move", {
          p_product_id: inserted.id,
          p_new_stock: Math.max(0, stock),
          p_note: "CSV 신규등록 초기재고",
        });
        if (rpcErr) throw new Error(rpcErr.message);
      }
    }
  }

  if (fullSync) await deleteProductsNotInCsv(csvSkus);
  revalidatePath("/products");
  revalidatePath("/status");

  if (LOG_MOVES) {
    revalidatePath("/moves");
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