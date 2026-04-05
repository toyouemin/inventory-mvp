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

/**
 * 카드 옵션 목록 정렬: 색상 그룹 유지 후, **같은 색 안에서는 사이즈(숫자) → 사이즈 문자열 → 성별** 순.
 * 예전(색→성별→사이즈)은 '여' 행이 많을 때 '남100'만 맨 아래로 밀려 스크롤 밖으로 떨어져 보이기 쉬움.
 */
export function sortVariantRows(
  a: { color?: string | null; gender?: string | null; size?: string | null },
  b: { color?: string | null; gender?: string | null; size?: string | null }
): number {
  const ca = normColorForSort(a.color);
  const cb = normColorForSort(b.color);
  if (ca !== cb) return ca.localeCompare(cb, "ko");

  const na = sizeNumericPart(a.size);
  const nb = sizeNumericPart(b.size);
  if (na != null && nb != null && na !== nb) return na - nb;
  if (na != null && nb == null) return -1;
  if (na == null && nb != null) return 1;

  const sa = (a.size ?? "").trim();
  const sb = (b.size ?? "").trim();
  const sizeCmp = sa.localeCompare(sb, "ko", { numeric: true });
  if (sizeCmp !== 0) return sizeCmp;

  const ga = (a.gender ?? "").trim();
  const gb = (b.gender ?? "").trim();
  return ga.localeCompare(gb, "ko");
}
