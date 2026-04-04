"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { buildProductImageCandidates } from "./imageUtils";
import {
  filterFailedProductImageCandidates,
  getProductImageFailureCacheVersion,
  markProductImageUrlFailed,
  subscribeProductImageFailureCache,
} from "./imageLoadFailureCache";

export type UseProductImageSrcResult = {
  /** 렌더할 URL 없으면 null — <img> 출력 금지 */
  src: string | null;
  onError: () => void;
  /** 후보 없음 또는 모두 로드 실패 */
  dead: boolean;
};

/**
 * 1) image_url 비어 있지 않으면 그 URL
 * 2) 그다음 /images/{SKU}.jpg
 * onError 시 URL을 세션 실패 캐시에 기록 → 후보에서 제외(모듈 + sessionStorage, 카드/리스트 전환 후에도 유지).
 */
export function useProductImageSrc(sku: string, imageUrl: string | null | undefined): UseProductImageSrcResult {
  const rawCandidates = useMemo(() => buildProductImageCandidates(sku, imageUrl), [sku, imageUrl]);

  const failVersion = useSyncExternalStore(
    subscribeProductImageFailureCache,
    getProductImageFailureCacheVersion,
    () => 0
  );

  const candidates = useMemo(
    () => filterFailedProductImageCandidates(rawCandidates),
    [rawCandidates, failVersion]
  );

  const [dead, setDead] = useState(() => filterFailedProductImageCandidates(rawCandidates).length === 0);

  useEffect(() => {
    setDead(candidates.length === 0);
  }, [candidates]);

  const errorOncePerUrl = useRef<Set<string>>(new Set());
  useEffect(() => {
    errorOncePerUrl.current.clear();
  }, [sku, imageUrl]);

  const src = dead || candidates.length === 0 ? null : candidates[0] ?? null;

  const onError = useCallback(() => {
    const u = candidates[0];
    if (!u) return;
    if (errorOncePerUrl.current.has(u)) return;
    errorOncePerUrl.current.add(u);
    markProductImageUrlFailed(u);
  }, [candidates]);

  return { src, onError, dead };
}
