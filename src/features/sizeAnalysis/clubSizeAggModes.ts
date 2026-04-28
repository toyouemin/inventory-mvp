/**
 * 사이즈 분석 — 클럽/성별/사이즈 집계: 총 수량 / 중복자(duplicateGroupKey) / 중복 제외(중복 태그 제거)
 * rows 원본은 변경하지 않습니다.
 */

import { buildColumnSizesForClub } from "./clubAggMatrixColumns";
import { duplicateGroupKeyFromRow } from "./duplicateKeyNormalize";
import { matrixDisplayFromSizeFields } from "./matrixSizeDisplay";
import type { StructureType } from "./types";

export type ClubSizeAggMode = "total" | "duplicate" | "deduped";

export type AggRow = { club: string; gender: string; size: string; qty: number };

export type ClubAggBlock = {
  club: string;
  clubRows: AggRow[];
  totalQty: number;
  columnSizes: string[];
  rowKeys: Array<"여" | "남" | "공용">;
  qtyMap: Map<string, number>;
};

export const CLUB_AGG_MODE_LABEL: Record<ClubSizeAggMode, string> = {
  total: "총 수량",
  duplicate: "중복자 수량",
  deduped: "중복 제외 수량",
};

export function normClubFromNormRow(r: { clubNameNormalized?: string | null; clubNameRaw?: string | null }): string {
  return String(r.clubNameNormalized ?? r.clubNameRaw ?? "미분류").trim() || "미분류";
}

function personNameKeyForDupGroup(r: { memberNameRaw?: unknown; memberName?: unknown }): string {
  return String(r.memberNameRaw || r.memberName || "")
    .trim()
    .replace(/\s+/g, " ");
}

/** 0/빈 수량 제외(사이즈표 셀 등) — 중복 판정에서 제외 */
export function rowExcludedByEmptyQuantity(r: any): boolean {
  return String(r?.parseReason ?? "").includes("0/빈 수량 제외");
}

function sizeLine(standardizedSize: string | null | undefined): "M" | "W" | null {
  const s = String(standardizedSize ?? "").trim().toUpperCase();
  if (/^M\d{2,3}$/.test(s)) return "M";
  if (/^W\d{2,3}$/.test(s)) return "W";
  return null;
}

function normalizeBinaryGender(raw: string | null | undefined): "남" | "여" | null {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  if (/^(남|남자|m)$/i.test(t)) return "남";
  if (/^(여|여자|w)$/i.test(t)) return "여";
  return null;
}

function preferredLineForRow(r: any): "M" | "W" | null {
  const line = sizeLine(r.standardizedSize);
  if (line) return line;
  const raw = String(r.sizeRaw ?? "").trim();
  if (/^남|남자/i.test(raw)) return "M";
  if (/^여|여자/i.test(raw)) return "W";
  return null;
}

function pickKeepEntry(list: Array<{ r: any; i: number }>): { r: any; i: number } {
  const g = normalizeBinaryGender(list[0]?.r?.genderNormalized ?? list[0]?.r?.genderRaw);
  if (g === "남") {
    const hit = list.find((x) => preferredLineForRow(x.r) === "M");
    if (hit) return hit;
  } else if (g === "여") {
    const hit = list.find((x) => preferredLineForRow(x.r) === "W");
    if (hit) return hit;
  }
  return list[0]!;
}

export function rowQtyParsed(r: any): number {
  const q = r.qtyParsed;
  return Number.isFinite(Number(q)) ? Number(q) : 0;
}

/** 최종 집계 포함 조건: auto_confirmed/corrected 이고 excluded 아님 */
export function rowIncludedInFinalAggregation(r: any): boolean {
  const st = String(r?.parseStatus ?? "").trim();
  if (Boolean(r?.excluded) || st === "excluded") return false;
  return st === "auto_confirmed" || st === "corrected";
}

/**
 * 중복 수량/중복 매트릭스 표시용 포함 조건.
 * - 최종 집계(total/deduped) 조건과 분리: 중복으로 제외된 행(parseStatus=excluded)도 집계 대상
 * - 기존 정책 유지: needs_review/unresolved 제외, 0/빈 수량 제외
 */
function rowIncludedInDuplicateAggregation(r: any): boolean {
  const st = String(r?.parseStatus ?? "").trim();
  if (st === "needs_review" || st === "unresolved") return false;
  if (rowExcludedByEmptyQuantity(r)) return false;
  return rowQtyParsed(r) > 0;
}

