"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, Ref } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import dayjs from "dayjs";
import type { Product, ProductVariant, ProductRow } from "./types";
import { diagnoseSockSortVariant, formatGenderSizeDisplay, sortVariantsForDisplay, tryParseSockCombinedLabel } from "./variantOptions";
import { useProductImageSrc } from "./useProductImageSrc";
import { ProductCard } from "./ProductCard";
import { AddProductModal } from "./AddProductModal";
import {
  adjustStock,
  adjustVariantStock,
  bulkUploadProductImages,
  deleteProduct,
  uploadProductsCsv,
  type BulkProductImageUploadResult,
} from "./actions";
import { resizeAndCompressImage } from "./imageUtils";
import { normalizeCategoryLabel } from "./categoryNormalize";
import { compareProductsByCategoryOrder } from "./categorySortOrder.utils";
import { EditProductModal } from "./EditProductModal";
import { normalizeSkuForMatch, productNormSku } from "./skuNormalize";
import {
  buildSkuDisplayGroups,
  totalStockForSkuDisplayGroup,
  type SkuDisplayGroup,
} from "./skuDisplayMerge";
import { VARIANT_AUDIT_TARGET_SKUS } from "./variantAuditTargets";
import { fitCategorySelectWidth } from "./fitCategorySelectWidth";

type ViewMode = "card" | "list";

type DownloadMenuDirection = "up" | "down";

type CsvUploadMode = "merge" | "reset";

const CSV_UPLOAD_HIGHLIGHT_MS = 6000;
/** 검색어 반영 지연 — 타이핑 중 필터·병합·리스트 재계산 횟수 감소 */
const SEARCH_DEBOUNCE_MS = 300;

function variantsAfterZeroStockFilter(variants: ProductVariant[], hideZeroStock: boolean): ProductVariant[] {
  if (!hideZeroStock) return variants;
  return variants.filter((v) => Number(v.stock ?? 0) > 0);
}

type StorageOrphanCleanupResult = {
  bucket: string;
  referencedCount: number;
  storageFileCount: number;
  orphanCount: number;
  orphanPaths: string[];
  deletedCount: number;
  deletedPaths: string[];
  failedPaths: Array<{ path: string; message: string }>;
  parseFailures: Array<{ imageUrl: string; reason: string }>;
};

/** 동일 `product.id`가 배열에 중복이면 카드·개수가 2배로 보이므로 첫 항목만 유지 */
function dedupeProductsById(products: Product[]): Product[] {
  const seen = new Set<string>();
  const out: Product[] = [];
  for (const p of products) {
    const id = String(p.id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(p);
  }
  return out;
}

const DEBUG_FOCUS_SKU = "T25KT1033BL";

function logProductsPipelineStage(label: string, list: Product[]) {
  const ids = list.map((p) => p.id);
  const skus = list.map((p) => p.sku);
  const focus = list.filter((p) => p.sku === DEBUG_FOCUS_SKU);
  const focusIds = focus.map((p) => p.id);
  const focusIdSet = new Set(focusIds);
  console.info(`[productsPipeline][client] ${label}`, {
    length: list.length,
    ids,
    skus,
    uniqueIdCount: new Set(ids).size,
    focusSku: DEBUG_FOCUS_SKU,
    focusCount: focus.length,
    focusIds,
    focusUniqueIdCount: focusIdSet.size,
    focusSameIdRows:
      focus.length > 1 && focusIdSet.size === 1 ? "동일 id로 여러 행(이론상 불가)" : "no",
    focusSameSkuDifferentIds:
      focus.length > 1 && focusIdSet.size > 1 ? "sku 동일·id 서로 다름" : "no",
  });
}

/** `filtered` 기준: 동일 product.id 인덱스·포커스 SKU object reference */
function logFilteredSkuFocusDetail(list: Product[], label: string) {
  const ids = list.map((p) => p.id);
  const skus = list.map((p) => p.sku);
  const idToIndices = new Map<string, number[]>();
  ids.forEach((id, i) => {
    const arr = idToIndices.get(id) ?? [];
    arr.push(i);
    idToIndices.set(id, arr);
  });
  const duplicateIdIndexGroups = [...idToIndices.entries()].filter(([, ix]) => ix.length > 1);

  const focusIndices: number[] = [];
  list.forEach((p, i) => {
    if (p.sku === DEBUG_FOCUS_SKU) focusIndices.push(i);
  });
  const focusRows = focusIndices.map((i) => ({
    index: i,
    id: list[i].id,
    objectRef: list[i],
  }));
  const focusRefs = focusIndices.map((i) => list[i]);
  const distinctFocusRefs = new Set(focusRefs);

  console.info(`[productsPipeline][filtered 확정] ${label}`, {
    length: list.length,
    ids,
    skus,
    uniqueIdCount: new Set(ids).size,
    [`${DEBUG_FOCUS_SKU}_count`]: focusIndices.length,
    duplicateProductIdIndexGroups:
      duplicateIdIndexGroups.length > 0
        ? duplicateIdIndexGroups.map(([id, ix]) => ({ id, indices: ix }))
        : "없음 — filtered에 동일 id가 두 슬롯에 없음",
    focusSkuRows: focusRows,
    focusDistinctObjectRefCount: distinctFocusRefs.size,
    focusRefInterpretation:
      focusIndices.length <= 1
        ? "n/a"
        : distinctFocusRefs.size === 1
          ? "같은 id·같은 객체 reference가 배열에 여러 인덱스(비정상)"
          : "서로 다른 객체 reference(동일 sku·다른 id 가능 또는 복제된 객체)",
  });
}

/** Record 키는 유일. 버킷 내부 variant.id 중복 push 여부 */
function logVariantsMapIntegrity(
  map: Record<string, ProductVariant[]>,
  label: string,
  filteredList: Product[]
) {
  const keys = Object.keys(map);
  const bucketsWithDupVariantId: { productId: string; duplicateVariantIds: string[] }[] = [];
  for (const [pid, arr] of Object.entries(map)) {
    const seen = new Set<string>();
    const dup = new Set<string>();
    for (const v of arr) {
      if (seen.has(v.id)) dup.add(v.id);
      seen.add(v.id);
    }
    if (dup.size > 0) bucketsWithDupVariantId.push({ productId: pid, duplicateVariantIds: [...dup] });
  }

  const focusProductIds = [
    ...new Set(filteredList.filter((p) => p.sku === DEBUG_FOCUS_SKU).map((p) => p.id)),
  ];
  const focusBuckets = focusProductIds.map((pid) => ({
    productId: pid,
    variantCount: (map[pid] ?? []).length,
    variantIds: (map[pid] ?? []).map((v) => v.id),
  }));

  console.info(`[productsPipeline][localVariantsByProductId] ${label}`, {
    recordKeyCount: keys.length,
    duplicateKeysInRecord: "불가(객체 키는 유일)",
    bucketsWithDuplicateVariantIds:
      bucketsWithDupVariantId.length > 0 ? bucketsWithDupVariantId : "없음",
    focusSkuProductIds: focusProductIds,
    focusSkuVariantBuckets: focusBuckets,
  });
}

function 남100ishVariant(v: ProductVariant): boolean {
  const g = (v.gender ?? "").trim();
  const s = (v.size ?? "").trim();
  const male = g.includes("남") || /^m$/i.test(g) || g === "남성";
  return male && s === "100";
}

/** 포커스 SKU 카드마다 product.id·연결 variant(남100 표시 포함) — 버킷 분리 확정용 */
function logFocusSkuCardsPerCard(
  cards: Product[],
  map: Record<string, ProductVariant[]>,
  mapLabel: string
) {
  const focus = cards.filter((p) => p.sku === DEBUG_FOCUS_SKU);
  const ids = focus.map((c) => c.id);
  console.info(`[productsPipeline][클라이언트 카드별 ${DEBUG_FOCUS_SKU}] ${mapLabel}`, {
    focusCardCount: focus.length,
    distinctProductIds: new Set(ids).size,
    확정:
      focus.length <= 1
        ? "카드 1장 이하"
        : new Set(ids).size === 1
          ? "동일 product.id로 카드 여러 장(비정상)"
          : "서로 다른 product.id + 동일 sku → DB에 동일 SKU 상품이 복수 행",
    cards: focus.map((p, idx) => {
      const vars = map[p.id] ?? [];
      const wrongBucket = vars.filter((v) => v.productId !== p.id);
      return {
        cardIndex: idx,
        productId: p.id,
        sku: p.sku,
        name: p.name,
        variantCount: vars.length,
        variantIds: vars.map((v) => v.id),
        variantsWrongProductId: wrongBucket.length > 0 ? wrongBucket.map((v) => v.id) : "없음",
        variants: vars.map((v) => ({
          variantId: v.id,
          productId: v.productId,
          variantSku: v.sku,
          color: v.color,
          gender: v.gender,
          size: v.size,
          stock: v.stock,
          displaySize: formatGenderSizeDisplay(v.gender, v.size),
          남100: 남100ishVariant(v),
        })),
      };
    }),
  });
}

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
  updatedAt,
  alt,
  onOpenPreview,
  localImageHrefBySkuLower,
}: {
  sku: string;
  imageUrl: string | null | undefined;
  updatedAt?: string | null;
  alt: string;
  onOpenPreview: (url: string, altText: string) => void;
  localImageHrefBySkuLower: Record<string, string>;
}) {
  const { src, onError, dead } = useProductImageSrc(sku, imageUrl, updatedAt, localImageHrefBySkuLower);
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
          <img
            className="thumb-small"
            src={src}
            alt=""
            width={48}
            height={48}
            loading="lazy"
            decoding="async"
            onError={onError}
          />
        </button>
      )}
    </div>
  );
}

