export type PartyInfo = {
  name: string;
  bizNo?: string;
  representative?: string;
  address?: string;
  contact?: string;
  businessType?: string;
  businessItem?: string;
};

export type TransactionStatementItem = {
  month: number | null;
  day: number | null;
  name: string;
  spec: string;
  qty: number;
  unitPrice: number;
  amount: number;
  note: string;
};

export type TransactionStatementData = {
  supplier: PartyInfo;
  customer: PartyInfo;
  issueDate: string;
  items: TransactionStatementItem[];
  totalAmount: number;
  totalQty: number;
  footerMemo?: string;
  /** false면 엑셀에서 공급가액·세액 칸을 비움(화면 부가세 표시 토글과 동일) */
  showVatIncluded?: boolean;
};

export type TransactionStatementOrderInput = {
  supplier?: Partial<PartyInfo>;
  customer?: Partial<PartyInfo>;
  issueDate?: string;
  notes?: string;
  lines?: Array<{
    date?: string;
    name?: string;
    spec?: string;
    qty?: number | string | null;
    unitPrice?: number | string | null;
    amount?: number | string | null;
    note?: string;
  }>;
};

export type TransactionStatementRequestBody = {
  statement?: Partial<TransactionStatementData>;
  order?: TransactionStatementOrderInput;
};
