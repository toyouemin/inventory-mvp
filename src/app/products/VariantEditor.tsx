"use client";

import { useCallback, useEffect, useRef } from "react";

/** Row for add mode: no variant id. Row for edit mode: may have variantId for existing DB row. */
export type VariantRow = {
  rowId: string; // stable React key
  size: string;
  stock: string;
  variantId?: string; // DB id if editing existing variant
};

function generateRowId() {
  return `row-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

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
    const newRow: VariantRow = {
      rowId: generateRowId(),
      size: "",
      stock: "0",
    };
    lastAddedRowIdRef.current = newRow.rowId;
    onRowsChange([...rows, newRow]);
  }, [rows, onRowsChange]);

  const removeRow = useCallback(
    (rowId: string) => {
      onRowsChange(rows.filter((r) => r.rowId !== rowId));
    },
    [rows, onRowsChange]
  );

  const updateRow = useCallback(
    (rowId: string, field: "size" | "stock", value: string) => {
      onRowsChange(
        rows.map((r) => (r.rowId === rowId ? { ...r, [field]: value } : r))
      );
    },
    [rows, onRowsChange]
  );

  // Auto-focus newly added size input (mobile Safari/Chrome: rAF + setTimeout)
  useEffect(() => {
    if (!autoFocusLastAdded || !lastAddedRowIdRef.current) return;
    const targetId = lastAddedRowIdRef.current;
    lastAddedRowIdRef.current = null;
    const focusInput = () => {
      const el = document.querySelector(
        `[data-variant-size-input="${targetId}"]`
      ) as HTMLInputElement | null;
      el?.focus();
    };
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        focusInput();
        setTimeout(focusInput, 100);
      });
    });
  }, [rows.length, autoFocusLastAdded]);

  return (
    <div>
      <label>사이즈 추가</label>
      {rows.map((row) => (
        <div key={row.rowId} className="variant-editor-row">
          <input
            type="text"
            data-variant-size-input={row.rowId}
            className="variant-editor-size-input"
            value={row.size}
            onChange={(e) => updateRow(row.rowId, "size", e.target.value)}
            placeholder="사이즈"
            autoComplete="off"
            autoCapitalize="off"
          />
          <input
            type="number"
            inputMode="numeric"
            pattern="[0-9]*"
            min={0}
            className="variant-editor-stock-input"
            value={row.stock}
            onChange={(e) => updateRow(row.rowId, "stock", e.target.value)}
            placeholder="재고"
          />
          <button
            type="button"
            onClick={() => removeRow(row.rowId)}
            className="btn btn-secondary"
          >
            삭제
          </button>
        </div>
      ))}
      {error && (
        <div style={{ color: "crimson", fontSize: 13, marginTop: 6 }}>
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={addRow}
        className="btn btn-secondary"
        style={{ marginTop: 8 }}
      >
        + 사이즈 추가
      </button>
    </div>
  );
}

export { generateRowId };
