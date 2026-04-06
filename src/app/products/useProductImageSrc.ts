"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { buildProductImageCandidates } from "./productImageCandidates";
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
 * 후보 순서는 `buildProductImageCandidates`와 동일 (image_url → 로컬 맵 → 맵 없을 때만 확장자 순 추측 URL).
 * onError 시 URL을 세션 실패 캐시에 기록 → 후보에서 제외.
 *
 * SSR/첫 하이드레이션: sessionStorage·실패 캐시를 읽지 않음(서버와 첫 클라 HTML 동일).
 * 마운트 후에만 필터 적용.
 */
export function useProductImageSrc(
  sku: string,
  imageUrl: string | null | undefined,
  updatedAt?: string | null,
  localImageHrefBySkuLower?: Record<string, string>
): UseProductImageSrcResult {
  const rawCandidates = useMemo(
    () => buildProductImageCandidates(sku, imageUrl, updatedAt, localImageHrefBySkuLower),
    [sku, imageUrl, updatedAt, localImageHrefBySkuLower]
  );

  const [applyFailureCache, setApplyFailureCache] = useState(false);
  useEffect(() => {
    setApplyFailureCache(true);
  }, []);

  const failVersion = useSyncExternalStore(
    subscribeProductImageFailureCache,
    getProductImageFailureCacheVersion,
    () => 0
  );

  const candidates = useMemo(() => {
    if (!applyFailureCache) return rawCandidates;
    return filterFailedProductImageCandidates(rawCandidates);
  }, [rawCandidates, failVersion, applyFailureCache]);

  const [dead, setDead] = useState(() => rawCandidates.length === 0);

  useEffect(() => {
    setDead(candidates.length === 0);
  }, [candidates]);

  const errorOncePerUrl = useRef<Set<string>>(new Set());
  useEffect(() => {
    errorOncePerUrl.current.clear();
  }, [sku, imageUrl, updatedAt]);

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
