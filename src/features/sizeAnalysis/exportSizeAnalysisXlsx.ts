import * as XLSX from "xlsx-js-style";

import { applyExcelDownloadFontToWorksheet } from "@/lib/excelDownloadFont";
import { formatDownloadFileNameDateYymmdd } from "@/lib/downloadFileNameDate";
import {
  buildAggRowsDedupedFirst,
  buildAggRowsDuplicate,
  buildAggRowsTotal,
  buildClubAggBlock,
  compareRowsBySourceThenIndex,
  normClubFromNormRow,
  rowQtyParsed,
  stableRowKeyForDup,
  unionClubsOrdered,
} from "./clubSizeAggModes";
import { labelSizeAnalysisParseStatusForRow, labelSizeAnalysisReasonForRow } from "./excludeReasonLabels";

type DupInput = { duplicateRowIds: Set<string>; dupByClub: Map<string, { persons: number; sheets: number }> };

const BORDER_COLOR = { rgb: "FFBBBBBB" } as const;
const thin = { style: "thin" as const, color: BORDER_COLOR };
/** 클럽 블록 구분 — 제목 행 상단 */
const CLUB_BLOCK_SEP_TOP = { style: "thick" as const, color: { rgb: "FF444444" } };

const mergeBorder = {
  top: thin,
  bottom: thin,
  left: thin,
  right: thin,
} as const;

const TITLE_FILL = { patternType: "solid" as const, fgColor: { rgb: "FFE8E8E8" } };
/** 클럽별집계 — 블록 제목 행 전용 */
const CLUB_AGG_TITLE_FILL_TOTAL = { patternType: "solid" as const, fgColor: { rgb: "FFF2F2F2" } };
const CLUB_AGG_TITLE_FILL_DEDUPED = { patternType: "solid" as const, fgColor: { rgb: "FFE2F0D9" } };
const CLUB_AGG_TITLE_FILL_DUPLICATE = { patternType: "solid" as const, fgColor: { rgb: "FFFCE4D6" } };
const HEADER_FILL = { patternType: "solid" as const, fgColor: { rgb: "FFCFD9EA" } };
const EMPH_DUP_FILL = { patternType: "solid" as const, fgColor: { rgb: "FFFFF4CC" } };
const EMPH_REVIEW_FILL = { patternType: "solid" as const, fgColor: { rgb: "FFFFF1E6" } };
const EMPH_UNRES_FILL = { patternType: "solid" as const, fgColor: { rgb: "FFF3F4F6" } };
const EMPH_GROUP_FILL = { patternType: "solid" as const, fgColor: { rgb: "FFF8FAFC" } };

function styleTitle(): import("xlsx-js-style").CellStyle {
  return {
    font: { bold: true },
    fill: TITLE_FILL,
    alignment: { horizontal: "center", vertical: "center" },
    border: mergeBorder,
  };
}

function styleClubAggBlockTitle(
  kind: "total" | "deduped" | "duplicate"
): import("xlsx-js-style").CellStyle {
  const fill =
    kind === "total"
      ? CLUB_AGG_TITLE_FILL_TOTAL
      : kind === "deduped"
        ? CLUB_AGG_TITLE_FILL_DEDUPED
        : CLUB_AGG_TITLE_FILL_DUPLICATE;
  return {
    font: { bold: true },
    fill,
    alignment: { horizontal: "center", vertical: "center" },
    border: mergeBorder,
  };
}

function styleHeader(): import("xlsx-js-style").CellStyle {
  return {
    font: { bold: true },
    fill: HEADER_FILL,
    alignment: { horizontal: "center", vertical: "center" },
    border: mergeBorder,
  };
}

function styleDataCenter(): import("xlsx-js-style").CellStyle {
  return {
    alignment: { horizontal: "center", vertical: "center" },
    border: mergeBorder,
  };
}

function styleDataLeft(): import("xlsx-js-style").CellStyle {
  return {
    alignment: { horizontal: "left", vertical: "center" },
    border: mergeBorder,
  };
}

