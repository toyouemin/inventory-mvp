import ExcelJS from "exceljs";

import {
  buildProductStockExcelColumnWidths,
  ExcelColumnWidthAccumulator,
  EXCEL_COL_WCH_MAX,
} from "@/lib/excelDownloadColumnWidths";
import {
  EXCEL_DOWNLOAD_DATA_FONT_SZ,
  EXCEL_DOWNLOAD_FONT_NAME,
  EXCEL_DOWNLOAD_HEADER_FONT_SZ,
  PRODUCT_STOCK_XLSX_CENTER_ALIGN_COLS,
  PRODUCT_STOCK_XLSX_COMMA_NUMBER_COLS,
  EXCEL_COMMA_NUMBER_NUMFMT,
} from "@/lib/excelDownloadFont";

import {
  type ProductStockExportImageLine,
  type ProductStockExportProductRow,
  type ProductStockExportVariantRow,
  excelCell,
  PRODUCT_STOCK_IMAGE_URL_COL_INDEX,
} from "./productStockExportShared";
import {
  fetchProductImageThumbnailForExcel,
  PRODUCT_STOCK_EXCEL_IMAGE_COL_WCH,
  PRODUCT_STOCK_EXCEL_IMAGE_ROW_PT,
  productStockExcelImageOneCellTlNative,
  productStockExcelImageSquareExtPx,
} from "./productStockExcelImageFetch";

/** 둘째 시트「이미지 포함상품재고」만 — 이미지는 A열(50×50), 데이터는 B열부터 */
const IMAGE_SHEET_EXPORT_HEADERS = [
  "카테고리",
  "상품명",
  "상품코드",
  "컬러",
  "성별",
  "사이즈",
  "수량",
  "출고가",
  "소비자가",
  "판매가",
  "매장가",
  "메모1",
  "메모2",
] as const;

/** 출고가·소비자가·판매가·매장가 — 실판매가 열 없음 */
function imageSheetDataRow(
  p: ProductStockExportProductRow,
  v: ProductStockExportVariantRow | null
): (string | number)[] {
  const name = (p.name ?? "").trim() || p.sku;
  const wholesale = v?.wholesale_price ?? p.wholesale_price;
  const sale = v?.sale_price ?? p.sale_price;
  const msrp = v?.msrp_price ?? p.msrp_price;
  const extra = v?.extra_price ?? p.extra_price;
  const stock = v ? Number(v.stock) || 0 : Number(p.stock) || 0;
  return [
    excelCell(p.category ?? ""),
    excelCell(name),
    excelCell(p.sku),
    excelCell(v?.color ?? ""),
    excelCell(v?.gender ?? ""),
    excelCell(v?.size ?? ""),
    excelCell(stock),
    excelCell(wholesale ?? ""),
    excelCell(msrp ?? ""),
    excelCell(sale ?? ""),
    excelCell(extra ?? ""),
    excelCell((v?.memo ?? p.memo) ?? ""),
    excelCell((v?.memo2 ?? p.memo2) ?? ""),
  ];
}

function writeNoImageCell(row: ExcelJS.Row): void {
  const cellA = row.getCell(1);
  cellA.value = "NO IMAGE";
  cellA.font = { name: EXCEL_DOWNLOAD_FONT_NAME, size: EXCEL_DOWNLOAD_DATA_FONT_SZ, italic: true };
  cellA.alignment = { horizontal: "center", vertical: "middle" };
}

const NORMAL_SHEET_NAME = "상품재고";
const IMAGE_SHEET_NAME = "이미지 포함상품재고";

/** 이미지 앵커: A열만(분수 좌표로 한 셀 안에 정사각형 배치, 가로 늘림 방지) */
const IMAGE_ANCHOR_COL = 1;
const IMAGE_DATA_COL_START = 2;
const IMAGE_DATA_COL_COUNT = IMAGE_SHEET_EXPORT_HEADERS.length;
const IMAGE_DATA_COL_END = IMAGE_DATA_COL_START + IMAGE_DATA_COL_COUNT - 1;

