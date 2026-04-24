/**
 * 클럽별 집계 매트릭스(PC 표·엑셀 클럽별집계 시트) 공통 열 순서.
 * 기본 숫자 열(85~115)은 항상 포함하고, 120·기타 숫자·문자 사이즈는 데이터가 있을 때만 뒤에 붙입니다.
 */

const LETTER_SIZES_ORDER = ["S", "M", "L", "XL", "2XL", "3XL", "4XL", "FREE", "F"] as const;

function compareSizeForMatrix(a: string, b: string): number {
  const na = String(a ?? "").trim();
  const nb = String(b ?? "").trim();
  const aNum = /^\d+$/.test(na);
  const bNum = /^\d+$/.test(nb);
  if (aNum && bNum) return Number(na) - Number(nb);
  if (aNum) return -1;
  if (bNum) return 1;
  const ua = na.toUpperCase();
  const ub = nb.toUpperCase();
  const ia = (LETTER_SIZES_ORDER as readonly string[]).indexOf(ua);
  const ib = (LETTER_SIZES_ORDER as readonly string[]).indexOf(ub);
  if (ia >= 0 && ib >= 0) return ia - ib;
  if (ia >= 0) return -1;
  if (ib >= 0) return 1;
  return na.localeCompare(nb, "ko");
}

export const DEFAULT_NUM_SIZE_COLS = ["85", "90", "95", "100", "105", "110", "115"] as const;

const DEFAULT_NUM_SET = new Set<string>(DEFAULT_NUM_SIZE_COLS);

/** 기본 숫자 열 뒤에 붙는 문자 사이즈 순 (데이터에 있을 때만 열) */
const LETTER_SIZE_ORDER: readonly string[] = [...LETTER_SIZES_ORDER];

export function buildColumnSizesForClub(clubRows: Array<{ size: string }>): string[] {
  const sizeSet = new Set(
    clubRows.map((r) => String(r.size ?? "").trim()).filter((s) => s.length > 0)
  );
  const cols: string[] = [...DEFAULT_NUM_SIZE_COLS];
  const extraNums = [...sizeSet]
    .filter((s) => /^\d+$/.test(s) && !DEFAULT_NUM_SET.has(s))
    .sort((a, b) => Number(a) - Number(b));
  cols.push(...extraNums);
  for (const want of LETTER_SIZE_ORDER) {
    const found = [...sizeSet].find((s) => s.toUpperCase() === want.toUpperCase());
    if (found && !cols.includes(found)) cols.push(found);
  }
  const inCols = new Set(cols);
  const rest = [...sizeSet]
    .filter((s) => !inCols.has(s) && s !== "미분류")
    .sort(compareSizeForMatrix);
  cols.push(...rest);
  return cols;
}
