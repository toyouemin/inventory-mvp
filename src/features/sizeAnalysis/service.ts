import { prisma } from "@/lib/prisma";
import { sanitizeForPrismaJson } from "@/lib/sanitizeForPrismaJson";
import { detectHeaderRow, detectStructureType, extractPeopleFromRows, suggestFieldMapping } from "./structure";
import { parseRepeatedSlots, parseSingleRowPerson, parseSizeMatrix, parseUnknownManualItem } from "./strategies";
import { preprocessCell } from "./normalize";
import { applyDuplicateSizePolicy, normalizePersonSizePolicy } from "./personSizePolicy";
import type { FieldMapping, NormalizedRow, PersonRecord, StructureType, WorkbookSnapshot } from "./types";

function sheetOrThrow(snapshot: WorkbookSnapshot, sheetName: string) {
  const sheet = snapshot.sheets.find((s) => s.name === sheetName);
  if (!sheet) throw new Error(`시트를 찾을 수 없습니다: ${sheetName}`);
  return sheet;
}

function buildPeopleWorkbook(workbook: WorkbookSnapshot): WorkbookSnapshot {
  return {
    sheets: workbook.sheets.map((sheet) => {
      const headerRowIndex = detectHeaderRow(sheet.rows);
      const structureType = detectStructureType(sheet.rows, headerRowIndex);
      const mapping = suggestFieldMapping(sheet.rows, structureType, headerRowIndex);
      const people = extractPeopleFromRows(sheet.rows, mapping).map((person) => ({
        club: person.club ?? "",
        name: person.name ?? "",
        gender: person.gender ?? "",
        size: person.size ?? "",
      }));
      return {
        ...sheet,
        people,
      };
    }),
  };
}

function normalizedRowsFromPeople(jobId: string, sheetName: string, people: PersonRecord[]): NormalizedRow[] {
  return people.map((person, idx) => {
    const pol = normalizePersonSizePolicy(person.size, person.gender);
    return {
      jobId,
      sourceSheet: sheetName,
      sourceRowIndex: idx,
      clubNameRaw: person.club,
      memberNameRaw: person.name,
      memberName: person.name,
      genderRaw: person.gender,
      sizeRaw: person.size,
      qtyRaw: "1",
      clubNameNormalized: preprocessCell(person.club),
      genderNormalized: pol.genderNormalized,
      standardizedSize: pol.standardizedSize,
      qtyParsed: 1,
      parseStatus: pol.parseStatus,
      parseConfidence: pol.parseConfidence,
      parseReason: pol.parseReason,
      userCorrected: false,
      excluded: false,
    };
  });
}

