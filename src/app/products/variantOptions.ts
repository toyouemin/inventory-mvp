/**
 * variant: color / gender / size 분리 저장, UI는 gender+size 붙여 표시.
 * DB 유니크: (sku, color, gender, size) — 한 상품 내에서는 sku가 고정이므로
 * variantCompositeKey(color, gender, size)만으로도 동일 조합 식별에 쓸 수 있음.
 */

/** Supabase `product_variants` 유니크 인덱스 컬럼 순서와 동일하게 유지 */
export const PRODUCT_VARIANTS_ON_CONFLICT = "sku,color,gender,size" as const;

export function variantCompositeKey(
  color: string | null | undefined,
  gender: string | null | undefined,
  size: string | null | undefined
): string {
  const c = (color ?? "").trim();
  const g = (gender ?? "").trim();
  const s = (size ?? "").trim();
  return `${c}\0${g}\0${s}`;
}

/** 동일 (color,gender,size) 행이 여러 개면 재고만 합치고 memo는 채워진 쪽 우선(가격은 첫 행 유지). */
export function aggregateDuplicateVariantsByCompositeKey<
  T extends {
    color?: string | null;
    gender?: string | null;
    size?: string | null;
    stock?: number;
    wholesalePrice?: number | null;
    msrpPrice?: number | null;
    salePrice?: number | null;
    extraPrice?: number | null;
    memo?: string | null;
    memo2?: string | null;
  },
>(rows: T[]): T[] {
  const map = new Map<string, T>();
  for (const r of rows) {
    const color = String(r.color ?? "").trim();
    const gender = String(r.gender ?? "").trim();
    const size = String(r.size ?? "").trim();
    const key = variantCompositeKey(color, gender, size);
    const stock = Number.isFinite(Number(r.stock)) ? Math.max(0, Number(r.stock)) : 0;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...r, color, gender, size, stock } as T);
      continue;
    }
    const prevStock = Number.isFinite(Number(prev.stock)) ? Math.max(0, Number(prev.stock)) : 0;
    map.set(key, {
      ...prev,
      color,
      gender,
      size,
      stock: prevStock + stock,
      memo: (prev.memo ?? "").trim() || (r.memo ?? "").trim() || null,
      memo2: (prev.memo2 ?? "").trim() || (r.memo2 ?? "").trim() || null,
    } as T);
  }
  return [...map.values()];
}

/** 표시용: 구분자 없이 (gender ?? '') + (size ?? '') 후 trim */
export function formatGenderSizeDisplay(gender: string | null | undefined, size: string | null | undefined): string {
  return `${gender ?? ""}${size ?? ""}`.trim();
}

/** 리스트·카드 옵션 줄: 컬러는 별도 컬럼, 사이즈 열에는 gender+size만 쓰므로 이 함수는 gender+size용 */
export function formatVariantSizeLabel(v: {
  gender?: string | null;
  size?: string | null;
}): string {
  return formatGenderSizeDisplay(v.gender, v.size);
}

function normColorForSort(c: string | null | undefined): string {
  return (c ?? "").trim().replace(/\s+/g, " ");
}

/** 사이즈 문자열에서 선행 숫자(예: 100, 90.5) 추출 — 없으면 null */
function sizeNumericPart(size: string | null | undefined): number | null {
  const raw = (size ?? "").trim();
  const m = /^\s*(\d+(?:\.\d+)?)/.exec(raw) ?? /\d+(?:\.\d+)?/.exec(raw);
  if (!m) return null;
  const n = Number(m[1] ?? m[0]);
  return Number.isFinite(n) ? n : null;
}