function mergeStyle(
  base: import("xlsx-js-style").CellStyle,
  extra: Partial<import("xlsx-js-style").CellStyle>
): import("xlsx-js-style").CellStyle {
  return {
    ...base,
    ...extra,
    alignment: { ...(base.alignment ?? {}), ...(extra.alignment ?? {}) },
    font: { ...(base.font ?? {}), ...(extra.font ?? {}) },
    border: { ...(base.border ?? {}), ...(extra.border ?? {}) },
    fill: extra.fill ?? base.fill,
  };
}

function autoFitColumns(ws: XLSX.WorkSheet, data: any[][]) {
  if (!data.length || !data[0] || data[0].length === 0) return;
  const colWidths = data[0].map((_, colIdx) => {
    let maxLength = 0;

    for (let rowIdx = 0; rowIdx < data.length; rowIdx++) {
      const cell = data[rowIdx]?.[colIdx];
      if (!cell) continue;

      const text = String(cell);
      const len = text.length;

      // 한글은 조금 더 넓게 잡기
      const adjusted = len * (/[가-힣]/.test(text) ? 1.8 : 1.2);

      if (adjusted > maxLength) {
        maxLength = adjusted;
      }
    }

    return {
      wch: Math.min(Math.max(maxLength + 2, 8), 30), // 최소 8, 최대 30
    };
  });

  ws["!cols"] = colWidths;
}

function worksheetToAoa(ws: XLSX.WorkSheet): any[][] {
  const ref = ws["!ref"];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const out: any[][] = [];
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    const row: any[] = [];
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const addr = XLSX.utils.encode_cell({ r, c });
      row.push((ws[addr] as import("xlsx").CellObject | undefined)?.v ?? "");
    }
    out.push(row);
  }
  return out;
}

type StyledSheetOptions = {
  centerCols: Set<number>;
  freezeHeader?: boolean;
  emptyMessage?: string;
  groupKeyByRow?: (row: Array<string | number>, rowIndex: number) => string;
  highlightCell?: (
    row: Array<string | number>,
    rowIndex: number,
    colIndex: number
  ) => Partial<import("xlsx-js-style").CellStyle> | null;
};

function buildStyledAoaSheet(
  aoa: Array<Array<string | number>>,
  options: StyledSheetOptions
): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  const enc = XLSX.utils.encode_cell;
  const rowCount = aoa.length;
  const colCount = Math.max(...aoa.map((r) => r.length), 1);
  for (let r = 0; r < rowCount; r += 1) {
    const row = aoa[r] ?? [];
    const isHeader = r === 0;
    const rowGroup = !isHeader && options.groupKeyByRow ? options.groupKeyByRow(row, r) : "";
    const prevGroup = r > 1 && options.groupKeyByRow ? options.groupKeyByRow(aoa[r - 1] ?? [], r - 1) : "";
    for (let c = 0; c < colCount; c += 1) {
      const v = row[c] ?? "";
      const t: "s" | "n" = typeof v === "number" ? "n" : "s";
      let style = isHeader
        ? styleHeader()
        : options.centerCols.has(c)
          ? styleDataCenter()
          : styleDataLeft();
      if (!isHeader && options.groupKeyByRow && rowGroup && prevGroup && rowGroup !== prevGroup) {
        style = mergeStyle(style, {
          border: {
            ...mergeBorder,
            top: { style: "medium", color: BORDER_COLOR },
          },
          fill: EMPH_GROUP_FILL,
        });
      }
      if (!isHeader && options.highlightCell) {
        const extra = options.highlightCell(row, r, c);
        if (extra) style = mergeStyle(style, extra);
      }
      ws[enc({ r, c })] = { t, v, s: style };
    }
  }
  const rMax = Math.max(0, rowCount - 1);
  const cMax = Math.max(0, colCount - 1);
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rMax, c: cMax } });
  autoFitColumns(ws, aoa);
  if (options.freezeHeader) {
    (ws as any)["!freeze"] = { xSplit: 0, ySplit: 1 };
  }
  applyExcelDownloadFontToWorksheet(ws);
  return ws;
}

/**
 * 사이즈 분석 결과 `rows`·중복 집계를 기준으로 4시트 xlsx를 만들어 브라우저에 저장합니다.
 */
