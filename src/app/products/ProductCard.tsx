"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import { updateProductMemo, updateVariantMemo } from "./actions";
import { useProductImageSrc } from "./useProductImageSrc";
import type { Product, ProductVariant } from "./types";
import { normalizeSkuForMatch, variantMatchesNormSku } from "./skuNormalize";
import { formatGenderSizeDisplay, sortVariants, variantCompositeKey } from "./variantOptions";

function dbgStockCard(phase: string, data: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  if (new URLSearchParams(window.location.search).get("debugStockAdjust") !== "1") return;
  console.info(`[stockAdjust][ProductCard] ${phase}`, { ...data, t: performance.now() });
}

function VariantOptionChips({ variant }: { variant: ProductVariant }) {
  const color = (variant.color ?? "").trim();
  const gs = formatGenderSizeDisplay(variant.gender, variant.size);
  const chips = [color, gs].filter(Boolean);
  if (chips.length === 0) return null;
  return (
    <span className="product-card__opt-chips">
      {chips.map((c, i) => (
        <span key={`${i}-${c}`} className="product-card__opt-chip">
          {c}
        </span>
      ))}
    </span>
  );
}

function PriceLabel({ full, mobile }: { full: string; mobile: string }) {
  return (
    <>
      <span className="product-card__label-full">{full}</span>
      <span className="product-card__label-mobile">{mobile}</span>
    </>
  );
}

function fmtPrice(n: number | null | undefined) {
  if (n == null || !Number.isFinite(Number(n))) return "-";
  return `${Number(n).toLocaleString()}원`;
}

export type ProductCardProps = {
  product: Product;
  /** `getLocalImageHrefBySkuLower()` 맵(키 = 정규화 SKU) */
  localImageHrefBySkuLower: Record<string, string>;
  variants?: ProductVariant[];
  /** 가격 계산용 원본 옵션(재고0 필터 전). 없으면 `variants` 사용 */
  priceSourceVariants?: ProductVariant[];
  onEditClick?: (productId: string) => void;
  onProductStockDelta?: (productId: string, delta: number) => void | Promise<void>;
  onVariantStockDelta?: (productId: string, variantId: string, delta: number) => void | Promise<void>;
  productStockSaving?: boolean;
  savingVariantIdsKey?: string;
  /** `?debugProductsDupes=1` — 렌더 시 id/sku 로그 */
  debugProductsDupes?: boolean;
  /** SKU 표시 그룹 정규화 키(병합 카드 기준 normSku) */
  displayGroupNormSku?: string;
  /** `?debugVariantSkuMix=1` — 카드에 붙은 각 variant의 product_id·sku·normSku 로그 */
  debugVariantSkuMix?: boolean;
  /** 재고0 토글 상태(ON + 0수량 + 메모 있음 행 흐림 처리용) */
  hideZeroStock?: boolean;
  /** 재고 0 숨김 ON인데 옵션이 모두 0일 때 안내 */
  showNoVisibleOptionsHint?: boolean;
  /** 툴바·카드 공통: 메모 본문 전체 표시 여부 */
  memoShowAll: boolean;
  onMemoShowAllChange: (next: boolean) => void;
};

