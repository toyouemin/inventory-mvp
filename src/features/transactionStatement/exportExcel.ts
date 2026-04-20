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
  worksheet.eachRow((row) => {
    row.eachCell((cell) => {
      if (typeof cell.value !== "string") return;
      if (!cell.value.includes("VAT포함")) return;
      const compact = cell.value.replace(/\s+/g, "");
      if (!compact.includes("합계금액(VAT포함)")) return;

      if (showVatIncluded) {
        // 기존 템플릿 문구를 최대한 유지하고, VAT 포함 표시만 보장한다.
        cell.value = cell.value.includes("(VAT포함)")
          ? cell.value
          : cell.value.replace("합계금액", "합계금액 (VAT포함)");
      } else {
        cell.value = cell.value.replace(/\s*\(VAT포함\)/g, "");
      }
    });
  });
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
  const { supplyAmount, taxAmount } = computeSupplyAndTax(data.totalAmount);
  setCellValue(worksheet, transactionStatementTemplateMap.totals.amountKoreanText, amountToKoreanText(data.totalAmount));
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
