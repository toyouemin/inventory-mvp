import * as XLSX from "xlsx-js-style";

/** 다운로드용 엑셀 공통: Arial 11pt */
export const EXCEL_DOWNLOAD_FONT = { name: "Arial", sz: 11 } as const;

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
