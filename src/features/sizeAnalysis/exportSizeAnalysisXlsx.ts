import * as XLSX from "xlsx";

import { formatDownloadFileNameDateYymmdd } from "@/lib/downloadFileNameDate";

const PARSE_STATUS_LABEL: Record<string, string> = {
  auto_confirmed: "자동확정",
  needs_review: "검토필요",
  unresolved: "미분류",
  corrected: "수정완료",
  excluded: "제외",
};

function labelParseStatus(v: string | null | undefined): string {
  if (v == null || v === "") return "";
  return PARSE_STATUS_LABEL[v] ?? v;
}

function normClubFromNormRow(r: { clubNameNormalized?: string | null; clubNameRaw?: string | null }): string {
  return String(r.clubNameNormalized ?? r.clubNameRaw ?? "미분류").trim() || "미분류";
}

function rowQtyParsed(r: any): number {
  const q = r.qtyParsed;
  return Number.isFinite(Number(q)) ? Number(q) : 0;
}

function stableRowKeyForDup(r: any, rowIndex: number): string {
  if (r != null && r.id != null && String(r.id) !== "") return String(r.id);
  if (r?.sourceRowIndex != null && r.sourceRowIndex !== "") return `src:${r.sourceRowIndex}`;
  return `ix:${rowIndex}`;
}

const LETTER_SIZES_ORDER = ["S", "M", "L", "XL", "2XL", "3XL", "4XL", "FREE", "F"] as const;

function rowKeyGenderForAgg(g: string | null | undefined): "여" | "남" | "공용" {
  const t = String(g ?? "").trim();
  if (t === "남") return "남";
  if (t === "여") return "여";
  return "공용";
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

const GENDER_ROW_ORDER: Array<"여" | "남" | "공용"> = ["여", "남", "공용"];

type AggRow = { club: string; gender: string; size: string; qty: number };

function buildAggregatedDetailRowsFromNormRows(rows: any[]): AggRow[] {
  const byClub = new Map<string, { club: string; totalQty: number; rows: AggRow[] }>();
  const detailMap = new Map<string, { club: string; gender: string; size: string; qty: number }>();

  for (const r of rows) {
    const club = normClubFromNormRow(r);
    const gender = String(r.genderNormalized ?? r.genderRaw ?? "").trim();
    const size = String(r.standardizedSize ?? r.sizeRaw ?? "미분류").trim() || "미분류";
    const qtyRaw = r.qtyParsed ?? r.qtyRaw ?? 0;
    const qty = Number.isFinite(Number(qtyRaw)) ? Number(qtyRaw) : 0;

    const clubEntry = byClub.get(club) ?? { club, totalQty: 0, rows: [] };
    clubEntry.totalQty += qty;
    byClub.set(club, clubEntry);

    const key = `${club}\0${gender}\0${size}`;
    const cur = detailMap.get(key) ?? { club, gender, size, qty: 0 };
    cur.qty += qty;
    detailMap.set(key, cur);
  }

  for (const d of detailMap.values()) {
    const clubEntry = byClub.get(d.club);
    if (!clubEntry) continue;
    clubEntry.rows.push(d);
  }

  return Array.from(byClub.values())
    .map((club) => ({
      ...club,
      rows: club.rows.sort(
        (a, b) => compareGenderForClubSize(a.gender, b.gender) || compareSizeLabel(a.size, b.size)
      ),
    }))
    .sort((a, b) => a.club.localeCompare(b.club, "ko"))
    .flatMap((c) => c.rows.map((r) => ({ club: c.club, gender: r.gender, size: r.size, qty: r.qty })));
}

function buildClubMatrixBlocks(
  clubFlat: AggRow[],
  dupByClub: Map<string, { persons: number; sheets: number }>
) {
  const by = new Map<string, AggRow[]>();
  for (const r of clubFlat) {
    if (!by.has(r.club)) by.set(r.club, []);
    by.get(r.club)!.push(r);
  }
  const clubs = Array.from(by.keys()).sort((a, b) => a.localeCompare(b, "ko"));
  return clubs.map((club) => {
    const clubRows = by.get(club) ?? [];
    const totalQty = clubRows.reduce((s, r) => s + r.qty, 0);
    const sizes = Array.from(new Set(clubRows.map((r) => r.size))).sort(compareSizeForMatrix);
    const gSeen = new Set<"여" | "남" | "공용">();
    for (const r of clubRows) gSeen.add(rowKeyGenderForAgg(r.gender));
    const rowKeys = GENDER_ROW_ORDER.filter((g) => gSeen.has(g));
    const qtyMap = new Map<string, number>();
    for (const r of clubRows) {
      const gk = rowKeyGenderForAgg(r.gender);
      const k = `${gk}\0${r.size}`;
      qtyMap.set(k, (qtyMap.get(k) ?? 0) + r.qty);
    }
    return { club, clubRows, totalQty, sizes, rowKeys, qtyMap, dup: dupByClub.get(club) };
  });
}

type DupInput = { duplicateRowIds: Set<string>; dupByClub: Map<string, { persons: number; sheets: number }> };

/**
 * 사이즈 분석 결과 `rows`·중복 집계를 기준으로 4시트 xlsx를 만들어 브라우저에 저장합니다.
 */
export function downloadSizeAnalysisResultXlsx(rows: any[], duplicateAnalysis: DupInput): void {
  const aoa1 = buildSheetAll(rows, duplicateAnalysis.duplicateRowIds);
  const aoa2 = buildSheetClubAgg(rows, duplicateAnalysis.dupByClub);
  const aoa3 = buildSheetDupMembers(rows);
  const aoa4 = buildSheetReview(rows);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa1), "전체목록");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa2), "클럽별집계");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa3), "중복자");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa4), "검토필요");

  const ymd = formatDownloadFileNameDateYymmdd();
  const fileName = `size-analysis-${ymd}.xlsx`;
  XLSX.writeFile(wb, fileName);
}

