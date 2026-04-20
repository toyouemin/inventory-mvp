import type {
  PartyInfo,
  TransactionStatementData,
  TransactionStatementItem,
  TransactionStatementOrderInput,
  TransactionStatementRequestBody,
} from "./types";

function toNumberOrZero(value: number | string | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const n = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function parseMonthDay(value: string | undefined): { month: number | null; day: number | null } {
  if (!value) return { month: null, day: null };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { month: null, day: null };
  return { month: date.getMonth() + 1, day: date.getDate() };
}

function normalizePartyInfo(input?: Partial<PartyInfo>): PartyInfo {
  return {
    name: (input?.name ?? "").trim(),
    bizNo: (input?.bizNo ?? "").trim(),
    representative: (input?.representative ?? "").trim(),
    address: (input?.address ?? "").trim(),
    contact: (input?.contact ?? "").trim(),
    businessType: (input?.businessType ?? "").trim(),
    businessItem: (input?.businessItem ?? "").trim(),
  };
}

function fromOrderInput(order: TransactionStatementOrderInput): TransactionStatementData {
  const issueDate = order.issueDate ?? new Date().toISOString().slice(0, 10);
  const items: TransactionStatementItem[] = (order.lines ?? []).map((line) => {
    const qty = toNumberOrZero(line.qty);
    const unitPrice = toNumberOrZero(line.unitPrice);
    const amountFromInput = toNumberOrZero(line.amount);
    const amount = amountFromInput > 0 ? amountFromInput : qty * unitPrice;
    const { month, day } = parseMonthDay(line.date ?? issueDate);

    return {
      month,
      day,
      name: (line.name ?? "").trim(),
      spec: (line.spec ?? "").trim(),
      qty,
      unitPrice,
      amount,
      note: (line.note ?? "").trim(),
    };
  });

  const totalQty = items.reduce((sum, item) => sum + item.qty, 0);
  const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);

  return {
    supplier: normalizePartyInfo(order.supplier),
    customer: normalizePartyInfo(order.customer),
    issueDate,
    items,
    totalAmount,
    totalQty,
    footerMemo: (order.notes ?? "").trim(),
    showVatIncluded: true,
  };
}

function fromStatementInput(statement: Partial<TransactionStatementData>): TransactionStatementData {
  const issueDate = statement.issueDate ?? new Date().toISOString().slice(0, 10);
  const items: TransactionStatementItem[] = (statement.items ?? []).map((item) => {
    const qty = toNumberOrZero(item.qty);
    const unitPrice = toNumberOrZero(item.unitPrice);
    const amount = toNumberOrZero(item.amount) || qty * unitPrice;
    return {
      month: item.month ?? null,
      day: item.day ?? null,
      name: (item.name ?? "").trim(),
      spec: (item.spec ?? "").trim(),
      qty,
      unitPrice,
      amount,
      note: (item.note ?? "").trim(),
    };
  });
  const totalQty = statement.totalQty ?? items.reduce((sum, item) => sum + item.qty, 0);
  const totalAmount = statement.totalAmount ?? items.reduce((sum, item) => sum + item.amount, 0);

  return {
    supplier: normalizePartyInfo(statement.supplier),
    customer: normalizePartyInfo(statement.customer),
    issueDate,
    items,
    totalQty,
    totalAmount,
    footerMemo: (statement.footerMemo ?? "").trim(),
    showVatIncluded: statement.showVatIncluded ?? true,
  };
}

function validateData(data: TransactionStatementData): TransactionStatementData {
  if (!data.supplier.name) throw new Error("공급자명(supplier.name)은 필수입니다.");
  if (!data.customer.name) throw new Error("공급받는자명(customer.name)은 필수입니다.");
  if (data.items.length === 0) throw new Error("품목(items)은 최소 1개 이상이어야 합니다.");
  return data;
}

export function buildTransactionStatementData(body: TransactionStatementRequestBody): TransactionStatementData {
  if (body.statement) return validateData(fromStatementInput(body.statement));
  if (body.order) return validateData(fromOrderInput(body.order));
  throw new Error("요청 본문에 statement 또는 order 데이터가 필요합니다.");
}
