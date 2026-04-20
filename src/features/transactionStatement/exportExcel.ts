import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { Buffer } from "node:buffer";

import ExcelJS from "exceljs";

import { amountToKoreanText } from "./amountToKoreanText";
import { TRANSACTION_STATEMENT_TEMPLATE_RELATIVE_PATH, transactionStatementTemplateMap } from "./templateMap";
import type { TransactionStatementData } from "./types";

type ErrorWithCode = Error & {
  code?: string;
  errno?: number;
  syscall?: string;
  path?: string;
  cause?: unknown;
};

export class TransactionTemplateFileMissingError extends Error {
  constructor(public readonly resolvedPath: string) {
    super(`거래명세표 템플릿 파일을 찾을 수 없습니다: ${resolvedPath}`);
    this.name = "TransactionTemplateFileMissingError";
  }
}

function resolveTemplateAbsolutePath(): string {
  return path.resolve(process.cwd(), TRANSACTION_STATEMENT_TEMPLATE_RELATIVE_PATH);
}

function ensureTemplateCapacity(itemCount: number): void {
  if (itemCount > transactionStatementTemplateMap.items.maxRows) {
    throw new RangeError(
      `거래명세표 템플릿은 품목을 최대 ${transactionStatementTemplateMap.items.maxRows}개까지 지원합니다. 현재 요청: ${itemCount}개`
    );
  }
}

function parseIssueDate(issueDate: string): Date | null {
  const date = new Date(issueDate);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function setCellValue(
  worksheet: ExcelJS.Worksheet,
  cellAddress: string,
  value: string | number | Date | null
): void {
  worksheet.getCell(cellAddress).value = value ?? "";
}

function adjustVatLabelInWorksheet(worksheet: ExcelJS.Worksheet, showVatIncluded: boolean): void {
  const vatLabel = showVatIncluded ? "부가세 포함 표시" : "";
  // 템플릿에서 부가세 포함 문구 위치로 사용하는 셀(AA11)을 토글 상태에 맞춰 반영한다.
  setCellValue(worksheet, "AA11", vatLabel);

  worksheet.eachRow((row) => {
    row.eachCell((cell) => {
      if (typeof cell.value !== "string") return;
      if (!cell.value.includes("부가세 포함")) return;
      cell.value = vatLabel;
    });
  });
}

function adjustAmountKoreanFontSize(worksheet: ExcelJS.Worksheet, amountKoreanText: string): void {
  const targetCell = worksheet.getCell(transactionStatementTemplateMap.totals.amountKoreanText);
  const textLength = amountKoreanText.trim().length;

  const nextSize = textLength >= 24 ? 8 : textLength >= 20 ? 9 : textLength >= 16 ? 10 : 11;

  targetCell.font = {
    ...targetCell.font,
    size: nextSize,
  };
}

function colToNumber(col: string): number {
  let value = 0;
  for (const ch of col.toUpperCase()) {
    value = value * 26 + (ch.charCodeAt(0) - 64);
  }
  return value;
}

function parseCellAddress(address: string): { row: number; col: number } | null {
  const match = address.match(/^([A-Z]+)(\d+)$/i);
  if (!match) return null;
  return { col: colToNumber(match[1]), row: Number(match[2]) };
}

function parseRange(range: string): { s: { row: number; col: number }; e: { row: number; col: number } } | null {
  const [start, end] = range.split(":");
  if (!start || !end) return null;
  const s = parseCellAddress(start);
  const e = parseCellAddress(end);
  if (!s || !e) return null;
  return {
    s: { row: Math.min(s.row, e.row), col: Math.min(s.col, e.col) },
    e: { row: Math.max(s.row, e.row), col: Math.max(s.col, e.col) },
  };
}

function rangesIntersect(a: string, b: string): boolean {
  const ra = parseRange(a);
  const rb = parseRange(b);
  if (!ra || !rb) return false;
  return !(ra.e.row < rb.s.row || rb.e.row < ra.s.row || ra.e.col < rb.s.col || rb.e.col < ra.s.col);
}

function ensureAmountKoreanMerge(worksheet: ExcelJS.Worksheet): void {
  const targetRange = "F11:P11";
  const modelMerges = ((worksheet as unknown as { model?: { merges?: string[] } }).model?.merges ?? []).slice();

  for (const mergeRange of modelMerges) {
    if (!rangesIntersect(mergeRange, targetRange)) continue;
    try {
      worksheet.unMergeCells(mergeRange);
    } catch {
      /* 이미 해제됐거나 비정상 병합은 무시 */
    }
  }

  try {
    worksheet.mergeCells(targetRange);
  } catch {
    /* 병합 실패 시 기존 템플릿 상태 유지 */
  }
}

function computeSupplyAndTax(totalAmount: number): { supplyAmount: number; taxAmount: number } {
  const safeTotal = Number.isFinite(totalAmount) ? totalAmount : 0;
  const supplyAmount = Math.round(safeTotal / 1.1);
  const taxAmount = safeTotal - supplyAmount;
  return { supplyAmount, taxAmount };
}

function logTemplateStageError(stage: string, templatePath: string, error: unknown): void {
  const err = error instanceof Error ? (error as ErrorWithCode) : null;
  console.error("[transaction-statement:xlsx] template stage failed", {
    stage,
    templatePath,
    message: err?.message ?? String(error),
    stack: err?.stack,
    cause: err?.cause,
    code: err?.code,
    errno: err?.errno,
    syscall: err?.syscall,
    path: err?.path,
  });
}

async function buildWorkbookFromTemplateBuffer(templateBuffer: Uint8Array, templatePath: string): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  const loadInput = Buffer.from(templateBuffer) as unknown as Parameters<(typeof workbook.xlsx)["load"]>[0];
  try {
    console.info("[transaction-statement:xlsx] workbook load start", { templatePath });
    await workbook.xlsx.load(loadInput);
    console.info("[transaction-statement:xlsx] workbook load success", { templatePath });
  } catch (error) {
    logTemplateStageError("workbook.load", templatePath, error);
    throw error;
  }
  return workbook;
}

