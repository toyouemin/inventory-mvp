export const TRANSACTION_STATEMENT_TEMPLATE_RELATIVE_PATH = "public/templates/transaction.xlsx";

export const transactionStatementTemplateMap = {
  // 템플릿 실시트명
  sheetName: "명세서",

  // 공급자/공급받는자 영역은 병합셀이라 반드시 병합 시작 셀(대표셀)만 사용한다.
  supplier: {
    // 상호명: E5:J6 병합의 시작 셀
    name: "E5",
    // 사업자번호: E3:P4 병합의 시작 셀
    bizNo: "E3",
  },
  customer: {
    // 상호명: U5:Y6 병합의 시작 셀
    name: "U5",
    // 사업자번호: U3:AE4 병합의 시작 셀
    bizNo: "U3",
    // 성명: AB5:AE6 병합의 시작 셀
    representative: "AB5",
    // 사업장주소: U7:AE8 병합의 시작 셀
    address: "U7",
    // 업태: U9:X10 병합의 시작 셀
    businessType: "U9",
    // 종목: AA9:AE10 병합의 시작 셀
    businessItem: "AA9",
  },
  issueDate: {
    // 거래일자 입력칸: A2:F2 병합(실양식은 월/일 분리칸이 아닌 통합 날짜칸)
    cell: "A2",
  },
  items: {
    // 품목 입력 가능 구간: 14행 ~ 20행 (총 7행)
    startRow: 14,
    maxRows: 7,
    columns: {
      // 월/일
      month: "A",
      day: "B",
      // 품목명: C:M 병합 시작 열
      name: "C",
      // 규격: N:P 병합 시작 열
      spec: "N",
      // 수량: Q:S 병합 시작 열
      qty: "Q",
      // 단가: T:W 병합 시작 열
      unitPrice: "T",
      // 금액: X:AB 병합 시작 열
      amount: "X",
      // 비고: AC:AE 병합 시작 열
      note: "AC",
    },
  },
  totals: {
    // 총수량: C21:E22 병합 시작 셀
    totalQty: "C21",
    // 상단 합계금액 한글 표기: F11:O12 병합 시작 셀
    amountKoreanText: "F11",
    // 상단 괄호 안 합계금액(숫자): S11:Y12 병합 시작 셀
    amountInParentheses: "S11",
    // 하단 공급가액: H21:K22 병합 시작 셀
    supplyAmount: "H21",
    // 하단 세액: N21:P22 병합 시작 셀
    taxAmount: "N21",
    // 하단 합계금액: T21:Y22 병합 시작 셀
    totalAmount: "T21",
    // 현재 템플릿에는 footerMemo 전용 빈 입력칸이 없음
    footerMemo: null,
  },
} as const;

export type TransactionStatementTemplateMap = typeof transactionStatementTemplateMap;
