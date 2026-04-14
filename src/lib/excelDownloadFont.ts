import * as XLSX from "xlsx-js-style";

/** 다운로드용 엑셀 공통: Arial 11pt */
export const EXCEL_DOWNLOAD_FONT = { name: "Arial", sz: 11 } as const;

/** 상품/재고 엑셀: wholesalePrice, msrpPrice, salePrice, extraPrice 열(0-based) */
export const PRODUCT_STOCK_XLSX_PRICE_COLS = [8, 9, 10, 11] as const;

export const EXCEL_PRICE_NUMFMT = "#,##0";

function cellValueToFiniteNumber(cell: XLSX.CellObject): number | null {
  const v = cell.v;
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v).trim();
  if (s === "") return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * 지정 열(데이터 행만)을 숫자 타입으로 두고 천단위 콤마 서식을 붙입니다.
 * `applyExcelDownloadFontToWorksheet`보다 먼저 호출하세요.
 */
export function applyThousandsPriceFormatToColumns(
  ws: XLSX.WorkSheet,
  columnIndices: readonly number[],
  options?: { headerRowCount?: number }
): void {
  const headerRowCount = options?.headerRowCount ?? 1;
  const ref = ws["!ref"];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);
  for (let r = range.s.r + headerRowCount; r <= range.e.r; r++) {
    for (const c of columnIndices) {
      if (c < range.s.c || c > range.e.c) continue;
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (!cell) continue;
      const num = cellValueToFiniteNumber(cell);
      if (num === null) continue;
      const prevS = cell.s ?? {};
      ws[addr] = {
        t: "n",
        v: num,
        s: {
          ...prevS,
          numFmt: EXCEL_PRICE_NUMFMT,
        },
      };
    }
  }
}

/**
 * 시트 `!ref` 범위의 모든 셀에 Arial 11을 병합 적용합니다.
 * 빈 칸은 스타일만 맞추기 위해 `{ t: "s", v: "" }`로 채웁니다.
 */
export function applyExcelDownloadFontToWorksheet(ws: XLSX.WorkSheet): void {
  const ref = ws["!ref"];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      let cell = ws[addr];
      if (!cell) {
        cell = { t: "s", v: "" };
        ws[addr] = cell;
      }
      const prev = cell.s ?? {};
      cell.s = {
        ...prev,
        font: {
          ...(prev.font ?? {}),
          name: EXCEL_DOWNLOAD_FONT.name,
          sz: EXCEL_DOWNLOAD_FONT.sz,
        },
      };
    }
  }
}

export function writeStyledXlsxBuffer(wb: XLSX.WorkBook): Buffer {
  return XLSX.write(wb, {
    bookType: "xlsx",
    type: "buffer",
    cellStyles: true,
  }) as Buffer;
}
