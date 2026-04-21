/**
 * 결과 표시(displayItems) 정렬: 비즈니스 로직과 분리.
 */

import type { BundleMatchResult, DisplayMatchItem, RowMatchResult } from "./types";

function statusRank(s: RowMatchResult["status"]): number {
  if (s === "full") return 0;
  if (s === "partial") return 1;
  return 2;
}

export function shortageDetailCount(r: RowMatchResult): number {
  return r.details.filter((d) => d.shortage > 0).length;
}

function bundleShortageKindCount(b: BundleMatchResult): number {
  return b.rowResults.reduce((s, r) => s + shortageDetailCount(r), 0);
}

export function compareRowMatchResult(a: RowMatchResult, b: RowMatchResult): number {
  const sr = statusRank(a.status) - statusRank(b.status);
  if (sr !== 0) return sr;
  if (a.totalShortage !== b.totalShortage) return a.totalShortage - b.totalShortage;
  const ka = shortageDetailCount(a);
  const kb = shortageDetailCount(b);
  if (ka !== kb) return ka - kb;
  return b.totalAllocated - a.totalAllocated;
}

export function compareBundleMatchResult(a: BundleMatchResult, b: BundleMatchResult): number {
  const sr = statusRank(a.status) - statusRank(b.status);
  if (sr !== 0) return sr;
  if (a.totalShortage !== b.totalShortage) return a.totalShortage - b.totalShortage;
  const ka = bundleShortageKindCount(a);
  const kb = bundleShortageKindCount(b);
  if (ka !== kb) return ka - kb;
  return b.totalAllocated - a.totalAllocated;
}

function displayMetrics(item: DisplayMatchItem) {
  if (item.kind === "standalone") {
    const r = item.result;
    return {
      status: r.status,
      totalShortage: r.totalShortage,
      shortageKinds: shortageDetailCount(r),
      totalAllocated: r.totalAllocated,
    };
  }
  const b = item.result;
  return {
    status: b.status,
    totalShortage: b.totalShortage,
    shortageKinds: bundleShortageKindCount(b),
    totalAllocated: b.totalAllocated,
  };
}

/** 완전 가능 → 부족합 ↑ → 부족 항목 수 ↑ → 충족(할당) ↓ */
export function compareDisplayMatchItems(a: DisplayMatchItem, b: DisplayMatchItem): number {
  const ma = displayMetrics(a);
  const mb = displayMetrics(b);
  const sr = statusRank(ma.status) - statusRank(mb.status);
  if (sr !== 0) return sr;
  if (ma.totalShortage !== mb.totalShortage) return ma.totalShortage - mb.totalShortage;
  if (ma.shortageKinds !== mb.shortageKinds) return ma.shortageKinds - mb.shortageKinds;
  return mb.totalAllocated - ma.totalAllocated;
}
