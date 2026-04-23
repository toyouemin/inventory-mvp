"use client";

/**
 * 주문 입력·매칭 결과 UI. 상태는 이 컴포넌트 내부에만 두며,
 * 기존 상품/재고 API를 호출하지 않고 props로 받은 스냅샷에 대해 메모리상 계산만 한다.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { GarmentTypeId, MatchStatus, NormalizedStockLine, RequestLineInput } from "@/features/orderQuantityMatch/types";
import { type SizePolicy, getSavedCategoryPolicyStore, saveCategoryPolicyStore } from "@/features/orderQuantityMatch/categoryPolicy";
import { matchOrderRowsToProducts, type ProductMatchResult } from "@/features/orderQuantityMatch/matchOrderToProducts";
import {
  buildOqmCategoryProfile,
  buildOqmQuickRequestLines,
  isOqmRecognizedSizeToken,
  normalizeOqmSizeToken,
  type OqmCategoryProfile,
  type OqmApparelSizeType,
} from "@/features/orderQuantityMatch/oqmPipelineModel";

const IS_DEV = process.env.NODE_ENV === "development";
const GENERAL_ITEM_PRESETS = ["라켓", "가방"] as const;
const SIZE_CATEGORY_FALLBACK_PRESETS = ["티셔츠", "바람막이", "맨투맨", "오버핏", "트레이닝복", "7부바지"] as const;

/**
 * 수량 매칭 UI에서만 카테고리 선택·자동완성 후보에서 제외 (DB `products.category` 값은 변경하지 않음).
 * 필요 시 문자열을 추가하면 됨.
 */
const OQM_UI_EXCLUDED_CATEGORIES = ["슬리브"] as const;
const OQM_UI_EXCLUDED_CATEGORY_SET = new Set<string>(OQM_UI_EXCLUDED_CATEGORIES);

function filterOqmUiCategories(cats: readonly string[]): string[] {
  return cats.map((c) => c.trim()).filter(Boolean).filter((c) => !OQM_UI_EXCLUDED_CATEGORY_SET.has(c));
}

/**
 * 일반 물품 datalist·행 시드: 프리셋 + `buildOqmCategoryProfile`의 generalItems(현재 카테고리 재고의 표시명)만 사용.
 * `products.category` 전체 목록과 **동일한 문자열**은 물품 후보에서 제외(슬리브 등 카테고리명이 물품 자동완성에 뜨는 것 방지).
 */
function buildOqmGeneralItemUiOptions(allDbCategories: readonly string[], profileGeneralItems: readonly string[]): string[] {
  const catSet = new Set(allDbCategories.map((c) => c.trim()).filter(Boolean));
  const fromProfile = profileGeneralItems
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((g) => !catSet.has(g));
  const merged = new Set<string>([...GENERAL_ITEM_PRESETS, ...fromProfile]);
  return [...merged].sort((a, b) => a.localeCompare(b, "ko"));
}

function safeScrollDomIdSegment(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return `h${Math.abs(h)}`;
}

/** 결과 행 스크롤 앵커·id (상품 기준) */
function resultCardDomIdByProduct(result: ProductMatchResult): string {
  return `oqm-card-product-${safeScrollDomIdSegment(result.productId)}`;
}

