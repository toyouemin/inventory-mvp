import {
  extractSizeGenderQty,
  isLikelySizeQtyConflation,
  normalizeGender,
  parseManualItemOrderSegment,
  parseQty,
  preprocessCell,
  splitOrderItemSegments,
} from "./normalize";
import { normalizePersonSizePolicy, normalizePersonWithFallback } from "./personSizePolicy";
import type { FieldMapping, NormalizedRow, SheetSnapshot } from "./types";

function cell(row: string[], index?: number): string | undefined {
  if (index === undefined || index < 0 || index >= row.length) return undefined;
  const v = row[index];
  return v == null ? undefined : String(v);
}

/** club/name/gender/size/qty가 모두 비어 있으면 완전 빈 행으로 간주 */
function isCoreFieldsAllEmpty(args: {
  clubRaw?: string;
  nameRaw?: string;
  genderRaw?: string;
  sizeRaw?: string;
  qtyRaw?: string;
}): boolean {
  return (
    !preprocessCell(args.clubRaw) &&
    !preprocessCell(args.nameRaw) &&
    !preprocessCell(args.genderRaw) &&
    !preprocessCell(args.sizeRaw) &&
    !preprocessCell(args.qtyRaw)
  );
}

export function parseSingleRowPerson(jobId: string, sheet: SheetSnapshot, mapping: FieldMapping): NormalizedRow[] {
  const out: NormalizedRow[] = [];
  const start = mapping.headerRowIndex + 1;
  const hasQtyColumn = mapping.fields.qty !== undefined;
  for (let i = start; i < sheet.rows.length; i += 1) {
    const row = sheet.rows[i] ?? [];
    const clubRaw = cell(row, mapping.fields.club);
    const nameRaw = cell(row, mapping.fields.name);
    const sizeRaw = cell(row, mapping.fields.size);
    const size2Raw = cell(row, mapping.fields.size2);
    const qtyRaw = cell(row, mapping.fields.qty);
    const genderRaw = cell(row, mapping.fields.gender);
    const itemRaw = cell(row, mapping.fields.item);
    const firstNonEmptySize = preprocessCell(sizeRaw) ? sizeRaw : size2Raw;
    if (
      isCoreFieldsAllEmpty({
        clubRaw,
        nameRaw,
        genderRaw,
        sizeRaw: firstNonEmptySize,
        qtyRaw,
      })
    ) {
      // 완전 빈 행은 excluded로 저장하지 않고 아예 drop
      continue;
    }

    const sizeCells = [sizeRaw, size2Raw];
    const seenSizeRaw = new Set<string>();
    const normalizedSizeCells: Array<{ raw: string | undefined; groupIndex: number }> = [];
    sizeCells.forEach((raw, idx) => {
      const key = preprocessCell(raw);
      if (!key) return;
      if (seenSizeRaw.has(key)) return;
      seenSizeRaw.add(key);
      normalizedSizeCells.push({ raw, groupIndex: idx });
    });
    const targetSizes = normalizedSizeCells.length > 0 ? normalizedSizeCells : [{ raw: firstNonEmptySize, groupIndex: 0 }];

    if (hasQtyColumn) {
      const q = parseQty(qtyRaw);
      const qty = q != null && Number.isFinite(q) && q > 0 ? q : 1;
      targetSizes.forEach(({ raw, groupIndex }) => {
        const pol = normalizePersonSizePolicy(raw, genderRaw);
        out.push({
          jobId,
          sourceSheet: sheet.name,
          sourceRowIndex: i,
          sourceGroupIndex: groupIndex,
          clubNameRaw: clubRaw,
          memberNameRaw: nameRaw,
          memberName: nameRaw,
          genderRaw,
          itemRaw: cell(row, mapping.fields.item),
          sizeRaw: raw,
          qtyRaw,
          clubNameNormalized: preprocessCell(clubRaw),
          genderNormalized: pol.genderNormalized,
          standardizedSize: pol.standardizedSize,
          qtyParsed: qty,
          parseStatus: pol.parseStatus,
          parseConfidence: pol.parseConfidence,
          parseReason: pol.parseReason,
          userCorrected: false,
          excluded: false,
        });
      });
    } else {
      targetSizes.forEach(({ raw, groupIndex }) => {
        const full = [genderRaw, raw, itemRaw].filter((x) => preprocessCell(x)).join(" ");
        const pol = normalizePersonWithFallback(raw, genderRaw, full);
        const parsedFull = extractSizeGenderQty(full);
        let q = parsedFull.qty;
        if (isLikelySizeQtyConflation(pol.standardizedSize, q)) {
          q = undefined;
        }
        if (pol.standardizedSize && /^[MW]\d{2,3}$/i.test(pol.standardizedSize) && q != null) {
          const d = pol.standardizedSize.replace(/^[MW]/i, "");
          if (d === String(q)) {
            q = undefined;
          }
        }
        const qty = q != null && q > 0 ? q : 1;
        out.push({
          jobId,
          sourceSheet: sheet.name,
          sourceRowIndex: i,
          sourceGroupIndex: groupIndex,
          clubNameRaw: clubRaw,
          memberNameRaw: nameRaw,
          memberName: nameRaw,
          genderRaw,
          itemRaw: cell(row, mapping.fields.item),
          sizeRaw: raw,
          qtyRaw,
          clubNameNormalized: preprocessCell(clubRaw),
          genderNormalized: pol.genderNormalized ?? parsedFull.gender ?? normalizeGender(genderRaw),
          standardizedSize: pol.standardizedSize,
          qtyParsed: qty,
          parseStatus: pol.parseStatus,
          parseConfidence: pol.parseConfidence,
          parseReason: pol.parseReason,
          userCorrected: false,
          excluded: false,
        });
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
      const clubRaw = cell(row, g.club);
      const nameRaw = cell(row, g.name);
      const sizeRaw = cell(row, g.size);
      const qtyRaw = cell(row, g.qty);
      const genderRaw = cell(row, g.gender);
      const merged = [genderRaw, sizeRaw, qtyRaw].filter(Boolean).join(" ");
      const pol = normalizePersonWithFallback(sizeRaw, genderRaw, merged);
      const empty = isCoreFieldsAllEmpty({
        clubRaw,
        nameRaw,
        genderRaw,
        sizeRaw,
        qtyRaw,
      });
      if (empty) {
        // 완전 빈 슬롯은 생성하지 않음
        return;
      }
      const fromLegacy = extractSizeGenderQty(merged);
      const qtyP = fromLegacy.qty ?? parseQty(qtyRaw) ?? 1;
      out.push({
        jobId,
        sourceSheet: sheet.name,
        sourceRowIndex: i,
        sourceGroupIndex: groupIndex,
        clubNameRaw: clubRaw,
        memberNameRaw: nameRaw,
        memberName: nameRaw,
        genderRaw,
        itemRaw: cell(row, g.item),
        sizeRaw,
        qtyRaw,
        clubNameNormalized: preprocessCell(clubRaw),
        genderNormalized: pol.genderNormalized,
        standardizedSize: pol.standardizedSize,
        qtyParsed: qtyP,
        parseStatus: pol.parseStatus,
        parseConfidence: pol.parseConfidence,
        parseReason: pol.parseReason,
        userCorrected: false,
        excluded: false,
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
    const genderRaw = cell(row, mapping.fields.gender);
    const sizeRaw = cell(row, mapping.fields.size);
    const qtyRaw = cell(row, mapping.fields.qty);
    const itemText = cell(row, itemCol) ?? "";
    if (
      isCoreFieldsAllEmpty({
        clubRaw,
        nameRaw,
        genderRaw,
        sizeRaw,
        qtyRaw,
      })
    ) {
      // 완전 빈 행은 drop
      continue;
    }
    if (!preprocessCell(itemText)) {
      out.push({
        jobId,
        sourceSheet: sheet.name,
        sourceRowIndex: i,
        sourceGroupIndex: 0,
        memberNameRaw: nameRaw,
        memberName: nameRaw,
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
        memberName: nameRaw,
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
        memberName: nameRaw,
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

  const clubCol = mapping.fields.club;
  for (let i = start; i < sheet.rows.length; i += 1) {
    const row = sheet.rows[i] ?? [];
    if (clubCol !== undefined && !preprocessCell(cell(row, clubCol))) {
      continue;
    }
    for (const s of sizeCols) {
      const qtyRaw = cell(row, s.idx);
      const qtyParsed = parseQty(qtyRaw) ?? (Number(preprocessCell(qtyRaw)) || undefined);
      const empty = qtyParsed === undefined || qtyParsed === 0;
      const nameForRow = cell(row, mapping.fields.name);
      out.push({
        jobId,
        sourceSheet: sheet.name,
        sourceRowIndex: i,
        clubNameRaw: cell(row, mapping.fields.club),
        memberNameRaw: nameForRow,
        memberName: nameForRow,
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

