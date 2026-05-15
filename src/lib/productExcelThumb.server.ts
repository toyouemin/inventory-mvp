import { Buffer } from "node:buffer";

import sharp from "sharp";

import { PRODUCT_STOCK_EXCEL_THUMB_PIXEL } from "@/app/products/xlsx/productStockExcelImageFetch";

/**
 * 엑셀용 사전 생성 썸네일(업로드·rebuild 스크립트에서 1회).
 * 다운로드 시에는 sharp 없이 이 버퍼를 그대로 씀.
 * 시각 품질은 예전 엑셀 폴백 경로(`fetchUrlAndNormalizeToJpegThumb`)와 동일하게 맞춤.
 */
export async function buildProductExcelThumbJpegFromBuffer(buf: Buffer): Promise<Buffer> {
  const px = PRODUCT_STOCK_EXCEL_THUMB_PIXEL;
  return sharp(buf)
    .resize(px, px, {
      fit: "contain",
      background: "#ffffff",
    })
    .jpeg({ quality: 92 })
    .toBuffer();
}
