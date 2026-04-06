"use client";

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

  const totalSkus = filtered.length;
  const totalQty = filtered.reduce((sum, r) => sum + (Number(r.stock) || 0), 0);
  const zeroStock = filtered.filter((r) => (Number(r.stock) || 0) === 0).length;

  return (
    <div className="products-page">
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>재고 현황</h1>

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

      <p className="products-count">
        {totalSkus}개 상품
        {search && ` (전체 ${rows.length}개 중)`}
      </p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <Stat label="품목 수" value={`${totalSkus.toLocaleString()}개`} />
        <Stat label="총 재고" value={`${totalQty.toLocaleString()}개`} />
        <Stat label="재고 0" value={`${zeroStock.toLocaleString()}개`} />
      </div>
      <p className="status-stock-stats-note">
        위 숫자와 표는 <strong>현재 검색·카테고리 필터</strong>가 적용된 목록 기준입니다. 상품별 재고는 옵션이 있으면{" "}
        <strong>모든 옵션 수량의 합</strong>이며, CSV의 <code>stock</code>과 같게 저장됩니다. 같은 색상·성별·사이즈 조합이
        CSV에 여러 줄이면 업로드 시 <strong>재고만 합산</strong>됩니다. CSV <strong>초기화(reset)</strong> 후에는 DB가
        파일 내용과 일치하고, <strong>덮어쓰기(merge)</strong>는 파일에 없는 기존 옵션이 DB에 남아 있으면 그 수량이
        총재고·상품별 합에 <strong>추가로</strong> 포함될 수 있습니다.
      </p>

      <div className="table-wrap status-stock-table-wrap">
        <table className="table status-stock-table">
          <thead>
            <tr>
              <th className="status-stock-table__category">카테고리</th>
              <th className="status-stock-table__name">품명</th>
              <th className="status-stock-table__stock">재고</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td className="status-stock-table__empty" colSpan={3}>
                  검색 결과가 없습니다.
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id}>
                  <td className="status-stock-table__category">
                    {(r.category ?? "").trim() || "—"}
                  </td>
                  <td className="status-stock-table__name">{r.name}</td>
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
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        border: "1px solid #ddd",
        borderRadius: 10,
        padding: "10px 12px",
        minWidth: 160,
      }}
    >
      <div style={{ color: "#666", fontSize: 12, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

