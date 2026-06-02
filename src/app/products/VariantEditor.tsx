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

export function rowHasAnyPriceFields(r: VariantRow): boolean {
  return [r.wholesalePrice, r.msrpPrice, r.salePrice, r.extraPrice].some((p) => String(p ?? "").trim() !== "");
}

function parsePriceField(value: string): number {
  const cleaned = String(value ?? "").replace(/,/g, "").trim();
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

export function rowHasNonZeroPrice(r: VariantRow): boolean {
  return [r.wholesalePrice, r.msrpPrice, r.salePrice, r.extraPrice].some((p) => parsePriceField(p) > 0);
}

/**
 * 특정 가격 칸(출고가/소비자가/실판매가/매장가)을 입력하면(0 초과),
 * 나머지 옵션 행에도 해당 칸을 같은 값으로 덮어씁니다.
 *
 * 주의: 기존 로직은 "어떤 금액 컬럼이든 0 초과인 첫 행"을 source로 잡다 보니,
 * source 행의 `wholesalePrice`가 비어 있으면 출고가 전파가 실패할 수 있었습니다.
 * 필드별로 source를 따로 찾아 오동작을 막습니다.
 */
export function fillMissingPricesFromSourceRow(rows: VariantRow[]): VariantRow[] {
  let sourceWholesale: VariantRow | null = null;
  let sourceMsrp: VariantRow | null = null;
  let sourceSale: VariantRow | null = null;
  let sourceExtra: VariantRow | null = null;

  for (const r of rows) {
    if (isVacantScratchRow(r)) continue;

    if (!sourceWholesale && parsePriceField(r.wholesalePrice) > 0) sourceWholesale = r;
    if (!sourceMsrp && parsePriceField(r.msrpPrice) > 0) sourceMsrp = r;
    if (!sourceSale && parsePriceField(r.salePrice) > 0) sourceSale = r;
    if (!sourceExtra && parsePriceField(r.extraPrice) > 0) sourceExtra = r;

    if (sourceWholesale && sourceMsrp && sourceSale && sourceExtra) break;
  }

  if (!sourceWholesale && !sourceMsrp && !sourceSale && !sourceExtra) return rows;

  return rows.map((r) => {
    if (isVacantScratchRow(r)) return r;
    return {
      ...r,
      ...(sourceWholesale ? { wholesalePrice: sourceWholesale.wholesalePrice } : {}),
      ...(sourceMsrp ? { msrpPrice: sourceMsrp.msrpPrice } : {}),
      ...(sourceSale ? { salePrice: sourceSale.salePrice } : {}),
      ...(sourceExtra ? { extraPrice: sourceExtra.extraPrice } : {}),
    };
  });
}

/** 표시용 empty-1 또는, 입력 전 템플릿 같은 빈 줄(옵션/가격/메모 없음·재고 0) */
export function isVacantScratchRow(r: VariantRow): boolean {
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
 * variant 없이 `products.stock`만 쓰던 상품의 편집 화면 기본 행(색상·성별·사이즈·가격·메모 없음).
 * CSV처럼 variant로 저장하지 않고 기존 product.stock 경로만 유지할 때 제외합니다.
 */
export function isLegacyProductStockOnlyRow(r: VariantRow): boolean {
  if (r.variantId) return false;
  const hasOpts =
    String(r.color ?? "").trim() !== "" ||
    String(r.gender ?? "").trim() !== "" ||
    String(r.size ?? "").trim() !== "";
  if (hasOpts || rowHasAnyPriceFields(r)) return false;
  if (String(r.memo ?? "").trim() !== "" || String(r.memo2 ?? "").trim() !== "") return false;
  return true;
}

/** 저장·전송 대상 옵션 행(CSV와 동일: 가격·재고·메모만 있어도 variant로 저장) */
export function getPersistableVariantRows(
  rows: VariantRow[],
  options?: { excludeLegacyProductStockOnly?: boolean }
): VariantRow[] {
  const excludeLegacy = options?.excludeLegacyProductStockOnly ?? false;
  return rows.filter((r) => {
    if (isVacantScratchRow(r)) return false;
    if (excludeLegacy && isLegacyProductStockOnlyRow(r)) return false;
    return true;
  });
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

function normalizeStockInput(raw: string): string {
  const trimmed = String(raw ?? "").trim();
  if (trimmed === "") return "";
  const digitsOnly = trimmed.replace(/[^\d]/g, "");
  if (digitsOnly === "") return "";
  return digitsOnly.replace(/^0+(?=\d)/, "");
}

function normalizePriceInput(raw: string): string {
  const trimmed = String(raw ?? "").trim();
  if (trimmed === "") return "";
  const digitsOnly = trimmed.replace(/[^\d]/g, "");
  if (digitsOnly === "") return "";
  const normalized = digitsOnly.replace(/^0+(?=\d)/, "");
  const n = Number(normalized);
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("ko-KR");
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
  const priceFields: ReadonlySet<Field> = new Set(["wholesalePrice", "msrpPrice", "salePrice", "extraPrice"]);

  const updateRow = useCallback(
    (rowId: string, field: Field, value: string) => {
      const nextValue =
        field === "stock"
          ? normalizeStockInput(value)
          : priceFields.has(field)
            ? normalizePriceInput(value)
            : value;
      onRowsChange((prev) => {
        if (prev.length === 0) {
          const r = emptyRow();
          return [{ ...r, rowId: generateRowId(), [field]: nextValue }];
        }
        return prev.map((r) => (r.rowId === rowId ? { ...r, [field]: nextValue } : r));
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
              onFocus={(e) => {
                if (e.currentTarget.value === "0") e.currentTarget.select();
              }}
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
