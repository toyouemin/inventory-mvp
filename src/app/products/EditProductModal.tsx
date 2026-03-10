"use client";

import { useEffect, useMemo, useState } from "react";
import { updateProduct, uploadProductImage } from "./actions";
import { readAsDataURL, resizeAndCompressImage } from "./imageUtils";
import type { Product, ProductVariant } from "./types";

type VariantRow = { rowId: string; size: string; stock: string; variantId?: string };

function makeRow(size = "", stock = "0", variantId?: string): VariantRow {
  return { rowId: `row-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, size, stock, variantId };
}

function variantsToRows(variants: ProductVariant[], fallbackStock: number): VariantRow[] {
  if (variants.length > 0) {
    return variants.map((v) => makeRow((v.size ?? "").trim(), String(v.stock), v.id));
  }
  return [makeRow("", String(fallbackStock ?? 0))];
}

export function EditProductModal({
  open,
  product,
  variants = [],
  onClose,
}: {
  open: boolean;
  product: Product | null;
  variants?: ProductVariant[];
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
  const [variantRows, setVariantRows] = useState<VariantRow[]>(() => [makeRow()]);
  const [variantError, setVariantError] = useState("");

  const initialVariantIds = useMemo(
    () => (variants ?? []).map((v) => v.id),
    [variants]
  );

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
    const rows = variantsToRows(variants ?? [], product.stock ?? 0);
    setVariantRows(rows.length > 0 ? rows : [makeRow("", String(product.stock ?? 0))]);
    setVariantError("");
  }, [open, product, variants]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!product) return;
    if (!sku.trim() || !nameSpec.trim()) return;
    if (pending) return;

    const emptySizeRows = variantRows.filter((r) => (r.size ?? "").trim() === "");
    const rowsWithNonEmptySize = variantRows.filter((r) => (r.size ?? "").trim() !== "");
    if (emptySizeRows.length > 0 && (variantRows.length > 1 || rowsWithNonEmptySize.length > 0)) {
      setVariantError("사이즈가 비어 있는 행이 있습니다. 사이즈를 입력하거나 해당 행을 삭제해 주세요.");
      return;
    }
    const sizes = rowsWithNonEmptySize.map((r) => (r.size ?? "").trim());
    if (new Set(sizes).size !== sizes.length) {
      setVariantError("중복된 사이즈가 있습니다.");
      return;
    }
    setVariantError("");

    const rowsWithSize = rowsWithNonEmptySize;
    const singleStockRow = variantRows.find((r) => (r.size ?? "").trim() === "");
    const updates = rowsWithSize.map((r) => ({
      id: r.variantId,
      size: (r.size ?? "").trim(),
      stock: Math.max(0, parseInt(String(r.stock), 10) || 0),
    }));
    const remainingIds = new Set(rowsWithSize.map((r) => r.variantId).filter(Boolean));
    const deleteIds = initialVariantIds.filter((id) => !remainingIds.has(id));
    const stockForSingle =
      updates.length === 0 && singleStockRow
        ? Math.max(0, parseInt(String(singleStockRow.stock), 10) || 0)
        : undefined;

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
        wholesalePrice: wholesalePrice === "" ? null : parseInt(wholesalePrice, 10),
        msrpPrice: msrpPrice === "" ? null : parseInt(msrpPrice, 10),
        salePrice: salePrice === "" ? null : parseInt(salePrice, 10),
        memo: memo.trim() || null,
        variants: { updates, deleteIds },
        stock: stockForSingle,
      });

      onClose();
    } finally {
      setPending(false);
    }
  }

  if (!open || !product) return null;

  const rowsToShow = variantRows.length > 0 ? variantRows : variantsToRows(variants ?? [], product.stock ?? 0);

  function addVariantRow() {
    setVariantRows((prev) => [...prev, makeRow()]);
  }
  function updateVariantRow(rowId: string, field: "size" | "stock", value: string) {
    setVariantRows((prev) =>
      prev.map((r) => (r.rowId === rowId ? { ...r, [field]: value } : r))
    );
  }
  function removeVariantRow(rowId: string) {
    setVariantRows((prev) => {
      const next = prev.filter((r) => r.rowId !== rowId);
      return next.length > 0 ? next : [makeRow()];
    });
  }

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

          <label>사이즈 추가</label>
          <div style={{ display: "block", minHeight: 80, marginTop: 4 }}>
            {rowsToShow.map((row) => (
              <div
                key={row.rowId}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 80px 48px",
                  gap: 6,
                  marginTop: 6,
                  alignItems: "center",
                }}
              >
                <input
                  type="text"
                  placeholder="사이즈"
                  value={row.size}
                  onChange={(e) => updateVariantRow(row.rowId, "size", e.target.value)}
                  style={{
                    minHeight: 44,
                    height: 44,
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: "8px 10px",
                    fontSize: 16,
                    boxSizing: "border-box",
                  }}
                />
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  placeholder="재고"
                  value={row.stock}
                  onChange={(e) => updateVariantRow(row.rowId, "stock", e.target.value)}
                  style={{
                    minHeight: 44,
                    height: 44,
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: "8px 10px",
                    fontSize: 16,
                    boxSizing: "border-box",
                  }}
                />
                <button
                  type="button"
                  onClick={() => removeVariantRow(row.rowId)}
                  style={{
                    width: 48,
                    minWidth: 48,
                    height: 44,
                    padding: 0,
                    border: "none",
                    borderRadius: 8,
                    background: "#c62828",
                    color: "#fff",
                    fontSize: 16,
                    fontWeight: 600,
                    cursor: "pointer",
                    lineHeight: 1,
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
            {variantError && (
              <div style={{ color: "crimson", fontSize: 13, marginTop: 6 }}>{variantError}</div>
            )}
            <button
              type="button"
              onClick={addVariantRow}
              style={{
                marginTop: 8,
                width: "100%",
                height: 44,
                minHeight: 44,
                border: "1px solid #ccc",
                borderRadius: 8,
                background: "#e0e0e0",
                color: "#212121",
                fontSize: 15,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              + 사이즈 추가
            </button>
          </div>

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
            inputMode="decimal"
            value={wholesalePrice}
            onChange={(e) => setWholesalePrice(e.target.value)}
            placeholder="0"
          />

          <label>소비자가</label>
          <input
            type="number"
            inputMode="decimal"
            value={msrpPrice}
            onChange={(e) => setMsrpPrice(e.target.value)}
            placeholder="0"
          />

          <label>실판매가</label>
          <input
            type="number"
            inputMode="decimal"
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