export function downloadSizeAnalysisResultXlsx(rows: any[], duplicateAnalysis: DupInput): void {
  const aoa1 = buildSheetAll(rows, duplicateAnalysis.duplicateRowIds);
  const aoa3 = buildSheetDupMembers(rows, duplicateAnalysis.duplicateRowIds);
  const aoa4 = buildSheetReview(rows);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildSheetAllStyled(aoa1), "전체목록");
  XLSX.utils.book_append_sheet(
    wb,
    buildClubAggregateStyledSheet(rows, duplicateAnalysis.duplicateRowIds),
    "클럽별집계"
  );
  XLSX.utils.book_append_sheet(wb, buildSheetDupStyled(aoa3), "중복자");
  XLSX.utils.book_append_sheet(wb, buildSheetReviewStyled(aoa4), "검토필요");

  const ymd = formatDownloadFileNameDateYymmdd();
  const fileName = `size-analysis-${ymd}.xlsx`;
  XLSX.writeFile(wb, fileName, { bookType: "xlsx", cellStyles: true });
}

function buildSheetAll(rows: any[], duplicateRowIds: Set<string>) {
  const header = ["원본행", "클럽", "이름", "성별", "사이즈", "수량", "상태", "사유", "신뢰도", "중복여부"];
  const body = rows.map((r, i) => {
    return [
    r.sourceRowIndex ?? "",
    r.clubNameRaw ?? r.clubNameNormalized ?? "",
    r.memberNameRaw ?? "",
    r.genderNormalized ?? r.genderRaw ?? "",
    r.standardizedSize ?? r.sizeRaw ?? "",
    r.qtyParsed ?? r.qtyRaw ?? "",
    labelSizeAnalysisParseStatusForRow(r),
    labelSizeAnalysisReasonForRow(r),
    Number.isFinite(Number(r.parseConfidence)) ? Number(r.parseConfidence).toFixed(2) : "",
    duplicateRowIds.has(stableRowKeyForDup(r, i)) ? "예" : "아니오",
  ];
  });
  return [header, ...body];
}

function buildSheetAllStyled(aoa: Array<Array<string | number>>): XLSX.WorkSheet {
  return buildStyledAoaSheet(aoa, {
    centerCols: new Set([0, 3, 4, 5, 6, 7, 8, 9]),
    freezeHeader: true,
    emptyMessage: "(전체목록 데이터가 없습니다)",
    highlightCell: (row, r, c) => {
      if (r < 1) return null;
      if (c === 9 && String(row[9] ?? "") === "예") {
        return { fill: EMPH_DUP_FILL, font: { bold: true } };
      }
      if (c === 6 && String(row[6] ?? "") === "검토필요") {
        return { fill: EMPH_REVIEW_FILL, font: { bold: true } };
      }
      if (c === 6 && String(row[6] ?? "") === "미분류") {
        return { fill: EMPH_UNRES_FILL, font: { bold: true } };
      }
      return null;
    },
  });
}

