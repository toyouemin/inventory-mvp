import * as XLSX from "xlsx";

/**
 * 첫 번째 시트를 header:1, raw:false, defval:"" 기준 2차원 배열로 읽습니다.
 */
export function readXlsxFirstSheetToAoa(buf: ArrayBuffer): unknown[][] {
  const wb = XLSX.read(buf, { type: "array" });
  if (!wb.SheetNames?.length) {
    throw new Error("엑셀 파일에 시트가 없습니다.");
  }
  const name = wb.SheetNames[0];
  const sheet = wb.Sheets[name];
  if (!sheet) {
    throw new Error("엑셀 파일에 시트가 없습니다.");
  }
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });
  if (!Array.isArray(aoa) || aoa.length === 0) {
    throw new Error("엑셀 첫 번째 시트가 비어 있습니다.");
  }
  return aoa;
}
