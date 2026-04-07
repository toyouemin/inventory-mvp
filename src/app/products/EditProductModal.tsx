"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { updateProduct, uploadProductImage } from "./actions";
import { readAsDataURL, resizeAndCompressImage } from "./imageUtils";
import type { Product, ProductVariant } from "./types";
import { VariantEditor, type VariantRow, generateRowId } from "./VariantEditor";
import { variantCompositeKey } from "./variantOptions";

function parsePriceInput(value: string): number | null {
  const cleaned = String(value ?? "").replace(/,/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function formatPriceInput(value: number | null | undefined): string {
  if (value == null) return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return Math.trunc(n).toLocaleString("ko-KR");
}

function emptyVariantRow(stock = "0"): VariantRow {
  return {
    rowId: generateRowId(),
    color: "",
    gender: "",
    size: "",
    stock,
    wholesalePrice: "",
    msrpPrice: "",
    salePrice: "",
    extraPrice: "",
    memo: "",
    memo2: "",
  };
}

function variantToRow(v: ProductVariant): VariantRow {
  return {
    rowId: generateRowId(),
    color: v.color ?? "",
    gender: v.gender ?? "",
    size: v.size ?? "",
    stock: String(v.stock ?? 0),
    wholesalePrice: formatPriceInput(v.wholesalePrice),
    msrpPrice: formatPriceInput(v.msrpPrice),
    salePrice: formatPriceInput(v.salePrice),
    extraPrice: formatPriceInput(v.extraPrice),
    memo: (v.memo ?? "").trim(),
    memo2: (v.memo2 ?? "").trim(),
    variantId: v.id,
  };
}

function variantsToRows(variants: ProductVariant[], fallbackStock: number): VariantRow[] {
  if (variants.length > 0) return variants.map(variantToRow);
  return [emptyVariantRow(String(fallbackStock ?? 0))];
}

export function EditProductModal({
  open,
  product,
  variants = [],
  onClose,
  onSaved,
}: {
  open: boolean;
  product: Product | null;
  variants?: ProductVariant[];
  onClose: () => void;
  onSaved?: (payload: { productId: string; memo: string | null; memo2: string | null }) => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [sku, setSku] = useState("");
  const [category, setCategory] = useState("");
  const [name, setName] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const [memo, setMemo] = useState("");
  const [memo2, setMemo2] = useState("");
  const [variantRows, setVariantRows] = useState<VariantRow[]>(() => [emptyVariantRow()]);
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
    setName(product.name ?? "");
    setImageUrl(product.imageUrl ?? "");
    setImageFile(null);
    setImagePreview(null);

    setMemo(product.memo ?? "");
    setMemo2(product.memo2 ?? "");
    const rows = variantsToRows(variants ?? [], product.stock ?? 0);
    setVariantRows(rows.length > 0 ? rows : [emptyVariantRow(String(product.stock ?? 0))]);
    setVariantError("");
  }, [open, product, variants]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!product) return;
    if (!sku.trim() || !name.trim()) return;
    if (pending) return;

    const rowsWithAny = variantRows.filter(
      (r) =>
        (r.color ?? "").trim() !== "" ||
        (r.gender ?? "").trim() !== "" ||
        (r.size ?? "").trim() !== ""
    );

    if (variantRows.length > 0 && rowsWithAny.length === 0 && variantRows.some((r) => variantRows.length > 1)) {
      setVariantError("옵션 행이 있으면 색상, 성별, 사이즈 중 하나 이상 입력해 주세요.");
      return;
    }

    const variantKeys = rowsWithAny.map((r) => variantCompositeKey(r.color, r.gender, r.size));
    if (new Set(variantKeys).size !== variantKeys.length) {
      setVariantError("중복된 변형입니다. 동일 SKU에서 색상·성별·사이즈 조합은 하나만 허용됩니다.");
      return;
    }
    setVariantError("");

    const singleStockRow = variantRows.find(
      (r) =>
        (r.color ?? "").trim() === "" &&
        (r.gender ?? "").trim() === "" &&
        (r.size ?? "").trim() === ""
    );
    const updates = rowsWithAny.map((r) => ({
      id: r.variantId,
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
    }));
    const remainingIds = new Set(updates.map((u) => u.id).filter(Boolean));
    const deleteIds = initialVariantIds.filter((id) => !remainingIds.has(id));
    const stockForSingle =
      updates.length === 0 && singleStockRow
        ? Math.max(0, parseInt(String(singleStockRow.stock), 10) || 0)
        : undefined;

    setPending(true);
    try {
      let finalImageUrl = imageUrl.trim() || null;
      if (imageFile) {
        if (!sku.trim()) {
          throw new Error("SKU를 먼저 입력한 뒤 이미지를 업로드해 주세요.");
        }
        const resized = await resizeAndCompressImage(imageFile);
        const fd = new FormData();
        fd.append("file", resized);
        fd.append("sku", sku.trim());
        const { url } = await uploadProductImage(fd);
        finalImageUrl = url;
      }
      const updatePayload = {
        sku: sku.trim(),
        category: category.trim() || null,
        name: name.trim(),
        imageUrl: finalImageUrl,
        memo: memo.trim() || null,
        memo2: memo2.trim() || null,
        variants: { updates, deleteIds },
        stock: stockForSingle,
      };
      if (
        typeof window !== "undefined" &&
        new URLSearchParams(window.location.search).get("debugProductSave") === "1"
      ) {
        console.log("[EditProductModal] 저장 직전 updateProduct payload", {
          productId: product.id,
          deleteIds,
          variantUpdates: updates.map((u) => ({
            id: u.id ?? "(신규)",
            color: u.color,
            gender: u.gender,
            size: u.size,
            stock: u.stock,
            wholesalePrice: u.wholesalePrice,
            msrpPrice: u.msrpPrice,
            salePrice: u.salePrice,
            extraPrice: u.extraPrice,
          })),
        });
      }
      await updateProduct(product.id, updatePayload);
      /* 한 번만 refresh — 이중 refresh는 RSC 중복 페치만 유발 */
      queueMicrotask(() => {
        router.refresh();
      });
      onSaved?.({
        productId: product.id,
        memo: memo.trim() || null,
        memo2: memo2.trim() || null,
      });

      onClose();
    } finally {
      setPending(false);
    }
  }

  if (!open || !product) return null;

  return (
    <div className="modal-overlay add-product-modal-overlay" onClick={onClose}>
      <div className="modal add-product-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header-add-product">
          <h3>상품 수정</h3>
          <button type="button" className="modal-header-cancel" onClick={onClose}>
            취소
          </button>
        </div>
        <form onSubmit={handleSave} className="modal-form add-product-modal-form">
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

          <label>상품명 *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required />

          <VariantEditor rows={variantRows} onRowsChange={setVariantRows} error={variantError} />

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

          <div className="modal-actions">
            <button type="submit" disabled={pending}>
              저장
            </button>
            <button type="button" onClick={onClose} disabled={pending}>
              취소
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
