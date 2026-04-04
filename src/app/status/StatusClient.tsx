"use client";

import { useMemo, useState } from "react";

type StatusRow = {
  id: string;
  sku: string;
  category: string | null;
  name: string;
  stock: number;
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
        (r.category ?? "").toLowerCase().includes(q)
    );
  }, [rows, categoryFilter, search]);

  const totalSkus = filtered.length;
  const totalQty = filtered.reduce((sum, r) => sum + (Number(r.stock) || 0), 0);
  const zeroStock = filtered.filter((r) => (Number(r.stock) || 0) === 0).length;

  return (
    <div className="products-page">
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>재고 현황</h1>

      <div className="products-toolbar products-toolbar--compact">
        <div className="toolbar-row toolbar-row--search">
          <input
            type="search"
            placeholder="품목·품명·카테고리"
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
          <select
            className="btn btn-secondary btn-compact"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            aria-label="카테고리 필터"
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

      <p className="products-count">
        {totalSkus}개 상품
        {search && ` (전체 ${rows.length}개 중)`}
      </p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <Stat label="품목 수" value={`${totalSkus.toLocaleString()}개`} />
        <Stat label="총 재고" value={`${totalQty.toLocaleString()}개`} />
        <Stat label="재고 0" value={`${zeroStock.toLocaleString()}개`} />
      </div>

      <div className="table-wrap status-stock-table-wrap">
        <table className="table status-stock-table">
          <thead>
            <tr>
              <th className="status-stock-table__name">품명</th>
              <th className="status-stock-table__stock">재고</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td className="status-stock-table__empty" colSpan={2}>
                  검색 결과가 없습니다.
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id}>
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

