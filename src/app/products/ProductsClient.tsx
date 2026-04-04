"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, Ref } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { Product, ProductVariant, ProductRow } from "./types";
import { formatGenderSizeDisplay } from "./variantOptions";
import { useProductImageSrc } from "./useProductImageSrc";
import { ProductCard } from "./ProductCard";
import { AddProductModal } from "./AddProductModal";
import { adjustStock, adjustVariantStock, deleteProduct, uploadProductsCsv } from "./actions";
import { compareProductsByCategoryOrder } from "./categorySortOrder.utils";
import { EditProductModal } from "./EditProductModal";

type ViewMode = "card" | "list";

type DownloadMenuDirection = "up" | "down";

type CsvUploadMode = "merge" | "reset";

const CSV_UPLOAD_HIGHLIGHT_MS = 6000;

function measureFixedMenuPosition(
  menu: HTMLDivElement | null,
  buttonDesktop: HTMLButtonElement | null,
  buttonMobile: HTMLButtonElement | null
): { direction: DownloadMenuDirection; style: CSSProperties } | null {
  const candidates = [buttonDesktop, buttonMobile];
  const trigger = candidates.find((el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  if (!trigger) return null;

  const rect = trigger.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;

  const gap = 8;
  const margin = 8;
  const innerH = window.innerHeight;
  const innerW = window.innerWidth;

  const spaceBelow = innerH - rect.bottom;
  const spaceAbove = rect.top;

  let menuHeight = 0;
  if (menu) {
    menuHeight = menu.offsetHeight;
    if (menuHeight < 1) menuHeight = menu.getBoundingClientRect().height;
    if (menuHeight < 1) menuHeight = menu.scrollHeight;
  }
  if (menuHeight < 1) return null;

  let menuWidth = 0;
  if (menu) {
    menuWidth = menu.offsetWidth;
    if (menuWidth < 1) menuWidth = menu.getBoundingClientRect().width;
    if (menuWidth < 1) menuWidth = menu.scrollWidth;
  }
  if (menuWidth < 1) menuWidth = 1;

  let direction: DownloadMenuDirection;
  if (spaceBelow >= menuHeight + gap) {
    direction = "down";
  } else if (spaceAbove >= menuHeight + gap) {
    direction = "up";
  } else {
    direction = spaceAbove > spaceBelow ? "up" : "down";
  }

  let top: number;
  if (direction === "down") {
    top = rect.bottom + gap;
    top = Math.min(top, innerH - menuHeight - margin);
    top = Math.max(margin, top);
  } else {
    top = rect.top - gap - menuHeight;
    top = Math.max(margin, top);
    top = Math.min(top, innerH - menuHeight - margin);
  }

  const triggerCenterX = rect.left + rect.width / 2;
  let left = triggerCenterX - menuWidth / 2;
  left = Math.max(margin, Math.min(left, innerW - menuWidth - margin));

  return {
    direction,
    style: {
      position: "fixed",
      top,
      left,
      zIndex: 9999,
    },
  };
}

function ProductsTableThumbCell({
  sku,
  imageUrl,
  alt,
  onOpenPreview,
  localImageHrefBySkuLower,
}: {
  sku: string;
  imageUrl: string | null | undefined;
  alt: string;
  onOpenPreview: (url: string, altText: string) => void;
  localImageHrefBySkuLower: Record<string, string>;
}) {
  const { src, onError, dead } = useProductImageSrc(sku, imageUrl, localImageHrefBySkuLower);
  return (
    <div className="products-table__thumb-root">
      {dead || !src ? (
        <span className="thumb-empty">-</span>
      ) : (
        <button
          type="button"
          className="products-table__thumb-btn"
          onClick={() => onOpenPreview(src, alt)}
          aria-label="상품 이미지 확대"
        >
          <img className="thumb-small" src={src} alt="" loading="lazy" decoding="async" onError={onError} />
        </button>
      )}
    </div>
  );
}

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
  categoryOrder = {},
  localImageHrefBySkuLower,
  variantsByProductId = {},
}: {
  products: Product[];
  categories?: string[];
  categoryOrder?: Record<string, number>;
  /** public/images 스캔 결과(항상 전달; 빈 객체면 로컬 SKU .jpg 추측 URL 비활성화) */
  localImageHrefBySkuLower: Record<string, string>;
  variantsByProductId?: Record<string, ProductVariant[]>;
}) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");

  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  /** CSV 업로드 버튼 색상 피드백(성공 녹색 / 실패 빨간색, 6초) */
  const [csvUploadHighlight, setCsvUploadHighlight] = useState<"success" | "error" | null>(null);
  const csvUploadHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editingVariants, setEditingVariants] = useState<ProductVariant[]>([]);
  const [localProducts, setLocalProducts] = useState<Product[]>(products);
  const [localVariantsByProductId, setLocalVariantsByProductId] =
    useState<Record<string, ProductVariant[]>>(variantsByProductId);

  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [listImagePreview, setListImagePreview] = useState<{ url: string; alt: string } | null>(null);

  const categorySelectRef = useRef<HTMLSelectElement>(null);
  const csvFileInputRef = useRef<HTMLInputElement>(null);
  /** 액션 바가 데스크톱/모바일에 중복이라 ref를 나눔. 숨겨진 쪽은 getBoundingClientRect가 0이라 메뉴가 (0,0) 근처로 감 */
  const downloadWrapDesktopRef = useRef<HTMLDivElement | null>(null);
  const downloadWrapMobileRef = useRef<HTMLDivElement | null>(null);
  const downloadButtonDesktopRef = useRef<HTMLButtonElement | null>(null);
  const downloadButtonMobileRef = useRef<HTMLButtonElement | null>(null);
  const downloadMenuRef = useRef<HTMLDivElement | null>(null);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [downloadMenuDirection, setDownloadMenuDirection] = useState<DownloadMenuDirection>("down");
  const [downloadMenuStyle, setDownloadMenuStyle] = useState<CSSProperties>({});
  const csvPendingModeRef = useRef<CsvUploadMode>("merge");
  const uploadWrapDesktopRef = useRef<HTMLDivElement | null>(null);
  const uploadWrapMobileRef = useRef<HTMLDivElement | null>(null);
  const uploadButtonDesktopRef = useRef<HTMLButtonElement | null>(null);
  const uploadButtonMobileRef = useRef<HTMLButtonElement | null>(null);
  const uploadMenuRef = useRef<HTMLDivElement | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadMenuDirection, setUploadMenuDirection] = useState<DownloadMenuDirection>("down");
  const [uploadMenuStyle, setUploadMenuStyle] = useState<CSSProperties>({});
  const [adjustingStockKeys, setAdjustingStockKeys] = useState(() => new Set<string>());

  useEffect(() => {
    return () => {
      if (csvUploadHighlightTimerRef.current) clearTimeout(csvUploadHighlightTimerRef.current);
    };
  }, []);

  function showUploadHighlight(kind: "success" | "error") {
    if (csvUploadHighlightTimerRef.current) clearTimeout(csvUploadHighlightTimerRef.current);
    setCsvUploadHighlight(kind);
    csvUploadHighlightTimerRef.current = setTimeout(() => {
      setCsvUploadHighlight(null);
      csvUploadHighlightTimerRef.current = null;
    }, CSV_UPLOAD_HIGHLIGHT_MS);
  }

  const updateDownloadMenuPosition = useCallback(() => {
    const pos = measureFixedMenuPosition(
      downloadMenuRef.current,
      downloadButtonDesktopRef.current,
      downloadButtonMobileRef.current
    );
    if (!pos) return;
    setDownloadMenuDirection(pos.direction);
    setDownloadMenuStyle(pos.style);
  }, []);

  const updateUploadMenuPosition = useCallback(() => {
    const pos = measureFixedMenuPosition(
      uploadMenuRef.current,
      uploadButtonDesktopRef.current,
      uploadButtonMobileRef.current
    );
    if (!pos) return;
    setUploadMenuDirection(pos.direction);
    setUploadMenuStyle(pos.style);
  }, []);
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
      const t = e.target as Node | null;
      if (!t) return;
      if (downloadWrapDesktopRef.current?.contains(t)) return;
      if (downloadWrapMobileRef.current?.contains(t)) return;
      if (downloadMenuRef.current?.contains(t)) return;
      setDownloadOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [downloadOpen]);

  useEffect(() => {
    if (!uploadOpen) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (uploadWrapDesktopRef.current?.contains(t)) return;
      if (uploadWrapMobileRef.current?.contains(t)) return;
      if (uploadMenuRef.current?.contains(t)) return;
      setUploadOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [uploadOpen]);

  useLayoutEffect(() => {
    if (!downloadOpen) return;

    updateDownloadMenuPosition();
    const rafId = requestAnimationFrame(() => {
      updateDownloadMenuPosition();
    });

    const menuEl = downloadMenuRef.current;
    const ro =
      menuEl && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            requestAnimationFrame(updateDownloadMenuPosition);
          })
        : null;
    if (menuEl && ro) ro.observe(menuEl);

    window.addEventListener("resize", updateDownloadMenuPosition);
    window.addEventListener("scroll", updateDownloadMenuPosition, true);
    return () => {
      cancelAnimationFrame(rafId);
      ro?.disconnect();
      window.removeEventListener("resize", updateDownloadMenuPosition);
      window.removeEventListener("scroll", updateDownloadMenuPosition, true);
    };
  }, [downloadOpen, updateDownloadMenuPosition]);

  useLayoutEffect(() => {
    if (!uploadOpen) return;

    updateUploadMenuPosition();
    const rafId = requestAnimationFrame(() => {
      updateUploadMenuPosition();
    });

    const menuEl = uploadMenuRef.current;
    const ro =
      menuEl && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            requestAnimationFrame(updateUploadMenuPosition);
          })
        : null;
    if (menuEl && ro) ro.observe(menuEl);

    window.addEventListener("resize", updateUploadMenuPosition);
    window.addEventListener("scroll", updateUploadMenuPosition, true);
    return () => {
      cancelAnimationFrame(rafId);
      ro?.disconnect();
      window.removeEventListener("resize", updateUploadMenuPosition);
      window.removeEventListener("scroll", updateUploadMenuPosition, true);
    };
  }, [uploadOpen, updateUploadMenuPosition]);

  useEffect(() => {
    setLocalProducts(products);
  }, [products]);
  useEffect(() => {
    setLocalVariantsByProductId(variantsByProductId);
  }, [variantsByProductId]);

  // 모바일이면 기본 카드형
  const debugInit =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("debugInit") === "1";
  useEffect(() => {
    if (typeof window === "undefined") return;
    const m = window.matchMedia("(max-width: 768px)");
    if (m.matches) setViewMode("card");
    if (debugInit) {
      console.log("[ProductsClient][debugInit] matchMedia", {
        innerWidth: window.innerWidth,
        mMatches: m.matches,
      });
    }
  }, []);

  // 저장된 보기 방식 불러오기
  useEffect(() => {
    const saved =
      typeof window !== "undefined" ? window.localStorage.getItem("products:viewMode") : null;
    if (saved === "card" || saved === "list") setViewMode(saved);
    if (debugInit) {
      console.log("[ProductsClient][debugInit] localStorage viewMode", { saved });
    }
  }, []);

  // 보기 방식 저장
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("products:viewMode", viewMode);
    if (debugInit) {
      console.log("[ProductsClient][debugInit] viewMode set", { viewMode });
    }
  }, [viewMode]);

  // categoryOrder(CSV 카테고리 등장 순) → SKU → created_at
  const orderedProducts = useMemo(() => {
    return [...localProducts].sort((a, b) => compareProductsByCategoryOrder(a, b, categoryOrder));
  }, [localProducts, categoryOrder]);

  // 검색 + 카테고리: orderedProducts 기준 필터링(순서 유지)
  const filtered = useMemo(() => {
    let list = orderedProducts;
    if (categoryFilter) {
      list = list.filter((p) => (p.category ?? "").trim() === categoryFilter);
    }
    if (!search.trim()) return list;
    const q = search.trim().toLowerCase();
    const textHas = (s: string | null | undefined) => (s ?? "").toLowerCase().includes(q);
    return list.filter((p) => {
      if (
        p.sku.toLowerCase().includes(q) ||
        textHas(p.name) ||
        textHas(p.category) ||
        textHas(p.memo) ||
        textHas(p.memo2)
      ) {
        return true;
      }
      const vars = localVariantsByProductId[p.id] ?? [];
      return vars.some((v) => textHas(v.memo) || textHas(v.memo2));
    });
  }, [orderedProducts, search, categoryFilter, localVariantsByProductId]);

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
            color: (v.color ?? "").trim(),
            size: formatGenderSizeDisplay(v.gender, v.size),
            variantStock: v.stock,
            memo: v.memo ?? null,
            memo2: v.memo2 ?? null,
            variantWholesalePrice: v.wholesalePrice ?? null,
            variantMsrpPrice: v.msrpPrice ?? null,
            variantSalePrice: v.salePrice ?? null,
            variantExtraPrice: v.extraPrice ?? null,
          });
        }
      } else {
        rows.push({
          ...p,
          variantId: "",
          color: "",
          size: "",
          variantStock: p.stock ?? 0,
          variantWholesalePrice: null,
          variantMsrpPrice: null,
          variantSalePrice: null,
          variantExtraPrice: null,
        });
      }
    }
    return rows;
  }, [filtered, localVariantsByProductId]);

  async function handleProductsCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvUploadHighlight(null);
    if (csvUploadHighlightTimerRef.current) {
      clearTimeout(csvUploadHighlightTimerRef.current);
      csvUploadHighlightTimerRef.current = null;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("mode", csvPendingModeRef.current);
      const result = await uploadProductsCsv(fd);
      if (result == null) {
        showUploadHighlight("error");
        return;
      }
      if (result.skippedCount > 0) {
        console.warn(
          "[uploadProductsCsv] SKU 비어 스킵:",
          result.skippedCount,
          "행",
          result.skippedRows
        );
      }
      showUploadHighlight("success");
      /* refresh는 다음 페인트 이후에 — 토스트가 먼저 보이도록(즉시 refresh 시 상태가 덮일 수 있음) */
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          router.refresh();
        });
      });
    } catch (err) {
      console.error("[uploadProductsCsv]", err);
      showUploadHighlight("error");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  function runSearch() {
    setSearch(searchInput);
  }

  function renderToolbarActions(
    downloadWrapRef: Ref<HTMLDivElement>,
    downloadBtnRef: Ref<HTMLButtonElement>,
    uploadWrapRef: Ref<HTMLDivElement>,
    uploadBtnRef: Ref<HTMLButtonElement>
  ) {
    return (
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
        <div className="download-dropdown" ref={downloadWrapRef}>
          <button
            type="button"
            className="btn btn-secondary btn-compact btn-strong"
            ref={downloadBtnRef}
            onClick={() => {
              setUploadOpen(false);
              setDownloadOpen((v) => !v);
            }}
            aria-haspopup="menu"
            aria-expanded={downloadOpen}
          >
            다운로드
          </button>
        </div>
        <div className="download-dropdown" ref={uploadWrapRef}>
          <button
            type="button"
            className={[
              "btn btn-compact btn-strong",
              uploading
                ? "btn-secondary"
                : csvUploadHighlight === "success"
                  ? "products-csv-upload-btn--success"
                  : csvUploadHighlight === "error"
                    ? "products-csv-upload-btn--error"
                    : "btn-secondary",
            ].join(" ")}
            ref={uploadBtnRef}
            onClick={() => {
              setDownloadOpen(false);
              setUploadOpen((v) => !v);
            }}
            aria-haspopup="menu"
            aria-expanded={uploadOpen}
            disabled={uploading}
            aria-label="CSV 업로드 방식 선택"
          >
            {uploading
              ? "업로드..."
              : csvUploadHighlight === "success"
                ? "완료"
                : csvUploadHighlight === "error"
                  ? "실패"
                  : "CSV 업로드"}
          </button>
        </div>
        <button type="button" className="btn btn-primary btn-compact" onClick={() => setAddOpen(true)}>
          추가
        </button>
      </>
    );
  }

  const downloadMenuPortal = downloadOpen
    ? createPortal(
      <div
        ref={downloadMenuRef}
        className="download-dropdown__menu"
        role="menu"
        aria-label="다운로드 선택"
        data-placement={downloadMenuDirection}
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
      </div>,
      document.body
    )
    : null;

  return (
    <div className="products-page">
      <div className="products-toolbar products-toolbar--compact">
        {/* 1줄: 검색 + 검색버튼 + 카테고리 */}
        <div className="toolbar-row toolbar-row--search">
          <input
            type="search"
            placeholder="품목·품명·카테고리·메모"
            title="SKU·상품명·카테고리·비고1·비고2(옵션 포함) 검색"
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
            {renderToolbarActions(
              downloadWrapDesktopRef,
              downloadButtonDesktopRef,
              uploadWrapDesktopRef,
              uploadButtonDesktopRef
            )}
          </div>
        </div>
      </div>

      {/* 모바일 전용: 하단 고정 액션 바 */}
      <div className="toolbar-bottom-bar" aria-hidden="true">
        {renderToolbarActions(
          downloadWrapMobileRef,
          downloadButtonMobileRef,
          uploadWrapMobileRef,
          uploadButtonMobileRef
        )}
      </div>

      {downloadMenuPortal}

      {uploadOpen
        ? createPortal(
            <div
              ref={uploadMenuRef}
              className="download-dropdown__menu"
              role="menu"
              aria-label="CSV 업로드 방식"
              data-placement={uploadMenuDirection}
              style={uploadMenuStyle}
            >
              <button
                type="button"
                role="menuitem"
                className="download-dropdown__item"
                onClick={() => {
                  csvPendingModeRef.current = "merge";
                  setUploadOpen(false);
                  requestAnimationFrame(() => csvFileInputRef.current?.click());
                }}
              >
                덮어쓰기
              </button>
              <button
                type="button"
                role="menuitem"
                className="download-dropdown__item"
                onClick={() => {
                  if (
                    !confirm(
                      "초기화: products·product_variants를 모두 삭제한 뒤 CSV만 남깁니다. 계속할까요?"
                    )
                  ) {
                    return;
                  }
                  csvPendingModeRef.current = "reset";
                  setUploadOpen(false);
                  requestAnimationFrame(() => csvFileInputRef.current?.click());
                }}
              >
                초기화
              </button>
            </div>,
            document.body
          )
        : null}

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
                  localImageHrefBySkuLower={localImageHrefBySkuLower}
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
                  <th className="products-table__th-name">품명</th>
                  <th className="products-table__th-tight">컬러</th>
                  <th className="products-table__th-tight">사이즈</th>
                  <th className="products-table__th-stock">재고</th>
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
                        <ProductsTableThumbCell
                          sku={row.sku}
                          imageUrl={row.imageUrl}
                          alt={(row.name ?? row.sku ?? "").toString()}
                          onOpenPreview={(url, altText) => setListImagePreview({ url, alt: altText })}
                          localImageHrefBySkuLower={localImageHrefBySkuLower}
                        />
                      </td>
                      <td className="products-table__td-name">{row.name}</td>
                      <td className="products-table__td-tight">{row.color?.trim() ? row.color : ""}</td>
                      <td className="products-table__td-tight">{row.size?.trim() ? row.size : ""}</td>
                      <td className="products-table__td-stock">
                        <div className="stock-cell">
                          <span className="stock-cell__qty">
                            <span className="stock-cell__qty-label-mobile" aria-hidden="true">
                              재고
                            </span>
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
                      <td>
                        {(row.variantId ? row.variantWholesalePrice : row.wholesalePrice) != null
                          ? `${Number(row.variantId ? row.variantWholesalePrice : row.wholesalePrice).toLocaleString()}원`
                          : "-"}
                      </td>
                      <td>
                        {(row.variantId ? row.variantMsrpPrice : row.msrpPrice) != null
                          ? `${Number(row.variantId ? row.variantMsrpPrice : row.msrpPrice).toLocaleString()}원`
                          : "-"}
                      </td>
                      <td>
                        {(row.variantId ? row.variantSalePrice : row.salePrice) != null
                          ? `${Number(row.variantId ? row.variantSalePrice : row.salePrice).toLocaleString()}원`
                          : "-"}
                      </td>
                      <td>
                        {(row.variantId ? row.variantExtraPrice : row.extraPrice) != null
                          ? `${Number(row.variantId ? row.variantExtraPrice : row.extraPrice).toLocaleString()}원`
                          : "-"}
                      </td>
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
            onError={() => setListImagePreview(null)}
          />
        </div>
      ) : null}
    </div>
  );
}