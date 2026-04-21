/**
 * 엑셀/외부 소스에서 한 줄을 표준 `RequestLineInput`으로 만드는 헬퍼.
 * (수동 UI는 이미 동일 필드를 갖고 있으므로, 엑셀 어댑터가 이 함수를 쓰면 입력 경로가 하나로 합쳐진다.)
 */

import type { GarmentTypeId, RequestLineInput } from "./types";
import { normalizeGarmentTypeId } from "./clothingDimensionProfile";
import { normalizeText } from "./textNormalize";

export type ExcelLikeRowDraft = {
  rowId: string;
  category: string;
  garmentType: string;
  gender?: string;
  size?: string;
  quantity: number;
  bundleKey?: string;
};

export function toRequestLineInput(draft: ExcelLikeRowDraft): RequestLineInput {
  const gt = normalizeGarmentTypeId(draft.garmentType) ?? ("single" as GarmentTypeId);
  const bundleRaw = draft.bundleKey;
  const bundleKey =
    bundleRaw == null || String(bundleRaw).trim() === "" ? "" : normalizeText(String(bundleRaw));
  return {
    rowId: normalizeText(draft.rowId) || String(draft.rowId).trim(),
    category: normalizeText(draft.category),
    garmentType: gt,
    gender: normalizeText(draft.gender ?? ""),
    size: normalizeText(draft.size ?? ""),
    quantity: Math.max(0, Math.floor(Number(draft.quantity) || 0)),
    bundleKey,
  };
}