function buildSheetAll(rows: any[], duplicateRowIds: Set<string>) {
  const header = ["원본행", "클럽", "이름", "성별", "사이즈", "수량", "상태", "신뢰도", "중복여부"];
  const body = rows.map((r, i) => [
    r.sourceRowIndex ?? "",
    r.clubNameRaw ?? r.clubNameNormalized ?? "",
    r.memberNameRaw ?? "",
    r.genderNormalized ?? r.genderRaw ?? "",
    r.standardizedSize ?? r.sizeRaw ?? "",
    r.qtyParsed ?? r.qtyRaw ?? "",
    labelParseStatus(r.parseStatus),
    Number.isFinite(Number(r.parseConfidence)) ? Number(r.parseConfidence).toFixed(2) : "",
    duplicateRowIds.has(stableRowKeyForDup(r, i)) ? "예" : "아니오",
  ]);
  return [header, ...body];
}

function buildSheetClubAgg(rows: any[], dupByClub: Map<string, { persons: number; sheets: number }>) {
  const flat = buildAggregatedDetailRowsFromNormRows(rows);
  if (flat.length === 0) {
    return [["(집계할 데이터가 없습니다)"]];
  }
  const blocks = buildClubMatrixBlocks(flat, dupByClub);
  const aoa: (string | number)[][] = [];
  for (const b of blocks) {
    const dup = b.dup;
    const dupText =
      dup && dup.persons > 0 ? ` · 중복 ${dup.persons}명/${dup.sheets}개` : " · 중복자 없음";
    aoa.push([`${b.club} · 총 ${b.totalQty}개${dupText}`]);
    aoa.push(["성별", ...b.sizes, "합계"]);
    for (const gk of b.rowKeys) {
      const row: (string | number)[] = [gk];
      let rowSum = 0;
      for (const sz of b.sizes) {
        const q = b.qtyMap.get(`${gk}\0${sz}`) ?? 0;
        row.push(q);
        rowSum += q;
      }
      row.push(rowSum);
      aoa.push(row);
    }
    aoa.push([]);
  }
  if (aoa[aoa.length - 1]?.length === 0) aoa.pop();
  return aoa;
}

function buildSheetDupMembers(rows: any[]) {
  const header = ["클럽", "이름", "원본행", "성별", "사이즈", "수량"];
  const byName = new Map<string, { r: any; i: number }[]>();
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i]!;
    if (r.excluded) continue;
    const name = String(r.memberNameRaw ?? "").trim();
    if (!name) continue;
    const club = normClubFromNormRow(r);
    const k = `${club}\0${name}`;
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k)!.push({ r, i });
  }
  const body: (string | number)[][] = [];
  const keys = Array.from(byName.keys()).sort((a, c) => a.localeCompare(c, "ko"));
  for (const k of keys) {
    const list = byName.get(k)!;
    if (list.length < 2) continue;
    const ordered = [...list].sort(
      (a, b) =>
        (Number(a.r.sourceRowIndex) || 0) - (Number(b.r.sourceRowIndex) || 0) || stableRowKeyForDup(a.r, a.i).localeCompare(stableRowKeyForDup(b.r, b.i))
    );
    for (const { r, i } of ordered) {
      body.push([
        normClubFromNormRow(r),
        r.memberNameRaw ?? "",
        r.sourceRowIndex ?? "",
        r.genderNormalized ?? r.genderRaw ?? "",
        r.standardizedSize ?? r.sizeRaw ?? "",
        rowQtyParsed(r),
      ]);
    }
  }
  if (body.length === 0) {
    return [header, ["(해당하는 중복 행이 없습니다)"]];
  }
  return [header, ...body];
}

function buildSheetReview(rows: any[]) {
  const header = ["원본행", "클럽", "이름", "성별", "사이즈", "수량", "상태", "신뢰도"];
  const sub = rows.filter((r) => {
    const st = String(r.parseStatus ?? "");
    return st === "needs_review" || st === "unresolved";
  });
  if (sub.length === 0) {
    return [header, ["(검토필요·미분류에 해당하는 행이 없습니다)"]];
  }
  const body = sub.map((r) => [
    r.sourceRowIndex ?? "",
    r.clubNameRaw ?? r.clubNameNormalized ?? "",
    r.memberNameRaw ?? "",
    r.genderNormalized ?? r.genderRaw ?? "",
    r.standardizedSize ?? r.sizeRaw ?? "",
    r.qtyParsed ?? r.qtyRaw ?? "",
    labelParseStatus(r.parseStatus),
    Number.isFinite(Number(r.parseConfidence)) ? Number(r.parseConfidence).toFixed(2) : "",
  ]);
  return [header, ...body];
}
