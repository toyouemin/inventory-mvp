/**
 * 정규화된 재고 맵 + 주문 행 → 비교·집계·표시 순서.
 *
 * 부작용 없음: 입력 스뮬레이션만 하며, 전달된 배열·맵을 변형하지 않는다(할당 시 재고 맵은 복사본 사용).
 */

import type {
  BundleMatchResult,
  DisplayMatchItem,
  LineShortageDetail,
  MatchReport,
  NormalizedStockLine,
  RequestLineInput,
  RowMatchResult,
} from "./types";
import { CLOTHING_DIMENSION_ORDER, summarizeDimensions } from "./clothingDimensionProfile";
import type { DemandAtom } from "./allocateStock";
import { allocateDemandFcfs } from "./allocateStock";
import { classifyFromTotals } from "./classifyStatus";
import {
  compareBundleMatchResult,
  compareDisplayMatchItems,
  compareRowMatchResult,
} from "./displaySort";
import { buildMatchKey, parseMatchKey } from "./matchKey";
import { aggregateStockByKey } from "./normalizeInventory";
import { normalizeRequestLine } from "./normalizeRequest";

const DIMENSION_ORDER = CLOTHING_DIMENSION_ORDER;

function garmentTypeOrder(t: RequestLineInput["garmentType"]): number {
  if (t === "top") return 0;
  if (t === "bottom") return 1;
  return 2;
}

function buildAtomsFromRequests(rows: RequestLineInput[]): DemandAtom[] {
  const atoms: DemandAtom[] = [];
  let order = 0;
  for (const row of rows) {
    const norm = normalizeRequestLine(row);
    if (norm.quantity <= 0) continue;
    const matchKey = buildMatchKey(DIMENSION_ORDER, norm.dimensions);
    atoms.push({
      atomId: `${row.rowId}\x1f${order}`,
      rowId: row.rowId,
      bundleKey: norm.bundleKey,
      matchKey,
      quantity: norm.quantity,
      sortOrder: order++,
    });
  }
  return atoms;
}

export function matchOrderRowsToStock(requestRows: RequestLineInput[], stockLines: NormalizedStockLine[]): MatchReport {
  const initialStockByKey = aggregateStockByKey(stockLines, DIMENSION_ORDER);
  const atoms = buildAtomsFromRequests(requestRows);
  const { perAtom } = allocateDemandFcfs(atoms, new Map(initialStockByKey));

  const rowIds = [...new Set(requestRows.map((r) => r.rowId))];
  const rowMeta = new Map<
    string,
    { garmentType: RequestLineInput["garmentType"]; summaryLabel: string; bundleKey: string | null }
  >();
  for (const r of requestRows) {
    const norm = normalizeRequestLine(r);
    rowMeta.set(r.rowId, {
      garmentType: r.garmentType,
      summaryLabel: norm.summaryLabel,
      bundleKey: norm.bundleKey,
    });
  }

  const rowResultsMap = new Map<string, RowMatchResult>();

  for (const rowId of rowIds) {
    const atomsOfRow = atoms.filter((a) => a.rowId === rowId);
    const meta = rowMeta.get(rowId)!;
    let totalRequested = 0;
    let totalAllocated = 0;
    let totalShortage = 0;
    const details: LineShortageDetail[] = [];

    for (const a of atomsOfRow) {
      const res = perAtom.get(a.atomId) ?? { allocated: 0, shortage: a.quantity };
      totalRequested += a.quantity;
      totalAllocated += res.allocated;
      totalShortage += res.shortage;
      const dims = parseMatchKey(DIMENSION_ORDER, a.matchKey);
      details.push({
        matchKey: a.matchKey,
        dimensionSummary: summarizeDimensions(dims, DIMENSION_ORDER),
        requested: a.quantity,
        allocated: res.allocated,
        shortage: res.shortage,
        availableStock: initialStockByKey.get(a.matchKey) ?? 0,
      });
    }

    const status = classifyFromTotals(totalRequested, totalAllocated, totalShortage);
    rowResultsMap.set(rowId, {
      rowId,
      bundleKey: meta.bundleKey,
      summaryLabel: meta.summaryLabel,
      garmentType: meta.garmentType,
      status,
      totalRequested,
      totalAllocated,
      totalShortage,
      details,
    });
  }

  const bundleKeys = new Set(
    requestRows.map((r) => normalizeRequestLine(r).bundleKey).filter((k): k is string => Boolean(k))
  );

  const standaloneRows: RowMatchResult[] = [];
  const bundles: BundleMatchResult[] = [];

  for (const rowId of rowIds) {
    const rr = rowResultsMap.get(rowId)!;
    if (!rr.bundleKey) standaloneRows.push(rr);
  }

  for (const bk of bundleKeys) {
    const rowResults = rowIds
      .map((id) => rowResultsMap.get(id)!)
      .filter((r) => r.bundleKey === bk)
      .sort((a, b) => garmentTypeOrder(a.garmentType) - garmentTypeOrder(b.garmentType));
    if (rowResults.length === 0) continue;
    const totalRequested = rowResults.reduce((s, r) => s + r.totalRequested, 0);
    const totalAllocated = rowResults.reduce((s, r) => s + r.totalAllocated, 0);
    const totalShortage = rowResults.reduce((s, r) => s + r.totalShortage, 0);
    const status = classifyFromTotals(totalRequested, totalAllocated, totalShortage);
    bundles.push({ bundleKey: bk, rowResults, status, totalRequested, totalAllocated, totalShortage });
  }

  const standaloneSorted = [...standaloneRows].sort(compareRowMatchResult);
  const bundlesSorted = [...bundles].sort(compareBundleMatchResult);

  const displayItems: DisplayMatchItem[] = [];
  for (const r of standaloneSorted) {
    displayItems.push({ kind: "standalone", result: r });
  }
  for (const b of bundlesSorted) {
    displayItems.push({ kind: "bundle", result: b });
  }

  displayItems.sort(compareDisplayMatchItems);

  return { standaloneRows: standaloneSorted, bundles: bundlesSorted, displayItems };
}
