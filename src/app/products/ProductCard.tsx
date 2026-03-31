"use client";

import { useState, useMemo, useEffect } from "react";
import { adjustStock, adjustVariantStock } from "./actions";
import type { Product, ProductVariant } from "./types";
import { sortSizes } from "./sizeUtils";

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

  const sortedVariants = useMemo(
    () => [...variants].sort((a, b) => sortSizes(a.size ?? "", b.size ?? "")),
    [variants]
  );
  const hasVariants = sortedVariants.length > 0;
  const firstSize = sortedVariants[0]?.size ?? "";
  const [selectedSize, setSelectedSize] = useState(firstSize);
  useEffect(() => {
    if (hasVariants && !sortedVariants.some((v) => v.size === selectedSize)) {
      setSelectedSize(firstSize);
    }
  }, [hasVariants, sortedVariants, selectedSize, firstSize]);

  const selectedVariant = useMemo(
    () => sortedVariants.find((v) => v.size === selectedSize),
    [sortedVariants, selectedSize]
  );
  const qty = hasVariants ? (selectedVariant?.stock ?? 0) : (product.stock ?? 0);

  async function handleAdjust(delta: number) {
    if (pending) return;
    setPending(true);
    try {
      if (hasVariants && selectedVariant) {
        await adjustVariantStock(selectedVariant.id, delta);
      } else {
        await adjustStock(product.id, delta);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <article className="product-card">
      <div className="product-card__image">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={(product.nameSpec ?? product.sku ?? "").toString()} />
        ) : (
          <div className="product-card__placeholder">이미지 없음</div>
        )}
      </div>

      <div className="product-card__body">
        <div className="product-card__sku">{product.sku}</div>
        {product.category && <span className="product-card__category">{product.category}</span>}
        <h3 className="product-card__name">{product.nameSpec}</h3>

        <div className="product-card__prices">
          <span>
            출고가:{" "}
            {product.wholesalePrice != null ? `${product.wholesalePrice.toLocaleString()}원` : "-"}
          </span>
          <span>
            소비자가:{" "}
            {product.msrpPrice != null ? `${product.msrpPrice.toLocaleString()}원` : "-"}
          </span>
          <span>
            실판매가:{" "}
            {product.salePrice != null ? `${product.salePrice.toLocaleString()}원` : "-"}
          </span>
        </div>

        {product.memo && <div className="product-card__memo">비고: {product.memo}</div>}

        <div className="product-card__stocks">
          <div className="product-card__stock-row">
            {hasVariants && (
              <>
                <span className="product-card__stock-label">사이즈</span>
                <select
                  className="product-card__size-select"
                  value={selectedSize}
                  onChange={(e) => setSelectedSize(e.target.value)}
                  aria-label="사이즈 선택"
                >
                  {sortedVariants.map((v) => (
                    <option key={v.id} value={v.size}>
                      {v.size || "(없음)"}
                    </option>
                  ))}
                </select>
              </>
            )}
            <span className="product-card__stock-label">재고:</span>
            <strong>{qty}</strong>
            <div className="product-card__adjust">
              <button type="button" onClick={() => handleAdjust(-1)} disabled={pending || qty < 1}>
                -1
              </button>
              <button type="button" onClick={() => handleAdjust(1)} disabled={pending}>
                +1
              </button>
            </div>
          </div>
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
    </article>
  );
}
