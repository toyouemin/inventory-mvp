import { prisma } from "@/lib/prisma";
import { detectHeaderRow, detectStructureType, suggestFieldMapping } from "./structure";
import { parseRepeatedSlots, parseSingleRowPerson, parseSizeMatrix } from "./strategies";
import type { FieldMapping, NormalizedRow, StructureType, WorkbookSnapshot } from "./types";

function sheetOrThrow(snapshot: WorkbookSnapshot, sheetName: string) {
  const sheet = snapshot.sheets.find((s) => s.name === sheetName);
  if (!sheet) throw new Error(`시트를 찾을 수 없습니다: ${sheetName}`);
  return sheet;
}

export async function createSizeAnalysisJob(args: { fileName: string; fileType: string; workbook: WorkbookSnapshot }) {
  const { workbook } = args;
  const created = await prisma.sizeAnalysisJob.create({
    data: {
      fileName: args.fileName,
      fileType: args.fileType,
      workbookSnapshot: workbook as unknown as object,
    },
  });

  if (workbook.sheets.length > 0) {
    await prisma.sizeAnalysisSheet.createMany({
      data: workbook.sheets.map((s) => ({
        jobId: created.id,
        name: s.name,
        rowCount: s.rows.length,
        colCount: Math.max(0, ...s.rows.map((r) => r.length)),
        previewRows: s.rows.slice(0, 30) as unknown as object,
      })),
    });
  }

  return created.id;
}

export async function detectStructure(jobId: string, sheetName: string) {
  const job = await prisma.sizeAnalysisJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("작업을 찾을 수 없습니다.");
  const workbook = job.workbookSnapshot as unknown as WorkbookSnapshot;
  const sheet = sheetOrThrow(workbook, sheetName);

  const headerRowIndex = detectHeaderRow(sheet.rows);
  const structureType = detectStructureType(sheet.rows, headerRowIndex);
  const mapping = suggestFieldMapping(sheet.rows, structureType, headerRowIndex);

  await prisma.sizeAnalysisSheet.updateMany({
    where: { jobId, name: sheetName },
    data: { detectedHeader: headerRowIndex, detectedType: structureType },
  });

  await prisma.sizeAnalysisJob.update({
    where: { id: jobId },
    data: { selectedSheetName: sheetName, structureType, headerRowIndex },
  });

  return { headerRowIndex, structureType, mapping, previewRows: sheet.rows.slice(0, 40) };
}

export async function saveMapping(jobId: string, sheetName: string, mapping: FieldMapping) {
  await prisma.sizeAnalysisFieldMapping.create({
    data: {
      jobId,
      sheetName,
      structureType: mapping.structureType as StructureType,
      headerRowIndex: mapping.headerRowIndex,
      mappingJson: mapping as unknown as object,
      userConfirmed: true,
    },
  });
  await prisma.sizeAnalysisJob.update({
    where: { id: jobId },
    data: { selectedSheetName: sheetName, structureType: mapping.structureType as StructureType, headerRowIndex: mapping.headerRowIndex },
  });
}

function summarize(rows: NormalizedRow[]) {
  const counts = {
    total: rows.length,
    auto_confirmed: 0,
    needs_review: 0,
    unresolved: 0,
    corrected: 0,
    excluded: 0,
  };
  let originalTotalQty = 0;
  let aggregatedTotalQty = 0;
  for (const row of rows) {
    counts[row.parseStatus] += 1;
    const qty = row.qtyParsed ?? 0;
    if (!row.excluded) {
      originalTotalQty += qty;
      aggregatedTotalQty += qty;
    }
  }
  return {
    ...counts,
    originalTotalQty,
    aggregatedTotalQty,
    verificationMatched: originalTotalQty === aggregatedTotalQty,
  };
}

export async function runAnalysis(jobId: string) {
  const job = await prisma.sizeAnalysisJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("작업을 찾을 수 없습니다.");
  if (!job.selectedSheetName) throw new Error("선택된 시트가 없습니다.");

  const mapping = await prisma.sizeAnalysisFieldMapping.findFirst({
    where: { jobId, sheetName: job.selectedSheetName },
    orderBy: { createdAt: "desc" },
  });
  if (!mapping) throw new Error("필드 매핑이 필요합니다.");
  const mappingJson = mapping.mappingJson as unknown as FieldMapping;
  const workbook = job.workbookSnapshot as unknown as WorkbookSnapshot;
  const sheet = sheetOrThrow(workbook, job.selectedSheetName);

  let rows: NormalizedRow[] = [];
  if (mappingJson.structureType === "single_row_person") rows = parseSingleRowPerson(jobId, sheet, mappingJson);
  else if (mappingJson.structureType === "repeated_slots") rows = parseRepeatedSlots(jobId, sheet, mappingJson);
  else if (mappingJson.structureType === "size_matrix") rows = parseSizeMatrix(jobId, sheet, mappingJson);
  else throw new Error("unknown 구조는 사용자 수동 매핑 확정 후 지원됩니다.");

  await prisma.sizeAnalysisRow.deleteMany({ where: { jobId } });
  if (rows.length > 0) {
    await prisma.sizeAnalysisRow.createMany({
      data: rows.map((r) => ({
        jobId,
        sourceSheet: r.sourceSheet,
        sourceRowIndex: r.sourceRowIndex,
        sourceGroupIndex: r.sourceGroupIndex,
        clubNameRaw: r.clubNameRaw,
        memberNameRaw: r.memberNameRaw,
        genderRaw: r.genderRaw,
        itemRaw: r.itemRaw,
        sizeRaw: r.sizeRaw,
        qtyRaw: r.qtyRaw,
        clubNameNormalized: r.clubNameNormalized,
        genderNormalized: r.genderNormalized,
        standardizedSize: r.standardizedSize,
        qtyParsed: r.qtyParsed,
        parseStatus: r.parseStatus,
        parseConfidence: r.parseConfidence,
        parseReason: r.parseReason,
        userCorrected: r.userCorrected,
        excluded: !!r.excluded,
        metaJson: (r.metaJson ?? {}) as unknown as object,
      })),
    });
  }

  const summary = summarize(rows);
  await prisma.sizeAnalysisJob.update({
    where: { id: jobId },
    data: { verificationJson: summary as unknown as object },
  });
  return summary;
}

