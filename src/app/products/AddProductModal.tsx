"use client";

import { useEffect, useState } from "react";
import { createProduct } from "./actions";

export function AddProductModal({
  open,
  onClose,
  initialSku,
  initialNameSpec,
  initialCategory,
}: {
  open: boolean;
  onClose: () => void;
  initialSku?: string;
  initialNameSpec?: string;
  initialCategory?: string;
}) {
  const [pending, setPending] = useState(false);

  const [sku, setSku] = useState("");
  const [category, setCategory] = useState("");
  const [nameSpec, setNameSpec] = useState("");
  const [imageUrl, setImageUrl] = useState("");

  // ✅ 가격 3개로 분리
  const [wholesalePrice, setWholesalePrice] = useState("");
  const [msrpPrice, setMsrpPrice] = useState("");
  const [salePrice, setSalePrice] = useState("");

  const [memo, setMemo] = useState("");

  // ✅ 모달이 열릴 때 초기값(검색값 등) 자동 세팅
  useEffect(() => {
    if (!open) return;

    setSku((initialSku ?? "").trim());
    setCategory((initialCategory ?? "").trim());
    setNameSpec((initialNameSpec ?? "").trim());

    // 나머지는 항상 빈값으로 시작(원하면 유지하도록 바꿀 수도 있음)
    setImageUrl("");
    setWholesalePrice("");
    setMsrpPrice("");
    setSalePrice("");
    setMemo("");
  }, [open, initialSku, initialNameSpec, initialCategory]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!sku.trim() || !nameSpec.trim()) return;
    if (pending) return;

    setPending(true);
    try {
      await createProduct({
        sku: sku.trim(),
        category: category.trim() || null,
        nameSpec: nameSpec.trim(),
        imageUrl: imageUrl.trim() || null,

        wholesalePrice: wholesalePrice === "" ? null : parseInt(wholesalePrice, 10),
        msrpPrice: msrpPrice === "" ? null : parseInt(msrpPrice, 10),
        salePrice: salePrice === "" ? null : parseInt(salePrice, 10),

        memo: memo.trim() || null,
      });

      // 저장 후 초기화
      setSku("");
      setCategory("");
      setNameSpec("");
      setImageUrl("");
      setWholesalePrice("");
      setMsrpPrice("");
      setSalePrice("");
      setMemo("");

      onClose();
    } finally {
      setPending(false);
    }
  }

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>상품 추가</h3>

        <form onSubmit={handleSubmit} className="modal-form">
          <label>품목코드 (SKU) *</label>
          <input
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            placeholder="예: P001"
            required
          />

          <label>카테고리</label>
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="(선택)"
          />

          <label>품명 *</label>
          <input
            value={nameSpec}
            onChange={(e) => setNameSpec(e.target.value)}
            placeholder="품명 입력"
            required
          />

          <label>이미지 URL</label>
          <input
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="https://..."
          />

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
          <input
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="(선택)"
          />

          <div className="modal-actions">
            <button type="submit" disabled={pending}>
              추가
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