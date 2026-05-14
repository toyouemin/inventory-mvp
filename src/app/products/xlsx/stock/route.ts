import { formatDownloadFileNameDateYymmdd } from "@/lib/downloadFileNameDate";
import { buildProductStockExcelColumnWidths } from "@/lib/excelDownloadColumnWidths";
import {
  applyExcelDownloadFontToWorksheet,
  applyHorizontalCenterToColumns,
  applyThousandsNumberFormatToColumns,
  PRODUCT_STOCK_XLSX_CENTER_ALIGN_COLS,
  PRODUCT_STOCK_XLSX_COMMA_NUMBER_COLS,
  writeStyledXlsxBuffer,
} from "@/lib/excelDownloadFont";
import * as XLSX from "xlsx-js-style";
import { unstable_noStore as noStore } from "next/cache";

import { loadProductStockExportBundle, PRODUCT_STOCK_IMAGE_URL_COL_INDEX } from "../productStockExportShared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  noStore();
  const { aoa, error } = await loadProductStockExportBundle({ debugVariantRows: false });

  if (error) {
    return new Response(`XLSX export failed: ${error.message}`, { status: 500 });
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = buildProductStockExcelColumnWidths(aoa, PRODUCT_STOCK_IMAGE_URL_COL_INDEX);
  applyThousandsNumberFormatToColumns(ws, PRODUCT_STOCK_XLSX_COMMA_NUMBER_COLS);
  applyHorizontalCenterToColumns(ws, PRODUCT_STOCK_XLSX_CENTER_ALIGN_COLS);
  applyExcelDownloadFontToWorksheet(ws);
  XLSX.utils.book_append_sheet(wb, ws, "stock");

  const buffer = writeStyledXlsxBuffer(wb);

  const yymmdd = formatDownloadFileNameDateYymmdd(new Date());
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="stock_${yymmdd}.xlsx"`,
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
    },
  });
}
