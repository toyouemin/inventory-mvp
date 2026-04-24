/**
 * 사이즈 분석 — 클럽/성별/사이즈 집계: 총 수량 / 중복자(동일 시트·행+동일 주문) / 중복 제외(중복 태그 제거)
 * rows 원본은 변경하지 않습니다.
 */

import { buildColumnSizesForClub } from "./clubAggMatrixColumns";
import { matrixDisplayFromSizeFields } from "./matrixSizeDisplay";

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

/** 동일 엑셀 행(시트+sourceRow) 안에서 “같은 주문”이 두 번인지: 클럽·이름·사이즈·성별·수량 */
function orderLineSigForDuplicate(r: any): string {
  return [
    normClubFromNormRow(r),
    personNameKeyForDupGroup(r),
    String(r.standardizedSize ?? r.sizeRaw ?? "")
      .trim()
      .replace(/\s+/g, " "),
    String(r.genderNormalized ?? r.genderRaw ?? "")
      .trim()
      .replace(/\s+/g, " "),
    String(rowQtyParsed(r)),
  ].join("\0");
}

function sameRowAndOrderKey(r: any): string {
  return [r.sourceSheet ?? "", String(r.sourceRowIndex ?? ""), orderLineSigForDuplicate(r)].join("\0");
}

export function rowQtyParsed(r: any): number {
  const q = r.qtyParsed;
  return Number.isFinite(Number(q)) ? Number(q) : 0;
}

/**
 * 정규화 행 배열에서 행을 유일히 가리킬 키(DB id 우선, 없으면 배열 인덱스).
 * (과거 `src:sourceRow`는 한 원본 행→여러 norm 행이 같은 키로 묶이는 오류가 있음)
 */
export function stableRowKeyForDup(r: any, rowIndex: number): string {
  if (r != null && r.id != null && String(r.id) !== "") return String(r.id);
  return `ix:${rowIndex}`;
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
    if (!duplicateRowIds.has(stableRowKeyForDup(r, i))) continue;
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

/** 동일 (시트+행+주문시그) 내 둘 이상 — 앞에 있는 슬롯·행이 대표, 뒤가 중복 */
function compareRowsForDuplicateTie(a: { r: any; i: number }, b: { r: any; i: number }): number {
  const ga = a.r.sourceGroupIndex != null && a.r.sourceGroupIndex !== "" ? Number(a.r.sourceGroupIndex) : 0;
  const gb = b.r.sourceGroupIndex != null && b.r.sourceGroupIndex !== "" ? Number(b.r.sourceGroupIndex) : 0;
  if (Number.isFinite(ga) && Number.isFinite(gb) && ga !== gb) return ga - gb;
  return a.i - b.i;
}

/**
 * `analyzeDuplicateRows`로 표시한 **동일 엑셀행·동일주문** 중복 행만 수량에서 제외 (나머지는 전부 합산)
 */
export function buildAggRowsDedupedFirst(rows: any[], duplicateRowIds: Set<string>): AggRow[] {
  const detailMap = new Map<string, AggRow>();
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i]!;
    if (duplicateRowIds.has(stableRowKeyForDup(r, i))) continue;
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
 * 중복(중복자): **다른** 엑셀행이면 서로 다른 주문으로 모두 정상(사람+사이즈 같아도 2주문 가능).
 * 동일 `sourceSheet` + `sourceRowIndex`에서 동일 `orderLineSig`(클럽·이름·사이즈·성별·수량)이
 * 2행 이상이면(슬롯/파싱으로 같은 줄이 두 번) 둘째부터 중복.
 * - duplicateRowIds: 중복으로 표시하는 행(뱃지·엑셀)
 * - duplicatePersonCount: 중복 **행** 수(기존 필드명 유지, UI에서 건·명 표시)
 * - dupByClub: 클럽별 중복 **건수** / 중복 **수량** 합
 */
export function analyzeDuplicateRows(rows: any[]): DuplicateAnalysis {
  const byOrderKey = new Map<string, { r: any; i: number }[]>();
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i]!;
    if (r.excluded) continue;
    const k = sameRowAndOrderKey(r);
    if (!byOrderKey.has(k)) byOrderKey.set(k, []);
    byOrderKey.get(k)!.push({ r, i });
  }

  const duplicateRowIds = new Set<string>();
  for (const list of byOrderKey.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort(compareRowsForDuplicateTie);
    for (let j = 1; j < sorted.length; j += 1) {
      const { r, i } = sorted[j]!;
      duplicateRowIds.add(stableRowKeyForDup(r, i));
    }
  }

  let totalQty = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i]!;
    if (r.excluded) continue;
    totalQty += rowQtyParsed(r);
  }

  let duplicateQtyTotal = 0;
  const dupByClub = new Map<string, { persons: number; sheets: number }>();
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i]!;
    if (r.excluded) continue;
    if (!duplicateRowIds.has(stableRowKeyForDup(r, i))) continue;
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
