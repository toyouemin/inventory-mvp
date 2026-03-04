"use client";

import { useEffect, useMemo, useState } from "react";
import type { Product } from "./types";
import { ProductCard } from "./ProductCard";
import { AddProductModal } from "./AddProductModal";
import { adjustStock, uploadProductsCsv } from "./actions";
import { EditProductModal } from "./EditProductModal";

export function ProductsClient({ products }: { products: Product[] }) {
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  type ViewMode = "card" | "list";
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem("products:viewMode") : null;
    if (saved === "card" || saved === "list") setViewMode(saved);
  }, []);

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

  return (
    <div className="products-page">
      <div className="products-toolbar">
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
        <input
          type="search"
          placeholder="품목코드·품명·카테고리 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="products-search"
        />

          <div className="view-toggle" role="group" aria-label="보기 방식 전환">
          <button
          type="button"
           className={`btn ${viewMode === "list" ? "btn-primary" : "btn-secondary"}`}
           onClick={() => setViewMode("list")}
           style={{ whiteSpace: "nowrap" }}  >
          리스트형
          </button>

        <button
    type="button"
    className={`btn ${viewMode === "card" ? "btn-primary" : "btn-secondary"}`}
    onClick={() => setViewMode("card")}
  >
    카드형
  </button>
</div>

        <button type="button" className="btn btn-primary" onClick={() => setAddOpen(true)}>
          상품 추가
        </button>

        <div className="products-csv">
          <a href="/products/csv/products" download className="btn btn-secondary">
            상품 CSV 다운로드
          </a>
          <label className="btn btn-secondary">
            {uploading ? "업로드 중..." : "상품 CSV 업로드"}
            <input
              type="file"
              accept=".csv"
              onChange={handleProductsCsv}
              disabled={uploading}
              style={{ display: "none" }}
            />
          </label>
        </div>
      </div>

      <p className="products-count">
        {filtered.length}개 상품
        {search && ` (전체 ${products.length}개 중)`}
      </p>

      {viewMode === "card" ? (
        <div className="products-grid">
          {filtered.length === 0 ? (
            <p className="muted">검색 결과가 없습니다.</p>
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
            <p className="muted">검색 결과가 없습니다.</p>
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
                          <img className="thumb-small" src={p.imageUrl} alt={p.nameSpec} />
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
                            <button
                              type="button"
                              className="btn-mini"
                              onClick={async () => adjustStock(p.id, 1)}
                            >
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

      <AddProductModal open={addOpen} onClose={() => setAddOpen(false)} />

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