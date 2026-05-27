import {
  buildAttachmentContentDisposition,
  productStockWithImagesXlsxFile,
} from "@/lib/downloadFileNames";
import { stripInvalidOneCellAnchorEditAsFromXlsxBuffer } from "@/lib/excelXlsxStripInvalidOneCellEditAs";
import ExcelJS from "exceljs";
import { unstable_noStore as noStore } from "next/cache";

import { loadProductStockExportBundle } from "../../productStockExportShared";
import { createImageSheet, createNormalSheet } from "../../productStockExcelJsSheets";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  noStore();
  const debugVariantRows = new URL(req.url).searchParams.get("debugVariants") === "1";
  const { aoa, imageLines, error } = await loadProductStockExportBundle({
    debugVariantRows,
    ensureExcelThumbnails: true,
  });

  if (error) {
    return new Response(`XLSX export failed: ${error.message}`, { status: 500 });
  }

  const origin = new URL(req.url).origin;
  const workbook = new ExcelJS.Workbook();
  createNormalSheet(workbook, aoa);
  await createImageSheet(workbook, imageLines, origin);

  const raw = new Uint8Array(await workbook.xlsx.writeBuffer());
  const buffer = await stripInvalidOneCellAnchorEditAsFromXlsxBuffer(raw);

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": buildAttachmentContentDisposition(productStockWithImagesXlsxFile()),
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
    },
  });
}
