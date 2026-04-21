/**
 * 파싱/표시 공통 정규화 (엑셀 등 외부 소스 확장 시 재사용).
 */

export function normalizeText(raw: string | null | undefined): string {
  if (raw == null) return "";
  let s = String(raw).trim();
  if (!s) return "";
  s = s.replace(/\s+/g, " ");
  try {
    s = s.normalize("NFC");
  } catch {
    /* ignore */
  }
  return s;
}

export function normalizeBundleKey(raw: string | null | undefined): string | null {
  const t = normalizeText(raw);
  return t ? t : null;
}
