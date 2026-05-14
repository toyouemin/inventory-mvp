import ExcelJS from "exceljs";

import { stripInvalidOneCellAnchorEditAsFromXlsxBuffer } from "@/lib/excelXlsxStripInvalidOneCellEditAs";

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

const FONT_FAMILY = "Malgun Gothic";
const LAST_COL_LETTER = "K";
const LAST_ROW = 32;

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFF2F2F2" },
};

const EDGE_THIN: ExcelJS.Border = { style: "thin", color: { argb: "FF000000" } };
const EDGE_MEDIUM: ExcelJS.Border = { style: "thin", color: { argb: "FF000000" } };

function edgeThin(cell: ExcelJS.Cell): void {
  cell.border = { top: EDGE_THIN, left: EDGE_THIN, bottom: EDGE_THIN, right: EDGE_THIN };
}

function edgeMedium(cell: ExcelJS.Cell): void {
  cell.border = {
    top: EDGE_MEDIUM,
    left: EDGE_MEDIUM,
    bottom: EDGE_MEDIUM,
    right: EDGE_MEDIUM,
  };
}

function toNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function setWorksheetPage(ws: ExcelJS.Worksheet): void {
  ws.pageSetup = {
    paperSize: 9,
    orientation: "portrait",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 1,
    margins: {
      left: 0.55,
      right: 0.55,
      top: 0.55,
      bottom: 0.55,
      header: 0.3,
      footer: 0.3,
    },
    horizontalCentered: true,
  };
  ws.views = [{ showGridLines: false }];
  ws.headerFooter.oddFooter = "";
  ws.headerFooter.oddHeader = "";
  ws.pageSetup.printArea = `A1:${LAST_COL_LETTER}${LAST_ROW}`;

  // A:B 좁게, C:D 넓게, G:H/I는 금액 가독성을 위해 넓게
  const widths = [8, 5, 8, 8, 7, 5, 8, 12, 8, 6, 6];
  for (let i = 0; i < widths.length; i += 1) {
    ws.getColumn(i + 1).width = widths[i];
  }
}

function setOuterBorderMedium(ws: ExcelJS.Worksheet): void {
  for (let r = 1; r <= LAST_ROW; r += 1) {
    for (let c = 1; c <= 11; c += 1) {
      const cell = ws.getRow(r).getCell(c);
      cell.border = {
        top: r === 1 ? EDGE_MEDIUM : EDGE_THIN,
        bottom: r === LAST_ROW ? EDGE_MEDIUM : EDGE_THIN,
        left: c === 1 ? EDGE_MEDIUM : EDGE_THIN,
        right: c === 11 ? EDGE_MEDIUM : EDGE_THIN,
      };
    }
  }
}

function mergeHeaderRow(ws: ExcelJS.Worksheet, row: number, fill = true): void {
  ws.mergeCells(`A${row}:B${row}`);
  ws.mergeCells(`C${row}:D${row}`);
  ws.mergeCells(`H${row}:I${row}`);
  ws.mergeCells(`J${row}:K${row}`);
  const labels = [
    { addr: `A${row}`, value: "구분", h: "center" as const },
    { addr: `C${row}`, value: "품명", h: "center" as const },
    { addr: `E${row}`, value: "수량", h: "center" as const },
    { addr: `F${row}`, value: "단위", h: "center" as const },
    { addr: `G${row}`, value: "단가", h: "center" as const },
    { addr: `H${row}`, value: "금액", h: "center" as const },
    { addr: `J${row}`, value: "비고", h: "center" as const },
  ];
  for (const label of labels) {
    const cell = ws.getCell(label.addr);
    cell.value = label.value;
    cell.font = { name: FONT_FAMILY, size: 10, bold: true };
    cell.alignment = { horizontal: label.h, vertical: "middle" };
    if (fill) cell.fill = HEADER_FILL;
  }
  ws.getRow(row).height = 24;
}

