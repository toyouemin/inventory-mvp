"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Product, ProductVariant, ProductRow } from "./types";
import { formatVariantDisplay } from "./variantOptions";
import { ProductCard } from "./ProductCard";
import { AddProductModal } from "./AddProductModal";
import { adjustStock, adjustVariantStock, deleteProduct, uploadProductsCsv } from "./actions";
import { EditProductModal } from "./EditProductModal";

type ViewMode = "card" | "list";

function variantSavingKeyForProduct(adjustingKeys: Set<string>, variants: ProductVariant[]): string {
  if (!variants.length) return "";
  const ids = new Set(variants.map((v) => v.id));
  return [...adjustingKeys]
    .filter((k) => k.startsWith("v:"))
    .map((k) => k.slice(2))
    .filter((vid) => ids.has(vid))
    .sort()
    .join(",");
}

function listRowAdjustKey(row: ProductRow): string {
  return row.variantId ? `v:${row.variantId}` : `p:${row.id}`;
}

/** 카테고리 select 폭 안에 들어가도록 글자 크기 조절(네이티브 select는 줄바꿈 불가). */
function fitCategorySelectFont(selectEl: HTMLSelectElement, displayedLabel: string) {
  const maxFs = 13;
  const minFs = 9;
  const padApprox = 28;
  const w = selectEl.clientWidth;
  if (w < 40) return;
  const cs = getComputedStyle(selectEl);
  const family = cs.fontFamily || "sans-serif";
  const weight = cs.fontWeight || "600";
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  let bestFs = minFs;
  for (let fs = maxFs; fs >= minFs; fs -= 0.5) {
    ctx.font = `${weight} ${fs}px ${family}`;
    if (ctx.measureText(displayedLabel).width + padApprox <= w) {
      bestFs = fs;
      break;
    }
  }
  selectEl.style.fontSize = `${bestFs}px`;
}

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
  const [localProducts, setLocalProducts] = useState<Product[]>(products);
  const [localVariantsByProductId, setLocalVariantsByProductId] =
    useState<Record<string, ProductVariant[]>>(variantsByProductId);

  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [listImagePreview, setListImagePreview] = useState<{ url: string; alt: string } | null>(null);

  // (중요) 화면에 처음 나타난 순서를 고정 저장
  const orderRef = useRef<Map<string, number>>(new Map());
  const categorySelectRef = useRef<HTMLSelectElement>(null);
  const csvFileInputRef = useRef<HTMLInputElement>(null);
  const downloadRef = useRef<HTMLDivElement | null>(null);
  const downloadButtonRef = useRef<HTMLButtonElement | null>(null);
  const downloadMenuRef = useRef<HTMLDivElement | null>(null);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [downloadMenuUp, setDownloadMenuUp] = useState(false);
  const [downloadMenuStyle, setDownloadMenuStyle] = useState<CSSProperties>({});
  const [adjustingStockKeys, setAdjustingStockKeys] = useState(() => new Set<string>());
  const adjustLocksRef = useRef<Set<string>>(new Set());
  const localProductsRef = useRef<Product[]>(products);
  const localVariantsRef = useRef<Record<string, ProductVariant[]>>(variantsByProductId);
  localProductsRef.current = localProducts;
  localVariantsRef.current = localVariantsByProductId;

  const patchAdjusting = useCallback((updater: (s: Set<string>) => Set<string>) => {
    setAdjustingStockKeys((prev) => updater(new Set(prev)));
  }, []);

  const onProductStockDelta = useCallback(
    async (productId: string, delta: number) => {
      const key = `p:${productId}`;
      if (adjustLocksRef.current.has(key)) return;
      adjustLocksRef.current.add(key);

      const rollback = { current: null as number | null };
      let applied = false;
      setLocalProducts((prev) => {
        const p = prev.find((x) => x.id === productId);
        if (!p) return prev;
        const old = p.stock ?? 0;
        if (delta < 0 && old < 1) return prev;
        rollback.current = old;
        applied = true;
        const next = Math.max(0, old + delta);
        return prev.map((x) => (x.id === productId ? { ...x, stock: next } : x));
      });

      if (!applied) {
        adjustLocksRef.current.delete(key);
        return;
      }

      patchAdjusting((s) => new Set(s).add(key));
      try {
        await adjustStock(productId, delta);
      } catch (err) {
        const old = rollback.current;
        if (old !== null) {
          setLocalProducts((prev) =>
            prev.map((x) => (x.id === productId ? { ...x, stock: old } : x))
          );
        }
        alert(err instanceof Error ? err.message : String(err));
      } finally {
        adjustLocksRef.current.delete(key);
        patchAdjusting((s) => {
          const n = new Set(s);
          n.delete(key);
          return n;
        });
      }
    },
    [patchAdjusting]
  );

  const onVariantStockDelta = useCallback(
    async (productId: string, variantId: string, delta: number) => {
      const key = `v:${variantId}`;
      if (adjustLocksRef.current.has(key)) return;
      adjustLocksRef.current.add(key);

      const rollback = { current: null as number | null };
      let applied = false;
      setLocalVariantsByProductId((prev) => {
        const list = prev[productId];
        if (!list) return prev;
        const idx = list.findIndex((v) => v.id === variantId);
        if (idx < 0) return prev;
        const old = list[idx].stock ?? 0;
        if (delta < 0 && old < 1) return prev;
        rollback.current = old;
        applied = true;
        const next = Math.max(0, old + delta);
        const nl = [...list];
        nl[idx] = { ...list[idx], stock: next };
        return { ...prev, [productId]: nl };
      });

      if (!applied) {
        adjustLocksRef.current.delete(key);
        return;
      }

      patchAdjusting((s) => new Set(s).add(key));
      try {
        await adjustVariantStock(variantId, delta);
      } catch (err) {
        const old = rollback.current;
        if (old !== null) {
          setLocalVariantsByProductId((prev) => {
            const list = prev[productId];
            if (!list) return prev;
            return {
              ...prev,
              [productId]: list.map((v) => (v.id === variantId ? { ...v, stock: old } : v)),
            };
          });
        }
        alert(err instanceof Error ? err.message : String(err));
      } finally {
        adjustLocksRef.current.delete(key);
        patchAdjusting((s) => {
          const n = new Set(s);
          n.delete(key);
          return n;
        });
      }
    },
    [patchAdjusting]
  );

  const onListRowStockDelta = useCallback(
    async (row: ProductRow, delta: number) => {
      if (row.variantId) await onVariantStockDelta(row.id, row.variantId, delta);
      else await onProductStockDelta(row.id, delta);
    },
    [onProductStockDelta, onVariantStockDelta]
  );

  const openEditById = useCallback((id: string) => {
    const p = localProductsRef.current.find((x) => x.id === id);
    if (!p) return;
    setEditingProduct(p);
    setEditingVariants(localVariantsRef.current[id] ?? []);
    setEditOpen(true);
  }, []);

  const requestDeleteProduct = useCallback(async (productId: string) => {
    if (!confirm("이 상품을 삭제하시겠습니까?")) return;
    await deleteProduct(productId);
  }, []);

  const categorySelectDisplayedLabel = categoryFilter === "" ? "전체" : categoryFilter;

  useLayoutEffect(() => {
    const sel = categorySelectRef.current;
    if (!sel) return;
    const run = () => fitCategorySelectFont(sel, categorySelectDisplayedLabel);
    run();
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(run);
    });
    ro.observe(sel);
    return () => ro.disconnect();
  }, [categorySelectDisplayedLabel]);

  useEffect(() => {
    if (!downloadOpen) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (!downloadRef.current) return;
      const t = e.target as Node | null;
      if (t && downloadRef.current.contains(t)) return;
      setDownloadOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [downloadOpen]);

  useEffect(() => {
    if (!downloadOpen) return;
    const computeMenuPos = () => {
      const btn = downloadButtonRef.current;
      const menu = downloadMenuRef.current;
      if (!btn) return;

      const rect = btn.getBoundingClientRect();
      const menuHeight = menu?.offsetHeight ?? 340;
      const menuWidth = menu?.offsetWidth ?? 320;
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;

      // 버튼 기준 위/아래 여유에 맞춰 배치
      // 아래 여유가 부족하면 위로, 아니면 아래로.
      const openUp = spaceBelow < menuHeight && spaceAbove > spaceBelow;
      setDownloadMenuUp(openUp);

      const gap = 0; // 메뉴-버튼 사이 간격 최소화
      const top = openUp ? Math.max(0, rect.top - menuHeight - gap) : rect.bottom + gap;

      // 글씨 폭 기준으로 버튼의 "가운데"와 메뉴의 "가운데"를 맞춤
      const preferredLeft = rect.left + rect.width / 2 - menuWidth / 2;
      const left = Math.max(8, Math.min(preferredLeft, window.innerWidth - menuWidth - 8));

      setDownloadMenuStyle({
        position: "fixed",
        top,
        left,
        zIndex: 9999,
      });
    };

    computeMenuPos();
    // 폭/높이(layout) 반영 직후 1회 더 재계산
    requestAnimationFrame(computeMenuPos);
    window.addEventListener("resize", computeMenuPos);
    window.addEventListener("scroll", computeMenuPos, true);
    return () => {
      window.removeEventListener("resize", computeMenuPos);
      window.removeEventListener("scroll", computeMenuPos, true);
    };
  }, [downloadOpen]);

  useEffect(() => {
    const map = orderRef.current;
    for (const p of products) {
      if (!map.has(p.id)) map.set(p.id, map.size);
    }
  }, [products]);
  useEffect(() => {
    setLocalProducts(products);
  }, [products]);
  useEffect(() => {
    setLocalVariantsByProductId(variantsByProductId);
  }, [variantsByProductId]);

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
    return [...localProducts].sort((a, b) => {
      const aCategory = (a.category ?? "").trim();
      const bCategory = (b.category ?? "").trim();
      if (aCategory !== bCategory) {
        if (!aCategory) return 1;
        if (!bCategory) return -1;
        return aCategory.localeCompare(bCategory, "ko");
      }
      const skuCompare = (a.sku ?? "").localeCompare(b.sku ?? "", "ko");
      if (skuCompare !== 0) return skuCompare;
      const ai = map.get(a.id) ?? 999999;
      const bi = map.get(b.id) ?? 999999;
      return ai - bi;
    });
  }, [localProducts]);

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
      const variants = localVariantsByProductId[p.id] ?? [];
      if (variants.length > 0) {
        for (const v of variants) {
          rows.push({
            ...p,
            variantId: v.id,
            size: formatVariantDisplay(v),
            variantStock: v.stock,
            memo: v.memo ?? null,
            memo2: v.memo2 ?? null,
          });
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
  }, [filtered, localVariantsByProductId]);

  async function handleProductsCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const result = await uploadProductsCsv(fd);
      if (result?.skippedCount && result.skippedCount > 0) {
        alert(
          `${result.skippedCount}개 행의 SKU가 비어 있어 스킵했습니다.\n` +
            `스킵된 데이터 행 번호: ${result.skippedRows.join(", ")}`
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(msg);
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
      <div className="download-dropdown" ref={downloadRef}>
        <button
          type="button"
          className="btn btn-secondary btn-compact btn-strong"
          ref={downloadButtonRef}
          onClick={() => setDownloadOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={downloadOpen}
        >
          다운로드
        </button>
        {downloadOpen ? (
          <div
            ref={downloadMenuRef}
            className="download-dropdown__menu"
            role="menu"
            aria-label="다운로드 선택"
            style={downloadMenuStyle}
          >
            <a
              role="menuitem"
              href="/products/csv/products"
              download="products.csv"
              className="download-dropdown__item"
              onClick={() => setDownloadOpen(false)}
            >
              상품 CSV
            </a>
            <a
              role="menuitem"
              href="/products/xlsx/products"
              download="products.xlsx"
              className="download-dropdown__item"
              onClick={() => setDownloadOpen(false)}
            >
              상품 엑셀
            </a>
            <div className="download-dropdown__divider" role="separator" />
            <a
              role="menuitem"
              href="/products/csv/stock"
              download="stock.csv"
              className="download-dropdown__item"
              onClick={() => setDownloadOpen(false)}
            >
              재고 CSV
            </a>
            <a
              role="menuitem"
              href="/products/xlsx/stock"
              download="stock.xlsx"
              className="download-dropdown__item"
              onClick={() => setDownloadOpen(false)}
            >
              재고 엑셀
            </a>
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className="btn btn-secondary btn-compact btn-strong"
        onClick={() => csvFileInputRef.current?.click()}
        disabled={uploading}
        aria-label="CSV 파일 업로드"
      >
        {uploading ? "업로드..." : "CSV업로드"}
      </button>
      <button type="button" className="btn btn-primary btn-compact" onClick={() => setAddOpen(true)}>
        추가
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

        {/* 데스크톱 전용: 리스트/카드/CSV/추가 */}
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
        {search && ` (전체 ${localProducts.length}개 중)`}
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
            filtered.map((p) => {
              const vars = localVariantsByProductId[p.id] ?? [];
              return (
                <ProductCard
                  key={p.id}
                  product={p}
                  variants={vars}
                  onEditClick={openEditById}
                  onDeleteClick={requestDeleteProduct}
                  onProductStockDelta={onProductStockDelta}
                  onVariantStockDelta={onVariantStockDelta}
                  productStockSaving={adjustingStockKeys.has(`p:${p.id}`)}
                  savingVariantIdsKey={variantSavingKeyForProduct(adjustingStockKeys, vars)}
                />
              );
            })
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
                  <th>매장</th>
                  <th>비고1</th>
                  <th>비고2</th>
                  <th>작업</th>
                </tr>
              </thead>
              <tbody>
                {listRows.map((row) => {
                  const qty = row.variantStock;
                  const rowKey = listRowAdjustKey(row);
                  const rowSaving = adjustingStockKeys.has(rowKey);
                  return (
                    <tr key={row.variantId ? `${row.id}-${row.variantId}` : row.id}>
                      <td>
                        {row.imageUrl ? (
                          <button
                            type="button"
                            className="products-table__thumb-btn"
                            onClick={() =>
                              setListImagePreview({
                                url: row.imageUrl!,
                                alt: (row.nameSpec ?? row.sku ?? "").toString(),
                              })
                            }
                            aria-label="상품 이미지 확대"
                          >
                            <img
                              className="thumb-small"
                              src={row.imageUrl}
                              alt=""
                              loading="lazy"
                              decoding="async"
                            />
                          </button>
                        ) : (
                          <span className="thumb-empty">-</span>
                        )}
                      </td>
                      <td>{row.sku}</td>
                      <td>{row.nameSpec}</td>
                      <td>{row.size || "-"}</td>
                      <td>
                        <div className="stock-cell">
                          <span className="stock-cell__qty">
                            <strong>{qty}</strong>
                            {rowSaving ? (
                              <span className="stock-adjust-pending" aria-label="저장 중" />
                            ) : null}
                          </span>
                          <div className="stock-buttons">
                            <button
                              type="button"
                              className="btn-mini"
                              disabled={qty < 1 || rowSaving}
                              onClick={() => {
                                void onListRowStockDelta(row, -1);
                              }}
                            >
                              -1
                            </button>
                            <button
                              type="button"
                              className="btn-mini"
                              disabled={rowSaving}
                              onClick={() => {
                                void onListRowStockDelta(row, 1);
                              }}
                            >
                              +1
                            </button>
                          </div>
                        </div>
                      </td>
                      <td>{row.wholesalePrice != null ? `${row.wholesalePrice.toLocaleString()}원` : "-"}</td>
                      <td>{row.msrpPrice != null ? `${row.msrpPrice.toLocaleString()}원` : "-"}</td>
                      <td>{row.salePrice != null ? `${row.salePrice.toLocaleString()}원` : "-"}</td>
                      <td>{row.extraPrice != null ? `${row.extraPrice.toLocaleString()}원` : "-"}</td>
                      <td>
                        {row.memo?.trim() ? (
                          <span className="products-table__memo products-table__memo--filled">{row.memo}</span>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td>
                        {row.memo2?.trim() ? (
                          <span className="products-table__memo products-table__memo--filled">{row.memo2}</span>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="btn btn-secondary btn-row"
                            onClick={() => openEditById(row.id)}
                          >
                            수정
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger btn-row"
                            onClick={() => void requestDeleteProduct(row.id)}
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

      <input
        ref={csvFileInputRef}
        type="file"
        accept=".csv"
        onChange={(e) => handleProductsCsv(e)}
        disabled={uploading}
        className="products-csv-file-input"
        aria-hidden
        tabIndex={-1}
      />

      <AddProductModal open={addOpen} onClose={() => setAddOpen(false)} initialSku={search.trim()} />

      <EditProductModal
        key={editingProduct?.id ?? "closed"}
        open={editOpen}
        product={editingProduct}
        variants={editingVariants}
        onSaved={({ productId, memo, memo2 }) => {
          setLocalProducts((prev) =>
            prev.map((p) => (p.id === productId ? { ...p, memo, memo2 } : p))
          );
          setEditingProduct((prev) =>
            prev && prev.id === productId ? { ...prev, memo, memo2 } : prev
          );
          setLocalVariantsByProductId((prev) => ({ ...prev }));
        }}
        onClose={() => {
          setEditOpen(false);
          setEditingProduct(null);
          setEditingVariants([]);
        }}
      />

      {listImagePreview ? (
        <div
          className="product-image-modal"
          role="dialog"
          aria-modal="true"
          onClick={() => setListImagePreview(null)}
        >
          <button
            type="button"
            className="product-image-modal__close"
            onClick={() => setListImagePreview(null)}
            aria-label="이미지 닫기"
          >
            닫기
          </button>
          <img
            className="product-image-modal__img"
            src={listImagePreview.url}
            alt={listImagePreview.alt}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </div>
  );
}