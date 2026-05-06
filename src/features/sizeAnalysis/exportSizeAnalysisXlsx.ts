import * as XLSX from "xlsx-js-style";

import { applyExcelDownloadFontToWorksheet } from "@/lib/excelDownloadFont";
import { formatDownloadFileNameDateYymmdd } from "@/lib/downloadFileNameDate";
import {
  buildAggRowsDedupedFirst,
  buildAggRowsDedupedFirstForItem,
  buildAggRowsDuplicate,
  buildAggRowsTotal,
  buildClubAggBlock,
  compareRowsBySourceThenIndex,
  matrixAggGenderAndSizeFromRow,
  normClubFromNormRow,
  rowKeyGenderForAgg,
  rowQtyParsed,
  stableRowKeyForDup,
  unionClubsOrdered,
} from "./clubSizeAggModes";
import { labelSizeAnalysisParseStatusForRow, labelSizeAnalysisReasonForRow } from "./excludeReasonLabels";
import type { StructureType } from "./types";
import { shouldPrioritizeSizeCheckUiDisplay } from "./uiOutsideAllowedSizes";

type DupInput = { duplicateRowIds: Set<string>; dupByClub: Map<string, { persons: number; sheets: number }> };

/** 업로드 원본명 → 다운로드 파일명에 쓸 베이스(확장자 제거·경로·금지 문자 정리) */
function baseNameFromUploadFileName(original: string): string {
  let s = original.replace(/^[\\/]+/g, "").trim();
  const lower = s.toLowerCase();
  if (lower.endsWith(".xlsx")) s = s.slice(0, -5);
  else if (lower.endsWith(".csv")) s = s.slice(0, -4);
  s = s
    .replace(/[/\\:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .trim();
  if (!s) return "size-analysis";
  return s.length > 120 ? s.slice(0, 120) : s;
}

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
const SUBTOTAL_FILL = { patternType: "solid" as const, fgColor: { rgb: "FFF5F5F5" } };
const GRAND_TOTAL_FILL = { patternType: "solid" as const, fgColor: { rgb: "FFFFF2CC" } };
const EMPH_SIZE_CHECK_FILL = { patternType: "solid" as const, fgColor: { rgb: "FFFEFCE8" } }; // #FEFCE8
const EMPH_SIZE_CHECK_HEADER_FILL = { patternType: "solid" as const, fgColor: { rgb: "FFFEF3C7" } };
const SIZE_CHECK_BOTTOM_BORDER = { style: "thin" as const, color: { rgb: "FFCA8A04" } }; // #CA8A04
const CLUB_TINT_ODD_FILL = { patternType: "solid" as const, fgColor: { rgb: "FFF0FDF4" } }; // 연녹색
const CLUB_TINT_EVEN_FILL = { patternType: "solid" as const, fgColor: { rgb: "FFFDF2F8" } }; // 연핑크
/** 다품목 클럽별집계 품목 제목 행 번갈아 적용(연보라) */
const CLUB_TINT_PRODUCT_PURPLE_FILL = { patternType: "solid" as const, fgColor: { rgb: "FFF3E8FF" } };
const MULTI_ITEM_PRODUCT_TITLE_FILLS = [CLUB_TINT_ODD_FILL, CLUB_TINT_EVEN_FILL, CLUB_TINT_PRODUCT_PURPLE_FILL] as const;

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
  /** 첫 행(헤더) 기준 자동 필터 — 데이터가 1줄 이상일 때만 설정 */
  autofilter?: boolean;
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
  if (options.autofilter && rowCount >= 2) {
    const lastExcelRow = rowCount;
    (ws as XLSX.WorkSheet)["!autofilter"] = {
      ref: `A1:${XLSX.utils.encode_col(cMax)}${lastExcelRow}`,
    };
  }
  applyExcelDownloadFontToWorksheet(ws);
  return ws;
}

/**
 * 사이즈 분석 결과 `rows`·중복 집계를 기준으로 4시트 xlsx를 만들어 브라우저에 저장합니다.
 */
export function downloadSizeAnalysisResultXlsx(
  rows: any[],
  duplicateAnalysis: DupInput,
  opts?: { structureType?: StructureType; uploadFileName?: string }
): void {
  const isMultiItem = opts?.structureType === "multi_item_personal_order";
  const aoa1 = buildSheetAll(rows, duplicateAnalysis.duplicateRowIds, isMultiItem);
  const aoa3 = buildSheetDupMembers(rows, duplicateAnalysis.duplicateRowIds);
  const aoa4 = buildSheetReview(rows);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildSheetAllStyled(aoa1, isMultiItem), "전체목록");
  XLSX.utils.book_append_sheet(
    wb,
    buildClubAggregateStyledSheet(rows, duplicateAnalysis.duplicateRowIds, { structureType: opts?.structureType }),
    "클럽별집계"
  );
  XLSX.utils.book_append_sheet(wb, buildSheetDupStyled(aoa3), "중복자");
  XLSX.utils.book_append_sheet(wb, buildSheetReviewStyled(aoa4), "검토필요");
  if (isMultiItem) {
    const productSheets = buildProductSheets(rows, duplicateAnalysis.duplicateRowIds);
    for (const s of productSheets) {
      XLSX.utils.book_append_sheet(wb, s.ws, s.name);
    }
  }

  const ymd = formatDownloadFileNameDateYymmdd();
  const rawName = opts?.uploadFileName?.trim();
  const base = rawName ? baseNameFromUploadFileName(rawName) : "size-analysis";
  const fileName = `(분석) ${base}_${ymd}.xlsx`;
  XLSX.writeFile(wb, fileName, { bookType: "xlsx", cellStyles: true });
}

