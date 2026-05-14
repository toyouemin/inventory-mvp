export type DevSourceItem = {
  label: string;
  description?: string;
  file: string;
  keywords?: string[];
};

export type DevSourcePageKey =
  | "products"
  | "sizeAnalysis"
  | "estimate"
  | "transactionStatement"
  | "inventory"
  | "orderMatching";

export const DEV_SOURCE_MAP: Record<DevSourcePageKey, DevSourceItem[]> = {
  products: [
    {
      label: "상품 목록 화면",
      description: "상품 리스트, 카드/리스트 전환, 필터, 업로드 메뉴의 시작점",
      file: "src/app/products/ProductsClient.tsx",
      keywords: ["상품", "목록", "카드", "리스트", "업로드 메뉴"],
    },
    {
      label: "상품 페이지 서버 진입점",
      description: "상품/옵션 조회, 정렬, 클라이언트 전달 데이터 구성",
      file: "src/app/products/page.tsx",
      keywords: ["서버 진입점", "조회", "정렬"],
    },
    {
      label: "상품 카드 UI",
      description: "모바일 카드형 상품 표시, 재고/가격/메모 노출",
      file: "src/app/products/ProductCard.tsx",
      keywords: ["상품 카드", "모바일", "재고"],
    },
    {
      label: "상품 서버 액션",
      description: "상품 저장, 수정, 삭제, CSV 업로드 처리",
      file: "src/app/products/actions.ts",
      keywords: ["상품 저장", "수정", "삭제", "CSV 업로드"],
    },
    {
      label: "CSV 파이프라인",
      description: "CSV 컬럼 매핑, 정규화, 업로드 전처리 로직",
      file: "src/app/products/csvProductPipeline.ts",
      keywords: ["CSV", "컬럼 매핑", "정규화"],
    },
    {
      label: "이미지 포함 엑셀 다운로드(클라이언트)",
      description: "전역 진행 안내·취소(Abort), 상품 메뉴에서 재고/가격 xlsx 받기 연결",
      file: "src/app/ProductImageExcelDownloadProvider.tsx",
      keywords: ["이미지 포함", "엑셀", "다운로드", "취소", "토스트"],
    },
    {
      label: "이미지 포함 재고 엑셀(서버)",
      description: "ExcelJS 시트·썸네일 fetch·oneCell+ext 앵커, 이미지 시트 생성",
      file: "src/app/products/xlsx/productStockExcelJsSheets.ts",
      keywords: ["이미지 포함", "재고", "xlsx", "ExcelJS", "시트"],
    },
    {
      label: "엑셀용 상품 이미지 썸네일",
      description: "이미지 URL 정규화, sharp JPEG, 행 높이·앵커 픽셀 계산",
      file: "src/app/products/xlsx/productStockExcelImageFetch.ts",
      keywords: ["썸네일", "sharp", "이미지", "엑셀", "앵커"],
    },
    {
      label: "이미지 포함 재고 xlsx API",
      description: "GET 응답으로 통합 문서 스트림(일반 시트+이미지 시트)",
      file: "src/app/products/xlsx/products/with-images/route.ts",
      keywords: ["이미지 포함", "재고", "API", "xlsx"],
    },
    {
      label: "이미지 포함 가격 xlsx API",
      description: "가격표+이미지 시트 통합 엑셀",
      file: "src/app/products/xlsx/price-list/with-images/route.ts",
      keywords: ["이미지 포함", "가격", "가격표", "API", "xlsx"],
    },
    {
      label: "엑셀 drawing OOXML 보정",
      description: "ExcelJS가 쓴 잘못된 oneCellAnchor editAs 제거 후 ZIP 재압축",
      file: "src/lib/excelXlsxStripInvalidOneCellEditAs.ts",
      keywords: ["drawing", "OOXML", "xlsx", "복구", "이미지"],
    },
  ],

  sizeAnalysis: [
    {
      label: "사이즈 분석 메인 화면",
      description: "업로드, 단계 진행, 결과 요약, 상태 필터, 전체 화면 구성",
      file: "src/features/sizeAnalysis/ui/SizeAnalysisPage.tsx",
      keywords: ["사이즈 분석", "결과 요약", "상태 필터", "범위외 사이즈"],
    },
    {
      label: "클럽별 집계 공통 로직",
      description: "전체/중복/중복제외 수량 집계 기준",
      file: "src/features/sizeAnalysis/clubSizeAggModes.ts",
      keywords: ["집계", "중복 수량", "전체 수량", "중복 제외"],
    },
    {
      label: "범위외 사이즈 UI 기준",
      description: "범위 밖 사이즈 표시/도움 필터 기준",
      file: "src/features/sizeAnalysis/uiOutsideAllowedSizes.ts",
      keywords: ["범위외 사이즈", "사이즈 확인", "필터"],
    },
    {
      label: "엑셀 다운로드",
      description: "사이즈 분석 결과 엑셀 시트, 색상, 컬럼 폭, 정렬, 클럽별 집계",
      file: "src/features/sizeAnalysis/exportSizeAnalysisXlsx.ts",
      keywords: ["엑셀", "다운로드", "클럽별 집계", "색상", "컬럼 폭"],
    },
    {
      label: "사이즈 분석 요약 API",
      description: "결과 요약 숫자, 검토필요, 미분류, 수정완료, 집계 수량",
      file: "src/app/api/size-analysis/[jobId]/summary/route.ts",
      keywords: ["요약", "검토필요", "미분류", "수정완료"],
    },
  ],

  estimate: [
    {
      label: "견적서 화면",
      description: "견적서 입력 화면, 미리보기, JPG 저장 흐름의 시작점",
      file: "src/app/transaction-statement/page.tsx",
      keywords: ["견적서", "미리보기", "JPG", "품목"],
    },
    {
      label: "견적서 엑셀(도장 이미지)",
      description: "ExcelJS 출력, 도장 삽입 시 drawing OOXML 보정(strip) 포함",
      file: "src/features/transactionStatement/exportEstimateExcel.ts",
      keywords: ["견적서", "엑셀", "도장", "drawing"],
    },
    {
      label: "견적서 출력 템플릿",
      description: "견적서 출력 레이아웃, 테이블, 공급자/비고 영역 구성",
      file: "src/features/transactionStatement/EstimateSheet.tsx",
      keywords: ["견적서 템플릿", "테이블", "비고"],
    },
    {
      label: "견적서 스타일",
      description: "견적서 테이블 선, 컬럼 폭, 공급자 영역, 비고 영역 스타일",
      file: "src/app/globals.css",
      keywords: ["견적서 스타일", "테이블 선", "비고", "공급자"],
    },
  ],

  transactionStatement: [
    {
      label: "거래명세서 화면",
      description: "거래명세서 입력, 품목 리스트, 출력 화면 구성",
      file: "src/app/transaction-statement/page.tsx",
      keywords: ["거래명세서", "품목", "출력"],
    },
    {
      label: "거래명세서 요약 패널",
      description: "거래 요약 패널, 품목표, 합계/부가세 표시 UI",
      file: "src/features/transactionStatement/TransactionStatementScreenPanel.tsx",
      keywords: ["요약 패널", "품목표", "합계"],
    },
    {
      label: "거래명세서 스타일",
      description: "거래명세서 테이블 폭, 정렬, 컬럼 스타일",
      file: "src/features/transactionStatement/TransactionStatementScreenPanel.module.css",
      keywords: ["거래명세서 스타일", "컬럼 폭", "정렬"],
    },
  ],

  inventory: [
    {
      label: "재고 현황 페이지 진입점",
      description: "재고현황 데이터 조회, 카테고리 정렬, 클라이언트 전달",
      file: "src/app/status/page.tsx",
      keywords: ["재고현황", "조회", "정렬"],
    },
    {
      label: "재고 현황 화면",
      description: "재고 테이블, 필터, 화면 상호작용 UI",
      file: "src/app/status/StatusClient.tsx",
      keywords: ["재고 테이블", "필터", "UI"],
    },
    {
      label: "카테고리 정렬 유틸",
      description: "카테고리 병합/정렬 기준 로직",
      file: "src/app/products/categorySortOrder.utils.ts",
      keywords: ["카테고리 정렬", "정렬 기준"],
    },
  ],

  orderMatching: [
    {
      label: "주문수량 매칭 페이지 진입점",
      description: "매칭 화면 데이터 로딩과 서버 스냅샷 전달",
      file: "src/app/order-quantity-match/page.tsx",
      keywords: ["주문수량매칭", "데이터 로딩"],
    },
    {
      label: "주문수량 매칭 메인 화면",
      description: "매칭 분석 UI, 입력/결과 패널 구성",
      file: "src/app/order-quantity-match/OrderQuantityMatchClient.tsx",
      keywords: ["매칭", "분석 UI", "결과"],
    },
    {
      label: "매칭용 재고 로딩",
      description: "상품/옵션 재고를 매칭 포맷으로 로드",
      file: "src/app/order-quantity-match/inventoryForMatch.server.ts",
      keywords: ["재고 로딩", "서버", "스냅샷"],
    },
    {
      label: "재고 정규화 로직",
      description: "상품 카탈로그를 매칭용 재고 라인으로 변환",
      file: "src/features/orderQuantityMatch/normalizeInventory.ts",
      keywords: ["정규화", "재고 라인", "매칭"],
    },
  ],
};