function newRowId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `row-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

type QuickEntry = {
  id: string;
  quantity: string;
};

type QuickCategoryKind = "apparel" | "training" | "general";

type CategoryProfile = OqmCategoryProfile;
type ApparelSizeType = OqmApparelSizeType;
const TRAINING_FEMALE_BASE = ["85", "90", "95", "100", "105"] as const;
const TRAINING_MALE_BASE = ["95", "100", "105", "110", "115"] as const;
const ALPHA_SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"] as const;
const ALPHA_SIZE_RANK: Map<string, number> = new Map(ALPHA_SIZE_ORDER.map((s, i) => [s, i]));

function quickEntry(id: string): QuickEntry {
  return { id, quantity: "" };
}

function parseQty(raw: string): number {
  if (raw.trim() === "") return 0;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

function qtyStringForInput(raw: string): string {
  if (raw.trim() === "") return "";
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 0) return "";
  return String(n);
}

function buildRequestRow(input: Omit<RequestLineInput, "rowId">): RequestLineInput {
  return {
    rowId: newRowId(),
    ...input,
  };
}

function isAlphaSize(raw: string): boolean {
  const t = normalizeOqmSizeToken(raw);
  return ALPHA_SIZE_RANK.has(t);
}

function numericSizeOrNull(raw: string): number | null {
  const t = normalizeOqmSizeToken(raw);
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function clampTrainingFemaleSizes(sizes: string[]): string[] {
  return sizes.filter((s) => {
    const n = numericSizeOrNull(s);
    return n == null ? true : n <= 105;
  });
}

function clampTrainingMaleSizes(sizes: string[]): string[] {
  return sizes.filter((s) => {
    const n = numericSizeOrNull(s);
    return n == null ? true : n >= 95;
  });
}

function statusLabel(s: MatchStatus): string {
  if (s === "full") return "완전 가능";
  if (s === "partial") return "부분 가능";
  return "불가";
}

function statusClass(s: MatchStatus): string {
  if (s === "full") return "oqm-badge oqm-badge--ok";
  if (s === "partial") return "oqm-badge oqm-badge--partial";
  return "oqm-badge oqm-badge--bad";
}

export function OrderQuantityMatchClient({
  categories,
  stockLines,
  productImageById,
}: {
  categories: string[];
  stockLines: NormalizedStockLine[];
  productImageById: Record<string, string | null>;
}) {
  const [quickCategory, setQuickCategory] = useState("티셔츠");
  const [savedPolicyStore, setSavedPolicyStore] = useState<Record<string, SizePolicy>>({});
  /** 빠른 입력: 카테고리 내 재고를 선택한 상품 집합으로 한정(빈 배열 = 전체 상품) */
  const [quickProductScopeIds, setQuickProductScopeIds] = useState<string[]>([]);
  const linesInQuickCategory = useMemo(() => {
    const c = quickCategory.trim();
    if (!c) return [];
    return stockLines.filter((l) => (l.dimensions.category ?? "").trim() === c);
  }, [quickCategory, stockLines]);
  const quickStockScopeLines = useMemo(() => {
    if (quickProductScopeIds.length === 0) return linesInQuickCategory;
    const idSet = new Set(quickProductScopeIds);
    return linesInQuickCategory.filter((l) => idSet.has(l.productId));
  }, [linesInQuickCategory, quickProductScopeIds]);
  const categoryProfile = useMemo(
    () => buildOqmCategoryProfile(quickCategory, quickStockScopeLines, savedPolicyStore),
    [quickCategory, quickStockScopeLines, savedPolicyStore]
  );
  const [apparelSizeType, setApparelSizeType] = useState<ApparelSizeType>("genderSplit");
  const [apparelQtyByKey, setApparelQtyByKey] = useState<Record<string, string>>({});
  const [trainingSetQtyByKey, setTrainingSetQtyByKey] = useState<Record<string, string>>({});
  const [generalEntries, setGeneralEntries] = useState<QuickEntry[]>(GENERAL_ITEM_PRESETS.map((name) => quickEntry(name)));
  /** 상단 카테고리 추천의 기본 소스: 기존 재고 상품(products.category) 고유값 — UI 제외 목록 반영 */
  const inventoryCategorySuggestions = useMemo(
    () => [...new Set(filterOqmUiCategories(categories))].sort((a, b) => a.localeCompare(b, "ko")),
    [categories]
  );
  /** 일반(사이즈 없음) 물품: 프리셋 + 현재 범주 generalItems — 노출 카테고리명과 동일한 토큰은 제외 */
  const generalItemDatalistOptions = useMemo(
    () => buildOqmGeneralItemUiOptions(inventoryCategorySuggestions, categoryProfile.generalItems),
    [inventoryCategorySuggestions, categoryProfile.generalItems]
  );
  /** 빠른 입력 첫 카테고리: 사이즈 입력이 가능한 카테고리만 노출 — UI 제외 목록 반영 */
  const sizedCategorySuggestions = useMemo(() => {
    const sizedFromStock = new Set(
      stockLines
        .filter((l) => isOqmRecognizedSizeToken(l.dimensions.size ?? ""))
        .map((l) => (l.dimensions.category ?? "").trim())
        .filter(Boolean)
        .filter((c) => !OQM_UI_EXCLUDED_CATEGORY_SET.has(c))
    );
    // 트레이닝복은 운영상 필요 시 size 누락 데이터에서도 선택 가능하도록 예외 유지
    if (inventoryCategorySuggestions.includes("트레이닝복")) sizedFromStock.add("트레이닝복");

    const withoutExcluded = (arr: string[]) => arr.filter((c) => !OQM_UI_EXCLUDED_CATEGORY_SET.has(c));

    if (sizedFromStock.size >= 3) return withoutExcluded([...sizedFromStock].sort((a, b) => a.localeCompare(b, "ko")));
    const merged = new Set<string>(sizedFromStock);
    for (const p of SIZE_CATEGORY_FALLBACK_PRESETS) merged.add(p);
    return withoutExcluded([...merged].sort((a, b) => a.localeCompare(b, "ko")));
  }, [inventoryCategorySuggestions, stockLines]);

  useEffect(() => {
    setQuickCategory((prev) => {
      const t = prev.trim();
      if (!t) return prev;
      if (sizedCategorySuggestions.includes(t)) return prev;
      return sizedCategorySuggestions[0] ?? "";
    });
  }, [sizedCategorySuggestions]);

  const quickScopeProductOptions = useMemo(() => {
    const byId = new Map<string, { productId: string; label: string }>();
    for (const line of linesInQuickCategory) {
      if (byId.has(line.productId)) continue;
      const name = (line.displayName ?? "").trim();
      const sku = (line.sku ?? "").trim();
      const label = name || sku || line.productId;
      byId.set(line.productId, {
        productId: line.productId,
        label,
      });
    }
    return [...byId.values()].sort((a, b) => b.label.localeCompare(a.label, "ko", { numeric: true }));
  }, [linesInQuickCategory]);
  const quickCategoryKind = useMemo<QuickCategoryKind>(() => {
    if (categoryProfile.stockScopeType === "set") return "training";
    if (categoryProfile.stockScopeType === "other") return "general";
    return "apparel";
  }, [categoryProfile.stockScopeType]);
  const apparelGarmentType = useMemo<GarmentTypeId>(() => {
    if (quickCategoryKind !== "apparel") return "single";
    if (categoryProfile.stockScopeType === "top" || categoryProfile.stockScopeType === "outer") return "top";
    if (categoryProfile.stockScopeType === "bottom") return "bottom";
    return "single";
  }, [quickCategoryKind, categoryProfile.stockScopeType]);
  const activeApparelSizes =
    apparelSizeType === "genderSplit"
      ? [...new Set([...categoryProfile.femaleSizes, ...categoryProfile.maleSizes])]
      : categoryProfile.sizePolicy === "unisexAlpha"
        ? categoryProfile.unisexAlphaSizes
        : categoryProfile.unisexSizes;
  // 입력판은 카테고리명/정책 fallback이 아니라 현재 선택 범위의 실제 size 데이터 구조만 따른다.
  const canShowUnisexInput = categoryProfile.hasUnisexData;
  const canShowGenderSplitInput = categoryProfile.hasGenderSplitData;

  useEffect(() => {
    setSavedPolicyStore(getSavedCategoryPolicyStore());
  }, []);

  function confirmCategoryPolicy(policy: SizePolicy) {
    const category = quickCategory.trim();
    if (!category) return;
    const next = { ...savedPolicyStore, [category]: policy };
    setSavedPolicyStore(next);
    saveCategoryPolicyStore(next);
  }

  function clearAllQuickQuantities() {
    setApparelQtyByKey({});
    setTrainingSetQtyByKey({});
    setGeneralEntries((prev) => prev.map((e) => ({ ...e, quantity: "" })));
  }

  useEffect(() => {
    if (canShowUnisexInput && canShowGenderSplitInput) return;
    if (canShowGenderSplitInput) {
      setApparelSizeType("genderSplit");
      return;
    }
    if (canShowUnisexInput) {
      setApparelSizeType("unisex");
    }
  }, [quickCategory, canShowUnisexInput, canShowGenderSplitInput]);

  useEffect(() => {
    setQuickProductScopeIds([]);
  }, [quickCategory]);

  useEffect(() => {
    if (quickProductScopeIds.length === 0) return;
    const validIdSet = new Set(quickScopeProductOptions.map((o) => o.productId));
    const next = quickProductScopeIds.filter((id) => validIdSet.has(id));
    if (next.length !== quickProductScopeIds.length) setQuickProductScopeIds(next);
  }, [quickProductScopeIds, quickScopeProductOptions]);

  useEffect(() => {
    if (quickCategoryKind !== "general") return;
    const resolved =
      generalItemDatalistOptions.length > 0 ? generalItemDatalistOptions : [...GENERAL_ITEM_PRESETS];
    setGeneralEntries(resolved.map((name) => quickEntry(name)));
  }, [quickCategory, quickCategoryKind, generalItemDatalistOptions]);

  useEffect(() => {
    if (!IS_DEV) return;
    const needles = [...OQM_UI_EXCLUDED_CATEGORIES];
    const pick = (arr: readonly string[], n: string) => arr.filter((x) => x.includes(n));
    for (const n of needles) {
      const hits = {
        inventoryCategorySuggestions: pick(inventoryCategorySuggestions, n),
        sizedCategorySuggestions: pick(sizedCategorySuggestions, n),
        generalItemDatalistOptions: pick(generalItemDatalistOptions, n),
        categoryProfile_generalItems: pick(categoryProfile.generalItems, n),
      };
      if (Object.values(hits).some((a) => a.length > 0)) {
        console.info(`[OQM] UI 제외 목록 위반 의심: '${n}' 포함`, hits);
      }
    }
  }, [
    inventoryCategorySuggestions,
    sizedCategorySuggestions,
    generalItemDatalistOptions,
    categoryProfile.generalItems,
  ]);

  const quickRequestInputs = useMemo(
    () =>
      buildOqmQuickRequestLines({
        createRow: buildRequestRow,
        quickCategory,
        quickCategoryKind,
        apparelSizeType,
        categoryProfile,
        activeApparelSizes,
        apparelGarmentType,
        apparelQtyByKey,
        trainingSetQtyByKey,
        generalEntries,
      }),
    [
      activeApparelSizes,
      apparelQtyByKey,
      apparelSizeType,
      categoryProfile,
      generalEntries,
      apparelGarmentType,
      quickCategory,
      quickCategoryKind,
      trainingSetQtyByKey,
    ]
  );

  const requestInputs = quickRequestInputs;
  const scopedStockLines = useMemo(() => {
    if (!quickCategory.trim()) return [];
    return quickStockScopeLines;
  }, [quickCategory, quickStockScopeLines]);
  const productResults = useMemo(
    () => matchOrderRowsToProducts(requestInputs, scopedStockLines),
    [requestInputs, scopedStockLines]
  );

  return (
    <div className="products-page oqm-page">
      <div className="products-content-container">
        <header className="oqm-page-head">
          <h1 className="oqm-page-title">주문 수량 매칭</h1>
        </header>

        <section className="oqm-section oqm-section--input">

          <datalist id="oqm-general-item-suggestions">
            {generalItemDatalistOptions.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>

          <QuickInputPanel
            categories={sizedCategorySuggestions}
            generalItemDatalistOptions={generalItemDatalistOptions}
            quickCategory={quickCategory}
            setQuickCategory={setQuickCategory}
            productScopeOptions={quickScopeProductOptions}
            quickProductScopeIds={quickProductScopeIds}
            setQuickProductScopeIds={setQuickProductScopeIds}
            categoryProfile={categoryProfile}
            quickCategoryKind={quickCategoryKind}
            apparelSizeType={apparelSizeType}
            setApparelSizeType={setApparelSizeType}
            canShowUnisexInput={canShowUnisexInput}
            canShowGenderSplitInput={canShowGenderSplitInput}
            apparelQtyByKey={apparelQtyByKey}
            setApparelQtyByKey={setApparelQtyByKey}
            trainingSetQtyByKey={trainingSetQtyByKey}
            setTrainingSetQtyByKey={setTrainingSetQtyByKey}
            generalEntries={generalEntries}
            setGeneralEntries={setGeneralEntries}
            onConfirmCategoryPolicy={confirmCategoryPolicy}
            onClearAllQuantities={clearAllQuickQuantities}
          />
        </section>

        <section className="oqm-section oqm-section--results" aria-labelledby="oqm-result-heading">
          <h2 id="oqm-result-heading" className="oqm-section-title">
            매칭 결과
          </h2>
          <ResultCards items={productResults} productImageById={productImageById} />
        </section>
      </div>
    </div>
  );
}

function updateQuickEntriesByIndex(
  entries: QuickEntry[],
  index: number,
  patch: Partial<QuickEntry>
): QuickEntry[] {
  return entries.map((e, i) => (i === index ? { ...e, ...patch } : e));
}

function quickTotal(entries: QuickEntry[], predicate?: (e: QuickEntry) => boolean): number {
  return entries.reduce((sum, e) => {
    if (predicate && !predicate(e)) return sum;
    return sum + parseQty(e.quantity);
  }, 0);
}

function numberInputProps(value: string) {
  return {
    type: "number" as const,
    min: 0,
    step: 1,
    inputMode: "numeric" as const,
    value: qtyStringForInput(value),
    onWheel: (e: { target: EventTarget | null }) => (e.target as HTMLInputElement | null)?.blur(),
  };
}

function QuickInputPanel(props: {
  categories: string[];
  generalItemDatalistOptions: string[];
  quickCategory: string;
  setQuickCategory: (v: string) => void;
  productScopeOptions: { productId: string; label: string }[];
  quickProductScopeIds: string[];
  setQuickProductScopeIds: (v: string[]) => void;
  categoryProfile: CategoryProfile;
  quickCategoryKind: QuickCategoryKind;
  apparelSizeType: ApparelSizeType;
  setApparelSizeType: (v: ApparelSizeType) => void;
  canShowUnisexInput: boolean;
  canShowGenderSplitInput: boolean;
  apparelQtyByKey: Record<string, string>;
  setApparelQtyByKey: (v: Record<string, string>) => void;
  trainingSetQtyByKey: Record<string, string>;
  setTrainingSetQtyByKey: (v: Record<string, string>) => void;
  generalEntries: QuickEntry[];
  setGeneralEntries: (v: QuickEntry[]) => void;
  onConfirmCategoryPolicy: (policy: SizePolicy) => void;
  onClearAllQuantities: () => void;
}) {
  const {
    categories,
    generalItemDatalistOptions,
    quickCategory,
    setQuickCategory,
    productScopeOptions,
    quickProductScopeIds,
    setQuickProductScopeIds,
    categoryProfile,
    quickCategoryKind,
    apparelSizeType,
    setApparelSizeType,
    canShowUnisexInput,
    canShowGenderSplitInput,
    apparelQtyByKey,
    setApparelQtyByKey,
    trainingSetQtyByKey,
    setTrainingSetQtyByKey,
    generalEntries,
    setGeneralEntries,
    onConfirmCategoryPolicy,
    onClearAllQuantities,
  } = props;
  const selectedCategoryValue =
    quickCategory.trim() !== "" && categories.includes(quickCategory.trim()) ? quickCategory.trim() : "__empty__";
  const [productPickerValue, setProductPickerValue] = useState("");
  useEffect(() => {
    setProductPickerValue("");
  }, [quickCategory]);

  return (
    <div className="oqm-quick">
      <div className="oqm-quick-head">
        <div className="oqm-quick-head-primary">
          <label className="oqm-field oqm-field--category-select">
            <span className="oqm-field__label">카테고리 선택</span>
            <select
              className="oqm-select"
              value={selectedCategoryValue}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "__empty__") {
                  setQuickCategory("");
                  return;
                }
                setQuickCategory(v);
              }}
            >
              <option value="__empty__">카테고리 선택</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          {quickCategory.trim() !== "" ? (
            productScopeOptions.length > 0 ? (
              <label className="oqm-field oqm-field--product-scope">
                <span className="oqm-field__label">품목명 (매칭 재고 범위)</span>
                <select
                  className="oqm-select"
                  value={productPickerValue}
                  onChange={(e) => {
                    const id = e.target.value;
                    setProductPickerValue("");
                    if (!id) return;
                    if (quickProductScopeIds.includes(id)) return;
                    setQuickProductScopeIds([...quickProductScopeIds, id]);
                  }}
                  aria-label="매칭에 사용할 재고 품목명 범위"
                >
                  <option value="">품목명</option>
                  {productScopeOptions.map((o) => (
                    <option key={o.productId} value={o.productId}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="oqm-muted oqm-product-scope-empty">이 카테고리에 재고가 없어 품목명을 지정할 수 없습니다.</p>
            )
          ) : null}
        </div>
      </div>
      {quickCategory.trim() !== "" && productScopeOptions.length > 0 ? (
        <p className="oqm-muted oqm-category-hint">
          품목명을 여러 개 선택하면 선택 범위로만 매칭. (미선택 시 전체)
        </p>
      ) : null}
      {quickCategory.trim() !== "" ? (
        <div className="oqm-product-scope-selected">
          <span className="oqm-muted">선택 품목명:</span>
          {quickProductScopeIds.length === 0 ? (
            <span className="oqm-muted oqm-product-scope-selected__all">전체</span>
          ) : (
            <div className="oqm-product-scope-chips">
              {quickProductScopeIds.map((id) => {
                const label = productScopeOptions.find((o) => o.productId === id)?.label ?? id;
                return (
                  <span key={id} className="oqm-chip-select">
                    <span>{label}</span>
                    <button
                      type="button"
                      className="oqm-chip-select__remove"
                      onClick={() => setQuickProductScopeIds(quickProductScopeIds.filter((v) => v !== id))}
                      aria-label={`${label} 선택 해제`}
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {quickCategoryKind === "apparel" ? (
        <>
          {categoryProfile.sizePolicy === "unisexNumeric" ? (
            <p className="oqm-muted oqm-mantoman-hint">
              이 카테고리는 공용 숫자형 정규화(S/M/L/XL/2XL/3XL/4XL ↔ 85/90/95/100/105/110/115)를 적용합니다.
            </p>
          ) : null}
          {categoryProfile.needsPolicyChoice ? (
            <div className="oqm-quick-head">
              <div className="oqm-size-mode">
                <span className="oqm-muted">이 카테고리의 사이즈 방식을 선택해 주세요 (1회 저장)</span>
                {([
                  ["genderSplit", "남/여 분리"],
                  ["unisexNumeric", "공용 숫자형"],
                  ["unisexAlpha", "공용 S/M/L"],
                  ["free", "프리사이즈"],
                  ["custom", "사용자 정의"],
                ] as const).map(([id, label]) => (
                  <button key={id} type="button" className="oqm-size-mode-btn" onClick={() => onConfirmCategoryPolicy(id)}>
                    {label}
                  </button>
                ))}
                {categoryProfile.recommendedPolicy ? (
                  <span className="oqm-muted">추천: {categoryProfile.recommendedPolicy}</span>
                ) : null}
              </div>
            </div>
          ) : null}
          {canShowUnisexInput && canShowGenderSplitInput ? (
            <div className="oqm-quick-head">
              <div className="oqm-size-mode">
                {([
                  ["unisex", "공용 입력"],
                  ["genderSplit", "남/여 분리"],
                ] as const).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={`oqm-size-mode-btn${apparelSizeType === id ? " oqm-size-mode-btn--active" : ""}`}
                    onClick={() => setApparelSizeType(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <ApparelMatrix
            apparelSizeType={apparelSizeType}
            canShowUnisexInput={canShowUnisexInput}
            canShowGenderSplitInput={canShowGenderSplitInput}
            profile={categoryProfile}
            qtyByKey={apparelQtyByKey}
            onChange={(id, value) => setApparelQtyByKey({ ...apparelQtyByKey, [id]: value })}
            onClearAllQuantities={onClearAllQuantities}
          />
        </>
      ) : null}

      {quickCategoryKind === "training" ? (
        <>
          <div className="oqm-quick-head oqm-training-head">
            <div className="oqm-size-mode">
              <button type="button" className="oqm-size-mode-btn oqm-size-mode-btn--active" disabled>
                세트
              </button>
            </div>
          </div>
          <TrainingSetMatrix
            profile={categoryProfile}
            qtyByKey={trainingSetQtyByKey}
            onChange={(id, value) => setTrainingSetQtyByKey({ ...trainingSetQtyByKey, [id]: value })}
            onClearAllQuantities={onClearAllQuantities}
          />
        </>
      ) : null}

      {quickCategoryKind === "general" ? (
        <GeneralQuickPanel
          suggestionPreview={generalItemDatalistOptions}
          entries={generalEntries}
            onQuantityChange={(index, value) =>
              setGeneralEntries(updateQuickEntriesByIndex(generalEntries, index, { quantity: value }))
            }
            onCategoryChange={(index, value) =>
              setGeneralEntries(updateQuickEntriesByIndex(generalEntries, index, { id: value }))
            }
            onAdd={() => setGeneralEntries([...generalEntries, quickEntry(`물품-${generalEntries.length + 1}`)])}
            onClearAllQuantities={onClearAllQuantities}
        />
      ) : null}
    </div>
  );
}

function ApparelMatrix({
  apparelSizeType,
  canShowUnisexInput,
  canShowGenderSplitInput,
  profile,
  qtyByKey,
  onChange,
  onClearAllQuantities,
}: {
  apparelSizeType: ApparelSizeType;
  canShowUnisexInput: boolean;
  canShowGenderSplitInput: boolean;
  profile: CategoryProfile;
  qtyByKey: Record<string, string>;
  onChange: (id: string, value: string) => void;
  onClearAllQuantities: () => void;
}) {
  if (!canShowUnisexInput && !canShowGenderSplitInput) {
    return (
      <div className="oqm-matrix-wrap">
        <p className="oqm-muted">선택한 범위에 유효한 사이즈 데이터가 없어 입력판을 표시할 수 없습니다.</p>
      </div>
    );
  }

  const femaleSizes = profile.femaleSizes;
  const maleSizes = profile.maleSizes;
  const unisexSizes = profile.sizePolicy === "unisexAlpha" ? profile.unisexAlphaSizes : profile.unisexSizes;
  const total =
    apparelSizeType === "genderSplit"
      ? [...femaleSizes, ...maleSizes].reduce((sum, size) => sum + parseQty(qtyByKey[`여|${size}`] ?? "") + parseQty(qtyByKey[`남|${size}`] ?? ""), 0)
      : unisexSizes.reduce((sum, size) => sum + parseQty(qtyByKey[`공용|${size}`] ?? ""), 0);

  const renderGenderSplit = canShowGenderSplitInput && (apparelSizeType === "genderSplit" || !canShowUnisexInput);
  if (renderGenderSplit) {
    if (femaleSizes.length === 0 && maleSizes.length === 0) {
      return (
        <div className="oqm-matrix-wrap">
          <p className="oqm-muted">선택한 범위에 남/여 사이즈가 없어 입력란을 표시할 수 없습니다.</p>
        </div>
      );
    }
    const colFemale =
      femaleSizes.length > 0
        ? `max-content repeat(${femaleSizes.length}, minmax(1.55rem, 1fr))`
        : "";
    const colMale =
      maleSizes.length > 0
        ? `max-content repeat(${maleSizes.length}, minmax(1.55rem, 1fr))`
        : "";
    return (
      <div className="oqm-matrix-wrap oqm-matrix-wrap--compact">
        <div className="oqm-apparel-matrix">
          {femaleSizes.length > 0 ? (
            <div className="oqm-apparel-block">
              <div className="oqm-apparel-scroll" role="group" aria-label="여성 수량">
                <div
                  className="oqm-apparel-grid"
                  style={{ gridTemplateColumns: colFemale }}
                >
                  <div className="oqm-apparel-grid__role">여성</div>
                  {femaleSizes.map((size) => (
                    <div key={`h-여-${size}`} className="oqm-apparel-grid__size">
                      {size}
                    </div>
                  ))}
                  <div className="oqm-apparel-grid__qty-lab">수량</div>
                  {femaleSizes.map((size) => (
                    <div key={`in-여-${size}`} className="oqm-apparel-grid__cell">
                      <input
                        className="oqm-input oqm-input--qty oqm-input--qty-mtx"
                        {...numberInputProps(qtyByKey[`여|${size}`] ?? "")}
                        onChange={(e) => onChange(`여|${size}`, e.target.value)}
                        aria-label={`여성 ${size} 수량`}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
          {maleSizes.length > 0 ? (
            <div className="oqm-apparel-block">
              <div className="oqm-apparel-scroll" role="group" aria-label="남성 수량">
                <div
                  className="oqm-apparel-grid"
                  style={{ gridTemplateColumns: colMale }}
                >
                  <div className="oqm-apparel-grid__role">남성</div>
                  {maleSizes.map((size) => (
                    <div key={`h-남-${size}`} className="oqm-apparel-grid__size">
                      {size}
                    </div>
                  ))}
                  <div className="oqm-apparel-grid__qty-lab">수량</div>
                  {maleSizes.map((size) => (
                    <div key={`in-남-${size}`} className="oqm-apparel-grid__cell">
                      <input
                        className="oqm-input oqm-input--qty oqm-input--qty-mtx"
                        {...numberInputProps(qtyByKey[`남|${size}`] ?? "")}
                        onChange={(e) => onChange(`남|${size}`, e.target.value)}
                        aria-label={`남성 ${size} 수량`}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>
        <div className="oqm-quick-total-row oqm-quick-total-row--tight">
          <p className="oqm-quick-total oqm-quick-total--tight" role="status">
            총 합계: {total.toLocaleString()}
          </p>
          <button
            type="button"
            className="btn btn-secondary oqm-btn-clear-quantities"
            onClick={onClearAllQuantities}
            aria-label="입력한 수량 전부 삭제"
          >
            수량 전체 삭제
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="oqm-matrix-wrap oqm-matrix-wrap--compact">
      <div className="oqm-apparel-matrix oqm-apparel-matrix--unisex">
        <div className="oqm-apparel-block-title" id="oqm-unisex-hd">
          공용
        </div>
        <div className="oqm-apparel-scroll" role="group" aria-labelledby="oqm-unisex-hd" aria-label="공용 수량">
          <div
            className="oqm-apparel-grid oqm-apparel-grid--nolab"
            style={{ gridTemplateColumns: `repeat(${unisexSizes.length}, minmax(1.55rem, 1fr))` }}
          >
            {unisexSizes.map((size) => (
              <div key={`h-공-${size}`} className="oqm-apparel-grid__size oqm-apparel-grid__size--unisex">
                {size}
              </div>
            ))}
            {unisexSizes.map((size) => (
              <div key={`in-공-${size}`} className="oqm-apparel-grid__cell">
                <input
                  className="oqm-input oqm-input--qty oqm-input--qty-mtx"
                  {...numberInputProps(qtyByKey[`공용|${size}`] ?? "")}
                  onChange={(e) => onChange(`공용|${size}`, e.target.value)}
                  aria-label={`공용 ${size} 수량`}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="oqm-quick-total-row oqm-quick-total-row--tight">
        <p className="oqm-quick-total oqm-quick-total--tight" role="status" aria-label={`총 합계 ${total.toLocaleString()}`}>
          총 합계: {total.toLocaleString()}
        </p>
        <button
          type="button"
          className="btn btn-secondary oqm-btn-clear-quantities"
          onClick={onClearAllQuantities}
          aria-label="입력한 수량 전부 삭제"
        >
          수량 전체 삭제
        </button>
      </div>
    </div>
  );
}

function TrainingSetMatrix({
  profile,
  qtyByKey,
  onChange,
  onClearAllQuantities,
}: {
  profile: CategoryProfile;
  qtyByKey: Record<string, string>;
  onChange: (id: string, value: string) => void;
  onClearAllQuantities: () => void;
}) {
  const femaleSizes = profile.femaleSizes;
  const maleSizes = profile.maleSizes;
  const total =
    femaleSizes.reduce((sum, size) => sum + parseQty(qtyByKey[`여|${size}`] ?? ""), 0) +
    maleSizes.reduce((sum, size) => sum + parseQty(qtyByKey[`남|${size}`] ?? ""), 0);

  if (femaleSizes.length === 0 && maleSizes.length === 0) {
    return (
      <div className="oqm-matrix-wrap">
        <p className="oqm-muted">선택한 범위에 남/여 사이즈가 없어 입력란을 표시할 수 없습니다.</p>
      </div>
    );
  }

  const colFemale =
    femaleSizes.length > 0
      ? `max-content repeat(${femaleSizes.length}, minmax(1.55rem, 1fr))`
      : "";
  const colMale =
    maleSizes.length > 0 ? `max-content repeat(${maleSizes.length}, minmax(1.55rem, 1fr))` : "";

  return (
    <div className="oqm-matrix-wrap oqm-matrix-wrap--compact">
      <div className="oqm-apparel-matrix">
        {femaleSizes.length > 0 ? (
          <div className="oqm-apparel-block">
            <div className="oqm-apparel-scroll" role="group" aria-label="여성 수량(세트)">
              <div className="oqm-apparel-grid" style={{ gridTemplateColumns: colFemale }}>
                <div className="oqm-apparel-grid__role">여성</div>
                {femaleSizes.map((size) => (
                  <div key={`tr-h-여-${size}`} className="oqm-apparel-grid__size">
                    {size}
                  </div>
                ))}
                <div className="oqm-apparel-grid__qty-lab">수량</div>
                {femaleSizes.map((size) => (
                  <div key={`tr-in-여-${size}`} className="oqm-apparel-grid__cell">
                    <input
                      className="oqm-input oqm-input--qty oqm-input--qty-mtx"
                      {...numberInputProps(qtyByKey[`여|${size}`] ?? "")}
                      onChange={(e) => onChange(`여|${size}`, e.target.value)}
                      aria-label={`여성 ${size} 수량`}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
        {maleSizes.length > 0 ? (
          <div className="oqm-apparel-block">
            <div className="oqm-apparel-scroll" role="group" aria-label="남성 수량(세트)">
              <div className="oqm-apparel-grid" style={{ gridTemplateColumns: colMale }}>
                <div className="oqm-apparel-grid__role">남성</div>
                {maleSizes.map((size) => (
                  <div key={`tr-h-남-${size}`} className="oqm-apparel-grid__size">
                    {size}
                  </div>
                ))}
                <div className="oqm-apparel-grid__qty-lab">수량</div>
                {maleSizes.map((size) => (
                  <div key={`tr-in-남-${size}`} className="oqm-apparel-grid__cell">
                    <input
                      className="oqm-input oqm-input--qty oqm-input--qty-mtx"
                      {...numberInputProps(qtyByKey[`남|${size}`] ?? "")}
                      onChange={(e) => onChange(`남|${size}`, e.target.value)}
                      aria-label={`남성 ${size} 수량`}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>
      <div className="oqm-quick-total-row oqm-quick-total-row--tight">
        <p className="oqm-quick-total oqm-quick-total--tight" role="status">
          세트 총합: {total.toLocaleString()}
        </p>
        <button
          type="button"
          className="btn btn-secondary oqm-btn-clear-quantities"
          onClick={onClearAllQuantities}
          aria-label="입력한 수량 전부 삭제"
        >
          수량 전체 삭제
        </button>
      </div>
    </div>
  );
}

function GeneralQuickPanel({
  suggestionPreview,
  entries,
  onQuantityChange,
  onCategoryChange,
  onAdd,
  onClearAllQuantities,
}: {
  /** 자동완성·힌트용 (의류 DB 카테고리 전체가 아님) */
  suggestionPreview: string[];
  entries: QuickEntry[];
  onQuantityChange: (index: number, value: string) => void;
  onCategoryChange: (index: number, value: string) => void;
  onAdd: () => void;
  onClearAllQuantities: () => void;
}) {
  return (
    <div className="oqm-matrix-wrap">
      <div className="oqm-general-header" aria-hidden="true">
        <span>물품</span>
        <span>수량</span>
      </div>
      <ul className="oqm-general-list">
        {entries.map((e, idx) => (
          <li key={`general-${idx}`} className="oqm-general-item">
            <input
              className="oqm-input"
              list="oqm-general-item-suggestions"
              value={e.id}
              onChange={(ev) => onCategoryChange(idx, ev.target.value)}
              placeholder="물품명"
              aria-label={`물품 ${idx + 1}`}
            />
            <input
              className="oqm-input oqm-input--qty"
              {...numberInputProps(e.quantity)}
              onChange={(ev) => onQuantityChange(idx, ev.target.value)}
              placeholder="수량"
              aria-label={`${e.id} 수량`}
            />
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn-secondary oqm-btn-tool" onClick={onAdd}>
        품목 1줄 추가
      </button>
      {suggestionPreview.length > 0 ? (
        <p className="oqm-muted oqm-general-hint">참고 물품명: {suggestionPreview.slice(0, 8).join(", ")}</p>
      ) : null}
      <div className="oqm-quick-total-row">
        <p className="oqm-quick-total">총 합계: {quickTotal(entries).toLocaleString()}</p>
        <button
          type="button"
          className="btn btn-secondary oqm-btn-clear-quantities"
          onClick={onClearAllQuantities}
          aria-label="입력한 수량 전부 삭제"
        >
          수량 전체 삭제
        </button>
      </div>
    </div>
  );
}

function oqmCompactShortageSummary(result: ProductMatchResult): string {
  const lines = result.details.filter((d) => d.shortage > 0);
  if (lines.length === 0) return "";
  const parts = lines.map((d) => {
    const segs = d.dimensionSummary.split("·").map((s) => s.trim()).filter(Boolean);
    const shortLabel = segs.length >= 2 ? segs.slice(-2).join(" ") : (segs[0] ?? d.dimensionSummary);
    return `${shortLabel} -${d.shortage}`;
  });
  const first = parts.slice(0, 3).join(", ");
  const more = parts.length > 3 ? ` · 외 ${parts.length - 3}` : "";
  return `부족: ${first}${more}`;
}

function OqmProductThumb({ url, name }: { url: string | null | undefined; name: string }) {
  const [broke, setBroke] = useState(false);
  const useImg = url && !broke;
  return (
    <div className="oqm-result-thumb" aria-hidden>
      {useImg ? (
        <img
          src={url!}
          alt=""
          className="oqm-result-thumb__img"
          width={66}
          height={66}
          onError={() => setBroke(true)}
          loading="lazy"
        />
      ) : (
        <div className="oqm-result-thumb__ph" title={name} />
      )}
    </div>
  );
}

function ResultCards({
  items,
  productImageById,
}: {
  items: ProductMatchResult[];
  productImageById: Record<string, string | null>;
}) {
  const [sheetResult, setSheetResult] = useState<ProductMatchResult | null>(null);
  return (
    <>
      {items.length === 0 ? (
        <p className="oqm-muted oqm-result-empty">표시할 주문이 없습니다. 행을 추가하고 수량을 입력하세요.</p>
      ) : (
        <ul className="oqm-result-list" role="list">
          {items.map((item) => (
            <li key={item.productId} className="oqm-result-list__li">
              <OqmResultRow
                result={item}
                imageUrl={productImageById[item.productId] ?? null}
                onOpenDetail={() => setSheetResult(item)}
              />
            </li>
          ))}
        </ul>
      )}
      {sheetResult ? (
        <OqmResultDetailSheet
          result={sheetResult}
          imageUrl={productImageById[sheetResult.productId] ?? null}
          onClose={() => setSheetResult(null)}
        />
      ) : null}
    </>
  );
}

function oqmResultRowClass(status: MatchStatus): string {
  if (status === "full") return "oqm-result-row oqm-result-row--full";
  if (status === "partial") return "oqm-result-row oqm-result-row--partial";
  return "oqm-result-row oqm-result-row--impossible";
}

function OqmResultRow({
  result,
  imageUrl,
  onOpenDetail,
}: {
  result: ProductMatchResult;
  imageUrl: string | null;
  onOpenDetail: () => void;
}) {
  const domId = resultCardDomIdByProduct(result);
  const shortageText = oqmCompactShortageSummary(result);
  const hasShort = result.status !== "full" && shortageText;
  return (
    <button
      type="button"
      id={domId}
      className={oqmResultRowClass(result.status)}
      onClick={onOpenDetail}
    >
      <OqmProductThumb url={imageUrl} name={result.displayName} />
      <div className="oqm-result-row__body">
        <span className="oqm-result-row__title">{result.displayName}</span>
        <span className="oqm-result-row__sku">품번 {result.sku}</span>
        {hasShort ? (
          <span
            className={
              result.status === "impossible" ? "oqm-result-row__short oqm-result-row__short--bad" : "oqm-result-row__short"
            }
          >
            {shortageText}
          </span>
        ) : null}
      </div>
      <span className={`oqm-result-row__badge ${statusClass(result.status)}`}>{statusLabel(result.status)}</span>
    </button>
  );
}

function OqmResultDetailSheet({
  result,
  imageUrl,
  onClose,
}: {
  result: ProductMatchResult;
  imageUrl: string | null;
  onClose: () => void;
}) {
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );
  useEffect(() => {
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onKey]);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="oqm-detail-sheet" role="dialog" aria-modal="true" aria-labelledby="oqm-detail-sheet-title">
      <button type="button" className="oqm-detail-sheet__backdrop" aria-label="닫기" onClick={onClose} />
      <div className="oqm-detail-sheet__panel">
        <div className="oqm-detail-sheet__head">
          <h3 id="oqm-detail-sheet-title" className="oqm-detail-sheet__title">
            {result.displayName}
          </h3>
          <button type="button" className="oqm-detail-sheet__close" onClick={onClose} aria-label="상세 닫기">
            ×
          </button>
        </div>
        <div className="oqm-detail-sheet__image-wrap">
          {imageUrl ? (
            <img
              className="oqm-detail-sheet__image"
              src={imageUrl}
              alt={result.displayName}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <div className="oqm-detail-sheet__image-ph" aria-hidden />
          )}
        </div>
        <p className="oqm-detail-sheet__sku">품번 {result.sku}</p>
        <p>
          <span className={statusClass(result.status)}>{statusLabel(result.status)}</span>
        </p>
        {result.status !== "full" ? (
          <div className="oqm-detail-sheet__detail-block">
            <h4 className="oqm-detail-sheet__sub">부족·재고</h4>
            <OqmShortageListInSheet details={result.details} status={result.status} />
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}

function OqmShortageListInSheet({
  details,
  status,
}: {
  details: ProductMatchResult["details"];
  status: MatchStatus;
}) {
  const lines = details.filter((d) => d.shortage > 0);
  if (lines.length === 0) {
    return <p className="oqm-muted oqm-shortage-empty">부족 없음(상태: {statusLabel(status)})</p>;
  }
  return (
    <ul className="oqm-shortage-list oqm-shortage-list--sheet">
      {lines.map((d) => (
        <li key={d.matchKey}>
          <span className="oqm-shortage-list__dim">{d.dimensionSummary}</span>
          <span className="oqm-shortage-list__nums">
            재고 {d.availableStock.toLocaleString()} — 부족 <strong className="oqm-num-warn">{d.shortage.toLocaleString()}</strong>
          </span>
        </li>
      ))}
    </ul>
  );
}