function genderOrderForMultiItem(raw: unknown): number {
  const t = String(raw ?? "").trim();
  if (t === "여") return 0;
  if (t === "남") return 1;
  if (t === "공용") return 2;
  return 3;
}

function sizeOrderForMultiItem(raw: unknown): { kind: 0 | 1; num: number; text: string } {
  const t = String(raw ?? "").trim();
  const m = t.match(/(?:^|[^0-9])(80|85|90|95|100|105|110|115|120)(?![0-9])/);
  if (m?.[1]) return { kind: 0, num: Number(m[1]), text: t };
  return { kind: 1, num: Number.POSITIVE_INFINITY, text: t };
}

function compareSizeForMultiItem(a: unknown, b: unknown): number {
  const aa = sizeOrderForMultiItem(a);
  const bb = sizeOrderForMultiItem(b);
  if (aa.kind !== bb.kind) return aa.kind - bb.kind;
  if (aa.kind === 0) return aa.num - bb.num;
  return aa.text.localeCompare(bb.text, "ko");
}

function buildSheetAll(rows: any[], duplicateRowIds: Set<string>, includeItemColumn: boolean) {
  const sourceRows =
    includeItemColumn
      ? [...rows].sort((a, b) => {
          const ga = String(a?.genderNormalized ?? a?.genderRaw ?? "").trim();
          const gb = String(b?.genderNormalized ?? b?.genderRaw ?? "").trim();
          const gCmp = genderOrderForMultiItem(ga) - genderOrderForMultiItem(gb);
          if (gCmp !== 0) return gCmp;
          const sa = String(a?.standardizedSize ?? a?.sizeRaw ?? "").trim();
          const sb = String(b?.standardizedSize ?? b?.sizeRaw ?? "").trim();
          const sCmp = compareSizeForMultiItem(sa, sb);
          if (sCmp !== 0) return sCmp;
          const na = String(a?.memberNameRaw ?? "").trim();
          const nb = String(b?.memberNameRaw ?? "").trim();
          return na.localeCompare(nb, "ko");
        })
      : rows;
  const header = includeItemColumn
    ? ["원본행", "클럽", "이름", "성별", "상품명", "사이즈", "수량", "상태", "사유", "신뢰도", "중복여부"]
    : ["원본행", "클럽", "이름", "성별", "사이즈", "수량", "상태", "사유", "신뢰도", "중복여부"];
  const body = sourceRows.map((r, i) => {
    const isSizeCheck = shouldPrioritizeSizeCheckUiDisplay(r);
    const srcRaw = r.sourceRowIndex;
    const srcNum = Number(srcRaw);
    const srcDisplay =
      srcRaw === "" || srcRaw == null
        ? ""
        : Number.isFinite(srcNum)
          ? String(srcNum + 1)
          : srcRaw;
    const base = [
      srcDisplay,
      r.clubNameRaw ?? r.clubNameNormalized ?? "",
      r.memberNameRaw ?? "",
      r.genderNormalized ?? r.genderRaw ?? "",
    ];
    const tail = [
      r.standardizedSize ?? r.sizeRaw ?? "",
      r.qtyParsed ?? r.qtyRaw ?? "",
      isSizeCheck ? "사이즈" : labelSizeAnalysisParseStatusForRow(r),
      isSizeCheck
        ? labelSizeAnalysisReasonForRow(r)
          ? `${labelSizeAnalysisReasonForRow(r)} · 범위외 사이즈`
          : "범위외 사이즈"
        : labelSizeAnalysisReasonForRow(r),
      Number.isFinite(Number(r.parseConfidence)) ? Number(r.parseConfidence).toFixed(2) : "",
      duplicateRowIds.has(stableRowKeyForDup(r, i)) ? "예" : "아니오",
    ];
    if (includeItemColumn) return [...base, r.itemRaw ?? "", ...tail];
    return [...base, ...tail];
  });
  return [header, ...body];
}

