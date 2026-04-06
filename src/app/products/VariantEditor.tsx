"use client";

import { Fragment, useCallback, useEffect, useRef } from "react";

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

export function VariantEditor({
  rows,
  onRowsChange,
  error,
  autoFocusLastAdded,
}: {
  rows: VariantRow[];
  onRowsChange: (rows: VariantRow[]) => void;
  error?: string;
  autoFocusLastAdded?: boolean;
}) {
  const lastAddedRowIdRef = useRef<string | null>(null);

  const addRow = useCallback(() => {
    const newRow = emptyRow();
    lastAddedRowIdRef.current = newRow.rowId;
    onRowsChange([...rows, newRow]);
  }, [rows, onRowsChange]);

  const removeRow = useCallback(
    (rowId: string) => {
      const next = rows.filter((r) => r.rowId !== rowId);
      onRowsChange(next.length > 0 ? next : [emptyRow()]);
    },
    [rows, onRowsChange]
  );

  type Field = keyof Omit<VariantRow, "rowId" | "variantId">;

  const updateRow = useCallback(
    (rowId: string, field: Field, value: string) => {
      if (rows.length === 0) {
        const r = emptyRow();
        onRowsChange([{ ...r, rowId: generateRowId(), [field]: value }]);
      } else {
        onRowsChange(rows.map((r) => (r.rowId === rowId ? { ...r, [field]: value } : r)));
      }
    },
    [rows, onRowsChange]
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

  const displayRows = rows.length > 0 ? rows : [{ ...emptyRow(), rowId: "empty-1" }];

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
