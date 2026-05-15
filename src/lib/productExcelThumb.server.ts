import { Buffer } from "node:buffer";

import sharp from "sharp";

/** 엑셀용 사전 생성 썸네일(업로드 시 1회) — 다운로드 경로에서는 sharp 미사용 */
export async function buildProductExcelThumbJpegFromBuffer(buf: Buffer): Promise<Buffer> {
  return sharp(buf)
    .resize(50, 50, {
      fit: "cover",
      position: "centre",
    })
    .jpeg({ quality: 70 })
    .toBuffer();
}
