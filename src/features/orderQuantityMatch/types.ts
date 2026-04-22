/**
 * 주문 수량 매칭 — 공통 타입.
 * 의류 MVP는 동일 스키마를 쓰되, 차원 정의는 레지스트리로 분리해 확장한다.
 *
 * ── 레이어 계약(읽기 전용 분석) ──
 * - 이 디렉터리 전체는 기존 재고관리·상품/옵션 CRUD·업로드 파이프라인과 분리된 **계산 전용** 레이어다.
 * - 기존 DB 테이블을 변경하지 않으며, 매칭 결과는 메모리·UI상의 계산값으로만 취급한다.
 * - 향후 스냅샷/히스토리 저장이 필요하면 `products` / `product_variants`와 **별도** 스키마를 사용한다.
 */

/** 차원 값은 정규화된 문자열(빈 문자열 = 미기재) */
export type DimensionValues = Record<string, string>;

export type GarmentTypeId = "single" | "top" | "bottom";

export type MatchStatus = "full" | "partial" | "impossible";

/** 재고 측 garmentType 출처·신뢰도(키워드 추론은 임시값) */
export type GarmentTypeInferenceMeta = {
  source: "keyword_inference" | "override" | "category_policy";
  confidence: "high" | "ambiguous" | "defaulted";
  matchedRuleIds: string[];
  competingGarmentTypes?: GarmentTypeId[];
};

export type NormalizedStockLine = {
  productId: string;
  sku: string;
  displayName: string;
  dimensions: DimensionValues;
  stock: number;
  /** 키워드·카테고리 정책(`category_policy`)·수동(override) 메타. 없으면 구버전 데이터로 간주 */
  garmentTypeInference?: GarmentTypeInferenceMeta;
};

/**
 * 매칭 엔진 표준 입력 한 행.
 * 수동 UI·엑셀 정규화 파이프라인 모두 이 형태로 끝나면 `matchOrderRowsToStock(rows, stockLines)`에 그대로 넣을 수 있다.
 * 예: 단품 `{ rowId, category:"티셔츠", garmentType:"top", gender:"남", size:"M", quantity:24, bundleKey:"" }`,
 * 세트는 `bundleKey` 동일 + `garmentType`을 상의/하의로 나눈 행 2개 이상.
 */
export type RequestLineInput = {
  rowId: string;
  category: string;
  garmentType: GarmentTypeId;
  gender: string;
  size: string;
  quantity: number;
  /** 비우면 단품 행. 동일 키면 트레이복 등 세트로 묶음 */
  bundleKey: string;
};

export type NormalizedDemandLine = {
  rowId: string;
  bundleKey: string | null;
  quantity: number;
  dimensions: DimensionValues;
  /** UI/결과용 요약 라벨 */
  summaryLabel: string;
};

export type LineShortageDetail = {
  matchKey: string;
  dimensionSummary: string;
  requested: number;
  allocated: number;
  shortage: number;
  availableStock: number;
};

export type RowMatchResult = {
  rowId: string;
  bundleKey: string | null;
  summaryLabel: string;
  garmentType: GarmentTypeId;
  status: MatchStatus;
  totalRequested: number;
  totalAllocated: number;
  totalShortage: number;
  details: LineShortageDetail[];
};

export type BundleMatchResult = {
  bundleKey: string;
  rowResults: RowMatchResult[];
  status: MatchStatus;
  totalRequested: number;
  totalAllocated: number;
  totalShortage: number;
};

export type MatchReport = {
  standaloneRows: RowMatchResult[];
  bundles: BundleMatchResult[];
  /** 표시 순서용 평탄화(번들은 한 블록으로) */
  displayItems: DisplayMatchItem[];
};

export type DisplayMatchItem =
  | { kind: "standalone"; result: RowMatchResult }
  | { kind: "bundle"; result: BundleMatchResult };
