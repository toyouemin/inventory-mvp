import { Buffer } from "node:buffer";

import { buildProductExcelThumbJpegFromBuffer } from "@/lib/productExcelThumb.server";
import {
  PRODUCT_IMAGES_BUCKET,
  thumbnailObjectPathFromStem,
} from "@/lib/productImagesStorage";
import { supabaseServer } from "@/lib/supabaseClient";
import { normalizeSkuForMatch } from "@/app/products/skuNormalize";

const FETCH_TIMEOUT_MS = 20_000;
const MIN_IMAGE_BYTES = 100;

export type EnsureExcelThumbnailRow = {
  id: string;
  sku: string | null;
  image_url: string | null;
  thumbnail_url: string | null;
};

function safeSkuForImageFilename(rawSku: string): string {
  const normalized = normalizeSkuForMatch(rawSku);
  return normalized.replace(/[\/\\:*?"<>|\u0000-\u001F]/g, "-").trim();
}

function absolutizeProductImageUrlForFetch(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  if (t.startsWith("http://") || t.startsWith("https://")) return t;
  const supa = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "") ?? "";
  const path = t.startsWith("/") ? t : `/${t}`;
  if (supa && path.startsWith("/storage/")) {
    return `${supa}${path}`;
  }
  return t;
}

async function fetchImageBuffer(absUrl: string): Promise<Buffer | null> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(absUrl, { signal: ac.signal, cache: "no-store" });
    if (!res.ok) return null;
    const contentType = (res.headers.get("content-type") || "").split(";")[0]?.trim().toLowerCase() ?? "";
    if (!contentType.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf || buf.length < MIN_IMAGE_BYTES) return null;
    return buf;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * `image_url`(루트 원본)에서 엑셀용 `thumbs/{SKU}.jpg` 생성·업로드 후 공개 URL 반환.
 */
export async function buildAndUploadProductExcelThumbForSku(
  skuRaw: string,
  imagePublicUrl: string
): Promise<string | null> {
  const skuBase = safeSkuForImageFilename(skuRaw);
  if (!skuBase) return null;
  const abs = absolutizeProductImageUrlForFetch(imagePublicUrl);
  if (!abs) return null;

  const buf = await fetchImageBuffer(abs);
  if (!buf) return null;

  let thumbBuf: Buffer;
  try {
    thumbBuf = await buildProductExcelThumbJpegFromBuffer(buf);
  } catch {
    return null;
  }

  const thumbPath = thumbnailObjectPathFromStem(skuBase);
  const { error: upErr } = await supabaseServer.storage.from(PRODUCT_IMAGES_BUCKET).upload(thumbPath, thumbBuf, {
    contentType: "image/jpeg",
    upsert: true,
  });
  if (upErr) return null;

  const { data } = supabaseServer.storage.from(PRODUCT_IMAGES_BUCKET).getPublicUrl(thumbPath);
  return data.publicUrl;
}

/**
 * 이미지 포함 엑셀 다운로드 직전: `thumbnail_url`이 비어 있고 `image_url`이 있는 상품만 thumbs 생성.
 * 반환 Map은 갱신된 product id → thumbnail_url (메모리 병합용).
 */
export async function ensureProductExcelThumbnailsForExport(
  rows: EnsureExcelThumbnailRow[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const seen = new Set<string>();

  for (const row of rows) {
    const id = String(row.id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);

    if (String(row.thumbnail_url ?? "").trim() !== "") continue;
    const imageUrl = String(row.image_url ?? "").trim();
    if (!imageUrl) continue;

    const thumbUrl = await buildAndUploadProductExcelThumbForSku(String(row.sku ?? ""), imageUrl);
    if (!thumbUrl) continue;

    const { error: dbErr } = await supabaseServer
      .from("products")
      .update({ thumbnail_url: thumbUrl })
      .eq("id", id);
    if (dbErr) {
      console.warn("[ensureProductExcelThumbnails] DB thumbnail_url 갱신 실패", { id, message: dbErr.message });
      continue;
    }
    out.set(id, thumbUrl);
  }

  if (out.size > 0) {
    console.info("[ensureProductExcelThumbnails] 엑셀용 thumbs 생성", { count: out.size });
  }
  return out;
}
