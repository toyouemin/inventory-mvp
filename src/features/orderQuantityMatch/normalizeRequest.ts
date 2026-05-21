/** 주문 입력 행 → 정규화 수요 라인 (`matchOrderRowsToProducts` 등에서 사용). */

import type { NormalizedDemandLine, RequestLineInput } from "./types";
import {
  CLOTHING_DIMENSION_ORDER,
  buildClothingDimensionValues,
  summarizeDimensions,
} from "./clothingDimensionProfile";
import { normalizeBundleKey } from "./textNormalize";

export function normalizeRequestLine(row: RequestLineInput): NormalizedDemandLine {
  const dimensions = buildClothingDimensionValues({
    category: row.category,
    garmentType: row.garmentType,
    gender: row.gender,
    size: row.size,
  });
  const summaryLabel = summarizeDimensions(dimensions, CLOTHING_DIMENSION_ORDER);
  return {
    rowId: row.rowId,
    bundleKey: normalizeBundleKey(row.bundleKey),
    quantity: Math.max(0, Math.floor(Number(row.quantity) || 0)),
    dimensions,
    summaryLabel,
  };
}
