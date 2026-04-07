"use client";

import { Fragment, useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";

export type VariantRow = {
  rowId: string;
  color: string;
  gender: string;
  size: string;
  stock: string;
  wholesalePrice: string;
  msrpPrice: string;
  salePrice: string;
  extraPrice: string;
  memo: string;
  memo2: string;
  variantId?: string;
};

function generateRowId() {
  return `row-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const emptyRow = (): VariantRow => ({
  rowId: generateRowId(),
  color: "",
  gender: "",
  size: "",
  stock: "0",
  wholesalePrice: "",
  msrpPrice: "",
  salePrice: "",
  extraPrice: "",
  memo: "",
  memo2: "",
});

const PLACEHOLDER_ROW_ID = "empty-1";

function rowHasAnyPriceFields(r: VariantRow): boolean {
  return [r.wholesalePrice, r.msrpPrice, r.salePrice, r.extraPrice].some((p) => String(p ?? "").trim() !== "");
}

/** 표시용 empty-1 또는, 입력 전 템플릿 같은 빈 줄(옵션/가격/메모 없음·재고 0) */
function isVacantScratchRow(r: VariantRow): boolean {
  if (r.rowId === PLACEHOLDER_ROW_ID) return true;
  if (r.variantId) return false;
  const hasOpts =
    String(r.color ?? "").trim() !== "" ||
    String(r.gender ?? "").trim() !== "" ||
    String(r.size ?? "").trim() !== "";
  if (hasOpts || rowHasAnyPriceFields(r)) return false;
  const hasMemo = String(r.memo ?? "").trim() !== "" || String(r.memo2 ?? "").trim() !== "";
  if (hasMemo) return false;
  const st = String(r.stock ?? "").trim();
  const stockNum = st === "" ? 0 : parseInt(st, 10);
  return !Number.isFinite(stockNum) || stockNum === 0;
}

/**
 * 화면 아래에서 위로: 임시 빈 행은 건너뛰고,
 * 옵션/재고/메모만 있고 가격이 없으면 건너뛰어 이전 행에서 첫 "가격 1칸 이상" 행을 찾음.
 */
function findSourceRowForPriceCopy(prev: VariantRow[]): VariantRow | null {
  for (let i = prev.length - 1; i >= 0; i--) {
    const r = prev[i]!;
    if (isVacantScratchRow(r)) continue;
    if (rowHasAnyPriceFields(r)) return r;
  }
  return null;
}

function debugVariantAddRowEnabled(): boolean {
  return typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debugVariantAddRow") === "1";
}

export function VariantEditor({
  rows,
  onRowsChange,
  error,
  autoFocusLastAdded,
}: {
  rows: VariantRow[];
  onRowsChange: Dispatch<SetStateAction<VariantRow[]>>;
  error?: string;
  autoFocusLastAdded?: boolean;
}) {
  const lastAddedRowIdRef = useRef<string | null>(null);

  const addRow = useCallback(() => {
    onRowsChange((prev) => {
      const newRow = emptyRow();
      const source = findSourceRowForPriceCopy(prev);
      if (source) {
        newRow.wholesalePrice = source.wholesalePrice;
        newRow.msrpPrice = source.msrpPrice;
        newRow.salePrice = source.salePrice;
        newRow.extraPrice = source.extraPrice;
      }
      if (debugVariantAddRowEnabled() && typeof console !== "undefined" && console.info) {
        const lastRaw = prev.length > 0 ? prev[prev.length - 1]! : null;
        console.info("[VariantEditor][debugVariantAddRow] +옵션 행", {
          prevLength: prev.length,
          lastInArrayRowId: lastRaw?.rowId ?? null,
          lastInArrayVacant: lastRaw ? isVacantScratchRow(lastRaw) : null,
          sourceRow: source
            ? {
                rowId: source.rowId,
                variantId: source.variantId ?? null,
                rowKeys: Object.keys(source) as (keyof VariantRow)[],
                wholesalePrice: source.wholesalePrice,
                msrpPrice: source.msrpPrice,
                salePrice: source.salePrice,
                extraPrice: source.extraPrice,
              }
            : null,
          newRowPrices: {
            wholesalePrice: newRow.wholesalePrice,
            msrpPrice: newRow.msrpPrice,
            salePrice: newRow.salePrice,
            extraPrice: newRow.extraPrice,
          },
        });
      }
      lastAddedRowIdRef.current = newRow.rowId;
      return [...prev, newRow];
    });
  }, [onRowsChange]);

  const removeRow = useCallback(
    (rowId: string) => {
      onRowsChange((prev) => {
        const next = prev.filter((r) => r.rowId !== rowId);
        return next.length > 0 ? next : [emptyRow()];
      });
    },
    [onRowsChange]
  );

  type Field = keyof Omit<VariantRow, "rowId" | "variantId">;

  const updateRow = useCallback(
    (rowId: string, field: Field, value: string) => {
      onRowsChange((prev) => {
        if (prev.length === 0) {
          const r = emptyRow();
          return [{ ...r, rowId: generateRowId(), [field]: value }];
        }
        return prev.map((r) => (r.rowId === rowId ? { ...r, [field]: value } : r));
      });
    },
    [onRowsChange]
  );

  useEffect(() => {
    if (!autoFocusLastAdded || !lastAddedRowIdRef.current) return;
    const targetId = lastAddedRowIdRef.current;
    lastAddedRowIdRef.current = null;
    const focusInput = () => {
      const el = document.querySelector(`[data-variant-focus="${targetId}"]`) as HTMLInputElement | null;
      el?.focus();
    };
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        focusInput();
        setTimeout(focusInput, 100);
      });
    });
  }, [rows.length, autoFocusLastAdded]);

  const displayRows = rows.length > 0 ? rows : [{ ...emptyRow(), rowId: PLACEHOLDER_ROW_ID }];

  return (
    <div className="variant-editor">
      <label className="variant-editor-main-label">
        옵션 (색상 · 성별 · 사이즈 · 수량 · 금액)
      </label>
      {displayRows.map((row, idx) => (
        <Fragment key={row.rowId}>
          <div className="variant-editor-row">
            <input
              type="text"
              data-variant-focus={row.rowId}
              className="variant-editor-size-input"
              value={row.color}
              onChange={(e) => updateRow(row.rowId, "color", e.target.value)}
              placeholder="색상"
              autoComplete="off"
            />
            <input
              type="text"
              className="variant-editor-size-input"
              value={row.gender}
              onChange={(e) => updateRow(row.rowId, "gender", e.target.value)}
              placeholder="성별"
              autoComplete="off"
            />
            <input
              type="text"
              className="variant-editor-size-input"
              value={row.size}
              onChange={(e) => updateRow(row.rowId, "size", e.target.value)}
              placeholder="사이즈"
              autoComplete="off"
            />
            <input
              type="number"
              inputMode="numeric"
              min={0}
              className="variant-editor-stock-input"
              value={row.stock}
              onChange={(e) => updateRow(row.rowId, "stock", e.target.value)}
              placeholder="재고"
            />
            <input
              type="text"
              className="variant-editor-size-input"
              value={row.wholesalePrice}
              onChange={(e) => updateRow(row.rowId, "wholesalePrice", e.target.value)}
              placeholder="출고가"
            />
            <input
              type="text"
              className="variant-editor-size-input"
              value={row.msrpPrice}
              onChange={(e) => updateRow(row.rowId, "msrpPrice", e.target.value)}
              placeholder="소비자가"
            />
            <input
              type="text"
              className="variant-editor-size-input"
              value={row.salePrice}
              onChange={(e) => updateRow(row.rowId, "salePrice", e.target.value)}
              placeholder="실판매가"
            />
            <input
              type="text"
              className="variant-editor-size-input"
              value={row.extraPrice}
              onChange={(e) => updateRow(row.rowId, "extraPrice", e.target.value)}
              placeholder="매장가"
            />
            <input
              type="text"
              className="variant-editor-size-input"
              value={row.memo}
              onChange={(e) => updateRow(row.rowId, "memo", e.target.value)}
              placeholder="메모1"
              autoComplete="off"
            />
            <input
              type="text"
              className="variant-editor-size-input"
              value={row.memo2}
              onChange={(e) => updateRow(row.rowId, "memo2", e.target.value)}
              placeholder="메모2"
              autoComplete="off"
            />
          </div>
          <div className="variant-editor-delete-between">
            <button
              type="button"
              onClick={() => removeRow(row.rowId)}
              className="variant-editor-delete-between-btn"
            >
              {idx + 1}행 삭제
            </button>
          </div>
        </Fragment>
      ))}
      {error && <div className="variant-editor-error">{error}</div>}
      <div className="variant-editor-footer">
        <button type="button" onClick={addRow} className="btn btn-secondary variant-editor-add-btn">
          + 옵션 행 추가
        </button>
      </div>
    </div>
  );
}

export { generateRowId };