function appendClubMatrixSection(
  ws: XLSX.WorkSheet,
  enc: typeof XLSX.utils.encode_cell,
  merges: import("xlsx").Range[],
  rIn: number,
  b: ReturnType<typeof buildClubAggBlock>,
  titleText: string,
  titleStyle: import("xlsx-js-style").CellStyle,
  clubBlockTopSeparator: boolean
): { r: number; cMax: number } {
  let r = rIn;
  const colSizes = b.columnSizes;
  const L = colSizes.length;
  const colCount = 1 + L + 1 + 1;
  const lastCol = colCount - 1;
  const lastSumCol = 1 + L;
  let cMax = colCount - 1;

  const titleRowStyle = clubBlockTopSeparator
    ? mergeStyle(titleStyle, { border: { top: CLUB_BLOCK_SEP_TOP } })
    : titleStyle;

  const titleR = r;
  ws[enc({ r: titleR, c: 0 })] = { v: titleText, t: "s", s: titleRowStyle };
  merges.push({ s: { r: titleR, c: 0 }, e: { r: titleR, c: lastCol } });
  for (let c = 1; c <= lastCol; c += 1) {
    ws[enc({ r: titleR, c })] = { v: "", t: "s", s: titleRowStyle };
  }

  r += 1;
  const headerR = r;
  const headerRow: (string | number)[] = ["성별", ...colSizes, "합계", "종합계"];
  for (let c = 0; c < colCount; c += 1) {
    const v = headerRow[c]!;
    ws[enc({ r: headerR, c })] = { v, t: typeof v === "number" ? "n" : "s", s: styleHeader() };
  }

  r += 1;
  const genders = b.rowKeys;
  const dataStartR = r;
  const total = b.totalQty;
  const zongV = total === 0 ? "" : total;
  for (let gi = 0; gi < genders.length; gi += 1) {
    const gk = genders[gi]!;
    const rowIdx = r;
    ws[enc({ r: rowIdx, c: 0 })] = { v: gk, t: "s", s: styleDataCenter() };
    let rowSum = 0;
    for (let i = 0; i < L; i += 1) {
      const sz = colSizes[i]!;
      const q = b.qtyMap.get(`${gk}\0${sz}`) ?? 0;
      rowSum += q;
      if (q === 0) {
        ws[enc({ r: rowIdx, c: 1 + i })] = { t: "s", v: "", s: styleDataCenter() };
      } else {
        ws[enc({ r: rowIdx, c: 1 + i })] = { t: "n", v: q, s: styleDataCenter() };
      }
    }
    if (rowSum === 0) {
      ws[enc({ r: rowIdx, c: lastSumCol })] = { t: "s", v: "", s: styleDataCenter() };
    } else {
      ws[enc({ r: rowIdx, c: lastSumCol })] = { t: "n", v: rowSum, s: styleDataCenter() };
    }
    if (gi === 0) {
      ws[enc({ r: rowIdx, c: lastCol })] = {
        v: zongV,
        t: zongV === "" ? "s" : "n",
        s: { ...styleDataCenter(), font: { bold: true } },
      };
    } else {
      ws[enc({ r: rowIdx, c: lastCol })] = { t: "s", v: "", s: styleDataCenter() };
    }
    r += 1;
  }
  if (genders.length > 1) {
    merges.push({
      s: { r: dataStartR, c: lastCol },
      e: { r: dataStartR + genders.length - 1, c: lastCol },
    });
  }

  return { r, cMax };
}

function buildClubAggregateStyledSheet(rows: any[], duplicateRowIds: Set<string>): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  const enc = XLSX.utils.encode_cell;

  const modes = [
    { kind: "total" as const, label: "총 수량", flat: buildAggRowsTotal(rows) },
    { kind: "deduped" as const, label: "중복 제외 수량", flat: buildAggRowsDedupedFirst(rows, duplicateRowIds) },
    { kind: "duplicate" as const, label: "중복자 수량", flat: buildAggRowsDuplicate(rows, duplicateRowIds) },
  ] as const;

  const clubsOrdered = unionClubsOrdered(modes.map((m) => m.flat));
  if (clubsOrdered.length === 0) {
    ws[enc({ r: 0, c: 0 })] = { v: "(집계할 데이터가 없습니다)", t: "s" };
    ws["!ref"] = "A1";
    return ws;
  }

  const merges: import("xlsx").Range[] = [];
  let cMax = 0;
  let r = 0;

  for (let bi = 0; bi < clubsOrdered.length; bi += 1) {
    const club = clubsOrdered[bi]!;
    for (let mi = 0; mi < modes.length; mi += 1) {
      const mode = modes[mi]!;
      if (mi > 0) r += 1;
      const clubRows = mode.flat.filter((x) => x.club === club);
      const b = buildClubAggBlock(club, clubRows);
      const titleText = `${bi + 1}. ${b.club} · ${mode.label} ${b.totalQty}개`;
      const out = appendClubMatrixSection(
        ws,
        enc,
        merges,
        r,
        b,
        titleText,
        styleClubAggBlockTitle(mode.kind),
        bi > 0 && mi === 0
      );
      r = out.r;
      cMax = Math.max(cMax, out.cMax);
    }
    r += 1;
  }

  const rMax = r - 1;
  ws["!merges"] = merges;
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rMax, c: cMax } });
  autoFitColumns(ws, worksheetToAoa(ws));
  applyExcelDownloadFontToWorksheet(ws);
  return ws;
}

