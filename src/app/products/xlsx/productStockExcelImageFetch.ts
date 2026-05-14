import { Buffer } from "node:buffer";

import sharp from "sharp";

import { isProductImagesBucketPublicUrl } from "@/lib/productImagesStorage";

import type { ProductStockExportProductRow } from "./productStockExportShared";

const IMAGE_FETCH_TIMEOUT_MS = 20_000;
/** 엑셀에 넣는 비트맵 해상도(높을수록 선명, ext 표시 크기는 별도) */
export const PRODUCT_STOCK_EXCEL_THUMB_PIXEL = 120;
/** 엑셀 표시 목표 크기(px) — 정사각형 */
export const PRODUCT_STOCK_EXCEL_IMAGE_DISPLAY_PX = 50;

/**
 * 열 너비(wch) → 픽셀 너비(96dpi). OOXML/Excel 기본 MDW≈7(Calibri 11 기준) 근사.
 * @see https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.spreadsheet.column
 */
export function excelColumnWidthCharsToPx(wch: number, mdw = 7): number {
  if (!(wch > 0)) return 0;
  const inner = Math.trunc((256 * wch + Math.trunc(128 / mdw)) / 256);
  return Math.trunc(inner * mdw);
}

/** 행 높이(pt) → 픽셀 높이(96dpi) */
export function excelRowHeightPtToPx(hPt: number): number {
  return Math.round((hPt * 96) / 72);
}

/** DrawingML / ExcelJS `ExtXform` 과 동일 — colOff·rowOff·ext 환산 */
const EMU_PER_PIXEL_AT_96_DPI = 9525;

export function excelPixelsToEmu(px: number): number {
  return Math.round(px * EMU_PER_PIXEL_AT_96_DPI);
}

export const PRODUCT_STOCK_EXCEL_IMAGE_COL_WCH = 8;

/**
 * 셀을 정사각에 가깝게: 열 wch가 만드는 픽셀 높이와 같은 행 높이(pt).
 * 이미지 표시 비율은 `xdr:oneCellAnchor` + `xdr:ext` 고정 픽셀로 맞춤(twoCell·가로편차 보정 불필요).
 */
export const PRODUCT_STOCK_EXCEL_IMAGE_ROW_PT =
  (excelColumnWidthCharsToPx(PRODUCT_STOCK_EXCEL_IMAGE_COL_WCH) * 72) / 96;

/** oneCell 앵커 `ext` — ExcelJS가 픽셀 단위로 받아 EMU로 기록함(`ExtXform`). */
export function productStockExcelImageSquareExtPx(): number {
  const cellW = excelColumnWidthCharsToPx(PRODUCT_STOCK_EXCEL_IMAGE_COL_WCH);
  const cellH = excelRowHeightPtToPx(PRODUCT_STOCK_EXCEL_IMAGE_ROW_PT);
  const cap = Math.max(24, Math.min(cellW, cellH) - 6);
  return Math.min(PRODUCT_STOCK_EXCEL_IMAGE_DISPLAY_PX, cap);
}

/** 엑셀 실제 셀 폭과 wch→px 근사 차이로 이미지가 살짝 왼쪽으로 보일 때 — 가로만(px, EMU로 환산) */
const IMAGE_ONE_CELL_CENTER_COL_NUDGE_PX = 3;

/** A열(고정 wch) 한 칸 안에서 이미지를 가운데 두기 위한 xdr:from (EMU 오프셋). */
export function productStockExcelImageOneCellTlNative(
  nativeCol: number,
  nativeRow: number
): { nativeCol: number; nativeColOff: number; nativeRow: number; nativeRowOff: number } {
  const extPx = productStockExcelImageSquareExtPx();
  const cellW = excelColumnWidthCharsToPx(PRODUCT_STOCK_EXCEL_IMAGE_COL_WCH);
  const cellH = excelRowHeightPtToPx(PRODUCT_STOCK_EXCEL_IMAGE_ROW_PT);
  const maxColOff = Math.max(0, cellW - extPx);
  const colOffPx = Math.min(
    maxColOff,
    Math.max(0, Math.round((cellW - extPx) / 2) + IMAGE_ONE_CELL_CENTER_COL_NUDGE_PX)
  );
  const rowOffPx = Math.max(0, Math.round((cellH - extPx) / 2));
  return {
    nativeCol,
    nativeColOff: excelPixelsToEmu(colOffPx),
    nativeRow,
    nativeRowOff: excelPixelsToEmu(rowOffPx),
  };
}

const MIN_IMAGE_BYTES = 100;

function withCacheVersionOnUrl(href: string, version: string | null | undefined): string {
  if (!version?.trim()) return href;
  try {
    const u = new URL(href);
    u.searchParams.set("v", version.trim());
    return u.toString();
  } catch {
    return href;
  }
}

/**
 * DB에 호스트 없이 `/storage/v1/...` 만 저장된 경우 등 — fetch 가능한 절대 URL로 만듭니다.
 * (requestOrigin만 쓰면 localhost로 붙어 Supabase가 아닌 잘못된 주소가 됩니다.)
 */
