import { classifyFromTotals } from "./classifyStatus";
import { CLOTHING_DIMENSION_ORDER, summarizeDimensions } from "./clothingDimensionProfile";
import { buildMatchKey, parseMatchKey } from "./matchKey";
import { normalizeRequestLine } from "./normalizeRequest";
import type { MatchStatus, NormalizedStockLine, RequestLineInput } from "./types";

export type ProductShortageDetail = {
  matchKey: string;
  dimensionSummary: string;
  requested: number;
  allocated: number;
  shortage: number;
  availableStock: number;
};

export type ProductMatchResult = {
  productId: string;
  sku: string;
  displayName: string;
  status: MatchStatus;
  totalRequested: number;
  totalAllocated: number;
  totalShortage: number;
  shortageKinds: number;
  details: ProductShortageDetail[];
};

function statusRank(s: MatchStatus): number {
  if (s === "full") return 0;
  if (s === "partial") return 1;
  return 2;
}

function compareProductResults(a: ProductMatchResult, b: ProductMatchResult): number {
  const sr = statusRank(a.status) - statusRank(b.status);
  if (sr !== 0) return sr;
  if (a.totalShortage !== b.totalShortage) return a.totalShortage - b.totalShortage;
  if (a.shortageKinds !== b.shortageKinds) return a.shortageKinds - b.shortageKinds;
  if (a.totalAllocated !== b.totalAllocated) return b.totalAllocated - a.totalAllocated;
  return a.sku.localeCompare(b.sku, "ko");
}

function aggregateDemandByKey(rows: RequestLineInput[]): Map<string, number> {
  const byKey = new Map<string, number>();
  for (const row of rows) {
    const norm = normalizeRequestLine(row);
    if (norm.quantity <= 0) continue;
    const key = buildMatchKey(CLOTHING_DIMENSION_ORDER, norm.dimensions);
    byKey.set(key, (byKey.get(key) ?? 0) + norm.quantity);
  }
  return byKey;
}

export function matchOrderRowsToProducts(
  requestRows: RequestLineInput[],
  stockLines: NormalizedStockLine[]
): ProductMatchResult[] {
  const demandByKey = aggregateDemandByKey(requestRows);
  const demandEntries = [...demandByKey.entries()];
  if (demandEntries.length === 0) return [];

  const byProduct = new Map<string, NormalizedStockLine[]>();
  for (const line of stockLines) {
    const list = byProduct.get(line.productId) ?? [];
    list.push(line);
    byProduct.set(line.productId, list);
  }

  const out: ProductMatchResult[] = [];
  for (const [productId, lines] of byProduct.entries()) {
    if (lines.length === 0) continue;
    const first = lines[0]!;
    const stockByKey = new Map<string, number>();
    for (const line of lines) {
      const key = buildMatchKey(CLOTHING_DIMENSION_ORDER, line.dimensions);
      stockByKey.set(key, (stockByKey.get(key) ?? 0) + line.stock);
    }

    let totalRequested = 0;
    let totalAllocated = 0;
    let totalShortage = 0;
    const details: ProductShortageDetail[] = [];
    for (const [matchKey, requested] of demandEntries) {
      const availableStock = stockByKey.get(matchKey) ?? 0;
      const allocated = Math.min(requested, availableStock);
      const shortage = requested - allocated;
      totalRequested += requested;
      totalAllocated += allocated;
      totalShortage += shortage;
      const dims = parseMatchKey(CLOTHING_DIMENSION_ORDER, matchKey);
      details.push({
        matchKey,
        dimensionSummary: summarizeDimensions(dims, CLOTHING_DIMENSION_ORDER),
        requested,
        allocated,
        shortage,
        availableStock,
      });
    }
    const shortageKinds = details.filter((d) => d.shortage > 0).length;
    const status = classifyFromTotals(totalRequested, totalAllocated, totalShortage);
    out.push({
      productId,
      sku: first.sku,
      displayName: first.displayName,
      status,
      totalRequested,
      totalAllocated,
      totalShortage,
      shortageKinds,
      details,
    });
  }

  out.sort(compareProductResults);
  return out;
}

