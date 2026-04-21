/**
 * 동적 복합 키: 차원 순서는 프로필에서 주입 (고정 컬럼 비교 금지).
 */

import type { DimensionValues } from "./types";

export function buildMatchKey(dimensionOrder: readonly string[], dimensions: DimensionValues): string {
  return dimensionOrder.map((k) => `${k}=${dimensions[k] ?? ""}`).join("\x1f");
}

export function parseMatchKey(dimensionOrder: readonly string[], key: string): DimensionValues {
  const parts = key.split("\x1f");
  const out: DimensionValues = {};
  for (let i = 0; i < dimensionOrder.length; i++) {
    const seg = parts[i] ?? "";
    const eq = seg.indexOf("=");
    const name = eq >= 0 ? seg.slice(0, eq) : dimensionOrder[i]!;
    const val = eq >= 0 ? seg.slice(eq + 1) : "";
    out[name] = val;
  }
  return out;
}
