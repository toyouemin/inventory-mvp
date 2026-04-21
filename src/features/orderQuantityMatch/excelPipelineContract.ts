/**
 * ## 엑셀 사이즈 추출기 ↔ 매칭 엔진 연결 계약
 *
 * 1. **단일 진입점**: `matchOrderRowsToStock(requestRows, stockLines)`의 `requestRows`는 항상 `RequestLineInput[]`이다.
 * 2. **수동 UI**: 화면의 각 행을 `toRequestLineInput(...)` 형태로 바꾼 것과 동일 구조다(이미 `OrderQuantityMatchClient`가 그렇게 전달).
 * 3. **엑셀 파이프라인(향후)**: 시트 → 파싱 → (category, garmentType, gender, size, quantity, bundleKey) 추출 후
 *    행마다 `rowId`만 부여하면 된다. 비즈니스 차원은 `normalizeRequestLine`이 `DimensionValues`로 정규화한다.
 * 4. **재고 측 garmentType**: DB에 없을 때는 `keyword_inference`로 임시 채우고, 엑셀/수동 보정은
 *    `normalizeProductCatalogToStockLines(..., { garmentTypeOverrideByProductId })`로 덮어쓴다.
 * 5. **행 ID**: 엑셀 행마다 안정적인 `rowId`(파일 내 고유)를 부여하면 FCFS 할당 순서를 재현할 수 있다.
 * 6. **일반 물품(사이즈 없음) 임시 매핑**: 현재 엔진 키에 `size`가 포함되므로, 빠른 입력 UI는 물품명을
 *    `RequestLineInput.size`에 넣어 구분한다. 이는 임시 우회이며, 추후 `itemName` 등 별도 필드가 생기면
 *    어댑터 계층에서 교체한다(엔진 계약은 유지 가능).
 *
 * 이 파일은 런타임 의존성을 추가하지 않는다(문서·타입 재수출용). 실제 변환 헬퍼는 `toRequestLineInput.ts`.
 */
export type { RequestLineInput } from "./types";
