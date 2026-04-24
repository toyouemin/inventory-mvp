import type { ParsePiece, ParseStatus } from "./types";

const GENDER_RULES: Array<{ re: RegExp; value: "남" | "여" | "공용" }> = [
  { re: /\b(남|남자|남성|MALE|MAN)\b/i, value: "남" },
  { re: /\b(여|여자|여성|FEMALE|WOMAN)\b/i, value: "여" },
  { re: /\b(공용|UNISEX)\b/i, value: "공용" },
];

const NUMERIC_SIZES = new Set(["80", "85", "90", "95", "100", "105", "110", "115", "120"]);
const ALPHA_SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "FREE"] as const;
const ALPHA_RE = /\b(4XL|3XL|2XL|XL|XS|FREE|S|M|L)\b/i;
const QTY_RE = /(\d{1,4})\s*(장|개|EA|PCS)?\b/i;
const NUM_RE = /\b(80|85|90|95|100|105|110|115|120)\b/;

export function preprocessCell(value: string | null | undefined): string {
  if (!value) return "";
  return String(value)
    .replace(/\r?\n/g, " ")
    .replace(/[()]/g, " ")
    .replace(/[,_]/g, " ")
    .replace(/[/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function normalizeGender(raw: string | null | undefined): "남" | "여" | "공용" | undefined {
  const s = preprocessCell(raw);
  if (!s) return undefined;
  for (const rule of GENDER_RULES) {
    if (rule.re.test(s)) return rule.value;
  }
  return undefined;
}

export function extractSizeGenderQty(raw: string | null | undefined): ParsePiece {
  const s = preprocessCell(raw);
  if (!s) {
    return { confidence: 0, reason: "빈 값", status: "unresolved" };
  }

  const gender = normalizeGender(s);
  const numSize = s.match(NUM_RE)?.[1];
  const alphaSize = s.match(ALPHA_RE)?.[1]?.toUpperCase();
  const qtyHit = s.match(QTY_RE)?.[1];
  const qty = qtyHit ? Number(qtyHit) : undefined;

  const sizeCandidates = [numSize, alphaSize].filter(Boolean) as string[];
  const uniqueSizes = new Set(sizeCandidates);
  const size = sizeCandidates[0];

  const hasAmbiguousMixed = Boolean(numSize && alphaSize);
  const normalizedSize = size ? normalizeSize(size) : undefined;
  const validSize = normalizedSize && (NUMERIC_SIZES.has(normalizedSize) || ALPHA_SIZES.includes(normalizedSize as never));

  if (hasAmbiguousMixed || uniqueSizes.size > 1) {
    return {
      gender,
      size: normalizedSize,
      qty,
      confidence: 0.35,
      reason: "혼합 사이즈 표기",
      status: "needs_review",
    };
  }

  if (!validSize && !gender && qty === undefined) {
    return { confidence: 0.15, reason: "유효 토큰 미검출", status: "unresolved" };
  }

  if (validSize && (gender || qty !== undefined)) {
    return {
      gender,
      size: normalizedSize,
      qty,
      confidence: 0.92,
      reason: "사이즈/성별/수량 분리 성공",
      status: "auto_confirmed",
    };
  }

  if (validSize) {
    return {
      size: normalizedSize,
      gender,
      qty,
      confidence: 0.84,
      reason: "사이즈 추출 성공",
      status: "auto_confirmed",
    };
  }

  return {
    gender,
    size: normalizedSize,
    qty,
    confidence: 0.52,
    reason: "부분 추출, 검토 필요",
    status: "needs_review",
  };
}

export function normalizeSize(raw: string | null | undefined): string | undefined {
  const s = preprocessCell(raw);
  if (!s) return undefined;
  if (NUMERIC_SIZES.has(s)) return s;

  if (s === "XXL") return "2XL";
  if (s === "XXXL") return "3XL";
  if (s === "XXXXL") return "4XL";
  if (ALPHA_SIZES.includes(s as never)) return s;

  return undefined;
}

export function parseQty(raw: string | null | undefined): number | undefined {
  const s = preprocessCell(raw);
  if (!s) return undefined;
  const m = s.match(QTY_RE);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * item 열 "주문내용" 텍스트를 개별 주문 토막으로 나눕니다(슬래시, 쉼표, 줄바꿈).
 */
export function splitOrderItemSegments(itemText: string | null | undefined): string[] {
  if (itemText == null) return [];
  return String(itemText)
    .split(/(?:\r\n|\r|\n|[/／]|[,，])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const ALPHA_SIZE_TOKEN = String.raw`4XL|3XL|2XL|XXL|XXXL|XXXXL|XL|XS|FREE|L|M|S`;
const RE_ALPHA_SIZE_QTY = new RegExp(
  `^\\s*(${ALPHA_SIZE_TOKEN})\\s+(\\d{1,4})\\s*(?:장|개|EA|PCS)?\\s*$`,
  "i"
);
const RE_GENDER_NUMSIZE_QTY = /^\s*(남|여|공용)\s*([0-9]{2,3})\s+(\d{1,4})\s*(?:장|개|EA|PCS)?\s*$/i;
const RE_NUM_NUM = /^\s*([0-9]{2,3})\s+(\d{1,4})\s*(?:장|개|EA|PCS)?\s*$/;
const RE_GENDER_ALPHA_QTY = new RegExp(
  `^\\s*(남|여|공용)\\s*(${ALPHA_SIZE_TOKEN})\\s+(\\d{1,4})\\s*(?:장|개|EA|PCS)?\\s*$`,
  "i"
);

/**
 * unknown 구조 · 수동 item 텍스트 파싱용: 토막 한 덩이에서 사이즈/성별/수량을 판정합니다.
 */
export function parseManualItemOrderSegment(raw: string | null | undefined): ParsePiece {
  const t = String(raw ?? "").trim();
  if (!t) {
    return { confidence: 0, reason: "빈 토막", status: "unresolved" as ParseStatus };
  }

  let m = t.match(RE_GENDER_NUMSIZE_QTY);
  if (m) {
    const g = m[1] as string;
    const sizeNorm = normalizeSize(m[2]);
    const q = Number(m[3]);
    const gNorm: "남" | "여" | "공용" = g === "남" ? "남" : g === "여" ? "여" : "공용";
    if (sizeNorm && NUMERIC_SIZES.has(sizeNorm) && Number.isFinite(q) && q > 0) {
      return {
        gender: gNorm,
        size: sizeNorm,
        qty: q,
        confidence: 0.94,
        reason: "수동: 성별+숫자사이즈+수량",
        status: "auto_confirmed",
      };
    }
  }

  m = t.match(RE_GENDER_ALPHA_QTY);
  if (m) {
    const g = m[1] as string;
    const rawSize = m[2];
    const q = Number(m[3]);
    const sizeNorm = normalizeSize(rawSize);
    const gNorm: "남" | "여" | "공용" = g === "남" ? "남" : g === "여" ? "여" : "공용";
    if (sizeNorm && (NUMERIC_SIZES.has(sizeNorm) || (ALPHA_SIZES as readonly string[]).includes(sizeNorm)) && Number.isFinite(q) && q > 0) {
      return {
        gender: gNorm,
        size: sizeNorm,
        qty: q,
        confidence: 0.9,
        reason: "수동: 성별+알파사이즈+수량",
        status: "auto_confirmed",
      };
    }
  }

  m = t.match(RE_ALPHA_SIZE_QTY);
  if (m) {
    const rawSize = m[1];
    const q = Number(m[2]);
    const sizeNorm = normalizeSize(rawSize);
    if (sizeNorm && (NUMERIC_SIZES.has(sizeNorm) || (ALPHA_SIZES as readonly string[]).includes(sizeNorm)) && Number.isFinite(q) && q > 0) {
      return { size: sizeNorm, qty: q, confidence: 0.9, reason: "수동: 알파사이즈+수량", status: "auto_confirmed" };
    }
  }

  m = t.match(RE_NUM_NUM);
  if (m) {
    const a = m[1];
    const b = m[2];
    const sizeNorm = normalizeSize(a);
    const q = Number(b);
    if (sizeNorm && NUMERIC_SIZES.has(sizeNorm) && Number.isFinite(q) && q > 0) {
      if (q > 200) {
        return {
          size: sizeNorm,
          qty: q,
          confidence: 0.4,
          reason: "수량이 비정상적으로 큼(검토)",
          status: "needs_review",
        };
      }
      return { size: sizeNorm, qty: q, confidence: 0.9, reason: "수동: 숫자사이즈+수량", status: "auto_confirmed" };
    }
  }

  return extractSizeGenderQty(t);
}

