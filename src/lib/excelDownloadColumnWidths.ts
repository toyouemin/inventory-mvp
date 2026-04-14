import { PRODUCT_STOCK_XLSX_COMMA_NUMBER_COLS } from "@/lib/excelDownloadFont";

/** 이미지·URL 열 고정 폭 (wch) */
export const EXCEL_IMAGE_URL_FIXED_WCH = 14;

/** URL 제외 열: 자동 폭 하한/상한 (과도한 폭 방지) */
export const EXCEL_COL_WCH_MIN = 10;
export const EXCEL_COL_WCH_MAX = 48;

/**
 * Excel 열 너비(wch) 추정: ASCII 1단위, 그 외(한글 등) 2단위.
 */
export function excelDisplayWidthUnits(text: string): number {
  let u = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x0020 && cp <= 0x007e) u += 1;
    else if (cp === 0x0a || cp === 0x0d) continue;
    else u += 2;
  }
  return u;
}

function valueToWidthString(value: unknown, col: number, commaNumberCols: ReadonlySet<number>): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    if (commaNumberCols.has(col)) {
      return Math.trunc(value).toLocaleString("en-US");
    }
    return String(value);
  }
  return String(value);
}

/**
 * 상품/재고 엑셀: 이미지url 열만 고정폭, 나머지는 헤더·본문 표시 너비 기준(천단위 숫자 반영) + 최대폭 캡.
 */
export function buildProductStockExcelColumnWidths(
  rows: readonly (readonly unknown[])[],
  imageUrlColIndex: number,
  commaNumberCols: readonly number[] = PRODUCT_STOCK_XLSX_COMMA_NUMBER_COLS
): { wch: number }[] {
  const commaSet = new Set(commaNumberCols);
  const colCount = rows[0]?.length ?? 0;
  const cols: { wch: number }[] = [];

  for (let col = 0; col < colCount; col++) {
    if (col === imageUrlColIndex) {
      cols.push({ wch: EXCEL_IMAGE_URL_FIXED_WCH });
      continue;
    }

    let maxUnits = 0;
    for (const row of rows) {
      const s = valueToWidthString(row[col], col, commaSet);
      const w = excelDisplayWidthUnits(s);
      if (w > maxUnits) maxUnits = w;
    }

    const padded = maxUnits + 2;
    cols.push({ wch: Math.min(EXCEL_COL_WCH_MAX, Math.max(EXCEL_COL_WCH_MIN, padded)) });
  }

  return cols;
}

/** 가격표 등: 모든 열 자동폭(천단위 숫자 열 지정 가능) */
export class ExcelColumnWidthAccumulator {
  private readonly max: number[];
  private readonly commaSet: Set<number>;

  constructor(
    numCols: number,
    commaNumberCols: readonly number[] = []
  ) {
    this.max = Array.from({ length: numCols }, () => 0);
    this.commaSet = new Set(commaNumberCols);
  }

  consider(col: number, value: unknown): void {
    const s = valueToWidthString(value, col, this.commaSet);
    const w = excelDisplayWidthUnits(s);
    if (w > this.max[col]) this.max[col] = w;
  }

  /** fixedColWch: 열 인덱스 → 고정 wch (없으면 자동) */
  toCols(fixedColWch?: ReadonlyMap<number, number>): { wch: number }[] {
    const out: { wch: number }[] = [];
    for (let c = 0; c < this.max.length; c++) {
      const fixed = fixedColWch?.get(c);
      if (fixed != null) {
        out.push({ wch: fixed });
        continue;
      }
      const padded = this.max[c] + 2;
      out.push({ wch: Math.min(EXCEL_COL_WCH_MAX, Math.max(EXCEL_COL_WCH_MIN, padded)) });
    }
    return out;
  }
}
