const STORAGE_KEY = "transaction-statement-saved-lists-v1";

export type SavedTransactionListItemRow = {
  name: string;
  spec: string;
  qty: string;
  unit: string;
  unitPrice: string;
  note: string;
  isExtra: boolean;
};

export type SavedTransactionListSnapshot = {
  customerName: string;
  customerBizNo: string;
  customerRepresentative: string;
  customerAddress: string;
  customerBusinessType: string;
  customerBusinessItem: string;
  issueDate: string;
  tradeDate: string;
  estimateManagerName: string;
  estimateManagerPhone: string;
  estimateTotalNote: string;
  estimateFooterMemo: string;
  items: SavedTransactionListItemRow[];
};

export type SavedTransactionListEntry = {
  id: string;
  /** 상호/클럽(거래명세서) 또는 행사명(견적서 저장 시) */
  name: string;
  savedAt: string;
  documentType: "statement" | "estimate";
  snapshot: SavedTransactionListSnapshot;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseEntries(raw: unknown): SavedTransactionListEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: SavedTransactionListEntry[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const id = typeof item.id === "string" ? item.id : "";
    const name = typeof item.name === "string" ? item.name : "";
    const savedAt = typeof item.savedAt === "string" ? item.savedAt : "";
    const documentType = item.documentType === "estimate" ? "estimate" : "statement";
    const snapshot = item.snapshot;
    if (!id || !savedAt || !isRecord(snapshot) || !Array.isArray(snapshot.items)) continue;
    entries.push({
      id,
      name,
      savedAt,
      documentType,
      snapshot: {
        customerName: typeof snapshot.customerName === "string" ? snapshot.customerName : "",
        customerBizNo: typeof snapshot.customerBizNo === "string" ? snapshot.customerBizNo : "",
        customerRepresentative:
          typeof snapshot.customerRepresentative === "string" ? snapshot.customerRepresentative : "",
        customerAddress: typeof snapshot.customerAddress === "string" ? snapshot.customerAddress : "",
        customerBusinessType:
          typeof snapshot.customerBusinessType === "string" ? snapshot.customerBusinessType : "",
        customerBusinessItem:
          typeof snapshot.customerBusinessItem === "string" ? snapshot.customerBusinessItem : "",
        issueDate: typeof snapshot.issueDate === "string" ? snapshot.issueDate : "",
        tradeDate: typeof snapshot.tradeDate === "string" ? snapshot.tradeDate : "",
        estimateManagerName:
          typeof snapshot.estimateManagerName === "string" ? snapshot.estimateManagerName : "",
        estimateManagerPhone:
          typeof snapshot.estimateManagerPhone === "string" ? snapshot.estimateManagerPhone : "",
        estimateTotalNote: typeof snapshot.estimateTotalNote === "string" ? snapshot.estimateTotalNote : "",
        estimateFooterMemo:
          typeof snapshot.estimateFooterMemo === "string" ? snapshot.estimateFooterMemo : "",
        items: snapshot.items
          .filter(isRecord)
          .map((row) => ({
            name: typeof row.name === "string" ? row.name : "",
            spec: typeof row.spec === "string" ? row.spec : "",
            qty: typeof row.qty === "string" ? row.qty : "",
            unit: typeof row.unit === "string" ? row.unit : "개",
            unitPrice: typeof row.unitPrice === "string" ? row.unitPrice : "",
            note: typeof row.note === "string" ? row.note : "",
            isExtra: Boolean(row.isExtra),
          })),
      },
    });
  }
  return entries;
}

export function loadSavedTransactionLists(): SavedTransactionListEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return parseEntries(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

export function persistSavedTransactionLists(entries: SavedTransactionListEntry[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export function deleteSavedTransactionList(id: string): SavedTransactionListEntry[] {
  const next = loadSavedTransactionLists().filter((entry) => entry.id !== id);
  persistSavedTransactionLists(next);
  return next;
}

export function formatSavedListDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${h}:${min}`;
}