export const ProductCard = memo(function ProductCard({
  product,
  localImageHrefBySkuLower,
  variants = [],
  priceSourceVariants,
  onEditClick,
  onProductStockDelta,
  onVariantStockDelta,
  productStockSaving = false,
  savingVariantIdsKey = "",
  debugProductsDupes = false,
  displayGroupNormSku = "",
  debugVariantSkuMix = false,
  hideZeroStock = false,
  showNoVisibleOptionsHint = false,
  memoShowAll,
  onMemoShowAllChange,
}: ProductCardProps) {
  const debugInstanceId = useRef(
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `rnd-${Math.random().toString(36).slice(2)}`
  );
  const [imageOpen, setImageOpen] = useState(false);
  const [editingMemoVariantId, setEditingMemoVariantId] = useState<string | null>(null);
  const [editingProductMemo, setEditingProductMemo] = useState(false);
  const [memoDraft1, setMemoDraft1] = useState("");
  const [memoDraft2, setMemoDraft2] = useState("");
  const [memoPending, setMemoPending] = useState(false);
  /** id 없는 행은 ±·키·저장 키에서 제외 — 병합·정렬 단계 예외 방지 */
  const safeVariants = useMemo(
    () => (Array.isArray(variants) ? variants : []).filter((v) => v && String(v.id ?? "").trim()),
    [variants]
  );
  const safePriceSourceVariants = useMemo(
    () =>
      (Array.isArray(priceSourceVariants) ? priceSourceVariants : safeVariants).filter(
        (v) => v && String(v.id ?? "").trim()
      ),
    [priceSourceVariants, safeVariants]
  );

  const { src: imgSrc, onError: onImgError, dead: imgDead } = useProductImageSrc(
    product.sku,
    product.imageUrl,
    product.updatedAt,
    localImageHrefBySkuLower
  );

  useEffect(() => {
    if (imgDead) setImageOpen(false);
  }, [imgDead]);

  const savingVariantSet = useMemo(
    () => new Set(savingVariantIdsKey.split(",").filter(Boolean)),
    [savingVariantIdsKey]
  );

  const sortedVariants = useMemo(() => sortVariants(safeVariants), [safeVariants]);
  const sortedPriceSourceVariants = useMemo(() => sortVariants(safePriceSourceVariants), [safePriceSourceVariants]);

  useEffect(() => {
    if (!debugVariantSkuMix || !displayGroupNormSku.trim()) return;
    console.info("[productsPipeline][cardVariantSkuMix]", {
      cardNormSku: displayGroupNormSku,
      representativeProductId: product.id,
      variants: sortedVariants.map((v) => {
        const vn = normalizeSkuForMatch(v.sku);
        return {
          product_id: v.productId,
          variant_id: v.id,
          variant_sku: v.sku,
          variantNormSku: vn || "(empty)",
          cardNormSku: displayGroupNormSku,
          matchesCardNormSku: variantMatchesNormSku(v, displayGroupNormSku),
        };
      }),
    });
  }, [debugVariantSkuMix, displayGroupNormSku, product.id, sortedVariants]);

  const variantOptionLabelsOverlap = useMemo(() => {
    if (sortedVariants.length <= 1) return false;
    const counts = new Map<string, number>();
    for (const v of sortedVariants) {
      const label = variantCompositeKey(v.color, v.gender, v.size) || v.id;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.values()].some((c) => c > 1);
  }, [sortedVariants]);

  const hasVariants = sortedVariants.length > 0;
  const productStockQty = useMemo(() => {
    const n = Number(product?.stock);
    return Number.isFinite(n) ? n : 0;
  }, [product?.stock]);
  /** 품명 옆 총재고: 옵션이 2개 이상일 때만 표시 */
  const showNameTotalStock = sortedVariants.length >= 2;
  const totalVariantStock = useMemo(() => {
    if (sortedVariants.length < 2) return 0;
    return sortedVariants.reduce((sum, v) => {
      const n = Number(v.stock);
      return sum + (Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0);
    }, 0);
  }, [sortedVariants]);

  const hasAnyMemo = useMemo(() => {
    if ((product?.memo ?? "").trim() || (product?.memo2 ?? "").trim()) return true;
    return sortedVariants.some((v) => (v.memo ?? "").trim() || (v.memo2 ?? "").trim());
  }, [product?.memo, product?.memo2, sortedVariants]);

  /** CSV·현재 스키마는 가격이 variants에만 있고 products 가격은 비는 경우가 많음 → 상단은 상품값 우선, 없으면 정렬된 첫 variant */
  const headerPrices = useMemo(() => {
    const rep = sortedPriceSourceVariants[0];
    return {
      wholesalePrice: product.wholesalePrice ?? rep?.wholesalePrice ?? null,
      msrpPrice: product.msrpPrice ?? rep?.msrpPrice ?? null,
      salePrice: product.salePrice ?? rep?.salePrice ?? null,
      extraPrice: product.extraPrice ?? rep?.extraPrice ?? null,
    };
  }, [product, sortedPriceSourceVariants]);

  function handleAdjustProduct(delta: number) {
    dbgStockCard("card_product_btn_click", { productId: product.id, delta });
    void onProductStockDelta?.(product.id, delta);
  }

  function handleAdjustVariant(variant: ProductVariant, delta: number) {
    if (!variant?.id) {
      console.warn(
        `[variant-match-fail] sku=${product?.sku ?? ""} variant=${JSON.stringify({
          id: variant?.id,
          key: variantCompositeKey(variant?.color, variant?.gender, variant?.size),
        })}`
      );
      return;
    }
    dbgStockCard("card_variant_btn_click", {
      productId: variant.productId,
      variantId: variant.id,
      delta,
    });
    void onVariantStockDelta?.(variant.productId, variant.id, delta);
  }

  function openMemoEditor(variant: ProductVariant) {
    setEditingProductMemo(false);
    setEditingMemoVariantId(variant.id);
    setMemoDraft1((variant.memo ?? "").trim());
    setMemoDraft2((variant.memo2 ?? "").trim());
  }

  function openProductMemoEditor() {
    setEditingMemoVariantId(null);
    setEditingProductMemo(true);
    setMemoDraft1((product.memo ?? "").trim());
    setMemoDraft2((product.memo2 ?? "").trim());
  }

  async function handleSaveMemo(variantId: string) {
    if (memoPending) return;
    setMemoPending(true);
    try {
      await updateVariantMemo(variantId, memoDraft1, memoDraft2);
      setEditingMemoVariantId(null);
    } finally {
      setMemoPending(false);
    }
  }

  async function handleSaveProductMemo() {
    if (memoPending) return;
    setMemoPending(true);
    try {
      await updateProductMemo(product.id, memoDraft1, memoDraft2);
      setEditingProductMemo(false);
    } finally {
      setMemoPending(false);
    }
  }

  const displayName = (product?.name ?? "").trim() || product?.sku || "-";

  const stockUpdatedAtShort = useMemo(() => {
    const raw = product?.stockUpdatedAt;
    if (!raw) return "-";
    const d = dayjs(raw);
    return d.isValid() ? d.format("YY/MM/DD HH:mm") : "-";
  }, [product?.stockUpdatedAt]);

  const stockChangeSummaryLine = (product?.stockChangeSummary ?? "").trim();

  if (debugProductsDupes) {
    console.info("[productsPipeline][ProductCard render]", {
      componentInstance: debugInstanceId.current,
      productId: product.id,
      sku: product.sku,
    });
  }

  /**
   * DOM에 `article.product-card`는 이 컴포넌트 호출당 정확히 1개.
   * 옵션 행은 `sortedVariants.map` → `div.product-card__option-item`만 생성(카드 전체 반복 없음).
   */
  return (
    <article className="product-card" data-product-id={product.id}>
      {!imgDead && imgSrc ? (
        <button
          type="button"
          className="product-card__image"
          onClick={() => setImageOpen(true)}
          aria-label="상품 이미지 확대"
        >
          <img
            src={imgSrc}
            alt={displayName}
            loading="lazy"
            decoding="async"
            onError={onImgError}
          />
        </button>
      ) : (
        <div className="product-card__image" aria-hidden="true">
          <div className="product-card__placeholder">이미지 없음</div>
        </div>
      )}

      <div className="product-card__body">
        <div className="product-card__mobile-head">
          <div className="product-card__head-text">
            <div className="product-card__sku">{product?.sku ?? "-"}</div>
            <div className="product-card__head-category-line">
              {product?.category?.trim() ? (
                <span className="product-card__category product-card__category--head">{product.category}</span>
              ) : (
                <span className="product-card__category product-card__category--head product-card__category--placeholder">
                  —
                </span>
              )}
            </div>
            <h3 className="product-card__name">
              {displayName}
              {showNameTotalStock ? (
                <span className="product-card__name-total"> (총 {totalVariantStock.toLocaleString()})</span>
              ) : null}
            </h3>
            <div className="product-card__head-actions">
              <button
                type="button"
                className="btn btn-secondary btn-compact btn-strong product-card__head-action-edit"
                onClick={() => onEditClick?.(product.id)}
              >
                수정
              </button>
              <span
                className="product-card__head-stock-updated-at"
                title={
                  product?.stockUpdatedAt
                    ? stockChangeSummaryLine !== ""
                      ? `${dayjs(product.stockUpdatedAt).format("YYYY-MM-DD HH:mm")}\n${stockChangeSummaryLine}`
                      : dayjs(product.stockUpdatedAt).format("YYYY-MM-DD HH:mm")
                    : undefined
                }
              >
                <span className="product-card__head-stock-date">{stockUpdatedAtShort}</span>
                {stockChangeSummaryLine !== "" ? (
                  <span className="product-card__head-stock-summary">{stockChangeSummaryLine}</span>
                ) : null}
              </span>
            </div>
          </div>
          {!imgDead && imgSrc ? (
            <button
              type="button"
              className="product-card__thumb"
              onClick={() => setImageOpen(true)}
              aria-label="상품 썸네일 확대"
            >
              <img
                src={imgSrc}
                alt={displayName}
                loading="lazy"
                decoding="async"
                onError={onImgError}
              />
            </button>
          ) : (
            <div className="product-card__thumb" aria-hidden="true">
              <div className="product-card__placeholder">이미지 없음</div>
            </div>
          )}
        </div>

        <div className="product-card__prices">
          <span>
            <PriceLabel full="출고가:" mobile="출:" /> {fmtPrice(headerPrices.wholesalePrice)}
          </span>
          <span>
            <PriceLabel full="소비자가:" mobile="소:" /> {fmtPrice(headerPrices.msrpPrice)}
          </span>
          <span>
            <PriceLabel full="실판매가:" mobile="실:" /> {fmtPrice(headerPrices.salePrice)}
          </span>
          <span>
            <PriceLabel full="매장:" mobile="매:" /> {fmtPrice(headerPrices.extraPrice)}
          </span>
        </div>

        <div
          className={`product-card__stocks${hasAnyMemo ? " product-card__stocks--with-memo-toggle" : ""}${
            memoShowAll ? " product-card__stocks--memo-expanded" : ""
          }`}
        >
          {hasAnyMemo ? (
            <button
              type="button"
              className={`product-card__memo-visibility-toggle${memoShowAll ? " is-active" : ""}`}
              onClick={() => onMemoShowAllChange(!memoShowAll)}
              aria-pressed={memoShowAll}
              title={memoShowAll ? "메모 전체 끄기(모든 카드)" : "메모 전체 켜기(모든 카드)"}
            >
              메모
            </button>
          ) : null}
          {showNoVisibleOptionsHint ? (
            <div
              className="product-card__option-list product-card__option-list--novis"
              role="status"
              aria-live="polite"
            >
              <p className="product-card__no-visible-options muted">재고 없음</p>
            </div>
          ) : hasVariants ? (
            <div className="product-card__option-list" role="list" aria-label="옵션 목록">
              {sortedVariants.map((variant) => {
                const qtyRaw = Number(variant?.stock);
                const qty = Number.isFinite(qtyRaw) ? qtyRaw : 0;
                const variantSaving = savingVariantSet.has(variant.id);
                const variantMemo = (variant?.memo ?? "").trim();
                const variantMemo2 = (variant?.memo2 ?? "").trim();
                const variantMemoText =
                  variantMemo && variantMemo2
                    ? `${variantMemo} / ${variantMemo2}`
                    : variantMemo || variantMemo2;
                const shouldDimZeroMemo = hideZeroStock && qty < 1 && Boolean(variantMemoText);
                return (
                  <div
                    className={`product-card__option-item${shouldDimZeroMemo ? " product-card__option-item--zero-muted" : ""}`}
                    role="listitem"
                    key={variant.id}
                  >
                    <div className="product-card__option-row">
                      <div
                        className="product-card__option-chips-scroll"
                        role="region"
                        aria-label="옵션 — 옆으로 밀어 전체 보기"
                      >
                        <span className="product-card__option-name product-card__option-name--chips">
                          <VariantOptionChips variant={variant} />
                        </span>
                      </div>
                      <div className="product-card__option-right">
                        <span className="product-card__stock-label">재고</span>
                        <div className="product-card__option-qty">
                          <strong>{qty}</strong>
                          {variantSaving ? (
                            <span className="stock-adjust-pending" aria-label="저장 중" />
                          ) : null}
                        </div>
                        {variantMemoText && memoShowAll ? (
                          <span
                            className={`product-card__memo product-card__memo--filled product-card__memo--by-qty${
                              memoShowAll ? " product-card__memo--expanded" : ""
                            }${shouldDimZeroMemo ? " product-card__memo--keep-visible" : ""}`}
                          >
                            {variantMemoText}
                          </span>
                        ) : null}
                        <button
                          type="button"
                          className={`product-card__memo-btn${variantMemoText ? " product-card__memo-btn--filled" : ""}`}
                          onClick={() =>
                            editingMemoVariantId === variant.id
                              ? setEditingMemoVariantId(null)
                              : openMemoEditor(variant)
                          }
                          disabled={memoPending}
                        >
                          메모
                        </button>
                        <div className="product-card__adjust">
                          <button
                            type="button"
                            onClick={() => handleAdjustVariant(variant, -1)}
                            disabled={!Number.isFinite(qty) || qty < 1}
                          >
                            -1
                          </button>
                          <button type="button" onClick={() => handleAdjustVariant(variant, 1)}>
                            +1
                          </button>
                        </div>
                      </div>
                    </div>
                    {editingMemoVariantId === variant.id ? (
                      <div className="product-card__memo-editor">
                        <input
                          type="text"
                          value={memoDraft1}
                          onChange={(e) => setMemoDraft1(e.target.value)}
                          placeholder="비고1"
                        />
                        <input
                          type="text"
                          value={memoDraft2}
                          onChange={(e) => setMemoDraft2(e.target.value)}
                          placeholder="비고2"
                        />
                        <div className="product-card__memo-actions">
                          <button type="button" onClick={() => handleSaveMemo(variant.id)} disabled={memoPending}>
                            저장
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => setEditingMemoVariantId(null)}
                            disabled={memoPending}
                          >
                            취소
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="product-card__option-list" role="list" aria-label="옵션 목록">
              <div className="product-card__option-item" role="listitem">
                <div className="product-card__option-row">
                  <div
                    className="product-card__option-chips-scroll"
                    role="region"
                    aria-label="옵션 — 옆으로 밀어 전체 보기"
                  >
                    <span className="product-card__option-name" aria-hidden="true" />
                  </div>
                  <div className="product-card__option-right">
                    <span className="product-card__stock-label">재고</span>
                    <div className="product-card__option-qty">
                      <strong>{product?.stock ?? "-"}</strong>
                      {productStockSaving ? (
                        <span className="stock-adjust-pending" aria-label="저장 중" />
                      ) : null}
                    </div>
                    {((product?.memo ?? "").trim() || (product?.memo2 ?? "").trim()) && memoShowAll ? (
                      <span
                        className={`product-card__memo product-card__memo--filled product-card__memo--by-qty${
                          memoShowAll ? " product-card__memo--expanded" : ""
                        }`}
                      >
                        {[(product?.memo ?? "").trim(), (product?.memo2 ?? "").trim()].filter(Boolean).join(" / ")}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className={`product-card__memo-btn${
                        (product?.memo ?? "").trim() || (product?.memo2 ?? "").trim()
                          ? " product-card__memo-btn--filled"
                          : ""
                      }`}
                      onClick={() => (editingProductMemo ? setEditingProductMemo(false) : openProductMemoEditor())}
                      disabled={memoPending}
                    >
                      메모
                    </button>
                    <div className="product-card__adjust">
                      <button
                        type="button"
                        onClick={() => handleAdjustProduct(-1)}
                        disabled={productStockQty < 1}
                      >
                        -1
                      </button>
                      <button type="button" onClick={() => handleAdjustProduct(1)}>
                        +1
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
          {!hasVariants && editingProductMemo ? (
            <div className="product-card__memo-editor">
              <input
                type="text"
                value={memoDraft1}
                onChange={(e) => setMemoDraft1(e.target.value)}
                placeholder="비고1"
              />
              <input
                type="text"
                value={memoDraft2}
                onChange={(e) => setMemoDraft2(e.target.value)}
                placeholder="비고2"
              />
              <div className="product-card__memo-actions">
                <button type="button" onClick={handleSaveProductMemo} disabled={memoPending}>
                  저장
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setEditingProductMemo(false)}
                  disabled={memoPending}
                >
                  취소
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {imageOpen && imgSrc && !imgDead ? (
        <div className="product-image-modal" role="dialog" aria-modal="true" onClick={() => setImageOpen(false)}>
          <button
            type="button"
            className="product-image-modal__close"
            onClick={() => setImageOpen(false)}
            aria-label="이미지 닫기"
          >
            닫기
          </button>
          <img
            className="product-image-modal__img"
            src={imgSrc}
            alt={displayName}
            decoding="async"
            onError={onImgError}
          />
        </div>
      ) : null}
    </article>
  );
});