export async function createSizeAnalysisJob(args: { fileName: string; fileType: string; workbook: WorkbookSnapshot }) {
  const workbookWithPeople = buildPeopleWorkbook(args.workbook);
  // sheets.rows·people·mapping 전체: Prisma JSON에 `undefined`가 남지 않도록 최종 1회 deep sanitize
  const workbookSnapshot = sanitizeForPrismaJson(workbookWithPeople);
  const created = await prisma.sizeAnalysisJob.create({
    data: {
      fileName: args.fileName,
      fileType: args.fileType,
      workbookSnapshot,
    },
  });

  if (workbookWithPeople.sheets.length > 0) {
    await prisma.sizeAnalysisSheet.createMany({
      data: workbookWithPeople.sheets.map((s) => ({
        jobId: created.id,
        name: s.name,
        rowCount: s.rows.length,
        colCount: Math.max(0, ...s.rows.map((r) => r.length)),
        previewRows: sanitizeForPrismaJson(s.rows.slice(0, 30)),
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
      mappingJson: sanitizeForPrismaJson(mapping),
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
    // 원본 총수량은 중복/제외 여부와 무관하게 모든 유효 행 qty 합
    originalTotalQty += qty;
    if (!row.excluded) aggregatedTotalQty += qty;
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
  const people = (sheet.people ?? []).map((p) => ({
    club: p.club ?? "",
    name: p.name ?? "",
    gender: p.gender ?? "",
    size: p.size ?? "",
  }));

  let rows: NormalizedRow[] = [];
  if (mappingJson.structureType === "single_row_person") {
    rows = people.length > 0 ? normalizedRowsFromPeople(jobId, sheet.name, people) : parseSingleRowPerson(jobId, sheet, mappingJson);
  } else if (mappingJson.structureType === "repeated_slots") {
    rows = people.length > 0 ? normalizedRowsFromPeople(jobId, sheet.name, people) : parseRepeatedSlots(jobId, sheet, mappingJson);
  } else if (mappingJson.structureType === "size_matrix") rows = parseSizeMatrix(jobId, sheet, mappingJson);
  else if (mappingJson.structureType === "unknown") {
    const f = mappingJson.fields;
    const hasSizeColumn = f.size !== undefined || f.size2 !== undefined;
    if (f.name === undefined) {
      throw new Error("unknown 구조에서는 이름 열이 지정된 뒤 매핑을 저장해 주세요.");
    }
    if (hasSizeColumn) {
      // size 열이 있으면 qty 열이 없어도(기본 1) 주문내용 파싱 없이 단일행 파서로 처리 가능.
      rows = parseSingleRowPerson(jobId, sheet, mappingJson);
    } else {
      if (f.item === undefined) {
        throw new Error("unknown 구조에서는 사이즈 열이 없을 때 주문내용(품목) 열이 필요합니다.");
      }
      rows = parseUnknownManualItem(jobId, sheet, mappingJson);
    }
  } else {
    throw new Error("지원하지 않는 structureType 입니다.");
  }

  const structureType = mappingJson.structureType;
  rows = rows.map((r) => {
    const nameMissing = String(r.memberNameRaw ?? r.memberName ?? "").trim() === "";
    if (nameMissing && !r.excluded) {
      return {
        ...r,
        parseStatus: "needs_review" as const,
        parseReason: "이름 없음",
        parseConfidence: Math.min(Number(r.parseConfidence ?? 0), 0.35),
        metaJson: { ...(r.metaJson ?? {}), structureType },
      };
    }
    return {
      ...r,
      metaJson: { ...(r.metaJson ?? {}), structureType },
    };
  });
  // size_matrix만 클럽+이름+사이즈 중복 / 그 외는 클럽+이름만(기존). 0/빈 제외는 size_matrix에서만 중복 판별 제외.
  rows = applyDuplicateSizePolicy(rows, structureType);

  await prisma.sizeAnalysisRow.deleteMany({ where: { jobId } });
  if (rows.length > 0) {
    await prisma.sizeAnalysisRow.createMany({
      data: rows.map((r) => ({
        jobId,
        sourceSheet: r.sourceSheet,
        sourceRowIndex: r.sourceRowIndex,
        sourceGroupIndex: r.sourceGroupIndex ?? null,
        clubNameRaw: r.clubNameRaw ?? null,
        memberNameRaw: r.memberNameRaw ?? null,
        genderRaw: r.genderRaw ?? null,
        itemRaw: r.itemRaw ?? null,
        sizeRaw: r.sizeRaw ?? null,
        qtyRaw: r.qtyRaw ?? null,
        clubNameNormalized: r.clubNameNormalized ?? null,
        genderNormalized: r.genderNormalized ?? null,
        standardizedSize: r.standardizedSize ?? null,
        qtyParsed: r.qtyParsed ?? null,
        parseStatus: r.parseStatus,
        parseConfidence: r.parseConfidence,
        parseReason: r.parseReason ?? null,
        userCorrected: r.userCorrected,
        excluded: !!r.excluded,
        excludeReason: r.excludeReason ?? null,
        excludeDetail: r.excludeDetail ?? null,
        metaJson: sanitizeForPrismaJson(r.metaJson ?? {}),
      })),
    });
  }

  const summary = summarize(rows);
  await prisma.sizeAnalysisJob.update({
    where: { id: jobId },
    data: { verificationJson: sanitizeForPrismaJson(summary) },
  });
  return summary;
}