/** 일반형: `size`에 숫자 없으면 `gender` 안 숫자(예: `여85`)에서 추출 */
function generalVariantNumericSize(v: {
  gender?: string | null;
  size?: string | null;
}): number | null {
  const fromSize = sizeNumericPart(v.size);
  if (fromSize != null) return fromSize;
  const g = (v.gender ?? "").trim();
  const m = /\d+(?:\.\d+)?/.exec(g);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/** `3부` / `4부` 등 — 숫자 오름차순 (3부 → 4부 → 5부) */
function sockLengthRank(length: string): number {
  const m = /^(\d+)부$/.exec(length.trim());
  if (m) return parseInt(m[1]!, 10);
  return 999;
}

/** 여 → 남 */
function sockGenderRank(gender: string): number {
  const g = (gender ?? "").trim();
  if (g.startsWith("여")) return 1;
  if (g.startsWith("남")) return 2;
  return 3;
}

export type SockParsedKey = { length: string; gender: string; size: number };

export type SockParseSource = "gsLabel" | "colorCombined" | "splitColor" | null;

/**
 * `3부-여85` 한 덩어리 문자열(표시용 gender+size 또는 예전 color 단일 컬럼).
 * `rest`에 숫자가 없으면 `sizeFallback` 컬럼에서 숫자 사용.
 */
function parseSockCombinedString(optionSegment: string, sizeFallback: string): SockParsedKey | null {
  const t = (optionSegment ?? "").trim();
  if (!t) return null;
  const combined = /^(\d+부)-(.+)$/.exec(t);
  if (!combined) return null;
  const length = combined[1]!;
  const rest = combined[2]!.trim();
  const gender = rest.startsWith("여") ? "여" : rest.startsWith("남") ? "남" : "";
  const fromRest = parseInt(rest.replace(/[^\d]/g, ""), 10);
  const sf = (sizeFallback ?? "").trim();
  const fromFallback =
    sizeNumericPart(sf) ?? (() => {
      const p = parseInt(sf.replace(/[^\d]/g, ""), 10);
      return Number.isFinite(p) ? p : null;
    })();
  const sizeNum =
    Number.isFinite(fromRest) && fromRest > 0 ? fromRest : fromFallback != null && fromFallback > 0 ? fromFallback : 0;
  return { length, gender, size: sizeNum };
}

/** 디버그·샘플 검증용: 라벨 문자열만으로 양말형 파싱 성공 여부 */
export function tryParseSockCombinedLabel(text: string): SockParsedKey | null {
  return parseSockCombinedString(text, "");
}

function tryParseSockStyleVariantWithSource(v: {
  color?: string | null;
  gender?: string | null;
  size?: string | null;
}): { parsed: SockParsedKey | null; source: SockParseSource } {
  const c = (v.color ?? "").trim();
  const gField = (v.gender ?? "").trim();
  const sField = (v.size ?? "").trim();
  const gsLabel = formatGenderSizeDisplay(v.gender, v.size);

  let r = parseSockCombinedString(gsLabel, sField);
  if (r) {
    if (!r.gender) {
      const g = gField.startsWith("여") ? "여" : gField.startsWith("남") ? "남" : "";
      if (g) r = { ...r, gender: g };
    }
    return { parsed: r, source: "gsLabel" };
  }

  r = parseSockCombinedString(c, sField);
  if (r) {
    if (!r.gender) {
      const g = gField.startsWith("여") ? "여" : gField.startsWith("남") ? "남" : "";
      if (g) r = { ...r, gender: g };
    }
    return { parsed: r, source: "colorCombined" };
  }

  if (/^\d+부$/.test(c)) {
    const gender = gField.startsWith("여") ? "여" : gField.startsWith("남") ? "남" : "";
    const parsed = parseInt(sField.replace(/[^\d]/g, ""), 10);
    const sn = sizeNumericPart(sField) ?? (Number.isFinite(parsed) ? parsed : null);
    return {
      parsed: { length: c, gender, size: sn ?? 0 },
      source: "splitColor",
    };
  }

  return { parsed: null, source: null };
}

/** 카드 칩 `BK` + `3부-여85` 구조에서 두 번째 칩(gsLabel) 기준으로 양말형 인식 */
export function tryParseSockStyleVariant(v: {
  color?: string | null;
  gender?: string | null;
  size?: string | null;
}): SockParsedKey | null {
  return tryParseSockStyleVariantWithSource(v).parsed;
}

export type SockSortDiagnostic = {
  color: string;
  gender: string;
  size: string;
  gsLabel: string;
  displayLabel: string;
  parsed: SockParsedKey | null;
  parseSource: SockParseSource;
};

export function diagnoseSockSortVariant(v: {
  color?: string | null;
  gender?: string | null;
  size?: string | null;
}): SockSortDiagnostic {
  const color = (v.color ?? "").trim();
  const gender = (v.gender ?? "").trim();
  const size = (v.size ?? "").trim();
  const gsLabel = formatGenderSizeDisplay(v.gender, v.size);
  const { parsed, source } = tryParseSockStyleVariantWithSource(v);
  const displayLabel = [color, gsLabel].filter(Boolean).join(" | ");
  return { color, gender, size, gsLabel, displayLabel, parsed, parseSource: source };
}

function compareSockParsed(A: SockParsedKey, B: SockParsedKey): number {
  const lr = sockLengthRank(A.length) - sockLengthRank(B.length);
  if (lr !== 0) return lr;
  const gr = sockGenderRank(A.gender) - sockGenderRank(B.gender);
  if (gr !== 0) return gr;
  if (A.size !== B.size) return A.size - B.size;
  return 0;
}

/**
 * 화면에 넘기기 직전 variant 배열 정렬(카드·리스트 공통, `sortVariantRows` 단일 기준).
 */
export function sortVariantsForDisplay<T extends { color?: string | null; gender?: string | null; size?: string | null }>(
  variants: T[]
): T[] {
  return [...variants].sort((a, b) => sortVariantRows(a, b));
}

/**
 * 카드·리스트 옵션 정렬:
 * - **양말형**(gsLabel·color·split 중 한 경로로 파싱 성공): 길이(3부→4부) → 여→남 → 사이즈 숫자 →(동률) color → composite
 * - **비양말형**: color 동일 시 → 성별(여→남) → 사이즈 숫자 오름차순 →(동률) 사이즈 문자·gender 문자
 */
export function sortVariantRows(
  a: { color?: string | null; gender?: string | null; size?: string | null },
  b: { color?: string | null; gender?: string | null; size?: string | null }
): number {
  const sa = tryParseSockStyleVariant(a);
  const sb = tryParseSockStyleVariant(b);
  const ca = normColorForSort(a.color);
  const cb = normColorForSort(b.color);

  if (sa && sb) {
    const col = ca.localeCompare(cb, "ko");
    if (col !== 0) return col;
    const sock = compareSockParsed(sa, sb);
    if (sock !== 0) return sock;
    return variantCompositeKey(a.color, a.gender, a.size).localeCompare(
      variantCompositeKey(b.color, b.gender, b.size),
      "ko"
    );
  }

  if (ca !== cb) return ca.localeCompare(cb, "ko");

  if (sa && !sb) return -1;
  if (!sa && sb) return 1;

  const gra = sockGenderRank(a.gender ?? "");
  const grb = sockGenderRank(b.gender ?? "");
  if (gra !== grb) return gra - grb;

  const na = generalVariantNumericSize(a);
  const nb = generalVariantNumericSize(b);
  if (na != null && nb != null && na !== nb) return na - nb;
  if (na != null && nb == null) return -1;
  if (na == null && nb != null) return 1;

  const sza = (a.size ?? "").trim();
  const szb = (b.size ?? "").trim();
  const sizeCmp = sza.localeCompare(szb, "ko", { numeric: true });
  if (sizeCmp !== 0) return sizeCmp;

  const ga = (a.gender ?? "").trim();
  const gb = (b.gender ?? "").trim();
  return ga.localeCompare(gb, "ko");
}