function buildSheetDupMembers(rows: any[], duplicateRowIds: Set<string>) {
  const header = ["클럽", "이름", "구분", "원본행", "성별", "사이즈", "수량"];
  const byName = new Map<string, { r: any; i: number; dup: boolean }[]>();
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i]!;
    const name = String(r.memberNameRaw ?? "").trim();
    if (!name) continue;
    const club = normClubFromNormRow(r);
    const k = `${club}\0${name}`;
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k)!.push({ r, i, dup: duplicateRowIds.has(stableRowKeyForDup(r, i)) });
  }
  const body: (string | number)[][] = [];
  const keys = Array.from(byName.keys()).sort((a, c) => a.localeCompare(c, "ko"));
  for (const k of keys) {
    const list = byName.get(k)!;
    if (!list.some((x) => x.dup)) continue;
    const ordered = [...list].sort(compareRowsBySourceThenIndex);
    ordered.forEach(({ r, i, dup }) => {
      body.push([
        normClubFromNormRow(r),
        r.memberNameRaw ?? "",
        dup ? "중복" : "정상",
        r.sourceRowIndex ?? "",
        r.genderNormalized ?? r.genderRaw ?? "",
        r.standardizedSize ?? r.sizeRaw ?? "",
        rowQtyParsed(r),
      ]);
    });
  }
  if (body.length === 0) {
    return [header, ["(해당하는 중복 행이 없습니다)"]];
  }
  return [header, ...body];
}

function buildSheetDupStyled(aoa: Array<Array<string | number>>): XLSX.WorkSheet {
  if (aoa.length <= 1) {
    return buildStyledAoaSheet(aoa, {
      centerCols: new Set([2, 3, 4, 5, 6]),
      emptyMessage: "(해당하는 중복 행이 없습니다)",
    });
  }
  return buildStyledAoaSheet(aoa, {
    centerCols: new Set([2, 3, 4, 5, 6]),
    groupKeyByRow: (row, r) => (r === 0 ? "" : `${String(row[0] ?? "")}\0${String(row[1] ?? "")}`),
    highlightCell: (row, r, c) => {
      if (r < 1) return null;
      if (c <= 1) return { fill: EMPH_GROUP_FILL };
      return null;
    },
  });
}

function buildSheetReview(rows: any[]) {
  const header = ["원본행", "클럽", "이름", "성별", "사이즈", "수량", "상태", "사유", "신뢰도"];
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
    labelSizeAnalysisParseStatusForRow(r),
    labelSizeAnalysisReasonForRow(r),
    Number.isFinite(Number(r.parseConfidence)) ? Number(r.parseConfidence).toFixed(2) : "",
  ]);
  return [header, ...body];
}

function buildSheetReviewStyled(aoa: Array<Array<string | number>>): XLSX.WorkSheet {
  const hasData = aoa.length > 1 && aoa[1]!.length > 1;
  if (!hasData) {
    const ws = buildStyledAoaSheet(aoa, {
      centerCols: new Set([0, 3, 4, 5, 6, 7, 8]),
      emptyMessage: "(검토필요·미분류에 해당하는 행이 없습니다)",
    });
    const addr = XLSX.utils.encode_cell({ r: 1, c: 0 });
    const cell = ws[addr];
    if (cell) {
      cell.s = mergeStyle(styleDataLeft(), { fill: EMPH_REVIEW_FILL, font: { bold: true } });
    }
    return ws;
  }
  return buildStyledAoaSheet(aoa, {
    centerCols: new Set([0, 3, 4, 5, 6, 7, 8]),
    highlightCell: (row, r, c) => {
      if (r < 1) return null;
      if (c !== 6) return null;
      if (String(row[6] ?? "") === "검토필요") return { fill: EMPH_REVIEW_FILL, font: { bold: true } };
      if (String(row[6] ?? "") === "미분류") return { fill: EMPH_UNRES_FILL, font: { bold: true } };
      return null;
    },
  });
}
