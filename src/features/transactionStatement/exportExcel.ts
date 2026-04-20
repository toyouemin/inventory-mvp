import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { Buffer } from "node:buffer";

import ExcelJS from "exceljs";

import { amountToKoreanText } from "./amountToKoreanText";
import { TRANSACTION_STATEMENT_TEMPLATE_RELATIVE_PATH, transactionStatementTemplateMap } from "./templateMap";
import type { TransactionStatementData } from "./types";

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

function computeSupplyAndTax(totalAmount: number): { supplyAmount: number; taxAmount: number } {
  const safeTotal = Number.isFinite(totalAmount) ? totalAmount : 0;
  const supplyAmount = Math.round(safeTotal / 1.1);
  const taxAmount = safeTotal - supplyAmount;
  return { supplyAmount, taxAmount };
}

export async function exportTransactionStatementExcel(data: TransactionStatementData): Promise<Uint8Array> {
  ensureTemplateCapacity(data.items.length);

  const templatePath = resolveTemplateAbsolutePath();
  try {
    await access(templatePath);
  } catch {
    throw new TransactionTemplateFileMissingError(templatePath);
  }

  const workbook = new ExcelJS.Workbook();
  const templateBuffer = await readFile(templatePath);
  const loadInput = Buffer.from(templateBuffer) as unknown as Parameters<(typeof workbook.xlsx)["load"]>[0];
  await workbook.xlsx.load(loadInput);

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
