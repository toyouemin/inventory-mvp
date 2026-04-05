"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { updateProductMemo, updateVariantMemo } from "./actions";
import { useProductImageSrc } from "./useProductImageSrc";
import type { Product, ProductVariant } from "./types";
import { normalizeSkuForMatch, variantMatchesNormSku } from "./skuNormalize";
import { formatGenderSizeDisplay, sortVariantRows, variantCompositeKey } from "./variantOptions";

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
  /** public/images 스캔 맵(빈 객체면 SKU 기반 .jpg 추측 URL 비활성화) */
  localImageHrefBySkuLower: Record<string, string>;
  variants?: ProductVariant[];
  onEditClick?: (productId: string) => void;
  onDeleteClick?: (productId: string) => void | Promise<void>;
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
};

export const ProductCard = memo(function ProductCard({
  product,
  localImageHrefBySkuLower,
  variants = [],
  onEditClick,
  onDeleteClick,
  onProductStockDelta,
  onVariantStockDelta,
  productStockSaving = false,
  savingVariantIdsKey = "",
  debugProductsDupes = false,
  displayGroupNormSku = "",
  debugVariantSkuMix = false,
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
  const safeVariants = Array.isArray(variants) ? variants : [];

  const { src: imgSrc, onError: onImgError, dead: imgDead } = useProductImageSrc(
    product.sku,
    product.imageUrl,
    localImageHrefBySkuLower
  );

  useEffect(() => {
    if (imgDead) setImageOpen(false);
  }, [imgDead]);

  const savingVariantSet = useMemo(
    () => new Set(savingVariantIdsKey.split(",").filter(Boolean)),
    [savingVariantIdsKey]
  );

  const sortedVariants = useMemo(() => {
    const copy = [...safeVariants];
    return copy.sort((a, b) => sortVariantRows(a, b));
  }, [safeVariants]);

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

  /** CSV·현재 스키마는 가격이 variants에만 있고 products 가격은 비는 경우가 많음 → 상단은 상품값 우선, 없으면 정렬된 첫 variant */
  const headerPrices = useMemo(() => {
    const rep = sortedVariants[0];
    return {
      wholesalePrice: product.wholesalePrice ?? rep?.wholesalePrice ?? null,
      msrpPrice: product.msrpPrice ?? rep?.msrpPrice ?? null,
      salePrice: product.salePrice ?? rep?.salePrice ?? null,
      extraPrice: product.extraPrice ?? rep?.extraPrice ?? null,
    };
  }, [product, sortedVariants]);

  function handleAdjustProduct(delta: number) {
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
            <h3 className="product-card__name">{displayName}</h3>
            <div className="product-card__head-actions">
              <button
                type="button"
                className="btn btn-secondary btn-compact btn-strong product-card__head-action-edit"
                onClick={() => onEditClick?.(product.id)}
              >
                수정
              </button>
              {onDeleteClick ? (
                <button
                  type="button"
                  className="btn btn-danger btn-compact product-card__head-action-delete"
                  onClick={() => void onDeleteClick(product.id)}
                >
                  삭제
                </button>
              ) : null}
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

        <div className="product-card__stocks">
          {hasVariants ? (
            <div className="product-card__option-list" role="list" aria-label="옵션 목록">
              {sortedVariants.map((variant) => {
                const qty = variant?.stock ?? 0;
                const variantSaving = savingVariantSet.has(variant.id);
                const variantMemo = (variant?.memo ?? "").trim();
                const variantMemo2 = (variant?.memo2 ?? "").trim();
                const variantMemoText =
                  variantMemo && variantMemo2
                    ? `${variantMemo} / ${variantMemo2}`
                    : variantMemo || variantMemo2;
                return (
                  <div className="product-card__option-item" role="listitem" key={variant.id}>
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
                          {variantMemoText ? (
                            variantOptionLabelsOverlap ? (
                              <span
                                className="product-card__memo-has"
                                title={variantMemoText}
                                aria-label={`메모: ${variantMemoText}`}
                              />
                            ) : (
                              <span className="product-card__memo product-card__memo--filled product-card__memo--by-qty">
                                {variantMemoText}
                              </span>
                            )
                          ) : null}
                        </div>
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
                            disabled={variantSaving || qty < 1}
                          >
                            -1
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAdjustVariant(variant, 1)}
                            disabled={variantSaving}
                          >
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
                      {(product?.memo ?? "").trim() || (product?.memo2 ?? "").trim() ? (
                        <span className="product-card__memo product-card__memo--filled product-card__memo--by-qty">
                          {[(product?.memo ?? "").trim(), (product?.memo2 ?? "").trim()].filter(Boolean).join(" / ")}
                        </span>
                      ) : null}
                    </div>
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
                        disabled={productStockSaving || (product?.stock ?? 0) < 1}
                      >
                        -1
                      </button>
                      <button type="button" onClick={() => handleAdjustProduct(1)} disabled={productStockSaving}>
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
            onClick={(e) => e.stopPropagation()}
            onError={onImgError}
          />
        </div>
      ) : null}
    </article>
  );
});