/** 1-based 열: 수량(H)~매장가(L) */
const IMAGE_NUMBER_COLS_1BASED: readonly number[] = [8, 9, 10, 11, 12];

const NORMAL_STANDARD_ROW_H = 16.5;
/** A열 wch와 동일 픽셀 높이(pt) — 이미지는 oneCell+ext로 정사각 표시 */
const IMAGE_DATA_ROW_H = PRODUCT_STOCK_EXCEL_IMAGE_ROW_PT;

function applyNormalSheetStyling(ws: ExcelJS.Worksheet, rowCount: number, colCount: number): void {
  const headerRow = 1;
  for (let r = 1; r <= rowCount; r++) {
    const row = ws.getRow(r);
    row.height = NORMAL_STANDARD_ROW_H;
    const fontSz = r === headerRow ? EXCEL_DOWNLOAD_HEADER_FONT_SZ : EXCEL_DOWNLOAD_DATA_FONT_SZ;
    for (let c = 1; c <= colCount; c++) {
      const cell = row.getCell(c);
      cell.font = {
        ...cell.font,
        name: EXCEL_DOWNLOAD_FONT_NAME,
        size: fontSz,
        bold: r === headerRow ? true : cell.font?.bold,
      };
    }
  }

  for (const c of PRODUCT_STOCK_XLSX_COMMA_NUMBER_COLS) {
    const colIdx = c + 1;
    for (let r = 2; r <= rowCount; r++) {
      const cell = ws.getRow(r).getCell(colIdx);
      const v = cell.value;
      if (typeof v === "number" && Number.isFinite(v)) {
        cell.numFmt = EXCEL_COMMA_NUMBER_NUMFMT;
      }
    }
  }

  for (const c of PRODUCT_STOCK_XLSX_CENTER_ALIGN_COLS) {
    const colIdx = c + 1;
    for (let r = 1; r <= rowCount; r++) {
      const cell = ws.getRow(r).getCell(colIdx);
      cell.alignment = { ...cell.alignment, horizontal: "center", vertical: "middle" };
    }
  }
}

/**
 * 기존 상품재고 xlsx-js-style 시트와 동일한 헤더·데이터·열폭·숫자서식·정렬·글꼴을 ExcelJS로 생성합니다.
 */
export function createNormalSheet(workbook: ExcelJS.Workbook, aoa: (string | number)[][]): void {
  const ws = workbook.addWorksheet(NORMAL_SHEET_NAME);
  const rowCount = aoa.length;
  const colCount = aoa[0]?.length ?? 0;
  for (let r = 0; r < rowCount; r++) {
    const row = ws.getRow(r + 1);
    const src = aoa[r];
    for (let c = 0; c < colCount; c++) {
      row.getCell(c + 1).value = src[c];
    }
  }

  const wchs = buildProductStockExcelColumnWidths(aoa, PRODUCT_STOCK_IMAGE_URL_COL_INDEX);
  for (let i = 0; i < wchs.length; i++) {
    ws.getColumn(i + 1).width = wchs[i].wch;
  }

  applyNormalSheetStyling(ws, rowCount, colCount);
}

/**
 * 이미지는 한 행씩 순차 fetch 후 삽입합니다(Promise.all 미사용).
 */
