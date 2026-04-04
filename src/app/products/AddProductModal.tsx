"use client";

import { useEffect, useState } from "react";
import { createProduct, uploadProductImage } from "./actions";
import { readAsDataURL, resizeAndCompressImage } from "./imageUtils";
import { VariantEditor, type VariantRow } from "./VariantEditor";
import { variantCompositeKey } from "./variantOptions";

function parsePriceInput(value: string): number | null {
  const cleaned = String(value ?? "").replace(/,/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export function AddProductModal({
  open,
  onClose,
  initialSku,
  initialName,
  initialCategory,
}: {
  open: boolean;
  onClose: () => void;
  initialSku?: string;
  initialName?: string;
  initialCategory?: string;
}) {
  const [pending, setPending] = useState(false);

  const [sku, setSku] = useState("");
  const [category, setCategory] = useState("");
  const [name, setName] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const [memo, setMemo] = useState("");
  const [memo2, setMemo2] = useState("");

  const [variantRows, setVariantRows] = useState<VariantRow[]>([]);
  const [variantError, setVariantError] = useState("");

  useEffect(() => {
    if (!open) return;

    setSku((initialSku ?? "").trim());
    setCategory((initialCategory ?? "").trim());
    setName((initialName ?? "").trim());

    setImageUrl("");
    setImageFile(null);
    setImagePreview(null);
    setMemo("");
    setMemo2("");
    setVariantRows([]);
    setVariantError("");
  }, [open, initialSku, initialName, initialCategory]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!sku.trim() || !name.trim()) return;
    if (pending) return;

    const rowsWithAny = variantRows.filter(
      (r) =>
        (r.color ?? "").trim() !== "" ||
        (r.gender ?? "").trim() !== "" ||
        (r.size ?? "").trim() !== ""
    );
    if (variantRows.length > 0 && rowsWithAny.length === 0) {
      setVariantError("옵션 행이 있으면 색상, 성별, 사이즈 중 하나 이상 입력해 주세요.");
      return;
    }

    const variantKeys = rowsWithAny.map((r) =>
      variantCompositeKey(r.color, r.gender, r.size)
    );
    if (new Set(variantKeys).size !== variantKeys.length) {
      setVariantError("중복된 변형입니다. 동일 SKU에서 색상·성별·사이즈 조합은 하나만 허용됩니다.");
      return;
    }
    setVariantError("");

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
      const variants =
        rowsWithAny.length > 0
          ? rowsWithAny.map((r) => ({
              color: (r.color ?? "").trim(),
              gender: (r.gender ?? "").trim(),
              size: (r.size ?? "").trim(),
              stock: Math.max(0, parseInt(String(r.stock), 10) || 0),
              wholesalePrice: parsePriceInput(r.wholesalePrice) ?? 0,
              msrpPrice: parsePriceInput(r.msrpPrice) ?? 0,
              salePrice: parsePriceInput(r.salePrice) ?? 0,
              extraPrice: parsePriceInput(r.extraPrice) ?? 0,
              memo: (r.memo ?? "").trim() || null,
              memo2: (r.memo2 ?? "").trim() || null,
            }))
          : undefined;

      await createProduct({
        sku: sku.trim(),
        category: category.trim() || null,
        name: name.trim(),
        imageUrl: finalImageUrl,
        memo: memo.trim() || null,
        memo2: memo2.trim() || null,
        variants,
      });

      setSku("");
      setCategory("");
      setName("");
      setImageUrl("");
      setImageFile(null);
      setImagePreview(null);
      setMemo("");
      setMemo2("");
      setVariantRows([]);
      setVariantError("");

      onClose();
    } finally {
      setPending(false);
    }
  }

  if (!open) return null;

  return (
    <div className="modal-overlay add-product-modal-overlay" onClick={onClose}>
      <div className="modal add-product-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header-add-product">
          <h3>상품 추가</h3>
          <button type="button" className="modal-header-cancel" onClick={onClose}>
            취소
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form add-product-modal-form">
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

          <label>상품명 *</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="상품명 입력"
            required
          />

          <div className="variant-editor-section">
            <VariantEditor
              rows={variantRows}
              onRowsChange={setVariantRows}
              error={variantError}
              autoFocusLastAdded
            />
          </div>

          <label>이미지</label>
          {(imagePreview || imageUrl) && (
            <div className="add-product-modal-preview">
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
          <div className="add-product-modal-url-memos">
            <input
              type="text"
              value={imageUrl}
              onChange={(e) => {
                setImageUrl(e.target.value);
                if (e.target.value) {
                  setImageFile(null);
                  setImagePreview(null);
                }
              }}
              placeholder="또는 이미지 URL 입력"
            />

            <label className="variant-editor-product-memo-label">메모1 (상품)</label>
            <input
              type="text"
              className="variant-editor-size-input variant-editor-product-memo-input"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="메모1"
              autoComplete="off"
            />

            <label className="variant-editor-product-memo-label">메모2 (상품)</label>
            <input
              type="text"
              className="variant-editor-size-input variant-editor-product-memo-input"
              value={memo2}
              onChange={(e) => setMemo2(e.target.value)}
              placeholder="메모2"
              autoComplete="off"
            />
          </div>

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
