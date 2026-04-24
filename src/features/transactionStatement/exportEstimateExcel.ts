import * as XLSX from "xlsx";

import type { EstimateSheetItem, EstimateSheetSupplier } from "./EstimateSheet";
import { amountToKoreanText } from "./amountToKoreanText";

type ExportEstimateExcelInput = {
  issueDate: string;
  receiverName: string;
  eventName?: string;
  memo?: string;
  vatIncluded: boolean;
  supplier: EstimateSheetSupplier;
  items: EstimateSheetItem[];
};

function toNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function exportEstimateExcel(input: ExportEstimateExcelInput): Uint8Array {
  const normalItems = input.items.filter((item) => !item.isExtra);
  const totalAmount = normalItems.reduce((sum, item) => sum + toNumber(item.quantity) * toNumber(item.unitPrice), 0);

  const rows: Array<Array<string | number>> = [];
  rows.push(["견적서"]);
  rows.push([]);
  rows.push(["견적일", input.issueDate || ""]);
  rows.push(["수신", input.receiverName || ""]);
  rows.push(["행사명", input.eventName || ""]);
  rows.push([]);
  rows.push(["공급자"]);
  rows.push(["등록번호", input.supplier.businessNumber || ""]);
  rows.push(["상호", input.supplier.companyName || "", "대표", input.supplier.ceoName || ""]);
  rows.push(["주소", input.supplier.address || ""]);
  rows.push(["전화", input.supplier.tel || "", "팩스", input.supplier.fax || ""]);
  rows.push([]);
  rows.push(["견적금액(한글)", amountToKoreanText(totalAmount)]);
  rows.push(["견적금액", totalAmount]);
  rows.push(["VAT", input.vatIncluded ? "부가세포함" : "부가세별도"]);
  rows.push([]);
  rows.push(["구분", "품명", "수량", "단위", "단가", "금액"]);

  for (const item of normalItems) {
    const amount = toNumber(item.quantity) * toNumber(item.unitPrice);
    rows.push([
      item.category || "",
      item.name || "",
      toNumber(item.quantity),
      item.unit || "개",
      toNumber(item.unitPrice),
      amount,
    ]);
  }

  rows.push([]);
  rows.push(["합계", "", "", "", "", totalAmount]);
  rows.push(["비고", input.memo || ""]);

  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "견적서");

  return XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as Uint8Array;
}