export async function createImageSheet(
  workbook: ExcelJS.Workbook,
  lines: ProductStockExportImageLine[],
  requestOrigin: string
): Promise<void> {
  const ws = workbook.addWorksheet(IMAGE_SHEET_NAME);

  const headerRow = ws.getRow(1);
  headerRow.height = NORMAL_STANDARD_ROW_H;
  const imgHeader = headerRow.getCell(IMAGE_ANCHOR_COL);
  imgHeader.value = "이미지";
  imgHeader.font = {
    name: EXCEL_DOWNLOAD_FONT_NAME,
    size: EXCEL_DOWNLOAD_HEADER_FONT_SZ,
    bold: true,
  };
  imgHeader.alignment = { horizontal: "center", vertical: "middle" };

  for (let i = 0; i < IMAGE_SHEET_EXPORT_HEADERS.length; i++) {
    const cell = headerRow.getCell(IMAGE_DATA_COL_START + i);
    cell.value = IMAGE_SHEET_EXPORT_HEADERS[i];
    cell.font = { name: EXCEL_DOWNLOAD_FONT_NAME, size: EXCEL_DOWNLOAD_HEADER_FONT_SZ, bold: true };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const p = line.product;
    const v = line.variant;
    const excelRowIndex = 2 + i;
    const row = ws.getRow(excelRowIndex);
    row.height = IMAGE_DATA_ROW_H;

    const dataRow = imageSheetDataRow(p, v);
    for (let j = 0; j < dataRow.length; j++) {
      row.getCell(IMAGE_DATA_COL_START + j).value = dataRow[j];
    }

    for (let c = IMAGE_DATA_COL_START; c <= IMAGE_DATA_COL_END; c++) {
      const cell = row.getCell(c);
      cell.font = { name: EXCEL_DOWNLOAD_FONT_NAME, size: EXCEL_DOWNLOAD_DATA_FONT_SZ };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      if (IMAGE_NUMBER_COLS_1BASED.includes(c) && typeof cell.value === "number" && Number.isFinite(cell.value)) {
        cell.numFmt = EXCEL_COMMA_NUMBER_NUMFMT;
      }
    }

    try {
      const thumbBuf = await fetchProductImageThumbnailForExcel(p, requestOrigin);

      if (thumbBuf && thumbBuf.length > 0) {
        // @ts-expect-error exceljs `addImage` Buffer 타입이 Node 20+ generic Buffer와 맞지 않음(런타임은 정상)
        const imageId = workbook.addImage({ buffer: thumbBuf, extension: "jpeg" });
        const zr = excelRowIndex - 1;
        const zc = IMAGE_ANCHOR_COL - 1;
        const extPx = productStockExcelImageSquareExtPx();
        /** oneCellAnchor + 고정 ext: 행 높이를 키우지 않고도 정사각으로 보이게 함 */
        const imageRange = {
          editAs: "oneCell" as const,
          tl: productStockExcelImageOneCellTlNative(zc, zr),
          ext: { width: extPx, height: extPx },
        };
        ws.addImage(imageId, imageRange as unknown as Parameters<ExcelJS.Worksheet["addImage"]>[1]);
      } else {
        writeNoImageCell(row);
      }
    } catch (e) {
      console.warn("[productStockExcel] 이미지 행 삽입 실패, NO IMAGE로 대체합니다.", p.sku, e);
      writeNoImageCell(row);
    }
  }

  const imageSheetColCount = IMAGE_DATA_COL_END;
  const comma0based = IMAGE_NUMBER_COLS_1BASED.map((c) => c - 1);
  const acc = new ExcelColumnWidthAccumulator(imageSheetColCount, comma0based);
  acc.consider(0, "이미지");
  acc.consider(0, "NO IMAGE");
  for (let i = 0; i < IMAGE_SHEET_EXPORT_HEADERS.length; i++) {
    acc.consider(IMAGE_DATA_COL_START + i - 1, IMAGE_SHEET_EXPORT_HEADERS[i]);
  }
  for (const line of lines) {
    const cells = imageSheetDataRow(line.product, line.variant);
    for (let j = 0; j < cells.length; j++) {
      acc.consider(IMAGE_DATA_COL_START + j - 1, cells[j]);
    }
  }
  const fixedCols = new Map<number, number>([[IMAGE_ANCHOR_COL - 1, PRODUCT_STOCK_EXCEL_IMAGE_COL_WCH]]);
  const wchs = acc.toCols(fixedCols, { minWch: 2, pad: 0.75, maxWch: EXCEL_COL_WCH_MAX });
  for (let c = 0; c < imageSheetColCount; c++) {
    ws.getColumn(c + 1).width = wchs[c].wch;
  }
}