function mergeItemRow(ws: ExcelJS.Worksheet, row: number, item?: EstimateSheetItem): void {
  ws.mergeCells(`A${row}:B${row}`);
  ws.mergeCells(`C${row}:D${row}`);
  ws.mergeCells(`H${row}:I${row}`);
  ws.mergeCells(`J${row}:K${row}`);
  ws.getRow(row).height = 24;

  if (!item) return;

  const qty = toNumber(item.quantity);
  const unitPrice = toNumber(item.unitPrice);
  const amount = qty * unitPrice;

  ws.getCell(`A${row}`).value = item.category || "";
  ws.getCell(`A${row}`).alignment = { horizontal: "center", vertical: "middle", wrapText: false };

  ws.getCell(`C${row}`).value = item.name || "";
  ws.getCell(`C${row}`).alignment = { horizontal: "center", vertical: "middle", wrapText: false };

  ws.getCell(`E${row}`).value = qty;
  ws.getCell(`E${row}`).numFmt = "#,##0";
  ws.getCell(`E${row}`).alignment = { horizontal: "center", vertical: "middle" };

  ws.getCell(`F${row}`).value = item.unit || "개";
  ws.getCell(`F${row}`).alignment = { horizontal: "center", vertical: "middle", wrapText: false };

  ws.getCell(`G${row}`).value = unitPrice;
  ws.getCell(`G${row}`).numFmt = "#,##0";
  ws.getCell(`G${row}`).alignment = { horizontal: "right", vertical: "middle" };

  ws.getCell(`H${row}`).value = amount;
  ws.getCell(`H${row}`).numFmt = "#,##0";
  ws.getCell(`H${row}`).alignment = { horizontal: "right", vertical: "middle" };

  ws.getCell(`J${row}`).value = item.note || "";
  ws.getCell(`J${row}`).alignment = { horizontal: "center", vertical: "middle", wrapText: false };
}

