import {
  extractSizeGenderQty,
  isLikelySizeQtyConflation,
  normalizeGender,
  normalizeSize,
  parseManualItemOrderSegment,
  parseQty,
  preprocessCell,
  splitOrderItemSegments,
} from "./normalize";
import type { FieldMapping, NormalizedRow, SheetSnapshot } from "./types";

function cell(row: string[], index?: number): string | undefined {
  if (index === undefined || index < 0 || index >= row.length) return undefined;
  const v = row[index];
  return v == null ? undefined : String(v);
}

function baseStatus(
  parsed: ReturnType<typeof extractSizeGenderQty>,
  sizeRaw: string | undefined,
  genderRaw: string | undefined,
  qtyRaw: string | undefined
): Pick<NormalizedRow, "genderNormalized" | "standardizedSize" | "qtyParsed" | "parseStatus" | "parseConfidence" | "parseReason"> {
  const qtyFromRaw = parseQty(qtyRaw);
  const gender = parsed.gender ?? normalizeGender(genderRaw);
  const qty = parsed.qty ?? qtyFromRaw;
  const size = parsed.size ?? extractSizeGenderQty(sizeRaw).size;
  return {
    genderNormalized: gender,
    standardizedSize: size,
    qtyParsed: qty,
    parseStatus: parsed.status,
    parseConfidence: parsed.confidence,
    parseReason: parsed.reason,
  };
}

function pickQtyForSingleRowPerson(
  hasQtyColumn: boolean,
  qtyRaw: string | undefined,
  parsed: ReturnType<typeof extractSizeGenderQty>,
  standardizedSize: string | undefined
): { qty: number; parseStatus: NormalizedRow["parseStatus"]; parseConfidence: number; parseReason: string } {
  if (hasQtyColumn) {
    const q = parseQty(qtyRaw);
    const qty = q != null && Number.isFinite(q) && q > 0 ? q : 1;
    const ok = !!standardizedSize;
    return {
      qty,
      parseStatus: ok ? "auto_confirmed" : (parsed.status as NormalizedRow["parseStatus"]),
      parseConfidence: ok ? 0.9 : parsed.confidence,
      parseReason: ok ? "열 분리(사이즈/수량)" : parsed.reason,
    };
  }
  let q = parsed.qty;
  if (isLikelySizeQtyConflation(standardizedSize, q)) {
    q = undefined;
  }
  const qty = q != null && q > 0 ? q : 1;
  return {
    qty,
    parseStatus: parsed.status,
    parseConfidence: parsed.confidence,
    parseReason: parsed.reason,
  };
}

export function parseSingleRowPerson(jobId: string, sheet: SheetSnapshot, mapping: FieldMapping): NormalizedRow[] {
  const out: NormalizedRow[] = [];
  const start = mapping.headerRowIndex + 1;
  const hasQtyColumn = mapping.fields.qty !== undefined;
  for (let i = start; i < sheet.rows.length; i += 1) {
    const row = sheet.rows[i] ?? [];
    const nameRaw = cell(row, mapping.fields.name);
    const sizeRaw = cell(row, mapping.fields.size);
    const qtyRaw = cell(row, mapping.fields.qty);
    const genderRaw = cell(row, mapping.fields.gender);
    const itemRaw = cell(row, mapping.fields.item);
    const empty = !preprocessCell(nameRaw) && !preprocessCell(sizeRaw) && !preprocessCell(qtyRaw);
    if (empty) {
      out.push({
        jobId,
        sourceSheet: sheet.name,
        sourceRowIndex: i,
        clubNameRaw: cell(row, mapping.fields.club),
        memberNameRaw: nameRaw,
        genderRaw,
        itemRaw: cell(row, mapping.fields.item),
        sizeRaw,
        qtyRaw,
        clubNameNormalized: preprocessCell(cell(row, mapping.fields.club)),
        userCorrected: false,
        excluded: true,
        parseStatus: "excluded",
        parseConfidence: 1,
        parseReason: "빈 행 제외",
      });
      continue;
    }

    if (hasQtyColumn) {
      // 수량 열이 있을 때: 성별+사이즈만 합쳐 파싱(수량은 qty 열만 사용; 합쳐 넣으면 95가 수량으로 잡힘)
      const sizeInput = [genderRaw, sizeRaw].filter((x) => preprocessCell(x)).join(" ");
      const parsed = extractSizeGenderQty(sizeInput);
      const standardizedSize = parsed.size ?? normalizeSize(sizeRaw);
      const { qty, parseStatus, parseConfidence, parseReason } = pickQtyForSingleRowPerson(true, qtyRaw, parsed, standardizedSize);
      out.push({
        jobId,
        sourceSheet: sheet.name,
        sourceRowIndex: i,
        clubNameRaw: cell(row, mapping.fields.club),
        memberNameRaw: nameRaw,
        genderRaw,
        itemRaw: cell(row, mapping.fields.item),
        sizeRaw,
        qtyRaw,
        clubNameNormalized: preprocessCell(cell(row, mapping.fields.club)),
        genderNormalized: parsed.gender ?? normalizeGender(genderRaw),
        standardizedSize,
        qtyParsed: qty,
        parseStatus,
        parseConfidence,
        parseReason,
        userCorrected: false,
        excluded: false,
      });
    } else {
      // 수량 열 없을 때: item까지 합쳐 텍스트 파싱, 사이즈=수량 혼동은 보정
      const full = [genderRaw, sizeRaw, itemRaw].filter((x) => preprocessCell(x)).join(" ");
      const parsedFull = extractSizeGenderQty(full);
      const standardizedSize = parsedFull.size ?? normalizeSize(sizeRaw);
      const { qty, parseStatus, parseConfidence, parseReason } = pickQtyForSingleRowPerson(false, undefined, parsedFull, standardizedSize);
      out.push({
        jobId,
        sourceSheet: sheet.name,
        sourceRowIndex: i,
        clubNameRaw: cell(row, mapping.fields.club),
        memberNameRaw: nameRaw,
        genderRaw,
        itemRaw: cell(row, mapping.fields.item),
        sizeRaw,
        qtyRaw,
        clubNameNormalized: preprocessCell(cell(row, mapping.fields.club)),
        genderNormalized: parsedFull.gender ?? normalizeGender(genderRaw),
        standardizedSize,
        qtyParsed: qty,
        parseStatus,
        parseConfidence,
        parseReason,
        userCorrected: false,
        excluded: false,
      });
    }
  }
  return out;
}