/**
 * 정규화 행 배열에서 행을 유일히 가리킬 키(DB id 우선, 없으면 배열 인덱스).
 * (과거 `src:sourceRow`는 한 원본 행→여러 norm 행이 같은 키로 묶이는 오류가 있음)
 */
export function stableRowId(r: any, rowIndex: number): string {
  if (r != null && r.id != null && String(r.id) !== "") return String(r.id);
  const src = `${r?.sourceSheet ?? ""}:${r?.sourceRowIndex ?? ""}:${r?.sourceGroupIndex ?? ""}`;
  const sig = `${normClubFromNormRow(r)}:${personNameKeyForDupGroup(r)}:${String(r?.standardizedSize ?? r?.sizeRaw ?? "")}:${rowQtyParsed(r)}`;
  return `row:${src}:${sig}:${rowIndex}`;
}

/** 호환용 alias (기존 호출부 유지) */
export function stableRowKeyForDup(r: any, rowIndex: number): string {
  return stableRowId(r, rowIndex);
}

export function rowKeyGenderForAgg(g: string | null | undefined): "여" | "남" | "공용" {
  const t = String(g ?? "").trim();
  if (t === "남") return "남";
  if (t === "여") return "여";
  return "공용";
}

/**
 * 클럽 집계·매트릭스 **표시**용. `matrixSizeDisplay`에서
 * 남95·여90·95남·M100·남자 100·100(여자) 등 → 행(남/여)·열(숫자) 분리. 내부 `standardizedSize`는 DB 그대로.
 */
export function matrixAggGenderAndSizeFromRow(r: {
  standardizedSize?: string | null;
  sizeRaw?: string | null;
  genderNormalized?: string | null;
  genderRaw?: string | null;
}): { gender: string; size: string } {
  return matrixDisplayFromSizeFields(
    r.standardizedSize,
    r.sizeRaw,
    r.genderNormalized ?? r.genderRaw
  );
}

/** 클럽 요약(총 인원 / 사이즈 수량 / 미입력) — 표시 사이즈가 비었거나 미분류면 제외 */
export function rowHasDisplayableSizeForSummary(r: {
  standardizedSize?: string | null;
  sizeRaw?: string | null;
  genderNormalized?: string | null;
  genderRaw?: string | null;
}): boolean {
  const { size } = matrixAggGenderAndSizeFromRow(r);
  const s = String(size ?? "").trim();
  return Boolean(s && s !== "미분류");
}

/**
 * 동일 클럽·이름 중복(1행 유지) 처리 **그룹 후보**.
 * - 검토필요(needs_review), 표시 사이즈 없음·미분류는 제외(검토 우선).
 * - DB에 제외(중복)로 이미 저장된 행은 그룹·duplicateRowIds 재계산에 **포함**해야 하므로 excluded 여부는 보지 않음.
 */
export function rowEligibleForDuplicatePersonGroup(r: any): boolean {
  const st = String(r?.parseStatus ?? "").trim();
  if (st === "needs_review") return false;
  return rowHasDisplayableSizeForSummary(r);
}

export type ClubDisplaySummaryStats = {
  /** 해당 클럽 norm 행 수(allRows, 중복·제외 행 포함) */
  totalPersons: number;
  /** 표시 가능한 사이즈가 있는 행만 qty 합 */
  sizedQtySum: number;
  /** 사이즈 없음·미분류인 행 수 */
  missingSizePersons: number;
};

/**
 * 클럽별 보기 상단 문구용. 집계/duplicateRowIds 로직과 무관하게 표시만 계산합니다.
 */
export function computeClubDisplaySummaryStats(rows: any[], club: string): ClubDisplaySummaryStats {
  let totalPersons = 0;
  let sizedQtySum = 0;
  let missingSizePersons = 0;
  for (const r of rows) {
    if (normClubFromNormRow(r) !== club) continue;
    totalPersons += 1;
    const qty = rowQtyParsed(r);
    if (rowHasDisplayableSizeForSummary(r)) {
      sizedQtySum += qty;
    } else {
      missingSizePersons += 1;
    }
  }
  return { totalPersons, sizedQtySum, missingSizePersons };
}

/** 여·남은 항상 행으로 두고, 공용은 데이터가 있을 때만 추가 */
export function matrixGenderRowKeys(clubRows: Array<{ gender: string }>): Array<"여" | "남" | "공용"> {
  const keys: Array<"여" | "남" | "공용"> = ["여", "남"];
  if (clubRows.some((r) => rowKeyGenderForAgg(r.gender) === "공용")) keys.push("공용");
  return keys;
}

