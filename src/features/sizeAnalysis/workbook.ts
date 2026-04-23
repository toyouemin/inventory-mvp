import * as XLSX from "xlsx";
import type { WorkbookSnapshot } from "./types";

export async function readWorkbookFromFile(file: File): Promise<WorkbookSnapshot> {
  const bytes = await file.arrayBuffer();
  const ext = file.name.toLowerCase();

  if (ext.endsWith(".csv")) {
    const text = new TextDecoder("utf-8").decode(bytes);
    const rows = text
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .map((line) => line.split(",").map((v) => v.trim()));
    return { sheets: [{ name: "Sheet1", rows }] };
  }

  const wb = XLSX.read(bytes, { type: "array" });
  const sheets = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const aoa = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, blankrows: false });
    const rows = aoa.map((r) => r.map((c) => (c == null ? "" : String(c))));
    return { name, rows };
  });
  return { sheets };
}