function buildProductSheets(rows: any[], duplicateRowIds: Set<string>): Array<{ name: string; ws: XLSX.WorkSheet }> {
  const items = Array.from(
    new Set(
      rows
        .map((r) => String(r?.itemRaw ?? "").trim())
        .filter((x) => x.length > 0)
    )
  ).sort((a, b) => a.localeCompare(b, "ko"));
  const out: Array<{ name: string; ws: XLSX.WorkSheet }> = [];
  for (const item of items) {
    const sub = rows.filter((r, i) => {
      const sameItem = String(r?.itemRaw ?? "").trim() === item;
      if (!sameItem) return false;
      const isDup = duplicateRowIds.has(stableRowKeyForDup(r, i));
      if (isDup) return false;
      const st = String(r?.parseStatus ?? "");
      if (st !== "auto_confirmed" && st !== "corrected") return false;
      if (r?.excluded) return false;
      return true;
    });
    const by = new Map<string, number>();
    for (const r of sub) {
      const g = String(r.genderNormalized ?? r.genderRaw ?? "").trim() || "공용";
      const s = String(r.standardizedSize ?? r.sizeRaw ?? "").trim() || "미분류";
      const q = Number.isFinite(Number(r.qtyParsed)) ? Number(r.qtyParsed) : 0;
      const key = `${g}\0${s}`;
      by.set(key, (by.get(key) ?? 0) + q);
    }
    const groupedBody = Array.from(by.entries())
      .map(([k, qty]) => {
        const [gender, size] = k.split("\0");
        return [gender, size, qty] as Array<string | number>;
      })
      .sort(
        (a, b) =>
          genderOrderForMultiItem(a[0]) - genderOrderForMultiItem(b[0]) ||
          compareSizeForMultiItem(a[1], b[1])
      );
    const body: Array<Array<string | number>> = [];
    let grandTotal = 0;
    for (let i = 0; i < groupedBody.length; ) {
      const gender = String(groupedBody[i]?.[0] ?? "");
      let genderTotal = 0;
      while (i < groupedBody.length && String(groupedBody[i]?.[0] ?? "") === gender) {
        const row = groupedBody[i]!;
        body.push(row);
        const qty = Number(row[2]);
        if (Number.isFinite(qty)) {
          genderTotal += qty;
          grandTotal += qty;
        }
        i += 1;
      }
      body.push([`${gender} 합계`, "", genderTotal]);
      body.push(["", "", ""]);
    }
    if (body.length > 0 && body[body.length - 1]?.every((v) => v === "")) {
      body.pop();
    }
    body.push(["총합계", "", grandTotal]);

    const aoa = [["성별", "사이즈", "수량"], ...body];
    const ws = buildStyledAoaSheet(aoa, {
      centerCols: new Set([0, 1, 2]),
      emptyMessage: "(집계할 데이터가 없습니다)",
      highlightCell: (row, _r, _c) => {
        const label = String(row[0] ?? "").trim();
        if (label === "총합계") {
          return {
            font: { bold: true, sz: 13 },
            fill: GRAND_TOTAL_FILL,
            border: { top: thin },
          };
        }
        if (label.endsWith(" 합계")) {
          return {
            font: { bold: true },
            fill: SUBTOTAL_FILL,
            border: { top: thin },
          };
        }
        return null;
      },
    });
    out.push({ name: item.slice(0, 31), ws });
  }
  return out;
}