function compareGenderForClubSize(a: string, b: string): number {
  const order = (g: string) => {
    const t = String(g ?? "").trim();
    if (t === "남") return 0;
    if (t === "여") return 1;
    if (t === "공용" || t === "") return 2;
    return 3;
  };
  return order(a) - order(b) || String(a ?? "").localeCompare(String(b ?? ""), "ko");
}

function compareSizeLabel(a: string, b: string): number {
  const aa = String(a ?? "").trim();
  const bb = String(b ?? "").trim();
  const an = /^\d+$/.test(aa) ? Number(aa) : Number.NaN;
  const bn = /^\d+$/.test(bb) ? Number(bb) : Number.NaN;
  const aIsNum = Number.isFinite(an);
  const bIsNum = Number.isFinite(bn);
  if (aIsNum && bIsNum) return an - bn;
  if (aIsNum) return -1;
  if (bIsNum) return 1;
  return aa.localeCompare(bb, "ko");
}

function pushRowIntoDetailMap(
  detailMap: Map<string, AggRow>,
  club: string,
  gender: string,
  size: string,
  qty: number
): void {
  const key = `${club}\0${gender}\0${size}`;
  const cur = detailMap.get(key) ?? { club, gender, size, qty: 0 };
  cur.qty += qty;
  detailMap.set(key, cur);
}

function sortedAggRowsFromDetailMap(detailMap: Map<string, AggRow>): AggRow[] {
  const byClub = new Map<string, AggRow[]>();
  for (const d of detailMap.values()) {
    if (!byClub.has(d.club)) byClub.set(d.club, []);
    byClub.get(d.club)!.push(d);
  }
  return Array.from(byClub.entries())
    .sort((a, b) => a[0].localeCompare(b[0], "ko"))
    .flatMap(([, arr]) =>
      [...arr].sort((a, b) => compareGenderForClubSize(a.gender, b.gender) || compareSizeLabel(a.size, b.size))
    );
}

/** 총 수량: 현재 rows 전체 */
export function buildAggRowsTotal(rows: any[]): AggRow[] {
  const detailMap = new Map<string, AggRow>();
  for (const r of rows) {
    if (!rowIncludedInFinalAggregation(r)) continue;
    const club = normClubFromNormRow(r);
    const { gender, size } = matrixAggGenderAndSizeFromRow(r);
    const qty = rowQtyParsed(r);
    pushRowIntoDetailMap(detailMap, club, gender, size, qty);
  }
  return sortedAggRowsFromDetailMap(detailMap);
}

/** 중복자 수량: duplicateRowIds에 포함된 행만 */
export function buildAggRowsDuplicate(rows: any[], duplicateRowIds: Set<string>): AggRow[] {
  const detailMap = new Map<string, AggRow>();
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i]!;
    if (!duplicateRowIds.has(stableRowId(r, i))) continue;
    if (!rowIncludedInDuplicateAggregation(r)) continue;
    const club = normClubFromNormRow(r);
    const { gender, size } = matrixAggGenderAndSizeFromRow(r);
    const qty = rowQtyParsed(r);
    pushRowIntoDetailMap(detailMap, club, gender, size, qty);
  }
  return sortedAggRowsFromDetailMap(detailMap);
}

export function compareRowsBySourceThenIndex(a: { r: any; i: number }, b: { r: any; i: number }): number {
  const ha = a.r.sourceRowIndex != null && String(a.r.sourceRowIndex).trim() !== "";
  const hb = b.r.sourceRowIndex != null && String(b.r.sourceRowIndex).trim() !== "";
  if (ha && hb) {
    const na = Number(a.r.sourceRowIndex);
    const nb = Number(b.r.sourceRowIndex);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    if (Number.isFinite(na) && Number.isFinite(nb) && na === nb) {
      return String(a.r.sourceRowIndex).localeCompare(String(b.r.sourceRowIndex), "ko");
    }
    return String(a.r.sourceRowIndex).localeCompare(String(b.r.sourceRowIndex), "ko");
  }
  if (ha && !hb) return -1;
  if (!ha && hb) return 1;
  return a.i - b.i;
}

/**
 * `analyzeDuplicateRows`로 표시한 **동일 클럽+이름(중복 key)** 중복 행만 수량에서 제외 (나머지는 전부 합산)
 */
