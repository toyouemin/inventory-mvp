"use client";

import Link from "next/link";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { fitCategorySelectWidth } from "@/app/products/fitCategorySelectWidth";

type StatusRow = {
  id: string;
  sku: string;
  category: string | null;
  name: string;
  stock: number;
  memo: string;
  memo2: string;
};

type StockSortMode = "default" | "asc" | "desc";

export function StatusClient({
  rows,
  categories,
}: {
  rows: StatusRow[];
  categories: string[];
}) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [stockSort, setStockSort] = useState<StockSortMode>("default");
  const [hideZeroStock, setHideZeroStock] = useState(false);

  const categorySelectRef = useRef<HTMLSelectElement>(null);
  const toolbarSearchRowRef = useRef<HTMLDivElement>(null);
  const categorySelectDisplayedLabel = categoryFilter === "" ? "전체" : categoryFilter;

  useLayoutEffect(() => {
    const sel = categorySelectRef.current;
    if (!sel) return;
    const run = () =>
      fitCategorySelectWidth(sel, categorySelectDisplayedLabel, toolbarSearchRowRef.current);
    run();
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(run);
    });
    const row = toolbarSearchRowRef.current;
    if (row) ro.observe(row);
    ro.observe(sel);
    return () => ro.disconnect();
  }, [categorySelectDisplayedLabel]);

  const filtered = useMemo(() => {
    let list = rows;
    if (categoryFilter) {
      list = list.filter((r) => (r.category ?? "").trim() === categoryFilter);
    }
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (r) =>
        (r.sku ?? "").toLowerCase().includes(q) ||
        (r.name ?? "").toLowerCase().includes(q) ||
        (r.category ?? "").toLowerCase().includes(q) ||
        (r.memo ?? "").toLowerCase().includes(q) ||
        (r.memo2 ?? "").toLowerCase().includes(q)
    );
  }, [rows, categoryFilter, search]);

  const listAfterZeroToggle = useMemo(() => {
    if (!hideZeroStock) return filtered;
    return filtered.filter((r) => (Number(r.stock) || 0) !== 0);
  }, [filtered, hideZeroStock]);

  const displayed = useMemo(() => {
    if (stockSort === "default") return listAfterZeroToggle;
    const dir = stockSort === "asc" ? 1 : -1;
    return [...listAfterZeroToggle].sort((a, b) => {
      const sa = Number(a.stock) || 0;
      const sb = Number(b.stock) || 0;
      if (sa !== sb) return (sa - sb) * dir;
      return (a.sku ?? "").localeCompare(b.sku ?? "", "ko");
    });
  }, [listAfterZeroToggle, stockSort]);

  const totalSkus = filtered.length;
  const totalQty = filtered.reduce((sum, r) => sum + (Number(r.stock) || 0), 0);
  const zeroStock = filtered.filter((r) => (Number(r.stock) || 0) === 0).length;

  const cycleStockSort = () => {
    setStockSort((prev) => (prev === "default" ? "asc" : prev === "asc" ? "desc" : "default"));
  };

  const stockSortLabel =
    stockSort === "asc"
      ? "재고 오름차순"
      : stockSort === "desc"
        ? "재고 내림차순"
        : "재고 기본 순서(페이지 목록 순)";

  const stockSortTitle =
    stockSort === "default"
      ? "클릭: 오름차순"
      : stockSort === "asc"
        ? "클릭: 내림차순"
        : "클릭: 기본 순서로";

  return (
    <div className="products-page status-stock-page">
      <div className="products-content-container">
        <h1 className="status-stock-page__title">재고 현황</h1>

        <div className="products-toolbar products-toolbar--compact">
          <div ref={toolbarSearchRowRef} className="toolbar-row toolbar-row--search">
            <input
              type="search"
              placeholder="품목·품명·카테고리·메모"
              title="SKU·상품명·카테고리·비고1·비고2(옵션 포함) 검색"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setSearch(searchInput);
              }}
              className="products-search"
            />
            <button type="button" className="btn btn-primary btn-compact" onClick={() => setSearch(searchInput)}>
              검색
            </button>
            <div className="products-category-select-wrap">
              <select
                ref={categorySelectRef}
                className="btn btn-secondary btn-compact products-category-select"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                aria-label="카테고리 필터"
                title={categorySelectDisplayedLabel}
              >
                <option value="">전체</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="status-stock-stats" role="group" aria-label="재고 요약">
          <Stat label="품목 수" value={`${totalSkus.toLocaleString()}개`} />
          <Stat label="총 재고" value={`${totalQty.toLocaleString()}개`} />
          <button
            type="button"
            className="status-stock-stat status-stock-stat--zero-toggle"
            aria-pressed={hideZeroStock}
            aria-label={
              hideZeroStock
                ? `재고 0 ${zeroStock.toLocaleString()}개. 목록에서 재고 0 품목 숨김 켜짐. 누르면 다시 표시합니다.`
                : `재고 0 ${zeroStock.toLocaleString()}개. 재고 0 품목 목록에 표시 중. 누르면 목록에서 숨깁니다.`
            }
            title={
              hideZeroStock
                ? "재고 0 행 숨김 중 · 클릭하면 목록에 다시 표시"
                : "클릭하면 목록에서 재고 0 품목 숨김"
            }
            onClick={() => setHideZeroStock((v) => !v)}
          >
            <span className="status-stock-stat__label">재고 0</span>
            <span className="status-stock-stat__value">{`${zeroStock.toLocaleString()}개`}</span>
          </button>
        </div>
        <p className="status-stock-stats-note">
          ※ 검색·카테고리 필터 기준. 재고는 <strong>옵션 수량 합</strong>. CSV 동일 옵션 여러 줄은{" "}
          <strong>수량 합산</strong>. <strong>초기화</strong>는 파일과 일치, <strong>덮어쓰기</strong>는 파일에 없는 옵션이
          DB에 남으면 합계에 포함될 수 있음.
        </p>

        <div className="table-wrap status-stock-table-wrap">
          <table className="table status-stock-table">
            <thead>
              <tr>
                <th className="status-stock-table__category">카테고리</th>
                <th className="status-stock-table__name">품명</th>
                <th className="status-stock-table__stock">
                  <button
                    type="button"
                    className="status-stock-table__sort-btn"
                    onClick={cycleStockSort}
                    aria-label={stockSortLabel}
                    title={`${stockSortLabel}. ${stockSortTitle}`}
                  >
                    재고
                    {stockSort === "asc" ? (
                      <span className="status-stock-table__sort-btn__mark" aria-hidden>
                        ↑
                      </span>
                    ) : stockSort === "desc" ? (
                      <span className="status-stock-table__sort-btn__mark" aria-hidden>
                        ↓
                      </span>
                    ) : null}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td className="status-stock-table__empty" colSpan={3}>
                    검색 결과가 없습니다.
                  </td>
                </tr>
              ) : listAfterZeroToggle.length === 0 ? (
                <tr>
                  <td className="status-stock-table__empty" colSpan={3}>
                    재고가 있는 품목이 없습니다. (재고 0 숨김)
                  </td>
                </tr>
              ) : (
                displayed.map((r) => (
                  <tr
                    key={r.id}
                    className={(Number(r.stock) || 0) === 0 ? "status-stock-table__row--zero" : undefined}
                  >
                    <td className="status-stock-table__category">
                      {(r.category ?? "").trim() || "—"}
                    </td>
                    <td className="status-stock-table__name">
                      <Link href={`/products?jumpProductId=${encodeURIComponent(r.id)}`}>{r.name}</Link>
                    </td>
                    <td className="status-stock-table__stock">
                      <strong>{Number(r.stock).toLocaleString()}</strong>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="status-stock-stat">
      <div className="status-stock-stat__label">{label}</div>
      <div className="status-stock-stat__value">{value}</div>
    </div>
  );
}