export function parseRepeatedSlots(jobId: string, sheet: SheetSnapshot, mapping: FieldMapping): NormalizedRow[] {
  const out: NormalizedRow[] = [];
  const start = mapping.headerRowIndex + 1;
  const groups = mapping.slotGroups ?? [];
  for (let i = start; i < sheet.rows.length; i += 1) {
    const row = sheet.rows[i] ?? [];
    groups.forEach((g, groupIndex) => {
      const nameRaw = cell(row, g.name);
      const sizeRaw = cell(row, g.size);
      const qtyRaw = cell(row, g.qty);
      const genderRaw = cell(row, g.gender);
      const parsed = extractSizeGenderQty([genderRaw, sizeRaw, qtyRaw].filter(Boolean).join(" "));
      const empty = !preprocessCell(nameRaw) && !preprocessCell(sizeRaw) && !preprocessCell(qtyRaw);
      out.push({
        jobId,
        sourceSheet: sheet.name,
        sourceRowIndex: i,
        sourceGroupIndex: groupIndex,
        clubNameRaw: cell(row, g.club),
        memberNameRaw: nameRaw,
        genderRaw,
        itemRaw: cell(row, g.item),
        sizeRaw,
        qtyRaw,
        clubNameNormalized: preprocessCell(cell(row, g.club)),
        userCorrected: false,
        excluded: empty,
        ...(empty
          ? { parseStatus: "excluded", parseConfidence: 1, parseReason: "빈 슬롯 제외" as const }
          : baseStatus(parsed, sizeRaw, genderRaw, qtyRaw)),
      });
    });
  }
  return out;
}

/**
 * structureType: unknown + 사용자가 이름/클럽/item(주문내용) 열을 지정한 경우.
 * item 셀을 `/, 쉼표, 줄바꿈`으로 나눈 뒤 각 토막을 주문 1행으로 정규화합니다.
 */
