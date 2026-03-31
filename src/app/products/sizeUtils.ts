export type NormalizedSizeMeta = {
  normalized: string;
  corrected: boolean;
  recoverable: boolean;
  reason?: string;
};

function extractPrefix(raw: string): { prefix: "W" | "M"; corrected: boolean; recoverable: boolean; reason?: string } {
  const direct = raw.match(/[WM]/);
  if (direct) {
    const prefix = direct[0] as "W" | "M";
    const corrected = !(raw.startsWith(prefix) && raw.slice(0, 1) === prefix);
    return { prefix, corrected, recoverable: true };
  }
  return { prefix: "M", corrected: true, recoverable: false, reason: "prefix_not_found_defaulted_to_M" };
}

function extractNumber(raw: string): { numberText: string; corrected: boolean; recoverable: boolean; reason?: string } {
  const m = raw.match(/(\d+)/);
  if (m) {
    return { numberText: m[1], corrected: false, recoverable: true };
  }
  return { numberText: "0", corrected: true, recoverable: false, reason: "number_not_found_defaulted_to_0" };
}

export function normalizeSize(size: string): string {
  const raw = (size ?? "").replace(/\s+/g, "").toUpperCase();
  if (!raw) return "";

  const prefixInfo = extractPrefix(raw);
  const numberInfo = extractNumber(raw);
  return `${prefixInfo.prefix}${numberInfo.numberText}`;
}

export function normalizeSizeWithMeta(size: string): NormalizedSizeMeta {
  const raw = (size ?? "").replace(/\s+/g, "").toUpperCase();
  if (!raw) return { normalized: "", corrected: false, recoverable: true };

  const prefixInfo = extractPrefix(raw);
  const numberInfo = extractNumber(raw);
  const normalized = `${prefixInfo.prefix}${numberInfo.numberText}`;
  const corrected = raw !== normalized || prefixInfo.corrected || numberInfo.corrected;
  const recoverable = prefixInfo.recoverable && numberInfo.recoverable;
  const reason = !recoverable ? [prefixInfo.reason, numberInfo.reason].filter(Boolean).join(",") : undefined;
  return { normalized, corrected, recoverable, reason };
}

function parseForSort(size: string): { prefixOrder: number; numberPart: number; text: string } {
  const normalized = normalizeSize(size);
  if (!normalized) {
    return { prefixOrder: 999, numberPart: Number.POSITIVE_INFINITY, text: "" };
  }
  const m = /^([WM])(\d+)$/.exec(normalized);
  if (!m) {
    return { prefixOrder: 999, numberPart: Number.POSITIVE_INFINITY, text: normalized };
  }
  const prefixOrder = m[1] === "W" ? 0 : 1;
  return { prefixOrder, numberPart: Number.parseInt(m[2], 10), text: normalized };
}

export function sortSizes(a: string, b: string): number {
  const pa = parseForSort(a);
  const pb = parseForSort(b);
  if (pa.prefixOrder !== pb.prefixOrder) return pa.prefixOrder - pb.prefixOrder;
  if (pa.numberPart !== pb.numberPart) return pa.numberPart - pb.numberPart;
  return pa.text.localeCompare(pb.text);
}
