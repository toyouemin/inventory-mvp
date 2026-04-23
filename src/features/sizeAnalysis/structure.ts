import type { FieldMapping, HeaderRole, StructureType } from "./types";
import { preprocessCell } from "./normalize";

const ROLE_KEYWORDS: Record<HeaderRole, RegExp> = {
  club: /(클럽|소속|단체|팀|CLUB)/i,
  name: /(이름|성명|NAME)/i,
  gender: /(성별|남여|GENDER|SEX)/i,
  size: /(사이즈|SIZE|치수)/i,
  qty: /(수량|수|QTY|QUANTITY|장수)/i,
  item: /(품목|상품|ITEM)/i,
  note: /(비고|메모|NOTE|REMARK)/i,
};

function scoreHeaderRow(row: string[]): number {
  let score = 0;
  for (const cell of row) {
    const s = preprocessCell(cell);
    if (!s) continue;
    for (const re of Object.values(ROLE_KEYWORDS)) {
      if (re.test(s)) score += 2;
    }
  }
  return score;
}

export function detectHeaderRow(rows: string[][]): number {
  const max = Math.min(rows.length, 30);
  let bestIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < max; i += 1) {
    const score = scoreHeaderRow(rows[i] ?? []);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export function detectStructureType(rows: string[][], headerRowIndex: number): StructureType {
  const header = (rows[headerRowIndex] ?? []).map(preprocessCell);
  const nonEmptyHeader = header.filter(Boolean);
  const sizeHeaderCount = nonEmptyHeader.filter((h) => /^(80|85|90|95|100|105|110|115|120|XS|S|M|L|XL|2XL|3XL|4XL)$/i.test(h)).length;

  if (sizeHeaderCount >= 3) return "size_matrix";

  const slot1 = header.findIndex((h) => /이름1|NAME1|성별1|사이즈1|SIZE1/i.test(h));
  const slot2 = header.findIndex((h) => /이름2|NAME2|성별2|사이즈2|SIZE2/i.test(h));
  if (slot1 >= 0 && slot2 >= 0) return "repeated_slots";

  const hasPersonCore =
    header.some((h) => ROLE_KEYWORDS.name.test(h)) &&
    (header.some((h) => ROLE_KEYWORDS.size.test(h)) || header.some((h) => ROLE_KEYWORDS.qty.test(h)));
  if (hasPersonCore) return "single_row_person";

  return "unknown";
}

export function suggestFieldMapping(rows: string[][], structureType: StructureType, headerRowIndex: number): FieldMapping {
  const header = rows[headerRowIndex] ?? [];
  const fields: FieldMapping["fields"] = {};
  const normalizedHeader = header.map(preprocessCell);

  const findByRole = (role: HeaderRole): number | undefined => {
    const idx = normalizedHeader.findIndex((h) => ROLE_KEYWORDS[role].test(h));
    return idx >= 0 ? idx : undefined;
  };

  (Object.keys(ROLE_KEYWORDS) as HeaderRole[]).forEach((role) => {
    fields[role] = findByRole(role);
  });

  if (structureType !== "repeated_slots") {
    return { structureType, headerRowIndex, fields };
  }

  const slotGroups: NonNullable<FieldMapping["slotGroups"]> = [];
  const maxCols = normalizedHeader.length;
  for (let base = 0; base < maxCols; base += 1) {
    const name = normalizedHeader[base] ?? "";
    if (!/이름\d+|NAME\d+/i.test(name)) continue;
    const maybeGroup: Partial<Record<HeaderRole, number>> = { name: base };
    for (let i = base - 2; i <= base + 3; i += 1) {
      if (i < 0 || i >= maxCols) continue;
      const h = normalizedHeader[i] ?? "";
      if (ROLE_KEYWORDS.club.test(h)) maybeGroup.club = i;
      if (ROLE_KEYWORDS.gender.test(h)) maybeGroup.gender = i;
      if (ROLE_KEYWORDS.size.test(h)) maybeGroup.size = i;
      if (ROLE_KEYWORDS.qty.test(h)) maybeGroup.qty = i;
      if (ROLE_KEYWORDS.item.test(h)) maybeGroup.item = i;
    }
    slotGroups.push(maybeGroup);
  }

  return { structureType, headerRowIndex, fields, slotGroups };
}