export function absolutizeProductImageUrl(raw: string, requestOrigin: string): string {
  const t = raw.trim();
  if (!t) return "";
  if (t.startsWith("http://") || t.startsWith("https://")) return t;
  const supa = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "") ?? "";
  const path = t.startsWith("/") ? t : `/${t}`;
  if (supa && path.startsWith("/storage/")) {
    return `${supa}${path}`;
  }
  return new URL(path, requestOrigin).href;
}

/**
 * 잘못 저장된 변환 URL이면 공개 객체 URL로 되돌립니다.
 */
export function toSupabasePublicObjectUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    const marker = "/storage/v1/render/image/public/";
    if (!u.pathname.includes(marker)) return url.trim();
    u.pathname = u.pathname.replace(marker, "/storage/v1/object/public/");
    const vParam = u.searchParams.get("v");
    u.search = "";
    if (vParam) u.searchParams.set("v", vParam);
    return u.toString();
  } catch {
    return url.trim();
  }
}

/**
 * Supabase Storage 공개 URL이면 렌더(변환) URL로 바꿉니다. 미지원·무료 플랜 등에서 실패할 수 있어
 * 반드시 원본 객체 URL로 재시도해야 합니다.
 */
export function toSupabaseThumbnailRenderUrlIfApplicable(publicObjectUrl: string): string {
  if (!isProductImagesBucketPublicUrl(publicObjectUrl)) return publicObjectUrl;
  try {
    const u = new URL(publicObjectUrl.trim());
    const prefix = "/storage/v1/object/public/";
    if (!u.pathname.startsWith(prefix)) return publicObjectUrl;
    const vParam = u.searchParams.get("v");
    u.pathname = u.pathname.replace(prefix, "/storage/v1/render/image/public/");
    u.search = "";
    u.searchParams.set("width", "512");
    u.searchParams.set("height", "512");
    u.searchParams.set("resize", "contain");
    u.searchParams.set("format", "jpeg");
    if (vParam) u.searchParams.set("v", vParam);
    return u.toString();
  } catch {
    return publicObjectUrl;
  }
}

/**
 * 응답이 이미지인지 검사한 뒤 sharp로 JPEG(`extension: 'jpeg'` 전용)로 정규화합니다.
 * 픽셀은 `PRODUCT_STOCK_EXCEL_THUMB_PIXEL` 정사각(레터박스 없음 · contain + 흰 배경).
 * HTML·빈 응답·비이미지 Content-Type·metadata 불가 데이터는 null.
 */
async function fetchUrlAndNormalizeToJpegThumb(absUrl: string): Promise<Buffer | null> {
  if (!absUrl.trim()) return null;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), IMAGE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(absUrl, { signal: ac.signal, cache: "no-store" });
    if (!res.ok) {
      return null;
    }

    const contentType = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!contentType.startsWith("image/")) {
      return null;
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf || buf.length < MIN_IMAGE_BYTES) {
      return null;
    }

    const meta = await sharp(buf).metadata();
    if (!meta.width || !meta.height) {
      return null;
    }

    const normalized = await sharp(buf)
      .resize(PRODUCT_STOCK_EXCEL_THUMB_PIXEL, PRODUCT_STOCK_EXCEL_THUMB_PIXEL, {
        fit: "contain",
        background: "#ffffff",
      })
      .jpeg({ quality: 92 })
      .toBuffer();

    if (!normalized || normalized.length < MIN_IMAGE_BYTES) {
      return null;
    }
    const outMeta = await sharp(normalized).metadata();
    if (outMeta.format !== "jpeg") {
      return null;
    }
    return normalized;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * 상품 대표 이미지를 순차적으로 받아 썸네일 버퍼를 만듭니다(Promise.all 미사용).
 * 원본·Supabase contain 변환 URL 순으로 시도합니다.
 */
export async function fetchProductImageThumbnailForExcel(
  product: ProductStockExportProductRow,
  requestOrigin: string
): Promise<Buffer | null> {
  const raw = (product.image_url ?? "").trim();
  if (!raw) return null;
  let abs = absolutizeProductImageUrl(raw, requestOrigin);
  abs = withCacheVersionOnUrl(abs, product.updated_at);
  const objectUrl = toSupabasePublicObjectUrl(abs);
  /** 원본(또는 큰 contain)을 먼저 시도 — cover 프록시는 잘림·품질 저하가 잦음 */
  const candidates: string[] = [];
  candidates.push(objectUrl);
  const renderUrl = toSupabaseThumbnailRenderUrlIfApplicable(objectUrl);
  if (renderUrl !== objectUrl) {
    candidates.push(renderUrl);
  }
  const seen = new Set<string>();
  for (const u of candidates) {
    if (seen.has(u)) continue;
    seen.add(u);
    const buf = await fetchUrlAndNormalizeToJpegThumb(u);
    if (buf && buf.length > 0) return buf;
  }
  return null;
}
