/**
 * 필드 매핑 UI 전용 (0-based index는 서버/파서와 동일하게 유지)
 */

export type FieldRole = "club" | "name" | "gender" | "size" | "qty" | "item" | "note";

/** 1-based 열 번호 → Excel 열 문자 (1=A, 27=AA) */
export function excelColumnLetterFromOneBased(col1: number): string {
  if (col1 < 1) return "";
  let n = col1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s || "A";
}

export function maxColumnCountInPreview(previewRows: string[][] | undefined, headerRowIndex: number): number {
  if (!previewRows?.length) return 0;
  let m = 0;
  for (let r = 0; r < previewRows.length; r += 1) {
    const len = previewRows[r]?.length ?? 0;
    if (r >= headerRowIndex - 2 && r <= headerRowIndex + 10) {
      m = Math.max(m, len);
    }
  }
  for (const row of previewRows) {
    m = Math.max(m, row?.length ?? 0);
  }
  return m;
}

const ROLE_MATCH: Array<{ role: FieldRole; re: RegExp }> = [
  { role: "name", re: /이름|성명|^name$|member/i },
  { role: "club", re: /클럽|소속|단체|팀|^club$/i },
  { role: "item", re: /주문내용|품목|주문|상품|^item$/i },
  { role: "gender", re: /성별|남여|^gender|^sex$/i },
  { role: "size", re: /사이즈|치수|^size$/i },
  { role: "qty", re: /수량|장수|qty|quantity/i },
  { role: "note", re: /비고|메모|note|remark/i },
];

function headerCellText(h: string | undefined): string {
  return String(h ?? "")
    .replace(/\r?\n/g, " ")
    .trim();
}

/**
 * 헤더 셀 텍스트로 비어 있는 필드만 자동 매핑 (열 index 0-based)
 */
export function suggestFieldIndicesFromHeaderRow(headerRow: string[] | undefined): Partial<Record<FieldRole, number>> {
  if (!headerRow?.length) return {};
  const out: Partial<Record<FieldRole, number>> = {};
  const used = new Set<number>();
  for (const { role, re } of ROLE_MATCH) {
    for (let i = 0; i < headerRow.length; i += 1) {
      if (used.has(i)) continue;
      const t = headerCellText(headerRow[i]);
      if (t && re.test(t)) {
        out[role] = i;
        used.add(i);
        break;
      }
    }
  }
  return out;
}

export type MappingFields = Record<string, number | undefined>;

export function mergeAutoFieldMap(
  fields: MappingFields,
  suggested: Partial<Record<FieldRole, number>>
): MappingFields {
  const next = { ...fields };
  (Object.keys(suggested) as FieldRole[]).forEach((role) => {
    const v = suggested[role];
    if (v === undefined) return;
    if (next[role] === undefined) {
      next[role] = v;
    }
  });
  return next;
}

export function findDuplicateColumnIndices(fields: MappingFields): number[] {
  const byCol = new Map<number, string[]>();
  for (const [role, idx] of Object.entries(fields)) {
    if (idx === undefined || idx < 0) continue;
    const list = byCol.get(idx) ?? [];
    list.push(role);
    byCol.set(idx, list);
  }
  const dups: number[] = [];
  for (const [col, roles] of byCol) {
    if (roles.length > 1) dups.push(col);
  }
  return dups.sort((a, b) => a - b);
}
