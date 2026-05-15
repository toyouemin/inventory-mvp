/**
 * thumbnail_url 비어 있고 image_url 있는 기존 상품에 대해
 * `product-images/thumbs/{SKU}.jpg` 생성 후 DB `thumbnail_url` 갱신.
 *
 * 사용: npm run rebuild-thumbnails
 * 필요: .env / .env.local — NEXT_PUBLIC_SUPABASE_URL, Storage 업로드 가능한 키(권장 SUPABASE_SERVICE_ROLE_KEY)
 */

import { Buffer } from "node:buffer";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

const FETCH_TIMEOUT_MS = 20_000;
const MIN_IMAGE_BYTES = 100;
/** 스크립트는 순차 처리(상품별 try/catch) */
const PRODUCTS_PAGE_SIZE = 200;

function loadEnvFiles(): void {
  for (const name of [".env.local", ".env"]) {
    const p = join(projectRoot, name);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, "utf8");
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq <= 0) continue;
      const key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  }
}

loadEnvFiles();

function absolutizeProductImageUrlForFetch(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  if (t.startsWith("http://") || t.startsWith("https://")) return t;
  const supa = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "") ?? "";
  const path = t.startsWith("/") ? t : `/${t}`;
  if (supa && path.startsWith("/storage/")) {
    return `${supa}${path}`;
  }
  return path;
}

function safeSkuForImageFilename(rawSku: string, normalizeSkuForMatch: (s: string) => string): string {
  const normalized = normalizeSkuForMatch(rawSku);
  return normalized.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").trim();
}

const { buildProductExcelThumbJpegFromBuffer } = await import("../src/lib/productExcelThumb.server.ts");
const { PRODUCT_IMAGES_BUCKET } = await import("../src/lib/productImagesStorage.ts");
const { supabaseServer } = await import("../src/lib/supabaseClient.ts");
const { normalizeSkuForMatch } = await import("../src/app/products/skuNormalize.ts");

type ProductRow = { id: string; sku: string | null; image_url: string | null };

async function fetchImageBuffer(absUrl: string): Promise<{ buf: Buffer; contentType: string } | null> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(absUrl, { signal: ac.signal, cache: "no-store" });
    if (!res.ok) {
      console.warn(`[fetch] HTTP ${res.status} ${absUrl}`);
      return null;
    }
    const contentType = (res.headers.get("content-type") || "").split(";")[0]?.trim().toLowerCase() ?? "";
    if (!contentType.startsWith("image/")) {
      console.warn(`[fetch] 비이미지 Content-Type (${contentType}): ${absUrl}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf || buf.length < MIN_IMAGE_BYTES) {
      console.warn(`[fetch] 응답 너무 작음 (${buf?.length ?? 0} bytes)`);
      return null;
    }
    return { buf, contentType };
  } catch (e) {
    console.warn(`[fetch] 실패: ${absUrl}`, e instanceof Error ? e.message : e);
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function processOneProduct(row: ProductRow): Promise<"ok" | "skip" | "fail"> {
  const id = String(row.id ?? "").trim();
  const imageUrl = String(row.image_url ?? "").trim();
  if (!id || !imageUrl) return "skip";

  const skuBase = safeSkuForImageFilename(String(row.sku ?? ""), normalizeSkuForMatch);
  if (!skuBase) {
    console.warn(`[skip] SKU 없음 id=${id}`);
    return "skip";
  }

  const abs = absolutizeProductImageUrlForFetch(imageUrl);
  if (!abs) {
    console.warn(`[skip] URL 해석 불가 id=${id} sku=${skuBase}`);
    return "skip";
  }

  const fetched = await fetchImageBuffer(abs);
  if (!fetched) {
    console.warn(`[skip] 이미지 fetch 실패 id=${id} sku=${skuBase}`);
    return "skip";
  }

  let thumbBuf: Buffer;
  try {
    thumbBuf = await buildProductExcelThumbJpegFromBuffer(fetched.buf);
  } catch (e) {
    console.error(`[fail] sharp 실패 id=${id} sku=${skuBase}`, e instanceof Error ? e.message : e);
    return "fail";
  }

  const thumbPath = `thumbs/${skuBase}.jpg`;
  try {
    const { error: upErr } = await supabaseServer.storage.from(PRODUCT_IMAGES_BUCKET).upload(thumbPath, thumbBuf, {
      contentType: "image/jpeg",
      upsert: true,
    });
    if (upErr) {
      console.error(`[fail] Storage 업로드 id=${id} sku=${skuBase} path=${thumbPath}`, upErr.message);
      return "fail";
    }
  } catch (e) {
    console.error(`[fail] Storage 업로드 예외 id=${id}`, e instanceof Error ? e.message : e);
    return "fail";
  }

  const {
    data: { publicUrl: thumbnailPublicUrl },
  } = supabaseServer.storage.from(PRODUCT_IMAGES_BUCKET).getPublicUrl(thumbPath);

  const { error: dbErr } = await supabaseServer
    .from("products")
    .update({ thumbnail_url: thumbnailPublicUrl })
    .eq("id", id)
    .is("thumbnail_url", null);

  if (dbErr) {
    console.error(`[fail] DB 업데이트 id=${id} sku=${skuBase}`, dbErr.message);
    return "fail";
  }

  console.log(`[ok] id=${id} sku=${skuBase} thumb=${thumbPath}`);
  return "ok";
}

async function fetchNextBatch(): Promise<{ rows: ProductRow[]; error: Error | null }> {
  const offset = 0;
  const { data, error } = await supabaseServer
    .from("products")
    .select("id, sku, image_url")
    .is("thumbnail_url", null)
    .not("image_url", "is", null)
    .order("id", { ascending: true })
    .range(offset, offset + PRODUCTS_PAGE_SIZE - 1);

  if (error) {
    return { rows: [], error: new Error(error.message) };
  }
  const rows = (data ?? []) as ProductRow[];
  return { rows, error: null };
}

console.log("[rebuild-thumbnails] 시작 (순차 처리, 상품 단위 예외 무시)");

let ok = 0;
let skipped = 0;
let failed = 0;
let scanned = 0;

/**
 * DB를 갱신하면 행이 필터에서 빠지므로, offset 페이지네이션 대신 항상 첫 페이지만 읽어 반복합니다.
 */
for (;;) {
  const { rows, error } = await fetchNextBatch();
  if (error) {
    console.error("[rebuild-thumbnails] 페이지 조회 실패", error.message);
    process.exit(1);
  }
  const filtered = rows.filter((r) => String(r.image_url ?? "").trim() !== "");

  if (filtered.length === 0) break;

  for (const row of filtered) {
    scanned++;
    try {
      const r = await processOneProduct(row);
      if (r === "ok") ok++;
      else if (r === "skip") skipped++;
      else failed++;
    } catch (e) {
      failed++;
      console.error("[fail] 처리 중 예외", row.id, e instanceof Error ? e.message : e);
    }
  }
}

console.log(
  `[rebuild-thumbnails] 완료 — 스캔(처리 시도): ${scanned}, 성공: ${ok}, 건너뜀: ${skipped}, 실패: ${failed}`
);
