"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Product, ProductVariant, ProductRow } from "./types";
import { ProductCard } from "./ProductCard";
import { AddProductModal } from "./AddProductModal";
import { adjustStock, adjustVariantStock, deleteProduct, uploadProductsCsv } from "./actions";
import { EditProductModal } from "./EditProductModal";

type ViewMode = "card" | "list";

export function ProductsClient({
  products,
  categories = [],
  variantsByProductId = {},
}: {
  products: Product[];
  categories?: string[];
  variantsByProductId?: Record<string, ProductVariant[]>;
}) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");

  const [uploading, setUploading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editingVariants, setEditingVariants] = useState<ProductVariant[]>([]);

  const [viewMode, setViewMode] = useState<ViewMode>("list");

  // (중요) 화면에 처음 나타난 순서를 고정 저장
  const orderRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const map = orderRef.current;
    for (const p of products) {
      if (!map.has(p.id)) map.set(p.id, map.size);
    }
  }, [products]);

  // 모바일이면 기본 카드형
  useEffect(() => {
    if (typeof window === "undefined") return;
    const m = window.matchMedia("(max-width: 768px)");
    if (m.matches) setViewMode("card");
  }, []);

  // 저장된 보기 방식 불러오기
  useEffect(() => {
    const saved =
      typeof window !== "undefined" ? window.localStorage.getItem("products:viewMode") : null;
    if (saved === "card" || saved === "list") setViewMode(saved);
  }, []);

  // 보기 방식 저장
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("products:viewMode", viewMode);
  }, [viewMode]);

  // 항상 동일한 순서로 보이도록 고정 정렬된 products
  const orderedProducts = useMemo(() => {
    const map = orderRef.current;
    return [...products].sort((a, b) => {
      const ai = map.get(a.id) ?? 999999;
      const bi = map.get(b.id) ?? 999999;
      return ai - bi;
    });
  }, [products]);

  // 검색 + 카테고리: orderedProducts 기준 필터링(순서 유지)
  const filtered = useMemo(() => {
    let list = orderedProducts;
    if (categoryFilter) {
      list = list.filter((p) => (p.category ?? "").trim() === categoryFilter);
    }
    if (!search.trim()) return list;
    const q = search.trim().toLowerCase();
    return list.filter(
      (p) =>
        p.sku.toLowerCase().includes(q) ||
        (p.nameSpec && p.nameSpec.toLowerCase().includes(q)) ||
        (p.category && p.category.toLowerCase().includes(q))
    );
  }, [orderedProducts, search, categoryFilter]);

  /** List view: one row per (product, size). No total stock. */
  const listRows = useMemo((): ProductRow[] => {
    const rows: ProductRow[] = [];
    for (const p of filtered) {
      const variants = variantsByProductId[p.id] ?? [];
      if (variants.length > 0) {
        for (const v of variants) {
          rows.push({ ...p, variantId: v.id, size: v.size, variantStock: v.stock });
        }
      } else {
        rows.push({
          ...p,
          variantId: "",
          size: "",
          variantStock: p.stock ?? 0,
        });
      }
    }
    return rows;
  }, [filtered, variantsByProductId]);

  async function handleProductsCsv(e: React.ChangeEvent<HTMLInputElement>, fullSync: boolean) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (fullSync && !confirm("CSV에 없는 기존 상품은 모두 삭제됩니다. 계속하시겠습니까?")) {
      e.target.value = "";
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await uploadProductsCsv(fd, fullSync);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  function runSearch() {
    setSearch(searchInput);
  }

  const actionButtons = (
    <>
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
      <a href="/products/csv/products" download="products.csv" className="btn btn-secondary btn-compact btn-strong">
        CSV↓
      </a>
      <label className="btn btn-secondary btn-compact btn-strong">
        {uploading ? "업로드..." : "CSV↑"}
        <input
          type="file"
          accept=".csv"
          onChange={(e) => handleProductsCsv(e, false)}
          disabled={uploading}
          style={{ display: "none" }}
        />
      </label>
      <label className="btn btn-danger btn-compact btn-strong">
        {uploading ? "동기화 중..." : "전체동기화"}
        <input
          type="file"
          accept=".csv"
          onChange={(e) => handleProductsCsv(e, true)}
          disabled={uploading}
          style={{ display: "none" }}
        />
      </label>
      <button type="button" className="btn btn-primary btn-compact" onClick={() => setAddOpen(true)}>
        +추가
      </button>
    </>
  );

  return (
    <div className="products-page">
      <div className="products-toolbar products-toolbar--compact">
        {/* 1줄: 검색 + 검색버튼 + 카테고리 */}
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

        {/* 데스크톱 전용: 리스트/카드/CSV/+추가 */}
        <div className="toolbar-actions toolbar-actions-desktop">
          <div className="toolbar-scroll">
            {actionButtons}
          </div>
        </div>
      </div>

      {/* 모바일 전용: 하단 고정 액션 바 */}
      <div className="toolbar-bottom-bar" aria-hidden="true">
        {actionButtons}
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
                variants={variantsByProductId[p.id] ?? []}
                onEditClick={() => {
                  setEditingProduct(p);
                  setEditingVariants(variantsByProductId[p.id] ?? []);
                  setEditOpen(true);
                }}
                onDeleteClick={async () => {
                  if (!confirm("이 상품을 삭제하시겠습니까?")) return;
                  await deleteProduct(p.id);
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
                  <th>사이즈</th>
                  <th>재고</th>
                  <th>출고가</th>
                  <th>판매가</th>
                  <th>실판매가</th>
                  <th>작업</th>
                </tr>
              </thead>
              <tbody>
                {listRows.map((row) => {
                  const qty = row.variantStock;
                  const isVariant = Boolean(row.variantId);
                  const adjust = (delta: number) =>
                    isVariant ? adjustVariantStock(row.variantId, delta) : adjustStock(row.id, delta);
                  return (
                    <tr key={row.variantId ? `${row.id}-${row.size}` : row.id}>
                      <td>
                        {row.imageUrl ? (
                          <img className="thumb-small" src={row.imageUrl} alt={(row.nameSpec ?? row.sku ?? "").toString()} />
                        ) : (
                          <span className="thumb-empty">-</span>
                        )}
                      </td>
                      <td>{row.sku}</td>
                      <td>{row.nameSpec}</td>
                      <td>{row.size || "-"}</td>
                      <td>
                        <div className="stock-cell">
                          <strong>{qty}</strong>
                          <div className="stock-buttons">
                            <button
                              type="button"
                              className="btn-mini"
                              disabled={qty < 1}
                              onClick={async () => adjust(-1)}
                            >
                              -1
                            </button>
                            <button type="button" className="btn-mini" onClick={async () => adjust(1)}>
                              +1
                            </button>
                          </div>
                        </div>
                      </td>
                      <td>{row.wholesalePrice != null ? `${row.wholesalePrice.toLocaleString()}원` : "-"}</td>
                      <td>{row.msrpPrice != null ? `${row.msrpPrice.toLocaleString()}원` : "-"}</td>
                      <td>{row.salePrice != null ? `${row.salePrice.toLocaleString()}원` : "-"}</td>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="btn btn-secondary btn-row"
                            onClick={() => {
                              setEditingProduct(row);
                              setEditingVariants(variantsByProductId[row.id] ?? []);
                              setEditOpen(true);
                            }}
                          >
                            수정
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger btn-row"
                            onClick={async () => {
                              if (!confirm("이 상품을 삭제하시겠습니까?")) return;
                              await deleteProduct(row.id);
                            }}
                          >
                            삭제
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

      <AddProductModal open={addOpen} onClose={() => setAddOpen(false)} initialSku={search.trim()} />

      <EditProductModal
        key={editingProduct?.id ?? "closed"}
        open={editOpen}
        product={editingProduct}
        variants={editingVariants}
        onClose={() => {
          setEditOpen(false);
          setEditingProduct(null);
          setEditingVariants([]);
        }}
      />
    </div>
  );
}