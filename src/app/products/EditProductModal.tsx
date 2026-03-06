"use client";

import { useEffect, useState } from "react";
import { updateProduct, uploadProductImage } from "./actions";
import { readAsDataURL, resizeAndCompressImage } from "./imageUtils";
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
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  // ✅ 가격 3개
  const [wholesalePrice, setWholesalePrice] = useState("");
  const [msrpPrice, setMsrpPrice] = useState("");
  const [salePrice, setSalePrice] = useState("");

  const [memo, setMemo] = useState("");

  useEffect(() => {
    if (!open || !product) return;

    setPending(false);
    setSku(product.sku ?? "");
    setCategory(product.category ?? "");
    setNameSpec(product.nameSpec ?? "");
    setImageUrl(product.imageUrl ?? "");
    setImageFile(null);
    setImagePreview(null);

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
      let finalImageUrl = imageUrl.trim() || null;
      if (imageFile) {
        const resized = await resizeAndCompressImage(imageFile);
        const fd = new FormData();
        fd.append("file", resized);
        const { url } = await uploadProductImage(fd);
        finalImageUrl = url;
      }
      await updateProduct(product.id, {
        sku: sku.trim(),
        category: category.trim() || null,
        nameSpec: nameSpec.trim(),
        imageUrl: finalImageUrl,

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

          <label>이미지</label>
          {(imagePreview || imageUrl) && (
            <div style={{ marginBottom: 8 }}>
              <img
                src={imagePreview || imageUrl}
                alt="미리보기"
                style={{ maxWidth: "100%", maxHeight: 160, objectFit: "contain", borderRadius: 8, border: "1px solid var(--border)" }}
              />
            </div>
          )}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setImageFile(f);
              setImageUrl("");
              try {
                setImagePreview(await readAsDataURL(f));
              } catch {
                setImagePreview(null);
              }
            }}
          />
          <input
            type="text"
            value={imageUrl}
            onChange={(e) => { setImageUrl(e.target.value); if (e.target.value) setImageFile(null); setImagePreview(null); }}
            placeholder="또는 이미지 URL 입력"
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