"use client";

/**
 * 주문 입력·매칭 결과 UI. 상태는 이 컴포넌트 내부에만 두며,
 * 기존 상품/재고 API를 호출하지 않고 props로 받은 스냅샷에 대해 메모리상 계산만 한다.
 */

import { useEffect, useMemo, useState } from "react";
import type { GarmentTypeId, MatchStatus, NormalizedStockLine, RequestLineInput } from "@/features/orderQuantityMatch/types";
import {
  CATEGORY_PROFILES,
  type SizePolicy,
  type StockScopeType,
  UNISEX_ALPHA_SIZES,
  UNISEX_NUMERIC_SIZES,
  getSavedCategoryPolicyStore,
  inferSizePolicy,
  inferStockScopeType,
  linesForCategoryPolicyInference,
  normalizeSizeByPolicy,
  parseGenderAndSize,
  resolveCategorySizePolicy,
  saveCategoryPolicyStore,
} from "@/features/orderQuantityMatch/categoryPolicy";
import { matchOrderRowsToProducts, type ProductMatchResult } from "@/features/orderQuantityMatch/matchOrderToProducts";
import { normalizeRequestLine } from "@/features/orderQuantityMatch/normalizeRequest";

const IS_DEV = process.env.NODE_ENV === "development";
const GENERAL_ITEM_PRESETS = ["라켓", "가방"] as const;
const CATEGORY_FALLBACK_PRESETS = [
  "티셔츠",
  "바람막이",
  "후드",
  "트레이닝복",
  "라켓",
  "가방",
  "기타 사이즈 없음",
] as const;
const SIZE_CATEGORY_FALLBACK_PRESETS = ["티셔츠", "바람막이", "맨투맨", "오버핏", "트레이닝복", "7부바지"] as const;

function safeScrollDomIdSegment(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return `h${Math.abs(h)}`;
}

/** 결과 카드·TOP3 이동에 공통으로 사용 (상품 기준) */
function resultCardDomIdByProduct(result: ProductMatchResult): string {
  return `oqm-card-product-${safeScrollDomIdSegment(result.productId)}`;
}

function scrollToResultCardByProduct(result: ProductMatchResult): void {
  const id = resultCardDomIdByProduct(result);
  const el = typeof document !== "undefined" ? document.getElementById(id) : null;
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
  el?.focus?.();
}

