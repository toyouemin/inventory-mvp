import type { TransactionStatementRequestBody } from "./types";

export const transactionStatementSampleRequestBody: TransactionStatementRequestBody = {
  statement: {
    supplier: {
      name: "(주)세림통상",
      bizNo: "131-86-32310",
    },
    customer: {
      name: "샘플상사",
      bizNo: "123-45-67890",
    },
    issueDate: "2026-04-16",
    items: [
      {
        month: 4,
        day: 16,
        name: "아동 트레이닝 상의",
        spec: "블루 / 120",
        qty: 12,
        unitPrice: 18500,
        amount: 222000,
        note: "1차 출고",
      },
      {
        month: 4,
        day: 16,
        name: "아동 트레이닝 하의",
        spec: "블랙 / 130",
        qty: 7,
        unitPrice: 21000,
        amount: 147000,
        note: "묶음 배송",
      },
    ],
    totalQty: 19,
    totalAmount: 369000,
    footerMemo: "",
  },
};