function buildSheetAllStyled(aoa: Array<Array<string | number>>, includeItemColumn: boolean): XLSX.WorkSheet {
  const dupCol = includeItemColumn ? 10 : 9;
  const statusCol = includeItemColumn ? 7 : 6;
  const centerCols = includeItemColumn ? new Set([0, 3, 5, 6, 7, 8, 9, 10]) : new Set([0, 3, 4, 5, 6, 7, 8, 9]);
  return buildStyledAoaSheet(aoa, {
    centerCols,
    autofilter: true,
    emptyMessage: "(전체목록 데이터가 없습니다)",
    highlightCell: (row, r, c) => {
      if (r < 1) return null;
      const isDup = String(row[dupCol] ?? "") === "예";
      if (c === dupCol && isDup) {
        return { fill: EMPH_DUP_FILL, font: { bold: true } };
      }
      if (c === statusCol && isDup) {
        return { fill: EMPH_DUP_FILL, font: { bold: true } };
      }
      if (c === statusCol && String(row[statusCol] ?? "") === "사이즈") {
        return { fill: EMPH_SIZE_CHECK_FILL, font: { bold: true } };
      }
      if (c === statusCol && String(row[statusCol] ?? "") === "검토필요") {
        return { fill: EMPH_REVIEW_FILL, font: { bold: true } };
      }
      if (c === statusCol && String(row[statusCol] ?? "") === "미분류") {
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
  clubBlockTopSeparator: boolean,
  opts?: {
    modeKind?: "total" | "deduped" | "duplicate";
    hasSizeCheckInCell?: (gk: "여" | "남" | "공용", sz: string) => boolean;
    hasSizeCheckInColumn?: (sz: string) => boolean;
    clubTintFill?: import("xlsx-js-style").CellStyle["fill"];
    /** false면 `clubTintFill`은 제목 행에만 적용(헤더·본문은 파란 헤더·기본 배경 유지). 기본 true */
    clubTintSpreadToMatrix?: boolean;
  }
): { r: number; cMax: number } {
  let r = rIn;
  const colSizes = b.columnSizes;
  const L = colSizes.length;
  const colCount = 1 + L + 1 + 1;
  const lastCol = colCount - 1;
  const lastSumCol = 1 + L;
  let cMax = colCount - 1;

  const clubTintFillOpt = opts?.clubTintFill;
  const tintBody = Boolean(clubTintFillOpt) && opts?.clubTintSpreadToMatrix !== false;

  const titleWithTint = clubTintFillOpt ? mergeStyle(titleStyle, { fill: clubTintFillOpt }) : titleStyle;
  const titleRowStyle = clubBlockTopSeparator
    ? mergeStyle(titleWithTint, { border: { top: CLUB_BLOCK_SEP_TOP } })
    : titleWithTint;

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
    let headStyle = styleHeader();
    if (tintBody && clubTintFillOpt) headStyle = mergeStyle(headStyle, { fill: clubTintFillOpt });
    if (c >= 1 && c <= L) {
      const sz = colSizes[c - 1]!;
      if (opts?.hasSizeCheckInColumn?.(sz)) {
        headStyle = mergeStyle(headStyle, {
          fill: EMPH_SIZE_CHECK_HEADER_FILL,
          font: { bold: true, color: { rgb: "FF713F12" } },
        });
      }
    }
    ws[enc({ r: headerR, c })] = { v, t: typeof v === "number" ? "n" : "s", s: headStyle };
  }

  r += 1;
  const genders = b.rowKeys;
  const dataStartR = r;
  const total = b.totalQty;
  const zongV = total === 0 ? "" : total;
  for (let gi = 0; gi < genders.length; gi += 1) {
    const gk = genders[gi]!;
    const rowIdx = r;
    let firstColStyle = styleDataCenter();
    if (tintBody && clubTintFillOpt) firstColStyle = mergeStyle(firstColStyle, { fill: clubTintFillOpt });
    ws[enc({ r: rowIdx, c: 0 })] = { v: gk, t: "s", s: firstColStyle };
    let rowSum = 0;
    for (let i = 0; i < L; i += 1) {
      const sz = colSizes[i]!;
      const q = b.qtyMap.get(`${gk}\0${sz}`) ?? 0;
      rowSum += q;
      const hasSizeCheck = Boolean(opts?.hasSizeCheckInCell?.(gk, sz));
      let cellStyle = styleDataCenter();
      if (tintBody && clubTintFillOpt) cellStyle = mergeStyle(cellStyle, { fill: clubTintFillOpt });
      if (hasSizeCheck) {
        if (opts?.modeKind === "duplicate" && q > 0) {
          cellStyle = mergeStyle(cellStyle, { border: { bottom: SIZE_CHECK_BOTTOM_BORDER } });
        } else {
          cellStyle = mergeStyle(cellStyle, { fill: EMPH_SIZE_CHECK_FILL });
        }
      }
      if (q === 0) {
        ws[enc({ r: rowIdx, c: 1 + i })] = { t: "s", v: "", s: cellStyle };
      } else {
        ws[enc({ r: rowIdx, c: 1 + i })] = { t: "n", v: q, s: cellStyle };
      }
    }
    if (rowSum === 0) {
      let sumStyle = styleDataCenter();
      if (tintBody && clubTintFillOpt) sumStyle = mergeStyle(sumStyle, { fill: clubTintFillOpt });
      ws[enc({ r: rowIdx, c: lastSumCol })] = { t: "s", v: "", s: sumStyle };
    } else {
      let sumStyle = styleDataCenter();
      if (tintBody && clubTintFillOpt) sumStyle = mergeStyle(sumStyle, { fill: clubTintFillOpt });
      ws[enc({ r: rowIdx, c: lastSumCol })] = { t: "n", v: rowSum, s: sumStyle };
    }
    if (gi === 0) {
      let zStyle = { ...styleDataCenter(), font: { bold: true } } as import("xlsx-js-style").CellStyle;
      if (tintBody && clubTintFillOpt) zStyle = mergeStyle(zStyle, { fill: clubTintFillOpt });
      ws[enc({ r: rowIdx, c: lastCol })] = {
        v: zongV,
        t: zongV === "" ? "s" : "n",
        s: zStyle,
      };
    } else {
      let zStyle = styleDataCenter();
      if (tintBody && clubTintFillOpt) zStyle = mergeStyle(zStyle, { fill: clubTintFillOpt });
      ws[enc({ r: rowIdx, c: lastCol })] = { t: "s", v: "", s: zStyle };
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

function collectSortedItemLabelsForExport(rows: any[]): string[] {
  return Array.from(
    new Set(
      rows
        .map((r) => String(r?.itemRaw ?? "").trim())
        .filter((x) => x.length > 0)
    )
  ).sort((a, b) => a.localeCompare(b, "ko"));
}

function buildClubAggregateStyledSheet(
  rows: any[],
  duplicateRowIds: Set<string>,
  opts?: { structureType?: StructureType }
): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  const enc = XLSX.utils.encode_cell;
  const isMultiItem = opts?.structureType === "multi_item_personal_order";

  const totalFlat = buildAggRowsTotal(rows, duplicateRowIds);
  const dedupFlat = buildAggRowsDedupedFirst(rows, duplicateRowIds);
  const dupFlat = buildAggRowsDuplicate(rows, duplicateRowIds);

  const modes = [
    { kind: "total" as const, label: "총 수량", flat: totalFlat },
    { kind: "deduped" as const, label: "중복 제외 수량", flat: dedupFlat },
    { kind: "duplicate" as const, label: "중복자 수량", flat: dupFlat },
  ] as const;

  const clubsOrdered = isMultiItem
    ? unionClubsOrdered([totalFlat])
    : unionClubsOrdered(modes.map((m) => m.flat));
  if (clubsOrdered.length === 0) {
    ws[enc({ r: 0, c: 0 })] = { v: "(집계할 데이터가 없습니다)", t: "s" };
    ws["!ref"] = "A1";
    return ws;
  }

  const merges: import("xlsx").Range[] = [];
  let cMax = 0;
  let r = 0;
  const sizeCheckCellKeys = new Set<string>();
  const sizeCheckColumnKeys = new Set<string>();
  for (const row of rows) {
    if (!shouldPrioritizeSizeCheckUiDisplay(row)) continue;
    const club = normClubFromNormRow(row);
    const { gender, size } = matrixAggGenderAndSizeFromRow(row);
    const gk = rowKeyGenderForAgg(gender);
    const sz = String(size ?? "").trim() || "미분류";
    sizeCheckCellKeys.add(`${club}\0${gk}\0${sz}`);
    sizeCheckCellKeys.add(`전체\0${gk}\0${sz}`);
    sizeCheckColumnKeys.add(`${club}\0${sz}`);
    sizeCheckColumnKeys.add(`전체\0${sz}`);
  }

  if (isMultiItem) {
    const sizeCheckKeysByItem = new Map<string, Set<string>>();
    const sizeCheckColsByItem = new Map<string, Set<string>>();
    for (const row of rows) {
      if (!shouldPrioritizeSizeCheckUiDisplay(row)) continue;
      const item = String(row?.itemRaw ?? "").trim();
      if (!item) continue;
      const { gender, size } = matrixAggGenderAndSizeFromRow(row);
      const gk = rowKeyGenderForAgg(gender);
      const sz = String(size ?? "").trim() || "미분류";
      const cellKey = `${gk}\0${sz}`;
      if (!sizeCheckKeysByItem.has(item)) sizeCheckKeysByItem.set(item, new Set());
      sizeCheckKeysByItem.get(item)!.add(cellKey);
      if (!sizeCheckColsByItem.has(item)) sizeCheckColsByItem.set(item, new Set());
      sizeCheckColsByItem.get(item)!.add(sz);
    }

    const overallModesTop = [{ kind: "total" as const, label: "전체 합계", flat: totalFlat }] as const;
    for (let mi = 0; mi < overallModesTop.length; mi += 1) {
      const mode = overallModesTop[mi]!;
      if (mi > 0) r += 1;
      const b = buildClubAggBlock("전체", mode.flat);
      const titleText = `${mode.label} (${b.totalQty}개)`;
      const out = appendClubMatrixSection(
        ws,
        enc,
        merges,
        r,
        b,
        titleText,
        styleClubAggBlockTitle(mode.kind),
        false,
        {
          modeKind: mode.kind,
          hasSizeCheckInCell: (gk, sz) => sizeCheckCellKeys.has(`전체\0${gk}\0${sz}`),
          hasSizeCheckInColumn: (sz) => sizeCheckColumnKeys.has(`전체\0${sz}`),
        }
      );
      r = out.r;
      cMax = Math.max(cMax, out.cMax);
    }

    r += 1;

    const items = collectSortedItemLabelsForExport(rows);
    for (let pi = 0; pi < items.length; pi += 1) {
      const item = items[pi]!;
      const flatItem = buildAggRowsDedupedFirstForItem(rows, duplicateRowIds, item);
      if (flatItem.length === 0) continue;
      if (pi > 0) r += 1;
      const b = buildClubAggBlock("전체", flatItem);
      const titleFill = MULTI_ITEM_PRODUCT_TITLE_FILLS[pi % MULTI_ITEM_PRODUCT_TITLE_FILLS.length]!;
      const titleStyle = mergeStyle(styleClubAggBlockTitle("deduped"), {
        fill: titleFill,
        alignment: { horizontal: "center", vertical: "center" },
      });
      const cellKeys = sizeCheckKeysByItem.get(item);
      const colKeys = sizeCheckColsByItem.get(item);
      const out = appendClubMatrixSection(ws, enc, merges, r, b, item, titleStyle, false, {
        modeKind: "deduped",
        hasSizeCheckInCell: (gk, sz) => cellKeys?.has(`${gk}\0${sz}`) ?? false,
        hasSizeCheckInColumn: (sz) => colKeys?.has(sz) ?? false,
      });
      r = out.r;
      cMax = Math.max(cMax, out.cMax);
    }

    const rMax = Math.max(0, r - 1);
    ws["!merges"] = merges;
    ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rMax, c: cMax } });
    autoFitColumns(ws, worksheetToAoa(ws));
    if (Array.isArray(ws["!cols"]) && ws["!cols"]![0] && typeof ws["!cols"]![0].wch === "number") {
      ws["!cols"]![0].wch = Math.max(4, ws["!cols"]![0].wch! * 0.5);
    }
    applyExcelDownloadFontToWorksheet(ws);
    return ws;
  }

  // 상단 전체 메트릭스 3블록 (단일 품목·일반)
  const overallModes = [
    { kind: "total" as const, label: "전체 합계", flat: totalFlat },
    { kind: "deduped" as const, label: "전체 일반 수량", flat: dedupFlat },
    { kind: "duplicate" as const, label: "전체 중복수량", flat: dupFlat },
  ] as const;
  for (let mi = 0; mi < overallModes.length; mi += 1) {
    const mode = overallModes[mi]!;
    if (mi > 0) r += 1;
    const b = buildClubAggBlock("전체", mode.flat);
    const titleText = `${mode.label} (${b.totalQty}개)`;
    const out = appendClubMatrixSection(
      ws,
      enc,
      merges,
      r,
      b,
      titleText,
      styleClubAggBlockTitle(mode.kind),
      false,
      {
        modeKind: mode.kind,
        hasSizeCheckInCell: (gk, sz) => sizeCheckCellKeys.has(`전체\0${gk}\0${sz}`),
        hasSizeCheckInColumn: (sz) => sizeCheckColumnKeys.has(`전체\0${sz}`),
      }
    );
    r = out.r;
    cMax = Math.max(cMax, out.cMax);
  }

  r += 1;

  for (let bi = 0; bi < clubsOrdered.length; bi += 1) {
    const club = clubsOrdered[bi]!;
    for (let mi = 0; mi < modes.length; mi += 1) {
      const mode = modes[mi]!;
      if (mi > 0) r += 1;
      const clubRows = mode.flat.filter((x) => x.club === club);
      const b = buildClubAggBlock(club, clubRows);
      const titleText = `${bi + 1}. ${b.club} · ${mode.label} ${b.totalQty}개`;
      const clubTintFill = bi % 2 === 0 ? CLUB_TINT_ODD_FILL : CLUB_TINT_EVEN_FILL;
      const out = appendClubMatrixSection(
        ws,
        enc,
        merges,
        r,
        b,
        titleText,
        styleClubAggBlockTitle(mode.kind),
        bi > 0 && mi === 0,
        {
          modeKind: mode.kind,
          hasSizeCheckInCell: (gk, sz) => sizeCheckCellKeys.has(`${club}\0${gk}\0${sz}`),
          hasSizeCheckInColumn: (sz) => sizeCheckColumnKeys.has(`${club}\0${sz}`),
          clubTintFill,
        }
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
  if (Array.isArray(ws["!cols"]) && ws["!cols"]![0] && typeof ws["!cols"]![0].wch === "number") {
    ws["!cols"]![0].wch = Math.max(4, ws["!cols"]![0].wch! * 0.5);
  }
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
    return st === "needs_review" || st === "unresolved" || shouldPrioritizeSizeCheckUiDisplay(r);
  });
  if (sub.length === 0) {
    return [header, ["(검토필요·미분류에 해당하는 행이 없습니다)"]];
  }
  const body = sub.map((r) => {
    const baseReason = labelSizeAnalysisReasonForRow(r);
    const isOutsideSize = shouldPrioritizeSizeCheckUiDisplay(r);
    const reason = isOutsideSize
      ? baseReason
        ? `${baseReason} · 범위외 사이즈`
        : "범위외 사이즈"
      : baseReason;
    return [
      r.sourceRowIndex ?? "",
      r.clubNameRaw ?? r.clubNameNormalized ?? "",
      r.memberNameRaw ?? "",
      r.genderNormalized ?? r.genderRaw ?? "",
      r.standardizedSize ?? r.sizeRaw ?? "",
      r.qtyParsed ?? r.qtyRaw ?? "",
      labelSizeAnalysisParseStatusForRow(r),
      reason,
      Number.isFinite(Number(r.parseConfidence)) ? Number(r.parseConfidence).toFixed(2) : "",
    ];
  });
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