export function parseUnknownManualItem(jobId: string, sheet: SheetSnapshot, mapping: FieldMapping): NormalizedRow[] {
  const out: NormalizedRow[] = [];
  const nameCol = mapping.fields.name;
  const clubCol = mapping.fields.club;
  const itemCol = mapping.fields.item;
  if (nameCol === undefined || clubCol === undefined || itemCol === undefined) {
    return out;
  }

  const start = mapping.headerRowIndex + 1;
  for (let i = start; i < sheet.rows.length; i += 1) {
    const row = sheet.rows[i] ?? [];
    const nameRaw = cell(row, nameCol);
    const clubRaw = cell(row, clubCol);
    const itemText = cell(row, itemCol) ?? "";
    const allEmpty = !preprocessCell(nameRaw) && !preprocessCell(clubRaw) && !preprocessCell(itemText);
    if (allEmpty) {
      out.push({
        jobId,
        sourceSheet: sheet.name,
        sourceRowIndex: i,
        memberNameRaw: nameRaw,
        clubNameRaw: clubRaw,
        itemRaw: itemText,
        userCorrected: false,
        excluded: true,
        parseStatus: "excluded",
        parseConfidence: 1,
        parseReason: "빈 행 제외",
      });
      continue;
    }
    if (!preprocessCell(itemText)) {
      out.push({
        jobId,
        sourceSheet: sheet.name,
        sourceRowIndex: i,
        sourceGroupIndex: 0,
        memberNameRaw: nameRaw,
        clubNameRaw: clubRaw,
        itemRaw: itemText,
        clubNameNormalized: preprocessCell(clubRaw),
        parseStatus: "needs_review",
        parseConfidence: 0.32,
        parseReason: "주문내용(품목) 셀 없음",
        userCorrected: false,
        excluded: false,
      });
      continue;
    }

    const segments = splitOrderItemSegments(itemText);
    if (segments.length === 0) {
      out.push({
        jobId,
        sourceSheet: sheet.name,
        sourceRowIndex: i,
        sourceGroupIndex: 0,
        memberNameRaw: nameRaw,
        clubNameRaw: clubRaw,
        itemRaw: itemText,
        clubNameNormalized: preprocessCell(clubRaw),
        parseStatus: "unresolved",
        parseConfidence: 0.1,
        parseReason: "주문 토막을 나눌 수 없음",
        userCorrected: false,
        excluded: false,
      });
      continue;
    }

    segments.forEach((seg, groupIndex) => {
      const piece = parseManualItemOrderSegment(seg);
      const gRaw = koreanGenderAtStart(seg) ?? piece.gender;
      out.push({
        jobId,
        sourceSheet: sheet.name,
        sourceRowIndex: i,
        sourceGroupIndex: groupIndex,
        clubNameRaw: clubRaw,
        memberNameRaw: nameRaw,
        genderRaw: gRaw,
        itemRaw: seg,
        sizeRaw: seg,
        qtyRaw: piece.qty != null ? String(piece.qty) : seg,
        clubNameNormalized: preprocessCell(clubRaw),
        genderNormalized: piece.gender ?? normalizeGender(seg),
        standardizedSize: piece.size,
        qtyParsed: piece.qty,
        parseStatus: piece.status,
        parseConfidence: piece.confidence,
        parseReason: piece.reason,
        userCorrected: false,
        excluded: false,
        metaJson: { strategy: "unknown_manual_item" as const },
      });
    });
  }
  return out;
}

function koreanGenderAtStart(raw: string | undefined): string | undefined {
  if (raw == null) return undefined;
  const t = String(raw).trim();
  if (/^남/i.test(t)) return "남";
  if (/^여/i.test(t)) return "여";
  if (/^공용/i.test(t)) return "공용";
  return undefined;
}

export function parseSizeMatrix(jobId: string, sheet: SheetSnapshot, mapping: FieldMapping): NormalizedRow[] {
  const out: NormalizedRow[] = [];
  const header = sheet.rows[mapping.headerRowIndex] ?? [];
  const start = mapping.headerRowIndex + 1;
  const sizeCols = header
    .map((h, idx) => ({ h: preprocessCell(h), idx }))
    .filter((x) => /^(80|85|90|95|100|105|110|115|120|XS|S|M|L|XL|2XL|3XL|4XL|FREE)$/.test(x.h));

  for (let i = start; i < sheet.rows.length; i += 1) {
    const row = sheet.rows[i] ?? [];
    for (const s of sizeCols) {
      const qtyRaw = cell(row, s.idx);
      const qtyParsed = parseQty(qtyRaw) ?? (Number(preprocessCell(qtyRaw)) || undefined);
      const empty = qtyParsed === undefined || qtyParsed === 0;
      out.push({
        jobId,
        sourceSheet: sheet.name,
        sourceRowIndex: i,
        clubNameRaw: cell(row, mapping.fields.club),
        memberNameRaw: cell(row, mapping.fields.name),
        genderRaw: cell(row, mapping.fields.gender),
        itemRaw: cell(row, mapping.fields.item),
        sizeRaw: s.h,
        qtyRaw,
        clubNameNormalized: preprocessCell(cell(row, mapping.fields.club)),
        genderNormalized: normalizeGender(cell(row, mapping.fields.gender)),
        standardizedSize: s.h,
        qtyParsed,
        parseStatus: empty ? "excluded" : "auto_confirmed",
        parseConfidence: empty ? 1 : 0.96,
        parseReason: empty ? "0/빈 수량 제외" : "사이즈 열 기반 집계행",
        excluded: empty,
        userCorrected: false,
      });
    }
  }
  return out;
}

