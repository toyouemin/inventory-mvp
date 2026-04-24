/**
 * 사이즈 분석 — 클럽/성별/사이즈 집계: 총 수량 / 중복자 / 중복 제외(첫 행만)
 * rows 원본은 변경하지 않습니다.
 */

import { buildColumnSizesForClub } from "./clubAggMatrixColumns";

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

export function rowQtyParsed(r: any): number {
  const q = r.qtyParsed;
  return Number.isFinite(Number(q)) ? Number(q) : 0;
}

export function stableRowKeyForDup(r: any, rowIndex: number): string {
  if (r != null && r.id != null && String(r.id) !== "") return String(r.id);
  if (r?.sourceRowIndex != null && r.sourceRowIndex !== "") return `src:${r.sourceRowIndex}`;
  return `ix:${rowIndex}`;
}

export function rowKeyGenderForAgg(g: string | null | undefined): "여" | "남" | "공용" {
  const t = String(g ?? "").trim();
  if (t === "남") return "남";
  if (t === "여") return "여";
  return "공용";
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
    const club = normClubFromNormRow(r);
    const gender = String(r.genderNormalized ?? r.genderRaw ?? "").trim();
    const size = String(r.standardizedSize ?? r.sizeRaw ?? "미분류").trim() || "미분류";
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
    if (!duplicateRowIds.has(stableRowKeyForDup(r, i))) continue;
    const club = normClubFromNormRow(r);
    const gender = String(r.genderNormalized ?? r.genderRaw ?? "").trim();
    const size = String(r.standardizedSize ?? r.sizeRaw ?? "미분류").trim() || "미분류";
    const qty = rowQtyParsed(r);
    pushRowIntoDetailMap(detailMap, club, gender, size, qty);
  }
  return sortedAggRowsFromDetailMap(detailMap);
}

function compareRowsBySourceThenIndex(a: { r: any; i: number }, b: { r: any; i: number }): number {
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
 * 중복 제외 수량: 클럽+이름(비어 있지 않음) 그룹에서 원본행 순 첫 행만,
 * 이름 빈 행은 행마다 그대로 집계
 */
export function buildAggRowsDedupedFirst(rows: any[]): AggRow[] {
  const included = new Set<number>();
  const byKey = new Map<string, { r: any; i: number }[]>();

  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i]!;
    const name = String(r.memberNameRaw ?? "").trim();
    if (!name) {
      included.add(i);
      continue;
    }
    const club = normClubFromNormRow(r);
    const k = `${club}\0${name}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push({ r, i });
  }

  for (const list of byKey.values()) {
    const sorted = [...list].sort(compareRowsBySourceThenIndex);
    if (sorted.length > 0) included.add(sorted[0]!.i);
  }

  const detailMap = new Map<string, AggRow>();
  for (let i = 0; i < rows.length; i += 1) {
    if (!included.has(i)) continue;
    const r = rows[i]!;
    const club = normClubFromNormRow(r);
    const gender = String(r.genderNormalized ?? r.genderRaw ?? "").trim();
    const size = String(r.standardizedSize ?? r.sizeRaw ?? "미분류").trim() || "미분류";
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