function newRowId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `row-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

type ApparelSizeType = "unisex" | "genderSplit";

type QuickEntry = {
  id: string;
  quantity: string;
};

type QuickCategoryKind = "apparel" | "training" | "general";

type CategoryProfile = {
  stockScopeType: StockScopeType;
  sizePolicy: SizePolicy;
  needsPolicyChoice: boolean;
  recommendedPolicy: SizePolicy | null;
  unisexSizes: string[];
  unisexAlphaSizes: string[];
  femaleSizes: string[];
  maleSizes: string[];
  generalItems: string[];
  hasUnisexData: boolean;
  hasGenderSplitData: boolean;
};

const FALLBACK_NUMERIC = ["85", "90", "95", "100", "105", "110", "115"] as const;
const FALLBACK_ALPHA = ["S", "M", "L", "XL", "2XL", "3XL", "4XL"] as const;
const FALLBACK_FEMALE = ["85", "90", "95", "100", "105"] as const;
const FALLBACK_MALE = ["95", "100", "105", "110", "115"] as const;
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

function normalizeSizeToken(raw: string): string {
  const t = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!t) return "";
  if (t.startsWith("공용")) return t.replace(/^공용/, "");
  return t;
}

function isRecognizedSizeToken(raw: string): boolean {
  const original = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!original) return false;

  // 허용 접두: 공용/여/남 (예: 공용95, 여85, 남S)
  let body = original;
  if (body.startsWith("공용")) body = body.slice(2);
  else if (body.startsWith("여") || body.startsWith("남")) body = body.slice(1);
  if (!body) return false;

  // 숫자 사이즈: 85, 90, 95, 100, 105, 110, 115, ...
  if (/^\d{2,3}$/.test(body)) return true;

  // 영문 사이즈: S, M, L, XL, XXL, 2XL, 3XL, 4XL...
  if (/^(XXS|XS|S|M|L|XL|XXL|XXXL|XXXXL|[2-9]XL)$/.test(body)) return true;

  return false;
}

function isAlphaSize(raw: string): boolean {
  const t = normalizeSizeToken(raw);
  return ALPHA_SIZE_RANK.has(t);
}

function compareSize(a: string, b: string): number {
  const na = normalizeSizeToken(a);
  const nb = normalizeSizeToken(b);
  const an = Number(na);
  const bn = Number(nb);
  if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
  const ar = ALPHA_SIZE_RANK.get(na);
  const br = ALPHA_SIZE_RANK.get(nb);
  if (ar != null && br != null) return ar - br;
  return na.localeCompare(nb, "ko", { numeric: true });
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))].sort(compareSize);
}

function numericSizeOrNull(raw: string): number | null {
  const t = normalizeSizeToken(raw);
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

function buildCategoryProfile(
  category: string,
  stockLines: NormalizedStockLine[],
  savedPolicyStore: Record<string, SizePolicy>
): CategoryProfile {
  const cat = category.trim();
  const lines = stockLines.filter((l) => (l.dimensions.category ?? "").trim() === cat);
  const inferRows = linesForCategoryPolicyInference(cat, stockLines);
  const recommendedPolicy = inferSizePolicy(inferRows);
  const resolvedPolicy = resolveCategorySizePolicy(cat, inferRows, savedPolicyStore);
  const sizePolicy: SizePolicy = resolvedPolicy ?? "custom";
  const preset = CATEGORY_PROFILES[cat];
  const needsPolicyChoice = !preset?.sizePolicy && !savedPolicyStore[cat] && resolvedPolicy == null;
  const stockScopeType = preset?.stockScopeType ?? inferStockScopeType(cat);

  const items = uniqueSorted(lines.map((l) => l.displayName || l.sku)).slice(0, 30);
  const parsedRows = lines.map((l) => {
    const parsed = parseGenderAndSize(`${l.dimensions.gender ?? ""}${l.dimensions.size ?? ""}`);
    const gender = (l.dimensions.gender ?? "").trim() || parsed.gender;
    const sizeRaw = (l.dimensions.size ?? "").trim() || parsed.size;
    return {
      gender,
      size: normalizeSizeByPolicy(sizePolicy, gender, sizeRaw),
    };
  });
  const femaleSizesRaw = uniqueSorted(parsedRows.filter((r) => r.gender === "여").map((r) => normalizeSizeToken(r.size)));
  const maleSizesRaw = uniqueSorted(parsedRows.filter((r) => r.gender === "남").map((r) => normalizeSizeToken(r.size)));
  const unisexSizesRaw = uniqueSorted(
    parsedRows
      .filter((r) => r.gender === "공용" || r.gender === "")
      .map((r) => normalizeSizeToken(r.size))
  );
  const hasGenderSplitData = femaleSizesRaw.length > 0 || maleSizesRaw.length > 0;
  const hasUnisexData = unisexSizesRaw.length > 0;

  return {
    stockScopeType,
    sizePolicy,
    needsPolicyChoice,
    recommendedPolicy,
    unisexSizes:
      sizePolicy === "unisexNumeric"
        ? [...UNISEX_NUMERIC_SIZES]
        : sizePolicy === "free"
          ? ["FREE"]
          : unisexSizesRaw.length > 0
            ? unisexSizesRaw
            : [...FALLBACK_NUMERIC],
    unisexAlphaSizes: sizePolicy === "unisexAlpha" ? [...UNISEX_ALPHA_SIZES] : unisexSizesRaw,
    femaleSizes:
      femaleSizesRaw.length > 0
        ? femaleSizesRaw
        : sizePolicy === "custom"
          ? [...TRAINING_FEMALE_BASE]
          : [...FALLBACK_FEMALE],
    maleSizes:
      maleSizesRaw.length > 0
        ? maleSizesRaw
        : sizePolicy === "custom"
          ? [...TRAINING_MALE_BASE]
          : [...FALLBACK_MALE],
    generalItems: items.length > 0 ? items : [...GENERAL_ITEM_PRESETS],
    hasUnisexData,
    hasGenderSplitData,
  };
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

function productTitle(result: ProductMatchResult): string {
  return `${result.displayName} / ${result.sku}`;
}

export function OrderQuantityMatchClient({
  categories,
  stockLines,
}: {
  categories: string[];
  stockLines: NormalizedStockLine[];
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
    () => buildCategoryProfile(quickCategory, quickStockScopeLines, savedPolicyStore),
    [quickCategory, quickStockScopeLines, savedPolicyStore]
  );
  const [apparelSizeType, setApparelSizeType] = useState<ApparelSizeType>("genderSplit");
  const [apparelQtyByKey, setApparelQtyByKey] = useState<Record<string, string>>({});
  const [trainingSetQtyByKey, setTrainingSetQtyByKey] = useState<Record<string, string>>({});
  const [generalEntries, setGeneralEntries] = useState<QuickEntry[]>(GENERAL_ITEM_PRESETS.map((name) => quickEntry(name)));
  /** 상단 카테고리 추천의 기본 소스: 기존 재고 상품(products.category) 고유값 */
  const inventoryCategorySuggestions = useMemo(
    () => [...new Set(categories.map((c) => c.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko")),
    [categories]
  );
  /** 보조 추천: 실제 카테고리가 비거나 너무 적을 때만 합침 */
  const categorySuggestions = useMemo(() => {
    if (inventoryCategorySuggestions.length >= 3) return inventoryCategorySuggestions;
    const merged = new Set<string>(inventoryCategorySuggestions);
    for (const p of CATEGORY_FALLBACK_PRESETS) merged.add(p);
    return [...merged].sort((a, b) => a.localeCompare(b, "ko"));
  }, [inventoryCategorySuggestions]);
  /** 빠른 입력 첫 카테고리: 사이즈 입력이 가능한 카테고리만 노출 */
  const sizedCategorySuggestions = useMemo(() => {
    const sizedFromStock = new Set(
      stockLines
        .filter((l) => isRecognizedSizeToken(l.dimensions.size ?? ""))
        .map((l) => (l.dimensions.category ?? "").trim())
        .filter(Boolean)
    );
    // 트레이닝복은 운영상 필요 시 size 누락 데이터에서도 선택 가능하도록 예외 유지
    if (inventoryCategorySuggestions.includes("트레이닝복")) sizedFromStock.add("트레이닝복");

    if (sizedFromStock.size >= 3) return [...sizedFromStock].sort((a, b) => a.localeCompare(b, "ko"));
    const merged = new Set<string>(sizedFromStock);
    for (const p of SIZE_CATEGORY_FALLBACK_PRESETS) merged.add(p);
    return [...merged].sort((a, b) => a.localeCompare(b, "ko"));
  }, [inventoryCategorySuggestions, stockLines]);

  const displayedCategory = quickCategory;
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
  const selectedProductScopeLabels = useMemo(
    () =>
      quickProductScopeIds
        .map((id) => quickScopeProductOptions.find((o) => o.productId === id)?.label)
        .filter((v): v is string => Boolean(v)),
    [quickProductScopeIds, quickScopeProductOptions]
  );
  const displayedProductScopeLabel = useMemo(() => {
    if (quickProductScopeIds.length === 0) return "전체";
    if (selectedProductScopeLabels.length === 1) return selectedProductScopeLabels[0]!;
    return `${selectedProductScopeLabels.length}개 선택`;
  }, [quickProductScopeIds, selectedProductScopeLabels]);
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

  const generalItemsKey = useMemo(() => categoryProfile.generalItems.join("\x1f"), [categoryProfile.generalItems]);
  useEffect(() => {
    if (quickCategoryKind !== "general") return;
    const items = categoryProfile.generalItems.length > 0 ? categoryProfile.generalItems : [...GENERAL_ITEM_PRESETS];
    setGeneralEntries(items.map((name) => quickEntry(name)));
  }, [quickCategory, quickCategoryKind, generalItemsKey]);

  const quickRequestInputs = useMemo(() => {
    const out: RequestLineInput[] = [];
    if (quickCategoryKind === "apparel") {
      if (apparelSizeType === "genderSplit") {
        for (const size of categoryProfile.femaleSizes) {
          const qty = parseQty(apparelQtyByKey[`여|${size}`] ?? "");
          if (qty <= 0) continue;
          out.push(
            buildRequestRow({
              category: quickCategory.trim() || "의류",
              garmentType: apparelGarmentType,
              gender: "여",
              size,
              quantity: qty,
              bundleKey: "",
            })
          );
        }
        for (const size of categoryProfile.maleSizes) {
          const qty = parseQty(apparelQtyByKey[`남|${size}`] ?? "");
          if (qty <= 0) continue;
          out.push(
            buildRequestRow({
              category: quickCategory.trim() || "의류",
              garmentType: apparelGarmentType,
              gender: "남",
              size,
              quantity: qty,
              bundleKey: "",
            })
          );
        }
      } else {
        for (const size of activeApparelSizes) {
          const qty = parseQty(apparelQtyByKey[`공용|${size}`] ?? "");
          if (qty <= 0) continue;
          out.push(
            buildRequestRow({
              category: quickCategory.trim() || "의류",
              garmentType: apparelGarmentType,
              gender: "공용",
              size,
              quantity: qty,
              bundleKey: "",
            })
          );
        }
      }
      return out;
    }

    if (quickCategoryKind === "training") {
      for (const size of categoryProfile.femaleSizes) {
        const qty = parseQty(trainingSetQtyByKey[`여|${size}`] ?? "");
        if (qty <= 0) continue;
        const bundleKey = `SET-여-${size}`;
        out.push(
          buildRequestRow({
            category: quickCategory.trim() || "트레이닝복",
            garmentType: "single",
            gender: "여",
            size,
            quantity: qty,
            bundleKey,
          })
        );
      }
      for (const size of categoryProfile.maleSizes) {
        const qty = parseQty(trainingSetQtyByKey[`남|${size}`] ?? "");
        if (qty <= 0) continue;
        const bundleKey = `SET-남-${size}`;
        out.push(
          buildRequestRow({
            category: quickCategory.trim() || "트레이닝복",
            garmentType: "single",
            gender: "남",
            size,
            quantity: qty,
            bundleKey,
          })
        );
      }
      return out;
    }

    for (const entry of generalEntries) {
      const qty = parseQty(entry.quantity);
        if (qty <= 0) continue;
      /**
       * [임시 매핑 - 일반 물품]
       * 엔진 계약이 (category,type,gender,size) 고정이라, 사이즈 없는 물품명은 `size` 슬롯에 담아 구분한다.
       * - category: 상단 선택 카테고리
       * - size: 개별 물품명(예: 라켓/가방 세부명)
       *
       * 확장 시점:
       * - 엑셀/문서 추출에 일반 물품 전용 필드(itemName 등)를 도입하면
       *   어댑터 단계에서 이 매핑을 교체한다. 엔진 계약은 그대로 유지 가능.
       */
      out.push(
        buildRequestRow({
          category: quickCategory.trim() || "기타 사이즈 없음",
          garmentType: "single",
          gender: "",
          size: entry.id,
          quantity: qty,
          bundleKey: "",
        })
      );
    }
    return out;
  }, [
    activeApparelSizes,
    apparelQtyByKey,
    apparelSizeType,
    categoryProfile.femaleSizes,
    categoryProfile.maleSizes,
    generalEntries,
    apparelGarmentType,
    quickCategory,
    quickCategoryKind,
    trainingSetQtyByKey,
  ]);

  const requestInputs = quickRequestInputs;
  const scopedStockLines = useMemo(() => {
    if (!quickCategory.trim()) return [];
    return quickStockScopeLines;
  }, [quickCategory, quickStockScopeLines]);
  const productResults = useMemo(
    () => matchOrderRowsToProducts(requestInputs, scopedStockLines),
    [requestInputs, scopedStockLines]
  );

  const matchSummary = useMemo(() => {
    let full = 0;
    let partial = 0;
    let impossible = 0;
    for (const it of productResults) {
      const s = it.status;
      if (s === "full") full += 1;
      else if (s === "partial") partial += 1;
      else impossible += 1;
    }
    const nonFull = productResults
      .filter((it) => it.status !== "full")
      .map((it) => ({
        item: it,
        scrollKey: resultCardDomIdByProduct(it),
        label: productTitle(it),
        totalShortage: it.totalShortage,
        totalAllocated: it.totalAllocated,
      }))
      .sort((a, b) => {
        if (a.totalShortage !== b.totalShortage) return a.totalShortage - b.totalShortage;
        return b.totalAllocated - a.totalAllocated;
      })
      .slice(0, 3);
    return { full, partial, impossible, closest: nonFull };
  }, [productResults]);

  const debugSnapshots = useMemo(() => {
    const normalizedRequest = requestInputs.map((r) => normalizeRequestLine(r));
    const stockSummary = {
      lineCount: scopedStockLines.length,
      sampleLines: scopedStockLines.slice(0, 20),
    };
    return {
      rawRequestJson: JSON.stringify(requestInputs, null, 2),
      normalizedRequestJson: JSON.stringify(normalizedRequest, null, 2),
      stockSummaryJson: JSON.stringify(stockSummary, null, 2),
    };
  }, [requestInputs, scopedStockLines]);

  return (
    <div className="products-page oqm-page">
      <div className="products-content-container">
        <header className="oqm-page-head">
          <h1 className="oqm-page-title">주문 수량 매칭</h1>
        </header>

        <section className="oqm-section">

          <datalist id="oqm-category-suggestions">
            {categorySuggestions.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>

          <QuickInputPanel
            categories={sizedCategorySuggestions}
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
          />

          <p className="oqm-input-summary">
            현재 입력 생성 행 수: <strong>{requestInputs.length.toLocaleString()}</strong> · 대상 카테고리:{" "}
            <strong>{displayedCategory || "-"}</strong>
            {quickCategory.trim() !== "" ? (
              <>
                {" "}
                · 매칭 재고 범위(품목명): <strong>{displayedProductScopeLabel}</strong>
              </>
            ) : null}
          </p>
        </section>

        <section className="oqm-summary-strip" aria-label="매칭 요약">
          <div className="oqm-summary-strip__grid">
            <div className="oqm-stat oqm-stat--ok">
              <span className="oqm-stat__label">완전 가능</span>
              <span className="oqm-stat__value">{matchSummary.full}건</span>
            </div>
            <div className="oqm-stat oqm-stat--partial">
              <span className="oqm-stat__label">부분 가능</span>
              <span className="oqm-stat__value">{matchSummary.partial}건</span>
            </div>
            <div className="oqm-stat oqm-stat--bad">
              <span className="oqm-stat__label">불가</span>
              <span className="oqm-stat__value">{matchSummary.impossible}건</span>
            </div>
          </div>
          <div className="oqm-summary-closest">
            <span className="oqm-summary-closest__title">가장 근접한 상품 TOP 3</span>
            <span className="oqm-summary-closest__hint">(완전 가능 제외 · 부족 합 적은 순)</span>
            {matchSummary.closest.length === 0 ? (
              <p className="oqm-muted oqm-summary-closest__empty">완전 가능만 있거나, 표시할 주문이 없습니다.</p>
            ) : (
              <ul className="oqm-closest-list">
                {matchSummary.closest.map((c, i) => (
                  <li key={`${c.scrollKey}-${i}`}>
                    <button type="button" className="oqm-closest-jump" onClick={() => scrollToResultCardByProduct(c.item)}>
                      <span className="oqm-closest-list__name">{c.label}</span>
                      <span className="oqm-closest-list__meta">
                        부족 합 {c.totalShortage.toLocaleString()} · 충족 {c.totalAllocated.toLocaleString()}
                        <span className="oqm-closest-jump__hint"> 결과로 이동</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="oqm-section" aria-labelledby="oqm-result-heading">
          <h2 id="oqm-result-heading" className="oqm-section-title">
            매칭 결과
          </h2>
          <p className="oqm-intro oqm-intro--small">
            정렬: <strong>완전 가능</strong> 우선 → 부족 총합 오름차순 → 부족 항목 수 오름차순 → 충족(할당) 많은 순.
          </p>
          <ResultCards items={productResults} />
        </section>

        {IS_DEV ? (
          <details className="oqm-debug-details">
            <summary className="oqm-debug-details__summary">개발용 · 요청/정규화/재고 스냅샷</summary>
            <div className="oqm-debug-details__body">
              <details className="oqm-debug-sub">
                <summary>raw request (RequestLineInput[])</summary>
                <pre className="oqm-debug-pre">{debugSnapshots.rawRequestJson}</pre>
              </details>
              <details className="oqm-debug-sub">
                <summary>normalized request (normalizeRequestLine)</summary>
                <pre className="oqm-debug-pre">{debugSnapshots.normalizedRequestJson}</pre>
              </details>
              <details className="oqm-debug-sub">
                <summary>normalized stock 요약 (앞 20줄)</summary>
                <pre className="oqm-debug-pre">{debugSnapshots.stockSummaryJson}</pre>
              </details>
            </div>
          </details>
        ) : null}
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
}) {
  const {
    categories,
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
  } = props;
  const selectedCategoryValue =
    quickCategory.trim() !== "" && categories.includes(quickCategory.trim()) ? quickCategory.trim() : "__custom__";
  const isCustomCategory = selectedCategoryValue === "__custom__";
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
                if (v === "__custom__") return;
                setQuickCategory(v);
              }}
            >
              <option value="__empty__">카테고리 선택</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <option value="__custom__">기타 직접입력</option>
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
        {isCustomCategory ? (
          <label className="oqm-field oqm-field--category-custom">
            <span className="oqm-field__label">직접입력</span>
            <input
              className="oqm-input"
              value={quickCategory}
              onChange={(e) => setQuickCategory(e.target.value)}
              placeholder="카테고리 직접입력"
            />
          </label>
        ) : null}
      </div>
      <p className="oqm-muted oqm-category-hint">
        재고 카테고리 추천 {categories.length}개
        {categories.length < 3 ? " (부족 시 보조 추천 포함)" : ""}
        {quickCategory.trim() !== "" && productScopeOptions.length > 0
          ? " · 품목명을 여러 개 선택하면 선택 범위 재고로만 매칭합니다. (미선택 시 전체)"
          : ""}
      </p>
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
          />
        </>
      ) : null}

      {quickCategoryKind === "general" ? (
        <GeneralQuickPanel
          categories={categories}
          entries={generalEntries}
            onQuantityChange={(index, value) =>
              setGeneralEntries(updateQuickEntriesByIndex(generalEntries, index, { quantity: value }))
            }
            onCategoryChange={(index, value) =>
              setGeneralEntries(updateQuickEntriesByIndex(generalEntries, index, { id: value }))
            }
            onAdd={() => setGeneralEntries([...generalEntries, quickEntry(`물품-${generalEntries.length + 1}`)])}
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
}: {
  apparelSizeType: ApparelSizeType;
  canShowUnisexInput: boolean;
  canShowGenderSplitInput: boolean;
  profile: CategoryProfile;
  qtyByKey: Record<string, string>;
  onChange: (id: string, value: string) => void;
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
    return (
      <div className="oqm-matrix-wrap">
        <div className="oqm-matrix-gender">
          {femaleSizes.map((size, idx) => {
            const male = maleSizes[idx] ?? maleSizes[maleSizes.length - 1] ?? "";
            return (
              <div key={size} className="oqm-gender-row">
                <label className="oqm-matrix-cell">
                  <span>여 {size}</span>
                  <input
                    className="oqm-input oqm-input--qty"
                    {...numberInputProps(qtyByKey[`여|${size}`] ?? "")}
                    onChange={(e) => onChange(`여|${size}`, e.target.value)}
                  />
                </label>
                <label className="oqm-matrix-cell">
                  <span>남 {male}</span>
                  <input
                    className="oqm-input oqm-input--qty"
                    {...numberInputProps(qtyByKey[`남|${male}`] ?? "")}
                    onChange={(e) => onChange(`남|${male}`, e.target.value)}
                  />
                </label>
              </div>
            );
          })}
        </div>
        <p className="oqm-quick-total">총 합계: {total.toLocaleString()}</p>
      </div>
    );
  }

  const sizeList = unisexSizes;
  const mid = Math.ceil(sizeList.length / 2);
  const leftSizes = sizeList.slice(0, mid);
  const rightSizes = sizeList.slice(mid);

  return (
    <div className="oqm-matrix-wrap">
      <div className="oqm-matrix-unisex oqm-matrix-unisex--cols-down">
        <div className="oqm-matrix-unisex-col">
          {leftSizes.map((size) => (
            <label key={size} className="oqm-matrix-cell oqm-matrix-cell--unisex-pair">
              <span>{profile.sizePolicy === "unisexNumeric" ? `공용${size}` : size}</span>
              <input
                className="oqm-input oqm-input--qty"
                {...numberInputProps(qtyByKey[`공용|${size}`] ?? "")}
                onChange={(e) => onChange(`공용|${size}`, e.target.value)}
              />
            </label>
          ))}
        </div>
        <div className="oqm-matrix-unisex-col">
          {rightSizes.map((size) => (
            <label key={size} className="oqm-matrix-cell oqm-matrix-cell--unisex-pair">
              <span>{profile.sizePolicy === "unisexNumeric" ? `공용${size}` : size}</span>
              <input
                className="oqm-input oqm-input--qty"
                {...numberInputProps(qtyByKey[`공용|${size}`] ?? "")}
                onChange={(e) => onChange(`공용|${size}`, e.target.value)}
              />
            </label>
          ))}
          <div className="oqm-matrix-total-inline" role="status" aria-label={`총 합계 ${total.toLocaleString()}`}>
            <span className="oqm-matrix-total-inline__label">총 합계</span>
            <span className="oqm-matrix-total-inline__value">{total.toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function TrainingSetMatrix({
  profile,
  qtyByKey,
  onChange,
}: {
  profile: CategoryProfile;
  qtyByKey: Record<string, string>;
  onChange: (id: string, value: string) => void;
}) {
  const femaleSizes = profile.femaleSizes;
  const maleSizes = profile.maleSizes;
  const rowCount = Math.max(femaleSizes.length, maleSizes.length);
  return (
    <div className="oqm-matrix-wrap">
      <div className="oqm-matrix-gender">
        {Array.from({ length: rowCount }).map((_, idx) => {
          const femaleSize = femaleSizes[idx] ?? "";
          const maleSize = maleSizes[idx] ?? "";
          return (
            <div key={`training-set-row-${idx}`} className="oqm-gender-row">
              <label className="oqm-matrix-cell">
                <span>{femaleSize ? `여 ${femaleSize}` : ""}</span>
                <input
                  className="oqm-input oqm-input--qty"
                  {...numberInputProps(femaleSize ? (qtyByKey[`여|${femaleSize}`] ?? "") : "")}
                  onChange={(e) => {
                    if (!femaleSize) return;
                    onChange(`여|${femaleSize}`, e.target.value);
                  }}
                  disabled={!femaleSize}
                />
              </label>
              <label className="oqm-matrix-cell">
                <span>{maleSize ? `남 ${maleSize}` : ""}</span>
                <input
                  className="oqm-input oqm-input--qty"
                  {...numberInputProps(maleSize ? (qtyByKey[`남|${maleSize}`] ?? "") : "")}
                  onChange={(e) => {
                    if (!maleSize) return;
                    onChange(`남|${maleSize}`, e.target.value);
                  }}
                  disabled={!maleSize}
                />
              </label>
            </div>
          );
        })}
      </div>
      <p className="oqm-quick-total">세트 총합: {Object.values(qtyByKey).reduce((s, v) => s + parseQty(v), 0).toLocaleString()}</p>
    </div>
  );
}

function GeneralQuickPanel({
  categories,
  entries,
  onQuantityChange,
  onCategoryChange,
  onAdd,
}: {
  categories: string[];
  entries: QuickEntry[];
  onQuantityChange: (index: number, value: string) => void;
  onCategoryChange: (index: number, value: string) => void;
  onAdd: () => void;
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
              list="oqm-category-suggestions"
              value={e.id}
              onChange={(ev) => onCategoryChange(idx, ev.target.value)}
              placeholder="카테고리"
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
      {categories.length > 0 ? <p className="oqm-muted oqm-general-hint">참고 카테고리: {categories.slice(0, 8).join(", ")}</p> : null}
      <p className="oqm-quick-total">총 합계: {quickTotal(entries).toLocaleString()}</p>
    </div>
  );
}

function ResultCards({ items }: { items: ProductMatchResult[] }) {
  if (items.length === 0) {
    return <p className="oqm-muted">표시할 주문이 없습니다. 행을 추가하고 수량을 입력하세요.</p>;
  }
  return (
    <div className="oqm-result-cards">
      {items.map((item) => (
        <ProductResultCard key={item.productId} result={item} />
      ))}
    </div>
  );
}

function cardStatusModifier(status: MatchStatus): string {
  if (status === "full") return "oqm-result-card--status-full";
  if (status === "partial") return "oqm-result-card--status-partial";
  return "oqm-result-card--status-impossible";
}

function ProductShortageCallout({
  details,
  title = "부족 사이즈 상세",
}: {
  details: ProductMatchResult["details"];
  title?: string;
}) {
  const has = details.some((d) => d.shortage > 0);
  if (!has) return null;
  return (
    <div className="oqm-shortage-callout" role="region" aria-label={title}>
      <h4 className="oqm-shortage-callout__title">{title}</h4>
      <ShortageList details={details} />
    </div>
  );
}

function ProductResultCard({ result }: { result: ProductMatchResult }) {
  const domId = resultCardDomIdByProduct(result);
  const hasShortage = result.totalShortage > 0;
  return (
    <article
      id={domId}
      tabIndex={-1}
      className={`oqm-result-card ${cardStatusModifier(result.status)}`}
    >
      <header className="oqm-result-card__head">
        <span className="oqm-result-card__kind">상품</span>
        <span className={statusClass(result.status)}>{statusLabel(result.status)}</span>
      </header>
      <h3 className="oqm-result-card__title">{result.displayName}</h3>
      <p className="oqm-result-card__bundle-hint">품번: {result.sku}</p>
      {hasShortage ? <ProductShortageCallout details={result.details} /> : null}
      <dl className="oqm-result-card__stats">
        <div>
          <dt>총 요청 수량</dt>
          <dd>{result.totalRequested.toLocaleString()}</dd>
        </div>
        <div>
          <dt>총 충족 수량</dt>
          <dd>{result.totalAllocated.toLocaleString()}</dd>
        </div>
        <div>
          <dt>총 부족 수량</dt>
          <dd className={result.totalShortage > 0 ? "oqm-num-warn" : ""}>{result.totalShortage.toLocaleString()}</dd>
        </div>
      </dl>
      {!hasShortage ? (
        <p className="oqm-muted oqm-result-card__no-short">부족 항목 없음</p>
      ) : null}
    </article>
  );
}

function ShortageList({ details }: { details: ProductMatchResult["details"] }) {
  const lines = details.filter((d) => d.shortage > 0);
  if (lines.length === 0) {
    return <p className="oqm-muted oqm-shortage-empty">없음</p>;
  }
  return (
    <ul className="oqm-shortage-list">
      {lines.map((d) => (
        <li key={d.matchKey}>
          <span className="oqm-shortage-list__dim">{d.dimensionSummary}</span>
          <span className="oqm-shortage-list__nums">
            재고 {d.availableStock.toLocaleString()} → 부족 <strong>{d.shortage.toLocaleString()}</strong>
          </span>
        </li>
      ))}
    </ul>
  );
}
