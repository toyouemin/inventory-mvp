const ALPHA_SIZE_ORDER = [
  "XXS",
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "2XL",
  "3XL",
  "4XL",
  "5XL",
  "6XL",
];

/** 긴 토큰을 먼저 두어 `2XL`이 `XL`로만 매칭되지 않게 함 */
const ALPHA_SUFFIX_PATTERN =
  /(6XL|5XL|4XL|3XL|2XL|XXS|XS|XL|L|M|S)$/;

/** `공용 S`, `남 2XL`, `여 XL` 등 공백 구분 문자열에서 영문 사이즈 토큰 추출 */
const ENGLISH_SIZE_TOKEN_REGEX = /\b(6XL|5XL|4XL|3XL|2XL|XXS|XS|XL|L|M|S)\b/i;

export function extractEnglishSizeToken(raw: string | null | undefined): string | null {
  if (raw == null || raw === "") return null;
  const normalized = String(raw).toUpperCase().replace(/\s+/g, " ");
  const m = normalized.match(ENGLISH_SIZE_TOKEN_REGEX);
  if (!m?.[1]) return null;
  return m[1].toUpperCase();
}

function alphaSizeRank(size: string): number {
  const idx = ALPHA_SIZE_ORDER.indexOf(size);
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

export function normalizeSizeText(raw: string | null | undefined): string {
  if (raw == null || raw === "") return "";
  return String(raw)
    .replace(/\s+/g, "")
    .replace(/공용|남성|여성|남자|여자|남|여/gi, "")
    .toUpperCase()
    .trim();
}

/** @deprecated 호환용 — `normalizeSizeText`와 동일 역할 */
export function normalizeWearSize(raw: unknown): string {
  if (raw == null) return "";
  return normalizeSizeText(String(raw));
}

export function extractNumericSize(raw: string | null | undefined): number | null {
  const text = normalizeSizeText(raw);
  const match = text.match(/(\d{2,3})/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

export function extractAlphaSize(raw: string | null | undefined): string {
  const text = normalizeSizeText(raw);

  const parenMatch = text.match(/\(([^)]+)\)/);
  if (parenMatch?.[1]) {
    const inner = parenMatch[1].trim().toUpperCase();
    const innerRank = alphaSizeRank(inner);
    if (innerRank !== Number.MAX_SAFE_INTEGER) return inner;
    const innerSuffix = inner.match(ALPHA_SUFFIX_PATTERN);
    if (innerSuffix?.[1]) return innerSuffix[1].toUpperCase();
    return inner;
  }

  const direct = text.match(ALPHA_SUFFIX_PATTERN);
  if (direct?.[1]) return direct[1].toUpperCase();

  const word = extractEnglishSizeToken(raw);
  if (word && alphaSizeRank(word) !== Number.MAX_SAFE_INTEGER) return word;

  return "";
}

/**
 * 1) 숫자 사이즈(2~3자리, 괄호·접두 포함 문자열에서 추출) 우선
 * 2) 없으면 알파(S, M, L, XL, 2XL… — 괄호 안 또는 접미사)
 * 3) 그다음 정규화 문자열 localeCompare
 */
export function compareWearSize(aRaw: unknown, bRaw: unknown): number {
  const aStr = aRaw == null ? "" : String(aRaw);
  const bStr = bRaw == null ? "" : String(bRaw);

  const aNum = extractNumericSize(aStr);
  const bNum = extractNumericSize(bStr);

  if (aNum != null && bNum != null) {
    if (aNum !== bNum) return aNum - bNum;
    const aAlpha = extractAlphaSize(aStr);
    const bAlpha = extractAlphaSize(bStr);
    const aRank = alphaSizeRank(aAlpha);
    const bRank = alphaSizeRank(bAlpha);
    const aKnown = aRank !== Number.MAX_SAFE_INTEGER;
    const bKnown = bRank !== Number.MAX_SAFE_INTEGER;
    if (aKnown && bKnown) return aRank - bRank;
    if (aKnown) return -1;
    if (bKnown) return 1;
    return normalizeSizeText(aStr).localeCompare(normalizeSizeText(bStr), "ko");
  }

  if (aNum != null) return -1;
  if (bNum != null) return 1;

  const aAlpha = extractAlphaSize(aStr);
  const bAlpha = extractAlphaSize(bStr);
  const aRank = alphaSizeRank(aAlpha);
  const bRank = alphaSizeRank(bAlpha);
  const aKnown = aRank !== Number.MAX_SAFE_INTEGER;
  const bKnown = bRank !== Number.MAX_SAFE_INTEGER;

  if (aKnown && bKnown) return aRank - bRank;
  if (aKnown) return -1;
  if (bKnown) return 1;

  return normalizeSizeText(aStr).localeCompare(normalizeSizeText(bStr), "ko");
}
