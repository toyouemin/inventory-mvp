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
  if (/^[mMwW]\s*\d+$/.test(trimmed)) {
    const m = /^([mMwW])\s*(\d+)$/.exec(trimmed);
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
