export type NormalizedSizeMeta = {
  normalized: string;
  corrected: boolean;
  recoverable: boolean;
  reason?: string;
};

function normalizeCore(rawInput: string): { normalized: string; corrected: boolean; recoverable: boolean; reason?: string } {
  const trimmed = (rawInput ?? "").trim();
  if (!trimmed) return { normalized: "", corrected: false, recoverable: true };

  // Option-like values are preserved as-is.
  // Only standard size patterns are normalized in a limited way.
  if (/^[mMwW]/.test(trimmed)) {
    const m = /^([mMwW])\D*(\d+)(?:\D.*)?$/.exec(trimmed);
    if (!m) return { normalized: trimmed, corrected: false, recoverable: true };
    const normalized = `${m[1].toUpperCase()}${m[2]}`;
    return { normalized, corrected: normalized !== trimmed, recoverable: true, reason: "normalized_standard_prefixed_size" };
  }

  if (/^\d+$/.test(trimmed)) {
    return { normalized: trimmed, corrected: false, recoverable: true };
  }

  if (/^(xs|s|m|l|xl|xxl|xxxl|free|os)$/i.test(trimmed)) {
    const normalized = trimmed.toUpperCase();
    return { normalized, corrected: normalized !== trimmed, recoverable: true, reason: "normalized_standard_text_size" };
  }

  return { normalized: trimmed, corrected: false, recoverable: true, reason: "option_value_preserved" };
}

export function normalizeSize(size: string): string {
  return normalizeCore(size).normalized;
}

export function normalizeSizeWithMeta(size: string): NormalizedSizeMeta {
  const r = normalizeCore(size);
  return {
    normalized: r.normalized,
    corrected: r.corrected,
    recoverable: r.recoverable,
    reason: r.reason,
  };
}

function extractTerminalSizeToken(input: string): string {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return "";
  const parts = trimmed
    .split("/")
    .map((x) => x.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : trimmed;
}

function parseForSort(size: string): { prefixOrder: number; numberPart: number; text: string } {
  const terminal = extractTerminalSizeToken(size);
  const normalized = normalizeSize(terminal || size);
  if (!normalized) {
    return { prefixOrder: 999, numberPart: Number.POSITIVE_INFINITY, text: "" };
  }
  const standardTextSizeOrder: Record<string, number> = {
    XS: 0,
    S: 1,
    M: 2,
    L: 3,
    XL: 4,
    XXL: 5,
    XXXL: 6,
    "2XL": 5,
    "3XL": 6,
    "4XL": 7,
    FREE: 100,
    OS: 101,
  };
  const textOrder = standardTextSizeOrder[normalized];
  if (textOrder !== undefined) {
    return { prefixOrder: 0, numberPart: textOrder, text: normalized };
  }
  const m = /^([WM])\D*(\d+)(?:\D.*)?$/.exec(normalized);
  if (m) {
    const prefixOrder = m[1] === "W" ? 1 : 2;
    return { prefixOrder, numberPart: Number.parseInt(m[2], 10), text: normalized };
  }
  // 공용/UNISEX 사이즈 (예: 공용90, 공용100, 공용 105)
  const uni = /^(공용|UNISEX)\D*(\d+)(?:\D.*)?$/i.exec(normalized);
  if (uni) {
    return { prefixOrder: 3, numberPart: Number.parseInt(uni[2], 10), text: normalized };
  }
  if (/^\d+$/.test(normalized)) {
    return { prefixOrder: 3, numberPart: Number.parseInt(normalized, 10), text: normalized };
  }
  return { prefixOrder: 999, numberPart: Number.POSITIVE_INFINITY, text: normalized };
}

export function sortSizes(a: string, b: string): number {
  const pa = parseForSort(a);
  const pb = parseForSort(b);
  if (pa.prefixOrder !== pb.prefixOrder) return pa.prefixOrder - pb.prefixOrder;
  if (pa.numberPart !== pb.numberPart) return pa.numberPart - pb.numberPart;
  return pa.text.localeCompare(pb.text);
}
