import type { Prisma } from "@prisma/client";

/**
 * Prisma `Json` 필드에 전달하는 값에 `undefined`가 섞이지 않도록 정규화합니다.
 * - `undefined` → `null` (객체/배열의 값으로만; Prisma `InputJsonValue`는 루트 `null` 제한이 있어 별도 처리)
 * - `null` 유지
 * - `NaN` / `Infinity` → `null`
 * - `bigint` → 문자열
 * - `Date` → ISO 문자열
 * - `Map` / `Set` → 직렬화 가능한 배열로 변환
 */
function sanitizeInner(value: unknown): Prisma.JsonValue {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === "bigint") return String(value);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return value;
  }
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Map) {
    return Array.from(value.entries()).map(([k, v]) => [sanitizeInner(k), sanitizeInner(v)] as const);
  }
  if (value instanceof Set) {
    return Array.from(value, (v) => sanitizeInner(v));
  }
  if (Array.isArray(value)) {
    // map()은 희소 배열의 빈 슬롯을 건드리지 않아 Prisma JSON에 `undefined`가 남을 수 있음
    return Array.from({ length: value.length }, (_, i) => sanitizeInner(value[i]));
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, Prisma.JsonValue> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined) {
        out[k] = null;
        continue;
      }
      out[k] = sanitizeInner(v);
    }
    return out;
  }
  return null;
}

/**
 * DB에 쓰는 JSON 값 — `undefined`는 내부에서 제거/치환됩니다. (Prisma `InputJsonValue`에 맞춤)
 */
export function sanitizeForPrismaJson(value: unknown): Prisma.InputJsonValue {
  if (value === undefined) {
    return {} as Prisma.InputJsonValue;
  }
  const inner = sanitizeInner(value);
  if (inner === null) {
    return {} as Prisma.InputJsonValue;
  }
  return inner as Prisma.InputJsonValue;
}