const ProductsTableRow = memo(function ProductsTableRow({
  row,
  rowSaving,
  localImageHrefBySkuLower,
  onOpenPreview,
  onStockDelta,
  onEdit,
  onDelete,
}: {
  row: ProductRow;
  rowSaving: boolean;
  localImageHrefBySkuLower: Record<string, string>;
  onOpenPreview: (url: string, altText: string) => void;
  onStockDelta: (row: ProductRow, delta: number) => void;
  onEdit: (productId: string) => void;
  onDelete: (productId: string) => void;
}) {
  const qty = row.variantStock;
  const updatedAtText = row.updatedAt ? dayjs(row.updatedAt).format("YY/MM/DD HH:mm") : "-";
  const isRecent = !!row.updatedAt && dayjs().diff(dayjs(row.updatedAt), "day") < 1;
  if (row.isListNoVisibleOptionsRow) {
    return (
      <tr className="products-table__tr-novis">
        <td>
          <ProductsTableThumbCell
            sku={row.sku}
            imageUrl={row.imageUrl}
            updatedAt={row.updatedAt}
            alt={(row.name ?? row.sku ?? "").toString()}
            onOpenPreview={onOpenPreview}
            localImageHrefBySkuLower={localImageHrefBySkuLower}
          />
        </td>
        <td className="products-table__td-name">{row.name}</td>
        <td className="products-table__td-tight">{row.category?.trim() ? row.category : ""}</td>
        <td className="products-table__td-tight muted">—</td>
        <td className="products-table__td-tight products-table__td-novis-msg">표시할 옵션 없음</td>
        <td className="products-table__td-stock">
          <div className="stock-cell">
            <span className="stock-cell__qty">
              <span className="stock-cell__qty-label-mobile" aria-hidden="true">
                재고
              </span>
              <span className="muted">—</span>
            </span>
            <div className="stock-buttons">
              <button type="button" className="btn-mini" disabled title="표시된 옵션이 없어 조정할 수 없습니다">
                -1
              </button>
              <button type="button" className="btn-mini" disabled title="표시된 옵션이 없어 조정할 수 없습니다">
                +1
              </button>
            </div>
          </div>
        </td>
        <td>
          {row.wholesalePrice != null ? `${Number(row.wholesalePrice).toLocaleString()}원` : "-"}
        </td>
        <td>{row.msrpPrice != null ? `${Number(row.msrpPrice).toLocaleString()}원` : "-"}</td>
        <td>{row.salePrice != null ? `${Number(row.salePrice).toLocaleString()}원` : "-"}</td>
        <td>{row.extraPrice != null ? `${Number(row.extraPrice).toLocaleString()}원` : "-"}</td>
        <td>—</td>
        <td>—</td>
        <td className={`products-table__td-updated${isRecent ? " products-table__td-updated--recent" : ""}`}>
          <span className="products-table__updated-text" title={updatedAtText}>
            {updatedAtText}
          </span>
        </td>
        <td>
          <div className="row-actions">
            <button type="button" className="btn btn-secondary btn-row" onClick={() => onEdit(row.id)}>
              수정
            </button>
            <button type="button" className="btn btn-danger btn-row" onClick={() => void onDelete(row.id)}>
              삭제
            </button>
          </div>
        </td>
      </tr>
    );
  }
  return (
    <tr>
      <td>
        <ProductsTableThumbCell
          sku={row.sku}
          imageUrl={row.imageUrl}
          updatedAt={row.updatedAt}
          alt={(row.name ?? row.sku ?? "").toString()}
          onOpenPreview={onOpenPreview}
          localImageHrefBySkuLower={localImageHrefBySkuLower}
        />
      </td>
      <td className="products-table__td-name">{row.name}</td>
      <td className="products-table__td-tight">{row.category?.trim() ? row.category : ""}</td>
      <td className="products-table__td-tight">{row.color?.trim() ? row.color : ""}</td>
      <td className="products-table__td-tight">{row.size?.trim() ? row.size : ""}</td>
      <td className="products-table__td-stock">
        <div className="stock-cell">
          <span className="stock-cell__qty">
            <span className="stock-cell__qty-label-mobile" aria-hidden="true">
              재고
            </span>
            <strong>{qty}</strong>
            {rowSaving ? <span className="stock-adjust-pending" aria-label="저장 중" /> : null}
          </span>
          <div className="stock-buttons">
            <button
              type="button"
              className="btn-mini"
              disabled={qty < 1 || rowSaving}
              onClick={() => {
                void onStockDelta(row, -1);
              }}
            >
              -1
            </button>
            <button
              type="button"
              className="btn-mini"
              disabled={rowSaving}
              onClick={() => {
                void onStockDelta(row, 1);
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
      <td className={`products-table__td-updated${isRecent ? " products-table__td-updated--recent" : ""}`}>
        <span className="products-table__updated-text" title={updatedAtText}>
          {updatedAtText}
        </span>
      </td>
      <td>
        <div className="row-actions">
          <button type="button" className="btn btn-secondary btn-row" onClick={() => onEdit(row.id)}>
            수정
          </button>
          <button type="button" className="btn btn-danger btn-row" onClick={() => void onDelete(row.id)}>
            삭제
          </button>
        </div>
      </td>
    </tr>
  );
});

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
  if (row.isListNoVisibleOptionsRow) return `novis:${row.id}`;
  return row.variantId ? `v:${row.variantId}` : `p:${row.id}`;
}

export function ProductsClient({
  products,
  categories = [],
  categoryOrder = {},
  localImageHrefBySkuLower,
  variantsByProductId = {},
  variantsSyncDigest = "0",
  debugProductsDupes = false,
  debugVariantSkuMix = false,
  debugDisplayGroups = false,
  debugVariantTrace = false,
  debugVariantSync = false,
  traceProductId = "",
  focusSku = "",
  debugTargetSkus = false,
  debugCategoryOrder = false,
}: {
  products: Product[];
  categories?: string[];
  categoryOrder?: Record<string, number>;
  /** `getLocalImageHrefBySkuLower()` — 키는 `normalizeSkuForMatch`(파일명 stem·상품 SKU 공통) */
  localImageHrefBySkuLower: Record<string, string>;
  variantsByProductId?: Record<string, ProductVariant[]>;
  /**
   * 서버에서 모든 variant 행의 id·옵션·재고·가격·메모 등을 묶어 만든 SHA-256 digest.
   * props·digest 변경 시 `useEffect`로 `localProducts` / `localVariantsByProductId`를 서버 스냅샷에 맞춤(CSV·이미지 등 `router.refresh()` 후 동기화).
   */
  variantsSyncDigest?: string;
  /** `?debugProductsDupes=1` — 파이프라인·카드 렌더 단계 로그 */
  debugProductsDupes?: boolean;
  /** `?debugVariantSkuMix=1` — 카드별 variant의 product_id·variant_sku·normSku 로그 */
  debugVariantSkuMix?: boolean;
  /** `?debugDisplayGroups=1` — 카드 그룹 trace·빈 product sku → normSku 로그 */
  debugDisplayGroups?: boolean;
  /** `?debugVariantTrace=1&traceProductId=<uuid>` — 옵션 파이프라인 추적 */
  debugVariantTrace?: boolean;
  /** `?debugVariantSync=1` — `variantsSyncDigest`·동기화 effect·버킷 요약(콘솔) */
  debugVariantSync?: boolean;
  traceProductId?: string;
  /** `?focusSku=T25KT1033BL` — 위 디버그 시 해당 문자열/정규화 SKU와 맞는 카드끼리 cardNormSku 비교 */
  focusSku?: string;
  /** `?debugTargetSkus=1` — 대상 SKU들의 skuDisplayGroups·variant 개수(서버 로그와 대조) */
  debugTargetSkus?: boolean;
  /** `?debugCategoryOrder=1` — 카테고리 정렬·카드 순서 진단(콘솔) */
  debugCategoryOrder?: boolean;
}) {
  /** `?debugProductsClientLifecycle=1` — 렌더 횟수·마운트/언마운트·인스턴스 id */
  const lifecycleInstanceId = useRef(
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `pc-${Math.random().toString(36).slice(2)}`
  );
  const lifecycleRenderCount = useRef(0);
  lifecycleRenderCount.current += 1;

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [hideZeroStock, setHideZeroStock] = useState(false);
  const [showInStockOnly, setShowInStockOnly] = useState(false);
  /** 카드 메모 본문 전역 표시(툴바 메모ON·카드 메모 버튼 공유). PC는 마운트 후 OFF로 시작 */
  const [cardsMemoVisible, setCardsMemoVisible] = useState(true);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const router = useRouter();
  const searchParams = useSearchParams();
  const jumpProductId = (searchParams.get("jumpProductId") ?? "").trim();
  const hasJumpedToProductRef = useRef(false);
  const [uploading, setUploading] = useState(false);
  /** CSV 업로드 버튼 색상 피드백(성공 녹색 / 실패 빨간색, 6초) */
  const [csvUploadHighlight, setCsvUploadHighlight] = useState<"success" | "error" | null>(null);
  const csvUploadHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editingVariants, setEditingVariants] = useState<ProductVariant[]>([]);
  /**
   * 서버 `products`로만 목록을 맞춤 — prev에 append/merge/concat 금지.
   * props가 바뀔 때마다 `setLocalProducts(한 번에 통째로)`만 사용(Strict Mode 이중 실행에도 누적 없음).
   * 인자는 `dedupeProductsById(products)` — prev와 병합이 아니라 교체 직전 id당 1행 정규화.
   */
  const [localProducts, setLocalProducts] = useState<Product[]>(() =>
    dedupeProductsById(products)
  );
  const [localVariantsByProductId, setLocalVariantsByProductId] =
    useState<Record<string, ProductVariant[]>>(variantsByProductId);

  const [viewMode, setViewMode] = useState<ViewMode>("card");
  const [listImagePreview, setListImagePreview] = useState<{ url: string; alt: string } | null>(null);

  const categorySelectRef = useRef<HTMLSelectElement>(null);
  const toolbarSearchRowRef = useRef<HTMLDivElement>(null);
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
  const stickyControlsRef = useRef<HTMLDivElement | null>(null);
  const bottomBarRef = useRef<HTMLDivElement | null>(null);
  const [mobileLayoutVars, setMobileLayoutVars] = useState(() => ({
    stickyTop: 0,
    topBarHeight: 0,
    bottomBarHeight: 0,
  }));
  const [adjustingStockKeys, setAdjustingStockKeys] = useState(() => new Set<string>());
  const [stockErrorToast, setStockErrorToast] = useState<string | null>(null);
  const stockErrorToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [bulkImageModalOpen, setBulkImageModalOpen] = useState(false);
  const [bulkOnlyEmptyImage, setBulkOnlyEmptyImage] = useState(false);
  const [bulkImageWorking, setBulkImageWorking] = useState(false);
  const [bulkImageResult, setBulkImageResult] = useState<BulkProductImageUploadResult | null>(null);
  const bulkImageInputRef = useRef<HTMLInputElement>(null);
  const [orphanResult, setOrphanResult] = useState<StorageOrphanCleanupResult | null>(null);
  const [orphanWorkingMode, setOrphanWorkingMode] = useState<"scan" | "delete" | null>(null);
  const [orphanNotice, setOrphanNotice] = useState<string>("");

  const debugClientLifecycle =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("debugProductsClientLifecycle") === "1";

  const debugSockSort =
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debugSockSort") === "1";

  if (debugClientLifecycle) {
    console.log("[ProductsClient] render", {
      count: lifecycleRenderCount.current,
      instanceId: lifecycleInstanceId.current,
      productsLength: products.length,
      variantsByProductIdKeys: Object.keys(variantsByProductId).length,
    });
  }

  useEffect(() => {
    return () => {
      if (csvUploadHighlightTimerRef.current) clearTimeout(csvUploadHighlightTimerRef.current);
      if (stockErrorToastTimerRef.current) clearTimeout(stockErrorToastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      searchDebounceRef.current = null;
      setSearch(searchInput.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
        searchDebounceRef.current = null;
      }
    };
  }, [searchInput]);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(min-width: 769px)").matches) {
      setCardsMemoVisible(false);
    }
  }, []);

  useEffect(() => {
    if (!debugClientLifecycle) return;
    const id = lifecycleInstanceId.current;
    console.log("[ProductsClient] mount (useEffect)", { instanceId: id });
    return () => {
      console.log("[ProductsClient] unmount (useEffect)", { instanceId: id });
    };
  }, [debugClientLifecycle]);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 768px)");

    const update = () => {
      const headerEl = document.querySelector(".app-global-header .app-site-header") as HTMLElement | null;
      const navEl = document.querySelector(".app-global-header nav") as HTMLElement | null;
      const stickyTop =
        (headerEl?.offsetHeight ?? 0) + (navEl?.offsetHeight ?? 0);
      const topBarHeight = mq.matches ? (stickyControlsRef.current?.offsetHeight ?? 0) : 0;
      const bottomBarHeight = mq.matches ? (bottomBarRef.current?.offsetHeight ?? 0) : 0;
      setMobileLayoutVars((prev) =>
        prev.stickyTop === stickyTop &&
        prev.topBarHeight === topBarHeight &&
        prev.bottomBarHeight === bottomBarHeight
          ? prev
          : { stickyTop, topBarHeight, bottomBarHeight }
      );
    };

    update();
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            requestAnimationFrame(update);
          })
        : null;
    if (stickyControlsRef.current && ro) ro.observe(stickyControlsRef.current);
    if (bottomBarRef.current && ro) ro.observe(bottomBarRef.current);
    const headerEl = document.querySelector(".app-global-header .app-site-header");
    const navEl = document.querySelector(".app-global-header nav");
    if (headerEl && ro) ro.observe(headerEl);
    if (navEl && ro) ro.observe(navEl);
    window.addEventListener("resize", update);
    if (typeof mq.addEventListener === "function") mq.addEventListener("change", update);
    else mq.addListener(update);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", update);
      if (typeof mq.removeEventListener === "function") mq.removeEventListener("change", update);
      else mq.removeListener(update);
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

  const showStockErrorToast = useCallback((message: string) => {
    if (stockErrorToastTimerRef.current) {
      clearTimeout(stockErrorToastTimerRef.current);
      stockErrorToastTimerRef.current = null;
    }
    setStockErrorToast(message);
    stockErrorToastTimerRef.current = setTimeout(() => {
      setStockErrorToast(null);
      stockErrorToastTimerRef.current = null;
    }, 5000);
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
        showStockErrorToast(err instanceof Error ? err.message : String(err));
      } finally {
        adjustLocksRef.current.delete(key);
        patchAdjusting((s) => {
          const n = new Set(s);
          n.delete(key);
          return n;
        });
      }
    },
    [patchAdjusting, showStockErrorToast]
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
        showStockErrorToast(err instanceof Error ? err.message : String(err));
      } finally {
        adjustLocksRef.current.delete(key);
        patchAdjusting((s) => {
          const n = new Set(s);
          n.delete(key);
          return n;
        });
      }
    },
    [patchAdjusting, showStockErrorToast]
  );

  const onListRowStockDelta = useCallback(
    async (row: ProductRow, delta: number) => {
      const owner = row.variantOwnerProductId ?? row.id;
      if (row.variantId) await onVariantStockDelta(owner, row.variantId, delta);
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

  const variantSyncEffectRunRef = useRef(0);
  useEffect(() => {
    variantSyncEffectRunRef.current += 1;
    setLocalProducts(dedupeProductsById(products));
    setLocalVariantsByProductId(variantsByProductId);
    if (debugVariantSync && typeof console !== "undefined" && console.info) {
      const tid = traceProductId.trim();
      const traceBucket = tid ? (variantsByProductId[tid] ?? []) : [];
      const flatCount = Object.values(variantsByProductId).reduce((s, arr) => s + arr.length, 0);
      console.info("[ProductsClient][debugVariantSync] useEffect([products, variantsByProductId, variantsSyncDigest]) 실행", {
        runCount: variantSyncEffectRunRef.current,
        variantsSyncDigest,
        productsLength: products.length,
        variantBuckets: Object.keys(variantsByProductId).length,
        flatVariantCount: flatCount,
        traceProductId: tid || "(없음)",
        traceBucketLength: traceBucket.length,
        trace남120Ids: traceBucket
          .filter((v) => (v.gender ?? "").trim() === "남" && (v.size ?? "").trim() === "120")
          .map((v) => v.id),
      });
    }
  }, [products, variantsByProductId, variantsSyncDigest, debugVariantSync, traceProductId]);

  useEffect(() => {
    if (!debugVariantTrace || !traceProductId.trim()) return;
    if (typeof console === "undefined" || !console.info) return;
    const tid = traceProductId.trim();
    const fromProps = variantsByProductId[tid] ?? [];
    const fromLocal = localVariantsByProductId[tid] ?? [];
    console.info("[ProductsClient][trace] props vs local 버킷", {
      traceProductId: tid,
      variantsSyncDigest,
      propsCount: fromProps.length,
      localCount: fromLocal.length,
      props남120: fromProps.filter((v) => (v.gender ?? "").trim() === "남" && (v.size ?? "").trim() === "120").map((v) => v.id),
      local남120: fromLocal.filter((v) => (v.gender ?? "").trim() === "남" && (v.size ?? "").trim() === "120").map((v) => v.id),
    });
  }, [
    debugVariantTrace,
    traceProductId,
    variantsByProductId,
    localVariantsByProductId,
    variantsSyncDigest,
  ]);

  /**
   * 목록 순서: 서버가 넘긴 `categoryOrder`(= mergeCategoryOrderMapForDisplay 단일 결과)만 사용.
   * 다른 sort·키는 넣지 않음. buildSkuDisplayGroups는 이 순서를 유지한 filtered에서 normSku 첫 등장 순.
   */
  const orderedProducts = useMemo(() => {
    const sorted = [...localProducts].sort((a, b) => compareProductsByCategoryOrder(a, b, categoryOrder));
    return dedupeProductsById(sorted);
  }, [localProducts, categoryOrder]);

  useEffect(() => {
    if (!debugCategoryOrder || typeof console === "undefined" || !console.info) return;
    console.info("[debugCategoryOrder][client] categoryOrder 키 수", Object.keys(categoryOrder).length);
    console.info(
      "[debugCategoryOrder][client] orderedProducts 앞 40 (cat→sku)",
      orderedProducts.slice(0, 40).map((p) => ({ cat: p.category ?? "", sku: p.sku }))
    );
  }, [debugCategoryOrder, categoryOrder, orderedProducts]);

  /** 카테고리만 적용한 목록 — 동일 SKU 그룹 variant 검색에 사용 */
  const orderedAfterCategory = useMemo(() => {
    let list = orderedProducts;
    if (categoryFilter) {
      const want = normalizeCategoryLabel(categoryFilter);
      list = list.filter((p) => normalizeCategoryLabel(p.category) === want);
    }
    return list;
  }, [orderedProducts, categoryFilter]);

  // 검색 + 카테고리: orderedProducts 기준 필터링(순서 유지). variant 메모는 같은 SKU 전체 product의 옵션을 합쳐 검색
  const filtered = useMemo(() => {
    const list = orderedAfterCategory;
    const qRaw = search.trim();
    if (!qRaw) return list;
    const q = qRaw.toLowerCase();

    const productsByNormSku = new Map<string, Product[]>();
    for (const p of orderedAfterCategory) {
      const k = productNormSku(p, localVariantsByProductId);
      if (!k) continue;
      const arr = productsByNormSku.get(k) ?? [];
      arr.push(p);
      productsByNormSku.set(k, arr);
    }

    const textHas = (s: string | null | undefined) => (s ?? "").toLowerCase().includes(q);
    const skuMatches = (p: Product) => {
      if ((p.sku ?? "").toLowerCase().includes(q)) return true;
      const normKey = productNormSku(p, localVariantsByProductId);
      if (normKey && normKey.toLowerCase().includes(q)) return true;
      for (const v of localVariantsByProductId[p.id] ?? []) {
        if ((v.sku ?? "").toLowerCase().includes(q)) return true;
        const nv = normalizeSkuForMatch(v.sku);
        if (nv && nv.toLowerCase().includes(q)) return true;
      }
      return false;
    };
    return list.filter((p) => {
      if (skuMatches(p) || textHas(p.name) || textHas(p.category) || textHas(p.memo) || textHas(p.memo2)) {
        return true;
      }
      const nk = productNormSku(p, localVariantsByProductId);
      const group = productsByNormSku.get(nk) ?? [p];
      const allVars = group.flatMap((gp) => localVariantsByProductId[gp.id] ?? []);
      return allVars.some((v) => textHas(v.memo) || textHas(v.memo2));
    });
  }, [orderedAfterCategory, search, localVariantsByProductId]);

  /** 화면: 정규화 SKU당 1카드/1그룹 — DB에 동일 SKU product가 여러 개여도 합쳐서 표시 */
  const skuDisplayGroups = useMemo(
    () =>
      buildSkuDisplayGroups(filtered, orderedAfterCategory, localVariantsByProductId, {
        debugDisplayGroups,
        traceProductId:
          debugVariantTrace && traceProductId.trim() ? traceProductId.trim() : undefined,
      }),
    [
      filtered,
      orderedAfterCategory,
      localVariantsByProductId,
      debugDisplayGroups,
      debugVariantTrace,
      traceProductId,
    ]
  );

  /** 검색·카테고리·병합 후 → 총재고 0 그룹 제외(옵션 합 또는 단일 상품 stock) */
  const skuDisplayGroupsForView = useMemo(() => {
    if (!showInStockOnly) return skuDisplayGroups;
    return skuDisplayGroups.filter((g) => totalStockForSkuDisplayGroup(g) > 0);
  }, [skuDisplayGroups, showInStockOnly]);

  useEffect(() => {
    if (!debugCategoryOrder || typeof console === "undefined" || !console.info) return;
    console.info(
      "[debugCategoryOrder][client] skuDisplayGroups 앞 40 (cat→normSku)",
      skuDisplayGroups.slice(0, 40).map((g) => ({ cat: g.product.category ?? "", normSku: g.normSku }))
    );
  }, [debugCategoryOrder, skuDisplayGroups]);

  function skuDisplayGroupMatchesFocus(g: SkuDisplayGroup, focus: string): boolean {
    const f = focus.trim();
    if (!f) return false;
    const fn = normalizeSkuForMatch(f);
    if (fn && g.normSku === fn) return true;
    const fl = f.toLowerCase();
    const t = g.trace;
    if (t) {
      if (t.cardTitle.toLowerCase().includes(fl)) return true;
      if (t.representativeRawProductSku.toLowerCase().includes(fl)) return true;
      for (const row of t.productsInGroup) {
        if (row.rawProductSku.toLowerCase().includes(fl)) return true;
        if (row.fallbackVariantSku && row.fallbackVariantSku.toLowerCase().includes(fl)) return true;
        if (row.normSku.toLowerCase().includes(fl)) return true;
      }
    }
    if (g.normSku.toLowerCase().includes(fl)) return true;
    return false;
  }

  useEffect(() => {
    if (!debugDisplayGroups) return;
    for (const g of skuDisplayGroups) {
      const t = g.trace;
      if (!t) continue;
      console.info("[productsPipeline][displayGroupCard]", {
        representativeProductId: t.representativeProductId,
        groupProductIds: t.groupProductIds,
        cardNormSku: t.cardNormSku,
        representativeRawProductSku: t.representativeRawProductSku,
        representativeFallbackVariantSku: t.representativeFallbackVariantSku,
        cardTitle: t.cardTitle,
        productsInGroup: t.productsInGroup,
      });
    }
    const focus = (focusSku ?? "").trim();
    if (!focus) {
      console.info("[productsPipeline][focusSkuCardCompare]", {
        hint: "같은 품번처럼 보이는 카드가 여러 장이면 URL에 focusSku=T25KT1033BL 처럼 주면 cardNormSku 동일 여부를 출력합니다.",
      });
      return;
    }
    const matched = skuDisplayGroups.filter((g) => skuDisplayGroupMatchesFocus(g, focus));
    const norms = matched.map((g) => g.normSku);
    const distinct = [...new Set(norms)];
    console.info("[productsPipeline][focusSkuCardCompare]", {
      focusSkuRaw: focus,
      focusNormSku: normalizeSkuForMatch(focus) || null,
      matchedCardCount: matched.length,
      /** true면 매칭된 카드들의 cardNormSku가 모두 동일(이론상 1장이어야 함). false면 정규화 키가 달라 카드가 갈라진 상태 */
      allMatchedCardsShareSameCardNormSku: distinct.length <= 1,
      distinctCardNormSkuValues: distinct,
      cards: matched.map((g) => ({
        cardNormSku: g.normSku,
        representativeProductId: g.trace?.representativeProductId,
        groupProductIds: g.trace?.groupProductIds,
        cardTitle: g.trace?.cardTitle,
      })),
    });
  }, [debugDisplayGroups, focusSku, skuDisplayGroups]);

  useEffect(() => {
    if (!debugTargetSkus) return;
    const targets = new Set(VARIANT_AUDIT_TARGET_SKUS.map((s) => normalizeSkuForMatch(s)));
    for (const g of skuDisplayGroups) {
      if (!targets.has(g.normSku)) continue;
      const ownerIds = [...new Set(g.variants.map((v) => v.productId))].sort();
      console.info("[variantAudit][client] skuDisplayGroups → ProductCard에 넘기는 variants", {
        cardNormSku: g.normSku,
        mergedVariantLengthForCard: g.variants.length,
        representativeProductId: g.product.id,
        variantOwnerProductIds: ownerIds,
      });
    }
  }, [debugTargetSkus, skuDisplayGroups]);

  useEffect(() => {
    if (!debugSockSort) return;
    const samples = ["3부-여85", "3부-여90", "3부-여95", "3부-여100", "4부-남95", "4부-남100"];
    for (const s of samples) {
      const p = tryParseSockCombinedLabel(s);
      console.info("[socksSort][sample]", { label: s, ok: p != null, parsed: p });
    }
    const want = "T21PT4001";
    const wantU = want.toUpperCase();
    for (const g of skuDisplayGroups) {
      const n = (g.normSku ?? "").toUpperCase();
      const ps = (g.product.sku ?? "").toUpperCase();
      if (n !== wantU && ps !== wantU && !n.includes(wantU) && !ps.includes(wantU)) continue;
      console.info("[socksSort][group]", { normSku: g.normSku, productSku: g.product.sku, variantCount: g.variants.length });
      for (const v of g.variants) {
        console.info("[socksSort][variant]", diagnoseSockSortVariant(v));
      }
    }
  }, [debugSockSort, skuDisplayGroups]);

  /** 디버그·레거시 호환: id dedupe만 (SKU 병합 전 단계) */
  const filteredForRender = useMemo(() => dedupeProductsById(filtered), [filtered]);

  useEffect(() => {
    if (!debugProductsDupes) return;
    logProductsPipelineStage("1 props products", products);
    logProductsPipelineStage("2 localProducts", localProducts);
    logProductsPipelineStage("3 orderedProducts", orderedProducts);
    logProductsPipelineStage("4 filtered", filtered);
    logProductsPipelineStage("5 card map 직전 deduped (= filteredForRender)", filteredForRender);
    logFilteredSkuFocusDetail(filtered, "원본 filtered");
    logFilteredSkuFocusDetail(filteredForRender, "렌더용 filteredForRender");
    logVariantsMapIntegrity(localVariantsByProductId, "props 동기화 후 state", filteredForRender);
    logVariantsMapIntegrity(variantsByProductId, "직전 props 원본", filteredForRender);
    logFocusSkuCardsPerCard(filteredForRender, localVariantsByProductId, "localVariantsByProductId");
    logFocusSkuCardsPerCard(filteredForRender, variantsByProductId, "props variantsByProductId");
    console.info("[productsPipeline][skuDisplayGroups]", {
      groupCount: skuDisplayGroups.length,
      normSkus: skuDisplayGroups.map((g) => g.normSku),
    });
  }, [
    debugProductsDupes,
    products,
    localProducts,
    orderedProducts,
    filtered,
    filteredForRender,
    skuDisplayGroups,
    localVariantsByProductId,
    variantsByProductId,
  ]);

  /** List view: SKU 병합 후 (product, variant) 행 */
  const listRows = useMemo((): ProductRow[] => {
    const rows: ProductRow[] = [];
    for (const { product: p, variants } of skuDisplayGroupsForView) {
      if (variants.length > 0) {
        const visible = variantsAfterZeroStockFilter(variants, hideZeroStock);
        if (visible.length > 0) {
          for (const v of sortVariantsForDisplay(visible)) {
            rows.push({
              ...p,
              variantOwnerProductId: v.productId,
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
        } else if (hideZeroStock) {
          rows.push({
            ...p,
            isListNoVisibleOptionsRow: true,
            variantOwnerProductId: undefined,
            variantId: "",
            color: "",
            size: "",
            variantStock: 0,
            memo: null,
            memo2: null,
            variantWholesalePrice: null,
            variantMsrpPrice: null,
            variantSalePrice: null,
            variantExtraPrice: null,
          });
        }
      } else {
        rows.push({
          ...p,
          variantOwnerProductId: undefined,
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
  }, [skuDisplayGroupsForView, hideZeroStock]);

  useEffect(() => {
    if (!jumpProductId) {
      hasJumpedToProductRef.current = false;
      return;
    }
    if (viewMode !== "card") {
      setViewMode("card");
      return;
    }
    if (hasJumpedToProductRef.current) return;
    const selector = `[data-product-id="${jumpProductId.replace(/"/g, '\\"')}"]`;
    const target = document.querySelector(selector) as HTMLElement | null;
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    hasJumpedToProductRef.current = true;
  }, [jumpProductId, viewMode, skuDisplayGroupsForView.length]);

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

  const handleBulkImageFiles = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const list = e.target.files;
      if (!list?.length) return;
      setBulkImageWorking(true);
      setBulkImageResult(null);
      try {
        const fd = new FormData();
        fd.append("onlyIfEmpty", bulkOnlyEmptyImage ? "1" : "0");
        const arr = Array.from(list);
        for (const f of arr) {
          const processed = await resizeAndCompressImage(f);
          fd.append("files", processed);
        }
        const res = await bulkUploadProductImages(fd);
        setBulkImageResult(res);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => router.refresh());
        });
      } catch (err) {
        alert(err instanceof Error ? err.message : String(err));
      } finally {
        setBulkImageWorking(false);
        e.target.value = "";
      }
    },
    [bulkOnlyEmptyImage, router]
  );

  const scanStorageOrphans = useCallback(async () => {
    setOrphanWorkingMode("scan");
    setOrphanNotice("");
    try {
      const res = await fetch("/api/admin/storage-orphans", {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      const json = (await res.json()) as { ok?: boolean; error?: string } & Partial<StorageOrphanCleanupResult>;
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `불필요 이미지 점검 실패 (${res.status})`);
      }
      setOrphanResult({
        bucket: String(json.bucket ?? ""),
        referencedCount: Number(json.referencedCount ?? 0),
        storageFileCount: Number(json.storageFileCount ?? 0),
        orphanCount: Number(json.orphanCount ?? 0),
        orphanPaths: Array.isArray(json.orphanPaths) ? json.orphanPaths.map((x) => String(x)) : [],
        deletedCount: Number(json.deletedCount ?? 0),
        deletedPaths: Array.isArray(json.deletedPaths) ? json.deletedPaths.map((x) => String(x)) : [],
        failedPaths: Array.isArray(json.failedPaths)
          ? json.failedPaths.map((x) => ({
              path: String((x as { path?: unknown }).path ?? ""),
              message: String((x as { message?: unknown }).message ?? ""),
            }))
          : [],
        parseFailures: Array.isArray(json.parseFailures)
          ? json.parseFailures.map((x) => ({
              imageUrl: String((x as { imageUrl?: unknown }).imageUrl ?? ""),
              reason: String((x as { reason?: unknown }).reason ?? ""),
            }))
          : [],
      });
      setOrphanNotice("불필요 이미지 점검 완료");
    } catch (err) {
      setOrphanNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setOrphanWorkingMode(null);
    }
  }, []);

  const deleteStorageOrphans = useCallback(async () => {
    if (!orphanResult) return;
    if (orphanResult.parseFailures.length > 0) return;
    if (orphanResult.orphanCount === 0) return;
    if (
      !confirm(
        `불필요 이미지 ${orphanResult.orphanCount}건을 삭제합니다. 계속할까요?\n(참조 중 이미지와 placeholder는 삭제하지 않습니다.)`
      )
    ) {
      return;
    }
    setOrphanWorkingMode("delete");
    setOrphanNotice("");
    try {
      const res = await fetch("/api/admin/storage-orphans", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ dryRun: false, confirm: true }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string } & Partial<StorageOrphanCleanupResult>;
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `불필요 이미지 삭제 실패 (${res.status})`);
      }
      const next: StorageOrphanCleanupResult = {
        bucket: String(json.bucket ?? orphanResult.bucket),
        referencedCount: Number(json.referencedCount ?? orphanResult.referencedCount),
        storageFileCount: Number(json.storageFileCount ?? orphanResult.storageFileCount),
        orphanCount: Number(json.orphanCount ?? 0),
        orphanPaths: Array.isArray(json.orphanPaths) ? json.orphanPaths.map((x) => String(x)) : [],
        deletedCount: Number(json.deletedCount ?? 0),
        deletedPaths: Array.isArray(json.deletedPaths) ? json.deletedPaths.map((x) => String(x)) : [],
        failedPaths: Array.isArray(json.failedPaths)
          ? json.failedPaths.map((x) => ({
              path: String((x as { path?: unknown }).path ?? ""),
              message: String((x as { message?: unknown }).message ?? ""),
            }))
          : [],
        parseFailures: Array.isArray(json.parseFailures)
          ? json.parseFailures.map((x) => ({
              imageUrl: String((x as { imageUrl?: unknown }).imageUrl ?? ""),
              reason: String((x as { reason?: unknown }).reason ?? ""),
            }))
          : [],
      };
      setOrphanResult(next);
      setOrphanNotice(
        next.failedPaths.length > 0
          ? `삭제 완료(일부 실패 ${next.failedPaths.length}건)`
          : `삭제 완료(${next.deletedCount}건)`
      );
    } catch (err) {
      setOrphanNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setOrphanWorkingMode(null);
    }
  }, [orphanResult]);

  const orphanDeleteDisabled =
    orphanWorkingMode !== null ||
    !orphanResult ||
    orphanResult.orphanCount === 0 ||
    orphanResult.parseFailures.length > 0;

  const onListThumbPreview = useCallback((url: string, altText: string) => {
    setListImagePreview({ url, alt: altText });
  }, []);

  function runSearch() {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }
    setSearch(searchInput.trim());
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
            className={`btn btn-compact ${viewMode === "card" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setViewMode("card")}
          >
            모바일
          </button>
          <button
            type="button"
            className={`btn btn-compact ${viewMode === "list" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setViewMode("list")}
          >
            PC
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
            aria-label="업로드 메뉴"
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
          href="/products/xlsx/price-list"
          className="download-dropdown__item"
          onClick={() => setDownloadOpen(false)}
        >
          가격표
        </a>
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
          상품 Excel
        </a>
      </div>,
      document.body
    )
    : null;

  return (
    <div
      className="products-page"
      style={
        {
          "--products-mobile-sticky-top": `${mobileLayoutVars.stickyTop}px`,
          "--products-mobile-topbar-h": `${mobileLayoutVars.topBarHeight}px`,
          "--products-mobile-bottombar-h": `${mobileLayoutVars.bottomBarHeight}px`,
        } as CSSProperties
      }
    >
      <div className="products-sticky-controls" ref={stickyControlsRef}>
        <div className="products-content-container">
          <div className="products-toolbar products-toolbar--compact products-toolbar--sticky">
          {/* 1줄: 검색 + 검색버튼 + 카테고리 */}
          <div ref={toolbarSearchRowRef} className="toolbar-row toolbar-row--search">
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
          </div>

          <div className="products-count-bar">
          <div className="products-count-bar__count">
            <p className="products-count products-count--bar">
              {skuDisplayGroupsForView.length}개 상품
              {search && ` (총${localProducts.length})`}
            </p>
          </div>
          <div className="products-count-bar__toggle-slot products-count-bar__toggle-slot--soldout">
            <label className="products-hide-zero">
              <span className="products-hide-zero__label">품절</span>
              <input
                type="checkbox"
                className="products-hide-zero__input"
                role="switch"
                checked={showInStockOnly}
                onChange={(e) => setShowInStockOnly(e.target.checked)}
                aria-checked={showInStockOnly}
                aria-label="품절 숨기기"
              />
              <span className="products-hide-zero__track" aria-hidden />
            </label>
          </div>
          <div className="products-count-bar__toggle-slot products-count-bar__toggle-slot--option0">
            <label className="products-hide-zero">
              <span className="products-hide-zero__label">재고0</span>
              <input
                type="checkbox"
                className="products-hide-zero__input"
                role="switch"
                checked={hideZeroStock}
                onChange={(e) => setHideZeroStock(e.target.checked)}
                aria-checked={hideZeroStock}
                aria-label="재고 0 옵션 숨기기"
              />
              <span className="products-hide-zero__track" aria-hidden />
            </label>
          </div>
          <div className="products-count-bar__toggle-slot products-count-bar__toggle-slot--memo">
            <label className="products-hide-zero">
              <span className="products-hide-zero__label">메모ON</span>
              <input
                type="checkbox"
                className="products-hide-zero__input"
                role="switch"
                checked={cardsMemoVisible}
                onChange={(e) => setCardsMemoVisible(e.target.checked)}
                aria-checked={cardsMemoVisible}
                aria-label="카드 메모 전체 표시"
              />
              <span className="products-hide-zero__track" aria-hidden />
            </label>
          </div>
          </div>

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
      </div>

      <div className="products-content-container">
      {/* 모바일 전용: 하단 고정 액션 바 */}
      <div className="toolbar-bottom-bar" aria-hidden="true" ref={bottomBarRef}>
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
              aria-label="업로드 메뉴"
              data-placement={uploadMenuDirection}
              style={uploadMenuStyle}
            >
              <button
                type="button"
                role="menuitem"
                className="download-dropdown__item"
                disabled={orphanWorkingMode !== null}
                onClick={() => {
                  setUploadOpen(false);
                  void scanStorageOrphans();
                }}
              >
                {orphanWorkingMode === "scan" ? "불필요 이미지 점검 중…" : "불필요 이미지 점검"}
              </button>
              <button
                type="button"
                role="menuitem"
                className="download-dropdown__item"
                disabled={orphanDeleteDisabled}
                title={
                  orphanResult?.parseFailures.length
                    ? "parse 실패가 있어 삭제할 수 없습니다."
                    : orphanResult?.orphanCount === 0
                      ? "삭제할 불필요 이미지가 없습니다."
                      : undefined
                }
                onClick={() => {
                  setUploadOpen(false);
                  void deleteStorageOrphans();
                }}
              >
                {orphanWorkingMode === "delete" ? "불필요 이미지 삭제 중…" : "불필요 이미지 삭제"}
              </button>
              <div className="download-dropdown__divider download-dropdown__divider--thin" role="separator" />
              <button
                type="button"
                role="menuitem"
                className="download-dropdown__item"
                disabled={bulkImageWorking}
                onClick={() => {
                  setUploadOpen(false);
                  setDownloadOpen(false);
                  setBulkImageResult(null);
                  setBulkImageModalOpen(true);
                }}
              >
                일괄 이미지 업로드
              </button>
              <div className="download-dropdown__divider download-dropdown__divider--thin" role="separator" />
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
                CSV 덮어쓰기
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
                CSV 초기화
              </button>
            </div>,
            document.body
          )
        : null}

        {(orphanResult || orphanNotice) && (
        <section className="orphan-cleanup-panel" aria-live="polite">
          <div className="orphan-cleanup-panel__head">
            <strong>스토리지 불필요 이미지 점검 결과</strong>
            <button
              type="button"
              className="orphan-cleanup-panel__close"
              onClick={() => {
                setOrphanResult(null);
                setOrphanNotice("");
              }}
              aria-label="불필요 이미지 점검 결과 닫기"
            >
              닫기
            </button>
          </div>
          {orphanNotice ? <p className="orphan-cleanup-panel__notice">{orphanNotice}</p> : null}
          {orphanResult ? (
            <>
              <p className="orphan-cleanup-panel__summary">
                저장소 <strong>{orphanResult.bucket || "-"}</strong> · DB에서 사용 중{" "}
                <strong>{orphanResult.referencedCount}개</strong> · 스토리지 전체{" "}
                <strong>{orphanResult.storageFileCount}개</strong> · 불필요 이미지{" "}
                <strong>{orphanResult.orphanCount}개</strong>
                {orphanResult.deletedCount > 0 ? (
                  <>
                    {" "}
                    · 삭제 완료 <strong>{orphanResult.deletedCount}개</strong>
                  </>
                ) : null}
              </p>

              <div className="orphan-cleanup-panel__grid">
                <div className="orphan-cleanup-panel__box">
                  <p className="orphan-cleanup-panel__label">
                    불필요 이미지 경로 ({orphanResult.orphanPaths.length}개)
                  </p>
                  <pre className="orphan-cleanup-panel__list">
                    {orphanResult.orphanPaths.length > 0 ? orphanResult.orphanPaths.join("\n") : "없음"}
                  </pre>
                </div>
                <div className="orphan-cleanup-panel__box">
                  <p className="orphan-cleanup-panel__label">
                    경로 해석 실패 ({orphanResult.parseFailures.length}개)
                  </p>
                  <pre className="orphan-cleanup-panel__list">
                    {orphanResult.parseFailures.length > 0
                      ? orphanResult.parseFailures
                          .map((x) => `${x.imageUrl} :: ${x.reason}`)
                          .join("\n")
                      : "없음"}
                  </pre>
                </div>
                <div className="orphan-cleanup-panel__box">
                  <p className="orphan-cleanup-panel__label">
                    삭제 실패 경로 ({orphanResult.failedPaths.length}개)
                  </p>
                  <pre className="orphan-cleanup-panel__list">
                    {orphanResult.failedPaths.length > 0
                      ? orphanResult.failedPaths.map((x) => `${x.path} :: ${x.message}`).join("\n")
                      : "없음"}
                  </pre>
                </div>
              </div>
            </>
          ) : null}
        </section>
        )}

        {viewMode === "card" ? (
        <div className="products-grid">
          {skuDisplayGroupsForView.length === 0 ? (
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
            skuDisplayGroupsForView.map(({ normSku, product: p, variants: vars }) => {
              const displayVars = variantsAfterZeroStockFilter(vars, hideZeroStock);
              const showNoVisibleOptionsHint = hideZeroStock && vars.length > 0 && displayVars.length === 0;
              return (
                <ProductCard
                  key={normSku}
                  product={p}
                  displayGroupNormSku={normSku}
                  localImageHrefBySkuLower={localImageHrefBySkuLower}
                  variants={displayVars}
                  showNoVisibleOptionsHint={showNoVisibleOptionsHint}
                  memoShowAll={cardsMemoVisible}
                  onMemoShowAllChange={setCardsMemoVisible}
                  onEditClick={openEditById}
                  onDeleteClick={requestDeleteProduct}
                  onProductStockDelta={onProductStockDelta}
                  onVariantStockDelta={onVariantStockDelta}
                  productStockSaving={adjustingStockKeys.has(`p:${p.id}`)}
                  savingVariantIdsKey={variantSavingKeyForProduct(adjustingStockKeys, vars)}
                  debugProductsDupes={debugProductsDupes}
                  debugVariantSkuMix={debugVariantSkuMix}
                />
              );
            })
          )}
        </div>
        ) : (
        <div className="table-wrap products-list-table-wrap">
          {skuDisplayGroupsForView.length === 0 ? (
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
                  <th className="products-table__th-tight">카테고리</th>
                  <th className="products-table__th-tight">컬러</th>
                  <th className="products-table__th-tight">사이즈</th>
                  <th className="products-table__th-stock">재고</th>
                  <th>출고가</th>
                  <th>판매가</th>
                  <th>실판매가</th>
                  <th>매장</th>
                  <th>비고1</th>
                  <th>비고2</th>
                  <th className="products-table__th-updated">최종 수정일</th>
                  <th>작업</th>
                </tr>
              </thead>
              <tbody>
                {listRows.map((row) => {
                  const rowKey = listRowAdjustKey(row);
                  const rowSaving = adjustingStockKeys.has(rowKey);
                  return (
                    <ProductsTableRow
                      key={
                        row.isListNoVisibleOptionsRow
                          ? `${row.id}-novis`
                          : row.variantId
                            ? `${row.id}-${row.variantId}`
                            : row.id
                      }
                      row={row}
                      rowSaving={rowSaving}
                      localImageHrefBySkuLower={localImageHrefBySkuLower}
                      onOpenPreview={onListThumbPreview}
                      onStockDelta={onListRowStockDelta}
                      onEdit={openEditById}
                      onDelete={requestDeleteProduct}
                    />
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        )}
      </div>

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
        onSaved={({ productId, sku, category, name, imageUrl, memo, memo2 }) => {
          setLocalProducts((prev) =>
            prev.map((p) =>
              p.id === productId
                ? { ...p, sku, category, name, imageUrl, memo, memo2 }
                : p
            )
          );
          setEditingProduct((prev) =>
            prev && prev.id === productId
              ? { ...prev, sku, category, name, imageUrl, memo, memo2 }
              : prev
          );
        }}
        onClose={() => {
          setEditOpen(false);
          setEditingProduct(null);
          setEditingVariants([]);
        }}
      />

      {bulkImageModalOpen ? (
        <div
          className="modal-overlay add-product-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bulk-image-modal-title"
          onClick={() => {
            if (!bulkImageWorking) setBulkImageModalOpen(false);
          }}
        >
          <div className="modal add-product-modal bulk-image-modal" onClick={(ev) => ev.stopPropagation()}>
            <div className="modal-header-add-product bulk-image-modal__header">
              <h3 id="bulk-image-modal-title">일괄 이미지 업로드</h3>
            </div>
            <p className="bulk-image-modal__hint">
              파일명(확장자 제외)을 상품 SKU와 같게 맞추세요. 예: <code>T21KT1005RD.jpg</code>,{" "}
              <code>TGT-901RD.webp</code>
              <br />
              브라우저에서 리사이즈·압축 후 Supabase Storage에 저장되며 <code>products.image_url</code>이 갱신됩니다.
            </p>
            <label className="bulk-image-modal__checkbox">
              <span className="bulk-image-modal__checkbox-label">이미지 URL이 비어 있는 상품만 적용</span>
              <input
                type="checkbox"
                className="bulk-image-modal__checkbox-input"
                checked={bulkOnlyEmptyImage}
                onChange={(e) => setBulkOnlyEmptyImage(e.target.checked)}
                disabled={bulkImageWorking}
              />
            </label>
            <div className="bulk-image-modal__actions">
              <button
                type="button"
                className="btn btn-primary btn-compact bulk-image-modal__action-file"
                disabled={bulkImageWorking}
                onClick={() => bulkImageInputRef.current?.click()}
              >
                {bulkImageWorking ? "처리 중…" : "파일 선택 (여러 개)"}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-compact bulk-image-modal__action-close"
                disabled={bulkImageWorking}
                onClick={() => setBulkImageModalOpen(false)}
              >
                닫기
              </button>
            </div>
            <input
              ref={bulkImageInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="products-csv-file-input"
              aria-hidden
              tabIndex={-1}
              onChange={(e) => void handleBulkImageFiles(e)}
              disabled={bulkImageWorking}
            />
            {bulkImageResult ? (
              <div className="bulk-image-modal__result">
                <p>
                  성공 <strong>{bulkImageResult.successCount}</strong> · 매칭 실패{" "}
                  <strong>{bulkImageResult.matchFailedCount}</strong> · 업로드 실패{" "}
                  <strong>{bulkImageResult.uploadFailedCount}</strong>
                  {bulkImageResult.skippedExistingImageCount > 0 ? (
                    <>
                      {" "}
                      · 이미지 있음 건너뜀 <strong>{bulkImageResult.skippedExistingImageCount}</strong>
                    </>
                  ) : null}
                </p>
                {bulkImageResult.matchFailedSamples.length > 0 ? (
                  <p className="bulk-image-modal__result-muted">
                    매칭 실패 파일 예: {bulkImageResult.matchFailedSamples.join(", ")}
                  </p>
                ) : null}
                {bulkImageResult.uploadErrors.length > 0 ? (
                  <p className="bulk-image-modal__result-error">
                    업로드 오류:{" "}
                    {bulkImageResult.uploadErrors.map((x) => `${x.filename} (${x.message})`).join(" · ")}
                  </p>
                ) : null}
                {bulkImageResult.skippedExistingSamples.length > 0 ? (
                  <p className="bulk-image-modal__result-muted">
                    건너뜀(기존 이미지): {bulkImageResult.skippedExistingSamples.slice(0, 12).join(", ")}
                    {bulkImageResult.skippedExistingSamples.length > 12 ? "…" : ""}
                  </p>
                ) : null}
                {bulkImageResult.duplicateNormSkuUsedFirst.length > 0 ? (
                  <p className="bulk-image-modal__result-note">
                    동일 정규화 SKU가 여러 상품이면 첫 행만 갱신:{" "}
                    {bulkImageResult.duplicateNormSkuUsedFirst.slice(0, 10).join(", ")}
                    {bulkImageResult.duplicateNormSkuUsedFirst.length > 10 ? "…" : ""}
                  </p>
                ) : null}
                {bulkImageResult.storageDeleteFailures.length > 0 ? (
                  <p className="bulk-image-modal__result-error">
                    이전 Storage 파일 삭제 실패(새 이미지는 반영됨):{" "}
                    {bulkImageResult.storageDeleteFailures
                      .map((x) => `${x.filename} (${x.message})`)
                      .join(" · ")}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

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
            onError={() => setListImagePreview(null)}
          />
        </div>
      ) : null}

      {stockErrorToast ? (
        <div className="products-stock-toast" role="status">
          {stockErrorToast}
        </div>
      ) : null}
    </div>
  );
}