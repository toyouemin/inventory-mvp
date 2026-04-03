/** variant.size(결합 문자열) 또는 DB 분리 필드 ↔ 길이(option1)·성별(option2)·순수 사이즈 */

import { sortSizes } from "./sizeUtils";

export function normalizeGenderShort(token: string): string {
  const t = token.trim().toUpperCase();
  if (t === "남" || t === "남성" || t === "MEN" || t === "MENS") return "남";
  if (t === "여" || t === "여성" || t === "WOMEN" || t === "WOMENS") return "여";
  if (t === "공용" || t === "UNISEX") return "공용";
  return token.trim();
}

/**
 * "3부남자 / 남 / W28" → { option1: "3부", option2: "남", size: "W28" }
 * 패턴이 아니면 전부 size에 두고 option1/2는 빈 문자열.
 */
export function decomposeVariantSize(combined: string): { option1: string; option2: string; size: string } {
  const raw = (combined ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return { option1: "", option2: "", size: "" };
  const parts = raw.split(/\s*\/\s*/).map((x) => x.trim()).filter(Boolean);
  if (parts.length >= 3 && /^(남|여|공용|UNISEX)$/i.test(parts[1])) {
    const lenMatch = parts[0].match(/^(\d+부)/);
    const option1 = lenMatch ? lenMatch[1] : "";
    const option2 = normalizeGenderShort(parts[1]);
    const size = parts.slice(2).join(" / ");
    return { option1, option2, size };
  }
  if (parts.length === 2 && /^(남|여|공용|UNISEX)$/i.test(parts[0])) {
    return { option1: "", option2: normalizeGenderShort(parts[0]), size: parts[1] };
  }
  return { option1: "", option2: "", size: raw };
}

export function variantCompositeKey(
  option1: string | null | undefined,
  option2: string | null | undefined,
  size: string | null | undefined
): string {
  const o1 = (option1 ?? "").trim();
  const o2 = (option2 ?? "").trim();
  const s = (size ?? "").trim();
  return `${o1}\0${o2}\0${s}`;
}

/** UI·리스트: 칩/라벨용 (길이 → 성별 → 사이즈) */
export function formatVariantDisplay(parts: {
  option1?: string | null;
  option2?: string | null;
  size?: string | null;
  legacySize?: string | null;
}): string {
  const t = effectiveVariantTriple(parts);
  const chips = [t.option1, t.option2, t.size].filter(Boolean);
  if (chips.length > 0) return chips.join(" · ");
  const leg = (parts.legacySize ?? "").trim();
  return leg || "(없음)";
}

/** DB 분리값 우선, 레거시(결합 size만 있는 행)는 파싱 */
export function effectiveVariantTriple(parts: {
  option1?: string | null;
  option2?: string | null;
  size?: string | null;
  legacySize?: string | null;
}): { option1: string; option2: string; size: string } {
  let o1 = (parts.option1 ?? "").trim();
  let o2 = (parts.option2 ?? "").trim();
  let s = (parts.size ?? "").trim();
  if (o1 || o2) return { option1: o1, option2: o2, size: s };
  const raw = s || (parts.legacySize ?? "").trim();
  if (raw.includes(" / ")) return decomposeVariantSize(raw);
  return { option1: "", option2: "", size: raw };
}

/** CSV size 컬럼 재구성(다시 업로드 시 파서와 맞춤). */
export function joinVariantSizeForCsv(option1?: string | null, option2?: string | null, size?: string | null): string {
  const o1 = (option1 ?? "").trim();
  const o2 = (option2 ?? "").trim();
  const sp = (size ?? "").trim();
  if (o1 && o2 && sp) {
    const first =
      /^\d+부$/.test(o1) ? `${o1}${o2 === "남" ? "남자" : o2 === "여" ? "여자" : o2}` : o1;
    return `${first} / ${o2} / ${sp}`;
  }
  if (o2 && sp) return `${o2} / ${sp}`;
  return sp || o1 || o2;
}

function parse부Order(s: string): number {
  const m = /^(\d+)부/.exec((s ?? "").trim());
  return m ? parseInt(m[1], 10) : 999;
}

function genderOrder(g: string): number {
  const x = (g ?? "").trim();
  if (x === "남") return 0;
  if (x === "여") return 1;
  if (x === "공용") return 2;
  return 3;
}

/** 정렬: 길이(option1) → 성별(option2) → 순수 사이즈 */
export function sortVariantRows(
  a: { option1?: string | null; option2?: string | null; size?: string | null; legacySize?: string | null },
  b: { option1?: string | null; option2?: string | null; size?: string | null; legacySize?: string | null }
): number {
  const ta = effectiveVariantTriple(a);
  const tb = effectiveVariantTriple(b);
  const 부a = parse부Order(ta.option1);
  const 부b = parse부Order(tb.option1);
  if (부a !== 부b) return 부a - 부b;
  const ga = genderOrder(ta.option2);
  const gb = genderOrder(tb.option2);
  if (ga !== gb) return ga - gb;
  return sortSizes(ta.size, tb.size);
}
