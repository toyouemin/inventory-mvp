"use client";

import { useEffect, useMemo, useState } from "react";
import type { Product } from "./types";
import { ProductCard } from "./ProductCard";
import { AddProductModal } from "./AddProductModal";
import { adjustStock, uploadProductsCsv } from "./actions";
import { EditProductModal } from "./EditProductModal";

type ViewMode = "card" | "list";

export function ProductsClient({ products }: { products: Product[] }) {
  // ✅ 입력값(searchInput)과 실제 검색값(search) 분리
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const [uploading, setUploading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>("list");

  // ✅ 모바일이면 기본 카드형
  useEffect(() => {
    if (typeof window === "undefined") return;
    const m = window.matchMedia("(max-width: 768px)");
    if (m.matches) setViewMode("card");
  }, []);

  // ✅ 저장된 보기 방식 불러오기
  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem("products:viewMode") : null;
    if (saved === "card" || saved === "list") setViewMode(saved);
  }, []);

  // ✅ 보기 방식 저장
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("products:viewMode", viewMode);
  }, [viewMode]);

  const filtered = useMemo(() => {
    if (!search.trim()) return products;
    const q = search.trim().toLowerCase();
    return products.filter(
      (p) =>
        p.sku.toLowerCase().includes(q) ||
        (p.nameSpec && p.nameSpec.toLowerCase().includes(q)) ||
        (p.category && p.category.toLowerCase().includes(q))
    );
  }, [products, search]);

  async function handleProductsCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await uploadProductsCsv(fd);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  function runSearch() {
    setSearch(searchInput);
  }

  return (
    <div className="products-page">
      <div className="products-toolbar products-toolbar--compact">
        {/* ✅ 로그인/로그아웃 나중에 쓸 수 있게 주석처리 */}
        {/*
        <button
          type="button"
          className="btn btn-secondary"
          onClick={async () => {
            await fetch("/api/gate/logout", { method: "POST" });
            window.location.replace("/login");
          }}
        >
          로그아웃
        </button>
        */}

        {/* 1줄: 검색창 + 검색버튼 */}
        <div className="toolbar-row toolbar-row--search">
          <input
            type="search"
            placeholder="품목코드·품명·카테고리"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") runSearch();
            }}
            className="products-search"
          />
          <button type="button" className="btn btn-primary btn-compact" onClick={runSearch}>
            검색
          </button>
        </div>

        {/* 2줄: 작은 버튼들 */}
        <div className="toolbar-row toolbar-row--actions toolbar-row--scroll">
          <div className="view-toggle" role="group" aria-label="보기 방식 전환">
            <button
              type="button"
              className={`btn btn-compact ${viewMode === "list" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setViewMode("list")}
            >
              리스트
            </button>

            <button
              type="button"
              className={`btn btn-compact ${viewMode === "card" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setViewMode("card")}
            >
              카드
            </button>
          </div>

          <div className="products-csv products-csv--compact">
            <a href="/products/csv/products" download className="btn btn-secondary btn-compact">
              CSV↓
            </a>

            <label className="btn btn-secondary btn-compact">
              {uploading ? "업로드..." : "CSV↑"}
              <input
                type="file"
                accept=".csv"
                onChange={handleProductsCsv}
                disabled={uploading}
                style={{ display: "none" }}
              />
            </label>
          </div>

          <button type="button" className="btn btn-primary btn-compact" onClick={() => setAddOpen(true)}>
            +추가
          </button>
        </div>
      </div>

      <p className="products-count">
        {filtered.length}개 상품
        {search && ` (전체 ${products.length}개 중)`}
      </p>

      {viewMode === "card" ? (
        <div className="products-grid">
          {filtered.length === 0 ? (
            <div>
              <p className="muted">검색 결과가 없습니다.</p>

              {/* ✅ 검색값으로 바로 추가(모달에 SKU 자동 입력) */}
              {search.trim() && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setAddOpen(true)}
                  style={{ marginTop: 8 }}
                >
                  '{search.trim()}' 추가
                </button>
              )}
            </div>
          ) : (
            filtered.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                onEditClick={() => {
                  setEditingProduct(p);
                  setEditOpen(true);
                }}
              />
            ))
          )}
        </div>
      ) : (
        <div className="table-wrap">
          {filtered.length === 0 ? (
            <div>
              <p className="muted">검색 결과가 없습니다.</p>

              {search.trim() && (
                <button type="button" className="btn btn-primary" onClick={() => setAddOpen(true)}>
                  '{search.trim()}' 추가
                </button>
              )}
            </div>
          ) : (
            <table className="table products-table">
              <thead>
                <tr>
                  <th>이미지</th>
                  <th>SKU</th>
                  <th>품명</th>
                  <th>재고</th>
                  <th>출고가</th>
                  <th>판매가</th>
                  <th>실판매가</th>
                  <th>작업</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const qty = p.stock ?? 0;

                  return (
                    <tr key={p.id}>
                      <td>
                        {p.imageUrl ? (
                          <img className="thumb-small" src={p.imageUrl} alt={(p.nameSpec ?? p.sku ?? "").toString()} />
                        ) : (
                          <span className="thumb-empty">-</span>
                        )}
                      </td>
                      <td>{p.sku}</td>
                      <td>{p.nameSpec}</td>
                      <td>
                        <div className="stock-cell">
                          <strong>{qty}</strong>
                          <div className="stock-buttons">
                            <button
                              type="button"
                              className="btn-mini"
                              disabled={qty < 1}
                              onClick={async () => adjustStock(p.id, -1)}
                            >
                              -1
                            </button>
                            <button type="button" className="btn-mini" onClick={async () => adjustStock(p.id, 1)}>
                              +1
                            </button>
                          </div>
                        </div>
                      </td>
                      <td>{p.wholesalePrice != null ? `${p.wholesalePrice.toLocaleString()}원` : "-"}</td>
                      <td>{p.msrpPrice != null ? `${p.msrpPrice.toLocaleString()}원` : "-"}</td>
                      <td>{p.salePrice != null ? `${p.salePrice.toLocaleString()}원` : "-"}</td>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="btn btn-secondary btn-row"
                            onClick={() => {
                              setEditingProduct(p);
                              setEditOpen(true);
                            }}
                          >
                            수정
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ✅ 검색값을 SKU로 자동 채워서 추가 */}
      <AddProductModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        initialSku={search.trim()}
      />

      <EditProductModal
        open={editOpen}
        product={editingProduct}
        onClose={() => {
          setEditOpen(false);
          setEditingProduct(null);
        }}
      />
    </div>
  );
}