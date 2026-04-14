import * as XLSX from "xlsx-js-style";

/** 다운로드용 엑셀 공통 글꼴 (숫자 서식·배경·정렬 등은 건드리지 않고 font만 병합) */
export const EXCEL_DOWNLOAD_FONT_NAME = "맑은 고딕";
export const EXCEL_DOWNLOAD_HEADER_FONT_SZ = 11;
export const EXCEL_DOWNLOAD_DATA_FONT_SZ = 10;
/** 시트 전체 행 높이(pt) */
export const EXCEL_DOWNLOAD_ROW_HEIGHT_PT = 16.5;

/** 상품/재고 엑셀: stock(7) + wholesalePrice~extraPrice(8–11), 0-based */
export const PRODUCT_STOCK_XLSX_COMMA_NUMBER_COLS = [7, 8, 9, 10, 11] as const;
/** 상품/재고 엑셀: color(4), gender(5), size(6), memo(12), memo2(13), 0-based */
export const PRODUCT_STOCK_XLSX_CENTER_ALIGN_COLS = [4, 5, 6, 12, 13] as const;

export const EXCEL_COMMA_NUMBER_NUMFMT = "#,##0";

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
 * 지정 열(데이터 행만)을 숫자 타입으로 두고 numFmt `#,##0`(천단위 콤마)을 붙입니다.
 * `applyExcelDownloadFontToWorksheet`보다 먼저 호출하세요.
 */
export function applyThousandsNumberFormatToColumns(
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
          numFmt: EXCEL_COMMA_NUMBER_NUMFMT,
        },
      };
    }
  }
}

/**
 * 지정 열(헤더 포함 전체 행)에 `alignment.horizontal = "center"`를 병합 적용합니다.
 * 기존 alignment의 나머지 속성(vertical/wrapText 등)과 다른 스타일은 유지합니다.
 */
export function applyHorizontalCenterToColumns(
  ws: XLSX.WorkSheet,
  columnIndices: readonly number[]
): void {
  const ref = ws["!ref"];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (const c of columnIndices) {
      if (c < range.s.c || c > range.e.c) continue;
      const addr = XLSX.utils.encode_cell({ r, c });
      let cell = ws[addr];
      if (!cell) {
        cell = { t: "s", v: "" };
        ws[addr] = cell;
      }
      const prev = cell.s ?? {};
      const prevAlign = prev.alignment ?? {};
      cell.s = {
        ...prev,
        alignment: {
          ...prevAlign,
          horizontal: "center",
        },
      };
    }
  }
}

/**
 * 시트 `!ref` 범위: 맑은 고딕, 헤더(첫 행)=11pt·기존 bold 유지, 데이터=10pt.
 * numFmt·fill·alignment 등 `s`의 나머지는 유지하고 `font.name`·`font.sz`만 덮어씁니다.
 * 빈 칸은 `{ t: "s", v: "" }`로 채운 뒤 폰트만 맞춥니다.
 * `!rows`로 사용 범위 내 모든 행 높이를 16.5pt로 통일합니다.
 */
export function applyExcelDownloadFontToWorksheet(ws: XLSX.WorkSheet): void {
  const ref = ws["!ref"];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);
  const headerRow = range.s.r;

  for (let r = range.s.r; r <= range.e.r; r++) {
    const fontSz = r === headerRow ? EXCEL_DOWNLOAD_HEADER_FONT_SZ : EXCEL_DOWNLOAD_DATA_FONT_SZ;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      let cell = ws[addr];
      if (!cell) {
        cell = { t: "s", v: "" };
        ws[addr] = cell;
      }
      const prev = cell.s ?? {};
      const prevFont = prev.font ?? {};
      cell.s = {
        ...prev,
        font: {
          ...prevFont,
          name: EXCEL_DOWNLOAD_FONT_NAME,
          sz: fontSz,
        },
      };
    }
  }

  if (!ws["!rows"]) ws["!rows"] = [];
  const rows = ws["!rows"];
  for (let r = range.s.r; r <= range.e.r; r++) {
    rows[r] = { ...(rows[r] ?? {}), hpt: EXCEL_DOWNLOAD_ROW_HEIGHT_PT };
  }
}

export function writeStyledXlsxBuffer(wb: XLSX.WorkBook): Buffer {
  return XLSX.write(wb, {
    bookType: "xlsx",
    type: "buffer",
    cellStyles: true,
  }) as Buffer;
}
