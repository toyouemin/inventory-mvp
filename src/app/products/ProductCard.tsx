"use client";

import { useState, useMemo, useEffect } from "react";
import { adjustStock, adjustVariantStock } from "./actions";
import type { Product, ProductVariant } from "./types";
import { sortSizes } from "./sizeUtils";

function toOptionDisplay(v: ProductVariant): string {
  const value = (v.size ?? "").trim();
  return value || "(없음)";
}

function PriceLabel({ full, mobile }: { full: string; mobile: string }) {
  return (
    <>
      <span className="product-card__label-full">{full}</span>
      <span className="product-card__label-mobile">{mobile}</span>
    </>
  );
}

export function ProductCard({
  product,
  variants = [],
  onEditClick,
  onDeleteClick,
}: {
  product: Product;
  variants?: ProductVariant[];
  onEditClick?: () => void;
  onDeleteClick?: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  const safeVariants = Array.isArray(variants) ? variants : [];

  const sortedVariants = useMemo(() => {
    const copy = [...safeVariants];
    return copy.sort((a, b) => sortSizes(a.size ?? "", b.size ?? ""));
  }, [safeVariants]);
  const hasVariants = sortedVariants.length > 0;
  const hasImage = Boolean(product?.imageUrl);
  async function handleAdjustProduct(delta: number) {
    if (pending) return;
    setPending(true);
    try {
      await adjustStock(product.id, delta);
    } finally {
      setPending(false);
    }
  }

  async function handleAdjustVariant(variant: ProductVariant, delta: number) {
    if (pending) return;
    if (!variant?.id) {
      console.warn(
        `[variant-match-fail] sku=${product?.sku ?? ""} selectedOption=${variant?.size ?? ""} variants=${JSON.stringify(
          sortedVariants.map((v) => ({ id: v?.id ?? "", size: v?.size ?? "" }))
        )}`
      );
      return;
    }
    setPending(true);
    try {
      await adjustVariantStock(variant.id, delta);
    } finally {
      setPending(false);
    }
  }

  return (
    <article className="product-card">
      {hasImage ? (
        <button
          type="button"
          className="product-card__image"
          onClick={() => setImageOpen(true)}
          aria-label="상품 이미지 확대"
        >
          <img src={product.imageUrl ?? undefined} alt={(product?.nameSpec ?? product?.sku ?? "").toString()} />
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
            {product?.category && <span className="product-card__category">{product.category}</span>}
            <h3 className="product-card__name">{product?.nameSpec ?? "-"}</h3>
          </div>
          {hasImage ? (
            <button
              type="button"
              className="product-card__thumb"
              onClick={() => setImageOpen(true)}
              aria-label="상품 썸네일 확대"
            >
              <img src={product.imageUrl ?? undefined} alt={(product?.nameSpec ?? product?.sku ?? "").toString()} />
            </button>
          ) : (
            <div className="product-card__thumb" aria-hidden="true">
              <div className="product-card__placeholder">이미지 없음</div>
            </div>
          )}
        </div>

        <div className="product-card__prices">
          <span>
            <PriceLabel full="출고가:" mobile="출:" />{" "}
            {product?.wholesalePrice != null ? `${product.wholesalePrice.toLocaleString()}원` : "-"}
          </span>
          <span>
            <PriceLabel full="소비자가:" mobile="소:" />{" "}
            {product?.msrpPrice != null ? `${product.msrpPrice.toLocaleString()}원` : "-"}
          </span>
          <span>
            <PriceLabel full="실판매가:" mobile="실:" />{" "}
            {product?.salePrice != null ? `${product.salePrice.toLocaleString()}원` : "-"}
          </span>
          <span>
            <PriceLabel full="매장:" mobile="매:" />{" "}
            {product?.extraPrice != null ? `${product.extraPrice.toLocaleString()}원` : "-"}
          </span>
        </div>

        <div className="product-card__stocks">
          {hasVariants ? (
            <div className="product-card__option-list" role="list" aria-label="옵션 목록">
              {sortedVariants.map((variant) => {
                const qty = variant?.stock ?? 0;
                const variantMemo = (variant?.memo ?? "").trim();
                const variantMemo2 = (variant?.memo2 ?? "").trim();
                const variantMemoText =
                  variantMemo && variantMemo2
                    ? `${variantMemo} / ${variantMemo2}`
                    : variantMemo || variantMemo2;
                return (
                  <div className="product-card__option-row" role="listitem" key={variant.id ?? `${product?.id}-${variant.size}`}>
                    <span className="product-card__option-name">{toOptionDisplay(variant)}</span>
                    <span className="product-card__stock-label">재고</span>
                    <div className="product-card__option-qty">
                      <strong>{qty}</strong>
                      {variantMemoText ? <span className="product-card__memo">({variantMemoText})</span> : null}
                    </div>
                    <div className="product-card__adjust">
                      <button
                        type="button"
                        onClick={() => handleAdjustVariant(variant, -1)}
                        disabled={pending || qty < 1}
                      >
                        -1
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAdjustVariant(variant, 1)}
                        disabled={pending}
                      >
                        +1
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="product-card__stock-row">
              <span className="product-card__stock-label">옵션 없음</span>
              <span className="product-card__stock-label">재고:</span>
              <strong>{product?.stock ?? "-"}</strong>
              <div className="product-card__adjust">
                <button type="button" onClick={() => handleAdjustProduct(-1)} disabled={pending || (product?.stock ?? 0) < 1}>
                  -1
                </button>
                <button type="button" onClick={() => handleAdjustProduct(1)} disabled={pending}>
                  +1
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="product-card__actions">
          <button
            type="button"
            className="product-card__edit-btn"
            onClick={() => onEditClick?.()}
          >
            수정
          </button>
          {onDeleteClick && (
            <button
              type="button"
              className="btn btn-danger product-card__delete-btn"
              onClick={onDeleteClick}
            >
              삭제
            </button>
          )}
        </div>
      </div>

      {imageOpen && hasImage ? (
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
            src={product.imageUrl ?? undefined}
            alt={(product?.nameSpec ?? product?.sku ?? "").toString()}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </article>
  );
}