export function buildAggRowsDedupedFirst(rows: any[], duplicateRowIds: Set<string>): AggRow[] {
  const detailMap = new Map<string, AggRow>();
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i]!;
    if (duplicateRowIds.has(stableRowId(r, i))) continue;
    if (!rowIncludedInFinalAggregation(r)) continue;
    const club = normClubFromNormRow(r);
    const { gender, size } = matrixAggGenderAndSizeFromRow(r);
    const qty = rowQtyParsed(r);
    pushRowIntoDetailMap(detailMap, club, gender, size, qty);
  }
  return sortedAggRowsFromDetailMap(detailMap);
}

export function buildClubAggBlock(club: string, clubRows: AggRow[]): ClubAggBlock {
  const totalQty = clubRows.reduce((s, r) => s + r.qty, 0);
  const columnSizes = buildColumnSizesForClub(clubRows);
  const rowKeys = matrixGenderRowKeys(clubRows);
  const qtyMap = new Map<string, number>();
  for (const r of clubRows) {
    const gk = rowKeyGenderForAgg(r.gender);
    const k = `${gk}\0${r.size}`;
    qtyMap.set(k, (qtyMap.get(k) ?? 0) + r.qty);
  }
  return { club, clubRows, totalQty, columnSizes, rowKeys, qtyMap };
}

export function unionClubsOrdered(flats: AggRow[][]): string[] {
  const s = new Set<string>();
  for (const flat of flats) for (const r of flat) s.add(r.club);
  return [...s].sort((a, b) => a.localeCompare(b, "ko"));
}

export type DuplicateAnalysis = {
  duplicateRowIds: Set<string>;
  dupByClub: Map<string, { persons: number; sheets: number }>;
  duplicatePersonCount: number;
  duplicateQtyTotal: number;
  normalQty: number;
  totalQty: number;
};

/**
 * 중복 기준은 구조 타입과 무관하게 항상 클럽+이름입니다.
 * (중복자 보기에서 "같은 사람이 여러 번 신청" 여부를 확인하기 위한 정책)
 *
 * 참고:
 * - 0/빈 수량 제외(size_matrix) 정책은 유지합니다.
 * - needs_review 제외 정책은 유지합니다.
 * - 사이즈 표시 가능 여부(미분류 포함)는 중복 키 산출에서 더 이상 조건으로 쓰지 않습니다.
 */
export function analyzeDuplicateRows(rows: any[], structureType?: StructureType): DuplicateAnalysis {
  const st =
    structureType ?? (rows[0]?.metaJson?.structureType as StructureType | undefined);
  const isMatrix = st === "size_matrix";

  function keyForRow(r: any): string | null {
    return duplicateGroupKeyFromRow(r);
  }

  const byPerson = new Map<string, { r: any; i: number }[]>();
  const duplicateRowIds = new Set<string>();

  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i]!;
    if (isMatrix && rowExcludedByEmptyQuantity(r)) continue;
    const stRow = String(r?.parseStatus ?? "").trim();
    if (stRow === "needs_review") continue;
    const pk = keyForRow(r);
    if (!pk) continue;
    if (!byPerson.has(pk)) byPerson.set(pk, []);
    byPerson.get(pk)!.push({ r, i });
  }

  for (const list of byPerson.values()) {
    if (list.length < 2) continue;
    const keep = pickKeepEntry(list);
    for (const x of list) {
      if (x.i !== keep.i) {
        duplicateRowIds.add(stableRowId(x.r, x.i));
      }
    }
  }

  let totalQty = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i]!;
    if (!rowIncludedInFinalAggregation(r)) continue;
    totalQty += rowQtyParsed(r);
  }

  let duplicateQtyTotal = 0;
  const dupByClub = new Map<string, { persons: number; sheets: number }>();
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i]!;
    if (!duplicateRowIds.has(stableRowId(r, i))) continue;
    if (!rowIncludedInDuplicateAggregation(r)) continue;
    const q = rowQtyParsed(r);
    duplicateQtyTotal += q;
    const club = normClubFromNormRow(r);
    const d = dupByClub.get(club) ?? { persons: 0, sheets: 0 };
    d.persons += 1;
    d.sheets += q;
    dupByClub.set(club, d);
  }

  const normalQty = totalQty - duplicateQtyTotal;
  const duplicatePersonCount = duplicateRowIds.size;

  return {
    duplicateRowIds,
    dupByClub,
    duplicatePersonCount,
    duplicateQtyTotal,
    normalQty,
    totalQty,
  };
}