export async function exportEstimateExcel(input: ExportEstimateExcelInput): Promise<Uint8Array> {
  const normalItems = input.items.filter((item) => !item.isExtra).slice(0, 5);
  const extraItems = input.items.filter((item) => item.isExtra).slice(0, 5);
  const totalAmount = normalItems.reduce((sum, item) => sum + toNumber(item.quantity) * toNumber(item.unitPrice), 0);

  const supplierTel = input.supplier.tel?.trim() || "032-468-0351";
  const supplierFax = input.supplier.fax?.trim() || "032-468-0332";

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("견적서", { properties: { defaultRowHeight: 21 } });

  setWorksheetPage(ws);

  ws.mergeCells("A1:K1");
  const titleCell = ws.getCell("A1");
  titleCell.value = "견 적 서";
  titleCell.font = { name: FONT_FAMILY, size: 23, bold: true };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 40;

  ws.getCell("A2").value = "견적일";
  ws.getCell("A2").font = { name: FONT_FAMILY, size: 10 };
  ws.getCell("A2").alignment = { horizontal: "center", vertical: "middle", wrapText: false };
  ws.mergeCells("B2:E2");
  ws.getCell("B2").value = input.issueDate || "";
  ws.getCell("B2").font = { name: FONT_FAMILY, size: 10 };
  ws.getCell("B2").alignment = { horizontal: "left", vertical: "middle", wrapText: false };

  ws.getCell("A3").value = "수신";
  ws.getCell("A3").font = { name: FONT_FAMILY, size: 10 };
  ws.getCell("A3").alignment = { horizontal: "center", vertical: "middle", wrapText: false };
  ws.mergeCells("B3:E3");
  ws.getCell("B3").value = input.receiverName || "";
  ws.getCell("B3").font = { name: FONT_FAMILY, size: 12, bold: true, underline: true };
  ws.getCell("B3").alignment = { horizontal: "left", vertical: "middle", wrapText: false };

  ws.getCell("A4").value = "행사명";
  ws.getCell("A4").font = { name: FONT_FAMILY, size: 10 };
  ws.getCell("A4").alignment = { horizontal: "center", vertical: "middle", wrapText: false };
  ws.mergeCells("B4:E4");
  ws.getCell("B4").value = input.eventName || "";
  ws.getCell("B4").font = { name: FONT_FAMILY, size: 10 };
  ws.getCell("B4").alignment = { horizontal: "left", vertical: "middle", wrapText: false };

  ws.mergeCells("A5:E5");
  ws.getCell("A5").value = "";

  ws.mergeCells("F2:F5");
  const supLabel = ws.getCell("F2");
  supLabel.value = "공\n급\n자";
  supLabel.font = { name: FONT_FAMILY, size: 10, bold: true };
  supLabel.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  supLabel.fill = HEADER_FILL;

  ws.getCell("G2").value = "등록번호";
  ws.getCell("G2").font = { name: FONT_FAMILY, size: 10 };
  ws.getCell("G2").alignment = { horizontal: "center", vertical: "middle" };
  ws.getCell("G2").fill = HEADER_FILL;
  ws.mergeCells("H2:K2");
  ws.getCell("H2").value = input.supplier.businessNumber || "";
  ws.getCell("H2").font = { name: FONT_FAMILY, size: 10 };
  ws.getCell("H2").alignment = { horizontal: "left", vertical: "middle", wrapText: false };

  ws.getCell("G3").value = "상호";
  ws.getCell("G3").font = { name: FONT_FAMILY, size: 10 };
  ws.getCell("G3").alignment = { horizontal: "center", vertical: "middle" };
  ws.getCell("G3").fill = HEADER_FILL;
  ws.getCell("H3").value = input.supplier.companyName || "";
  ws.getCell("H3").font = { name: FONT_FAMILY, size: 10 };
  ws.getCell("H3").alignment = { horizontal: "center", vertical: "middle", wrapText: false };
  ws.getCell("I3").value = "대표";
  ws.getCell("I3").font = { name: FONT_FAMILY, size: 10 };
  ws.getCell("I3").alignment = { horizontal: "center", vertical: "middle" };
  ws.getCell("I3").fill = HEADER_FILL;
  ws.mergeCells("J3:K3");
  ws.getCell("J3").value = `${input.supplier.ceoName || ""} (인)`;
  ws.getCell("J3").font = { name: FONT_FAMILY, size: 10 };
  ws.getCell("J3").alignment = { horizontal: "center", vertical: "middle", wrapText: false };
  ws.getRow(2).height = 23;
  ws.getRow(3).height = 23;
  ws.getRow(4).height = 23;
  ws.getRow(5).height = 23;

  const wj = toNumber(ws.getColumn(10).width) || 6;
  const wk = toNumber(ws.getColumn(11).width) || 6;
  const PX_PER_WIDTH_UNIT = 7;
  const mergeJpKpx = (wj + wk) * PX_PER_WIDTH_UNIT;
  const stampExt = { width: 52, height: 52 };
  const stampLeftColFrac =
    mergeJpKpx > stampExt.width ? (mergeJpKpx - stampExt.width) / mergeJpKpx : 0;
  /** 열 단위로 오른쪽 미세 이동 (~1px 수준은 0.02~0.05) */
  const STAMP_COL_OFFSET_RIGHT = 0.07;

  try {
    const stampResponse = await fetch("/stamp.png");
    if (stampResponse.ok) {
      const stampBuffer = new Uint8Array(await stampResponse.arrayBuffer());
      const stampImageId = wb.addImage({
        buffer: stampBuffer as any,
        extension: "png",
      });
      const tlCol = 9 + stampLeftColFrac + STAMP_COL_OFFSET_RIGHT;
      ws.addImage(stampImageId, {
        tl: { col: tlCol, row: 2.06 },
        ext: stampExt,
      });
    }
  } catch {
    /* 이미지 로드 실패 또는 drawing 오류 시 무시 */
  }

  ws.getCell("G4").value = "주소";
  ws.getCell("G4").font = { name: FONT_FAMILY, size: 10 };
  ws.getCell("G4").alignment = { horizontal: "center", vertical: "middle" };
  ws.getCell("G4").fill = HEADER_FILL;
  ws.mergeCells("H4:K4");
  ws.getCell("H4").value = input.supplier.address || "";
  ws.getCell("H4").font = { name: FONT_FAMILY, size: 10 };
  ws.getCell("H4").alignment = { horizontal: "left", vertical: "middle", wrapText: false };

  ws.getCell("G5").value = "전화";
  ws.getCell("G5").font = { name: FONT_FAMILY, size: 10 };
  ws.getCell("G5").alignment = { horizontal: "center", vertical: "middle" };
  ws.getCell("G5").fill = HEADER_FILL;
  ws.getCell("H5").value = supplierTel;
  ws.getCell("H5").font = { name: FONT_FAMILY, size: 10 };
  ws.getCell("H5").alignment = { horizontal: "center", vertical: "middle", wrapText: false };
  ws.getCell("I5").value = "팩스";
  ws.getCell("I5").font = { name: FONT_FAMILY, size: 10 };
  ws.getCell("I5").alignment = { horizontal: "center", vertical: "middle" };
  ws.getCell("I5").fill = HEADER_FILL;
  ws.mergeCells("J5:K5");
  ws.getCell("J5").value = supplierFax;
  ws.getCell("J5").font = { name: FONT_FAMILY, size: 10 };
  ws.getCell("J5").alignment = { horizontal: "center", vertical: "middle", wrapText: false };

  ws.mergeCells("A6:K6");
  const noticeLine = ws.getCell("A6");
  noticeLine.value = "* 아래와 같이 견적하오니, 검토하여 주시기 바랍니다.";
  noticeLine.font = { name: FONT_FAMILY, size: 9 };
  noticeLine.alignment = { horizontal: "left", vertical: "middle", wrapText: false };
  ws.getRow(6).height = 21;

  const korean = amountToKoreanText(totalAmount);
  ws.mergeCells("A7:B7");
  const am1 = ws.getCell("A7");
  am1.value = "견적금액";
  am1.font = { name: FONT_FAMILY, size: 12, bold: true };
  am1.fill = HEADER_FILL;
  am1.alignment = { horizontal: "center", vertical: "middle" };
  ws.mergeCells("C7:G7");
  const am2 = ws.getCell("C7");
  am2.value = korean;
  am2.font = { name: FONT_FAMILY, size: 14, bold: true };
  am2.alignment = { horizontal: "right", vertical: "middle", wrapText: false };
  ws.mergeCells("H7:K7");
  const am3 = ws.getCell("H7");
  const vatLabel = input.vatIncluded ? "부가세포함" : "부가세별도";
  am3.value = {
    richText: [
      {
        font: { name: FONT_FAMILY, size: 14, bold: true },
        text: `₩${totalAmount.toLocaleString("ko-KR")} `,
      },
      { font: { name: FONT_FAMILY, size: 10, bold: true }, text: vatLabel },
    ],
  };
  am3.alignment = { horizontal: "right", vertical: "middle", wrapText: false };
  ws.getRow(7).height = 28;
  edgeMedium(am1);
  edgeMedium(am2);
  edgeMedium(am3);

  mergeHeaderRow(ws, 8);
  for (let i = 0; i < 5; i += 1) mergeItemRow(ws, 9 + i, normalItems[i]);

  ws.mergeCells("A14:G14");
  const sumL = ws.getCell("A14");
  sumL.value = "용 품 합 계";
  sumL.font = { name: FONT_FAMILY, size: 10, bold: true };
  sumL.fill = HEADER_FILL;
  sumL.alignment = { horizontal: "center", vertical: "middle" };
  ws.mergeCells("H14:K14");
  const sumR = ws.getCell("H14");
  sumR.value = totalAmount;
  sumR.numFmt = "\"₩\"#,##0";
  sumR.font = { name: FONT_FAMILY, size: 12, bold: true };
  sumR.alignment = { horizontal: "right", vertical: "middle" };
  ws.getRow(14).height = 24;

  mergeHeaderRow(ws, 15);
  for (let i = 0; i < 5; i += 1) mergeItemRow(ws, 16 + i, extraItems[i]);

  ws.mergeCells("A21:K21");
  const mt = ws.getCell("A21");
  mt.value = "비고";
  mt.font = { name: FONT_FAMILY, size: 10, bold: true };
  mt.fill = HEADER_FILL;
  mt.alignment = { horizontal: "left", vertical: "middle" };
  ws.getRow(21).height = 22;

  ws.mergeCells("A22:K25");
  const mb = ws.getCell("A22");
  mb.value = input.memo ?? "";
  mb.font = { name: FONT_FAMILY, size: 10 };
  mb.alignment = { horizontal: "left", vertical: "top", wrapText: true };
  ws.getRow(22).height = 21;
  ws.getRow(23).height = 21;
  ws.getRow(24).height = 21;
  ws.getRow(25).height = 21;

  ws.mergeCells("A26:H30");
  const bank = input.supplier.bankAccount?.trim() || "신한 140-009-456830 주식회사 세림통상";
  const footTxt = ws.getCell("A26");
  footTxt.value = [
    `* 입금계좌 : ${bank}`,
    "* 세금계산서 100% 발행합니다. (카드결재시 수수료 3% 별도)",
    "* 상기 견적은 본 대회시에만 적용하며, A/S 가능합니다.",
    "* 품목은 요청 및 상황에 따라 변동 될 수 있습니다.",
    "* 문의사항은 홈페이지를 참고하시거나 본사로 연락 바랍니다.",
  ].join("\n");
  footTxt.font = { name: FONT_FAMILY, size: 10 };
  footTxt.alignment = { horizontal: "left", vertical: "middle", wrapText: true };

  ws.mergeCells("I26:K30");
  const lg = ws.getCell("I26");
  lg.value = {
    richText: [
      { font: { name: FONT_FAMILY, size: 17, bold: true }, text: "TAGO" },
      { font: { name: FONT_FAMILY, size: 10, bold: false }, text: "\nwww.tagosports.co.kr" },
    ],
  };
  lg.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  ws.getRow(26).height = 20;
  ws.getRow(27).height = 20;
  ws.getRow(28).height = 20;
  ws.getRow(29).height = 20;
  ws.getRow(30).height = 20;

  ws.mergeCells("A31:K31");
  ws.getCell("A31").value = "";
  ws.getRow(31).height = 6;

  ws.mergeCells("A32:E32");
  const mgr = ws.getCell("A32");
  mgr.value = `담당자 : ${input.supplier.managerName?.trim() || ""}`;
  mgr.font = { name: FONT_FAMILY, size: 10 };
  mgr.alignment = { horizontal: "left", vertical: "middle", wrapText: false };
  mgr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } };
  ws.mergeCells("F32:K32");
  const ph = ws.getCell("F32");
  ph.value = `연락처 : ${input.supplier.managerPhone?.trim() || ""}`;
  ph.font = { name: FONT_FAMILY, size: 10 };
  ph.alignment = { horizontal: "left", vertical: "middle", wrapText: false };
  ws.getRow(32).height = 22;

  for (let r = 1; r <= LAST_ROW; r += 1) {
    for (let c = 1; c <= 11; c += 1) {
      const cell = ws.getRow(r).getCell(c);
      if (!cell.font) cell.font = { name: FONT_FAMILY, size: 10 };
      if (!cell.alignment) cell.alignment = { horizontal: "center", vertical: "middle" };
      edgeThin(cell);
    }
  }
  setOuterBorderMedium(ws);

  ws.getCell("A26").alignment = { horizontal: "left", vertical: "middle", wrapText: true };

  const raw = new Uint8Array(await wb.xlsx.writeBuffer());
  return stripInvalidOneCellAnchorEditAsFromXlsxBuffer(raw);
}