export async function exportTransactionStatementExcelFromTemplateBuffer(
  data: TransactionStatementData,
  templateBuffer: Uint8Array,
  templatePathForLog = "template-buffer"
): Promise<Uint8Array> {
  ensureTemplateCapacity(data.items.length);
  const workbook = await buildWorkbookFromTemplateBuffer(templateBuffer, templatePathForLog);

  const worksheet =
    workbook.getWorksheet(transactionStatementTemplateMap.sheetName) ??
    workbook.getWorksheet(1) ??
    (() => {
      throw new Error("거래명세표 템플릿의 시트를 찾을 수 없습니다.");
    })();

  const issueDate = parseIssueDate(data.issueDate);

  setCellValue(worksheet, transactionStatementTemplateMap.supplier.name, data.supplier.name);
  setCellValue(worksheet, transactionStatementTemplateMap.supplier.bizNo, data.supplier.bizNo ?? "");
  setCellValue(worksheet, transactionStatementTemplateMap.customer.name, data.customer.name);
  setCellValue(worksheet, transactionStatementTemplateMap.customer.bizNo, data.customer.bizNo ?? "");
  setCellValue(worksheet, transactionStatementTemplateMap.customer.representative, data.customer.representative ?? "");
  setCellValue(worksheet, transactionStatementTemplateMap.customer.address, data.customer.address ?? "");
  setCellValue(worksheet, transactionStatementTemplateMap.customer.businessType, data.customer.businessType ?? "");
  setCellValue(worksheet, transactionStatementTemplateMap.customer.businessItem, data.customer.businessItem ?? "");
  setCellValue(worksheet, transactionStatementTemplateMap.issueDate.cell, issueDate);

  for (let index = 0; index < data.items.length; index += 1) {
    const row = transactionStatementTemplateMap.items.startRow + index;
    const item = data.items[index];
    setCellValue(worksheet, `${transactionStatementTemplateMap.items.columns.month}${row}`, item.month);
    setCellValue(worksheet, `${transactionStatementTemplateMap.items.columns.day}${row}`, item.day);
    setCellValue(worksheet, `${transactionStatementTemplateMap.items.columns.name}${row}`, item.name);
    setCellValue(worksheet, `${transactionStatementTemplateMap.items.columns.spec}${row}`, item.spec);
    setCellValue(worksheet, `${transactionStatementTemplateMap.items.columns.qty}${row}`, item.qty);
    setCellValue(worksheet, `${transactionStatementTemplateMap.items.columns.unitPrice}${row}`, item.unitPrice);
    setCellValue(worksheet, `${transactionStatementTemplateMap.items.columns.amount}${row}`, item.amount);
    setCellValue(worksheet, `${transactionStatementTemplateMap.items.columns.note}${row}`, item.note);
  }

  const showVatIncluded = data.showVatIncluded !== false;
  adjustVatLabelInWorksheet(worksheet, showVatIncluded);
  ensureAmountKoreanMerge(worksheet);
  const { supplyAmount, taxAmount } = computeSupplyAndTax(data.totalAmount);
  const amountKoreanText = amountToKoreanText(data.totalAmount);
  setCellValue(worksheet, transactionStatementTemplateMap.totals.amountKoreanText, amountKoreanText);
  adjustAmountKoreanFontSize(worksheet, amountKoreanText);
  setCellValue(worksheet, transactionStatementTemplateMap.totals.amountInParentheses, data.totalAmount);
  setCellValue(worksheet, transactionStatementTemplateMap.totals.totalQty, data.totalQty);
  if (showVatIncluded) {
    setCellValue(worksheet, transactionStatementTemplateMap.totals.supplyAmount, supplyAmount);
    setCellValue(worksheet, transactionStatementTemplateMap.totals.taxAmount, taxAmount);
  } else {
    setCellValue(worksheet, transactionStatementTemplateMap.totals.supplyAmount, "");
    setCellValue(worksheet, transactionStatementTemplateMap.totals.taxAmount, "");
  }
  setCellValue(worksheet, transactionStatementTemplateMap.totals.totalAmount, data.totalAmount);
  if (transactionStatementTemplateMap.totals.footerMemo && data.footerMemo) {
    setCellValue(worksheet, transactionStatementTemplateMap.totals.footerMemo, data.footerMemo);
  }

  const output = await workbook.xlsx.writeBuffer();
  return output instanceof Uint8Array ? output : new Uint8Array(output);
}

export async function exportTransactionStatementExcel(data: TransactionStatementData): Promise<Uint8Array> {
  const templatePath = resolveTemplateAbsolutePath();
  try {
    console.info("[transaction-statement:xlsx] access start", { templatePath });
    await access(templatePath);
  } catch (error) {
    logTemplateStageError("access", templatePath, error);
    if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT") {
      throw new TransactionTemplateFileMissingError(templatePath);
    }
    throw error;
  }

  let templateBuffer: Awaited<ReturnType<typeof readFile>>;
  try {
    console.info("[transaction-statement:xlsx] readFile start", { templatePath });
    templateBuffer = await readFile(templatePath);
    console.info("[transaction-statement:xlsx] readFile success", { templatePath, byteLength: templateBuffer.byteLength });
  } catch (error) {
    logTemplateStageError("readFile", templatePath, error);
    if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT") {
      throw new TransactionTemplateFileMissingError(templatePath);
    }
    throw error;
  }

  return exportTransactionStatementExcelFromTemplateBuffer(data, templateBuffer, templatePath);
}
