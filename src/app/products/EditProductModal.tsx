"use client";

import { useEffect, useState } from "react";
import { updateProduct } from "./actions";
import type { Product } from "./types";

export function EditProductModal({
  open,
  product,
  onClose,
}: {
  open: boolean;
  product: Product | null;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [sku, setSku] = useState("");
  const [category, setCategory] = useState("");
  const [nameSpec, setNameSpec] = useState("");
  const [imageUrl, setImageUrl] = useState("");

  // ✅ 가격 3개
  const [wholesalePrice, setWholesalePrice] = useState("");
  const [msrpPrice, setMsrpPrice] = useState("");
  const [salePrice, setSalePrice] = useState("");

  const [memo, setMemo] = useState("");

  useEffect(() => {
    if (!open || !product) return;

    setPending(false);
    setSku(product.sku);
    setCategory(product.category ?? "");
    setNameSpec(product.nameSpec);
    setImageUrl(product.imageUrl ?? "");

    setWholesalePrice(product.wholesalePrice != null ? String(product.wholesalePrice) : "");
    setMsrpPrice(product.msrpPrice != null ? String(product.msrpPrice) : "");
    setSalePrice(product.salePrice != null ? String(product.salePrice) : "");

    setMemo(product.memo ?? "");
  }, [open, product]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!product) return;
    if (!sku.trim() || !nameSpec.trim()) return;
    if (pending) return;

    setPending(true);
    try {
      await updateProduct(product.id, {
        sku: sku.trim(),
        category: category.trim() || null,
        nameSpec: nameSpec.trim(),
        imageUrl: imageUrl.trim() || null,

        // ✅ DB 컬럼에 맞춰 전달
        wholesalePrice: wholesalePrice === "" ? null : parseInt(wholesalePrice, 10),
        msrpPrice: msrpPrice === "" ? null : parseInt(msrpPrice, 10),
        salePrice: salePrice === "" ? null : parseInt(salePrice, 10),

        memo: memo.trim() || null,
      });

      onClose();
    } finally {
      setPending(false);
    }
  }

  if (!open || !product) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>상품 수정</h3>
        <form onSubmit={handleSave} className="modal-form">
        {product.updatedAt && (
  <div style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>
    마지막 수정: {new Date(product.updatedAt).toLocaleString("ko-KR")}
  </div>
)}
          <label>품목코드 (SKU) *</label>
          <input value={sku} onChange={(e) => setSku(e.target.value)} required />

          <label>카테고리</label>
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="(선택)"
          />

          <label>품명 *</label>
          <input value={nameSpec} onChange={(e) => setNameSpec(e.target.value)} required />

          <label>이미지 URL</label>
          <input
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="https://..."
          />

          {/* ✅ 가격 3개 */}
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

          <div className="modal-actions">
            <button type="submit" disabled={pending}>
              저장
            </button>
            <button type="button" onClick={onClose}>
              취소
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}