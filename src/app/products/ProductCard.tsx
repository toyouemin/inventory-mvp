"use client";

import { useState, useMemo, useEffect } from "react";
import { adjustStock, adjustVariantStock, updateProduct } from "./actions";
import type { Product, ProductVariant } from "./types";

export function ProductCard({
  product,
  variants = [],
  onEditClick,
}: {
  product: Product;
  variants?: ProductVariant[];
  onEditClick?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);

  const [sku, setSku] = useState(product.sku);
  const [category, setCategory] = useState(product.category ?? "");
  const [nameSpec, setNameSpec] = useState(product.nameSpec);
  const [imageUrl, setImageUrl] = useState(product.imageUrl ?? "");

  const [wholesalePrice, setWholesalePrice] = useState(
    product.wholesalePrice != null ? String(product.wholesalePrice) : ""
  );
  const [msrpPrice, setMsrpPrice] = useState(
    product.msrpPrice != null ? String(product.msrpPrice) : ""
  );
  const [salePrice, setSalePrice] = useState(
    product.salePrice != null ? String(product.salePrice) : ""
  );

  const [memo, setMemo] = useState(product.memo ?? "");

  const hasVariants = variants.length > 0;
  const firstSize = variants[0]?.size ?? "";
  const [selectedSize, setSelectedSize] = useState(firstSize);
  useEffect(() => {
    if (hasVariants && !variants.some((v) => v.size === selectedSize)) {
      setSelectedSize(firstSize);
    }
  }, [hasVariants, variants, selectedSize, firstSize]);

  const selectedVariant = useMemo(
    () => variants.find((v) => v.size === selectedSize),
    [variants, selectedSize]
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

  async function handleSave() {
    if (pending) return;
    setPending(true);
    try {
      await updateProduct(product.id, {
        sku: (sku ?? "").trim(),
        category: (category ?? "").trim() || null,
        nameSpec: ((nameSpec ?? "").trim() || sku.trim()),
        imageUrl: (imageUrl ?? "").trim() || null,

        // ✅ 저장도 3개로
        wholesalePrice: wholesalePrice === "" ? null : parseInt(wholesalePrice, 10),
        msrpPrice: msrpPrice === "" ? null : parseInt(msrpPrice, 10),
        salePrice: salePrice === "" ? null : parseInt(salePrice, 10),

        memo: memo.trim() || null,
      });

      setEditing(false);
      onEditClick?.();
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
                  {variants.map((v) => (
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
          {editing ? (
            <button
              type="button"
              className="product-card__edit-btn"
              onClick={() => setEditing(false)}
            >
              취소
            </button>
          ) : (
            <button
              type="button"
              className="product-card__edit-btn"
              onClick={() => setEditing(true)}
            >
              수정
            </button>
          )}
        </div>

        {editing && (
          <div className="product-card__edit-form">
            {product.updatedAt && (
  <div style={{ fontSize: "12px", color: "#888", marginBottom: "6px" }}>
    마지막 수정: {new Date(product.updatedAt).toLocaleString()}
  </div>
)}
            <label>품목코드 (SKU)</label>
            <input value={sku} onChange={(e) => setSku(e.target.value)} />

            <label>카테고리</label>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="(선택)"
            />

            <label>품명</label>
            <input value={nameSpec} onChange={(e) => setNameSpec(e.target.value)} required />

            <label>이미지 URL</label>
            <input
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://..."
            />

            {/* ✅ 수정 폼도 3개 */}
            <label>출고가</label>
            <input
              type="number"
              value={wholesalePrice}
              onChange={(e) => setWholesalePrice(e.target.value)}
              placeholder="0"
            />

            <label>소비자가</label>
            <input
              type="number"
              value={msrpPrice}
              onChange={(e) => setMsrpPrice(e.target.value)}
              placeholder="0"
            />

            <label>실판매가</label>
            <input
              type="number"
              value={salePrice}
              onChange={(e) => setSalePrice(e.target.value)}
              placeholder="0"
            />

            <label>비고</label>
            <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="(선택)" />

            <div className="product-card__edit-actions">
              <button type="button" onClick={handleSave} disabled={pending}>
                저장
              </button>
              <button type="button" onClick={() => setEditing(false)}>
                취소
              </button>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}