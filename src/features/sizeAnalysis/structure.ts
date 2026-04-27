import type { FieldMapping, HeaderRole, PersonRecord, StructureType } from "./types";
import { preprocessCell } from "./normalize";

const ROLE_KEYWORDS: Record<HeaderRole, RegExp> = {
  club: /(클럽|소속|단체|팀|CLUB)/i,
  name: /(이름|성명|고객명|고객|NAME)/i,
  gender: /(성별|남여|젠더|GENDER|SEX)/i,
  size: /(사이즈|SIZE|치수)/i,
  qty: /(수량|수|QTY|QUANTITY|장수)/i,
  item: /(품목|상품|ITEM)/i,
  note: /(비고|메모|NOTE|REMARK)/i,
};

const REQUIRED_PERSON_ROLES: Array<"club" | "name" | "gender" | "size"> = ["club", "name", "gender", "size"];

const PERSON_HEADER_ALIASES: Record<"club" | "name" | "gender" | "size", string[]> = {
  club: ["클럽", "club", "팀", "소속"],
  name: ["이름", "성명", "고객명", "고객", "name"],
  gender: ["성별", "성", "젠더", "gender", "sex", "남녀"],
  size: ["사이즈", "size", "치수"],
};

function normalizeHeaderText(value: string | undefined): string {
  return String(value ?? "")
    .replace(/\r?\n/g, "")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();
}

function matchPersonRoleFromHeader(cell: string | undefined): "club" | "name" | "gender" | "size" | undefined {
  const normalized = normalizeHeaderText(cell);
  if (!normalized) return undefined;
  for (const role of REQUIRED_PERSON_ROLES) {
    const aliases = PERSON_HEADER_ALIASES[role];
    if (aliases.some((alias) => normalizeHeaderText(alias) === normalized)) {
      return role;
    }
  }
  return undefined;
}

function buildSequentialPersonGroups(header: string[]): Array<Record<"club" | "name" | "gender" | "size", number>> {
  const groups: Array<Record<"club" | "name" | "gender" | "size", number>> = [];
  let pending: Partial<Record<"club" | "name" | "gender" | "size", number>> = {};
  for (let col = 0; col < header.length; col += 1) {
    const role = matchPersonRoleFromHeader(header[col]);
    if (!role) continue;
    if (pending[role] !== undefined) {
      pending = { [role]: col };
      continue;
    }
    pending[role] = col;
    if (REQUIRED_PERSON_ROLES.every((requiredRole) => pending[requiredRole] !== undefined)) {
      groups.push(pending as Record<"club" | "name" | "gender" | "size", number>);
      pending = {};
    }
  }
  return groups;
}

function scoreHeaderRow(row: string[]): number {
  const personRoles = row.map((cell) => matchPersonRoleFromHeader(cell)).filter((role): role is "club" | "name" | "gender" | "size" => !!role);
  const uniqueRoleCount = new Set(personRoles).size;
  const groups = buildSequentialPersonGroups(row);
  let fallbackHits = 0;
  for (const cell of row) {
    const s = preprocessCell(cell);
    if (!s) continue;
    for (const re of Object.values(ROLE_KEYWORDS)) {
      if (re.test(s)) fallbackHits += 1;
    }
  }
  return groups.length * 100 + uniqueRoleCount * 10 + personRoles.length * 3 + fallbackHits;
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
  const rawHeader = rows[headerRowIndex] ?? [];
  const header = rawHeader.map(preprocessCell);
  const nonEmptyHeader = header.filter(Boolean);
  const sizeHeaderCount = nonEmptyHeader.filter((h) => /^(80|85|90|95|100|105|110|115|120|XS|S|M|L|XL|2XL|3XL|4XL)$/i.test(h)).length;

  if (sizeHeaderCount >= 3) return "size_matrix";

  const repeatedGroups = buildSequentialPersonGroups(rawHeader);
  if (repeatedGroups.length >= 2) return "repeated_slots";

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
  const repeatedGroups = buildSequentialPersonGroups(header);

  const findByRole = (role: HeaderRole): number | undefined => {
    const idx = normalizedHeader.findIndex((h) => ROLE_KEYWORDS[role].test(h));
    return idx >= 0 ? idx : undefined;
  };

  (Object.keys(ROLE_KEYWORDS) as HeaderRole[]).forEach((role) => {
    fields[role] = findByRole(role);
  });

  const firstGroup = repeatedGroups[0];
  if (firstGroup) {
    fields.club = firstGroup.club;
    fields.name = firstGroup.name;
    fields.gender = firstGroup.gender;
    fields.size = firstGroup.size;
  }

  if (repeatedGroups.length >= 2) {
    return {
      structureType: "repeated_slots",
      headerRowIndex,
      fields,
      slotGroups: repeatedGroups.map((g) => ({ ...g })),
    };
  }

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

function safeCellValue(row: string[], index: number | undefined): string {
  if (index === undefined || index < 0 || index >= row.length) return "";
  const raw = row[index];
  return raw == null ? "" : String(raw);
}

export function extractPeopleFromRows(rows: string[][], mapping: FieldMapping): PersonRecord[] {
  const start = (mapping.headerRowIndex ?? 0) + 1;
  const groups =
    mapping.slotGroups && mapping.slotGroups.length > 0
      ? mapping.slotGroups.map((g) => ({
          club: g.club,
          name: g.name,
          gender: g.gender,
          size: g.size,
        }))
      : [
          {
            club: mapping.fields.club,
            name: mapping.fields.name,
            gender: mapping.fields.gender,
            size: mapping.fields.size,
          },
        ];

  const people: PersonRecord[] = [];
  for (let rowIndex = start; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    for (const group of groups) {
      const person: PersonRecord = {
        club: safeCellValue(row, group.club),
        name: safeCellValue(row, group.name),
        gender: safeCellValue(row, group.gender),
        size: safeCellValue(row, group.size),
      };
      if (!person.club && !person.name && !person.gender && !person.size) {
        continue;
      }
      people.push(person);
    }
  }
  return people;
}

