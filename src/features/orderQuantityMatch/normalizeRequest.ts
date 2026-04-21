/**
 * 주문 입력 행 → 정규화 수요 라인.
 *
 * 엑셀 등 외부 소스는 `toRequestLineInput`으로 먼저 `RequestLineInput`을 만든 뒤,
 * 여기 `normalizeRequestLine`을 거치면 매칭 키와 동일한 차원 맵이 된다(`excelPipelineContract.ts` 참고).
 */

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
