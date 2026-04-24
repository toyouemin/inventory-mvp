/**
 * 사이즈 문자열(원본/정규화) → 집계·매트릭스 **표시**용 성별·열(숫자·문자) 파싱.
 * 내부 standardizedSize(M100/W90)는 저장 경로에서 유지, 여기서는 **표시**만 맞춤.
 */

import { normalizeGender } from "./normalize";

const SIZE_2_3 = /^(8[0-9]|9[0-9]|1[0-1][0-9]|120)$/;

function isSizeNum(n: string): boolean {
  return SIZE_2_3.test(n);
}

function normalizeParens(s: string): string {
  return s.replace(/[（]/g, "(").replace(/[）]/g, ")").replace(/\s+/g, " ").trim();
}

function genderInFragment(frag: string): "남" | "여" | null {
  const t = frag.replace(/\s+/g, " ").trim();
  if (!t) return null;
  const has남 = /남|남자|남성/i.test(t) || /^M$|M(?![a-zA-Z0-9])/i.test(t);
  const has여 = /여|여자|여성/i.test(t) || /^W$|W(?![a-zA-Z0-9])/i.test(t);
  if (has남 && !has여) return "남";
  if (has여 && !has남) return "여";
  if (has남 && has여) return "남";
  return null;
}

export type SizeParseForMatrix =
  | { kind: "mw_num"; line: "남" | "여"; num: string }
  | { kind: "num_only"; num: string }
  | { kind: "alpha"; label: string };

/**
 * 한 덩어리 문자열(사이즈 셀 전체)에서 80~120 + 성별(선택)을 뽑습니다.
 * 실패 시 null — 호출 측에서 열+행 폴백.
 */
export function tryParseSizeTextForMatrix(s0: string): SizeParseForMatrix | null {
  const s = normalizeParens(s0);
  if (!s) return null;

  let m: RegExpExecArray | null;

  m = /^M\s*(\d{2,3})$/i.exec(s);
  if (m && isSizeNum(m[1]!)) return { kind: "mw_num", line: "남", num: m[1]! };
  m = /^W\s*(\d{2,3})$/i.exec(s);
  if (m && isSizeNum(m[1]!)) return { kind: "mw_num", line: "여", num: m[1]! };

  m = /^남(?:자|성)?\s*(\d{2,3})$/u.exec(s);
  if (m && isSizeNum(m[1]!)) return { kind: "mw_num", line: "남", num: m[1]! };
  m = /^여(?:자|성)?\s*(\d{2,3})$/u.exec(s);
  if (m && isSizeNum(m[1]!)) return { kind: "mw_num", line: "여", num: m[1]! };

  m = /^(\d{2,3})\s*남(?:자|성)?(?:티|용|벨트|핏|줄|하의|상의)?$/u.exec(s);
  if (m && isSizeNum(m[1]!)) return { kind: "mw_num", line: "남", num: m[1]! };
  m = /^(\d{2,3})\s*여(?:자|성)?(?:티|용|벨트|핏|줄|하의|상의)?$/u.exec(s);
  if (m && isSizeNum(m[1]!)) return { kind: "mw_num", line: "여", num: m[1]! };

  m = /^(\d{2,3})\s*M$/i.exec(s);
  if (m && isSizeNum(m[1]!)) return { kind: "mw_num", line: "남", num: m[1]! };
  m = /^(\d{2,3})\s*W$/i.exec(s);
  if (m && isSizeNum(m[1]!)) return { kind: "mw_num", line: "여", num: m[1]! };

  m = /^(\d{2,3})\s*남(?:자|성)?$/u.exec(s);
  if (m && isSizeNum(m[1]!)) return { kind: "mw_num", line: "남", num: m[1]! };
  m = /^(\d{2,3})\s*여(?:자|성)?$/u.exec(s);
  if (m && isSizeNum(m[1]!)) return { kind: "mw_num", line: "여", num: m[1]! };

  m = /^(\d{2,3})\s*\(([^)]+)\)$/.exec(s);
  if (m) {
    const g = genderInFragment(m[2]!);
    if (g && isSizeNum(m[1]!)) return { kind: "mw_num", line: g, num: m[1]! };
  }

  m = /^(\d{2,3})$/i.exec(s);
  if (m && isSizeNum(m[1]!)) return { kind: "num_only", num: m[1]! };

  if (!/^M\d{2,3}$/i.test(s) && !/^W\d{2,3}$/i.test(s)) {
    const al = s.toUpperCase();
    if (
      ["XXS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "FREE", "F", "LL", "W"].includes(al) &&
      s.length <= 5
    ) {
      return { kind: "alpha", label: al };
    }
  }

  return null;
}

/**
 * `standardizedSize`·`sizeRaw`·결합을 순서대로 시도해 매트릭스 행/열에 씁니다.
 */
export function matrixDisplayFromSizeFields(
  standardizedSize: string | null | undefined,
  sizeRaw: string | null | undefined,
  genderColumn: string | null | undefined
): { gender: string; size: string } {
  const gFromCol = normalizeGenderFromMatrixColumn(genderColumn);

  const st = String(standardizedSize ?? "").trim();
  const raw = String(sizeRaw ?? "").trim();
  const combined = `${st} ${raw}`.replace(/\s+/g, " ").trim();

  const seen = new Set<string>();
  const candidates: string[] = [];
  const pushC = (x: string) => {
    const u = x.replace(/\s+/g, " ").trim();
    if (u && !seen.has(u)) {
      seen.add(u);
      candidates.push(u);
    }
  };
  pushC(st);
  pushC(raw);
  pushC(combined);

  for (const c of candidates) {
    const p = tryParseSizeTextForMatrix(c);
    if (p?.kind === "mw_num") {
      return { gender: p.line, size: p.num };
    }
  }
  for (const c of candidates) {
    const p = tryParseSizeTextForMatrix(c);
    if (p?.kind === "num_only") {
      return { gender: genderStringOrEmpty(gFromCol), size: p.num };
    }
  }
  for (const c of candidates) {
    const p = tryParseSizeTextForMatrix(c);
    if (p?.kind === "alpha") {
      return { gender: genderStringOrEmpty(gFromCol), size: p.label };
    }
  }

  for (const c of [st, raw, combined].filter(Boolean)) {
    const stripped = lastResortExtractNumOrAlpha(c, gFromCol);
    if (stripped) return stripped;
  }

  return { gender: genderStringOrEmpty(gFromCol), size: "미분류" };
}

function genderStringOrEmpty(g: "남" | "여" | "공용" | undefined): string {
  if (g === "남" || g === "여") return g;
  if (g === "공용") return "공용";
  return "";
}

function normalizeGenderFromMatrixColumn(raw: string | null | undefined): "남" | "여" | "공용" | undefined {
  const t = String(raw ?? "").trim();
  if (!t) return undefined;
  if (/^(남|남자|남성|남자성|M)$/i.test(t) || t.toUpperCase() === "M") return "남";
  if (/^(여|여자|여성|여자성|W)$/i.test(t) || t.toUpperCase() === "W") return "여";
  return normalizeGender(raw);
}

function lastResortExtractNumOrAlpha(
  s0: string,
  gFromCol: "남" | "여" | "공용" | undefined
): { gender: string; size: string } | null {
  const s = normalizeParens(s0);
  const numHit = s.match(/(?:^|[^0-9])(8[0-9]|9[0-9]|1[0-1][0-9]|120)(?![0-9])/)?.[1];
  if (numHit && isSizeNum(numHit)) {
    const gInner = genderInFragment(s) ?? gFromCol;
    if (gInner === "남" || gInner === "여") {
      return { gender: gInner, size: numHit };
    }
    return { gender: genderStringOrEmpty(gFromCol), size: numHit };
  }
  return null;
}

/**
 * `AggRow.size` 등 임의 문자열 → 매트릭스 **열 머리** (숫자·S/L 등). 금지: 남자 100, M100, 105여…
 */
export function matrixColumnLabelFromSizeString(s0: string): string {
  const s = normalizeParens(s0);
  if (!s) return "";
  const p = tryParseSizeTextForMatrix(s);
  if (p?.kind === "mw_num" || p?.kind === "num_only") return p.num;
  if (p?.kind === "alpha") return p.label;

  const n = s.match(/(?:^|[^0-9])(8[0-9]|9[0-9]|1[0-1][0-9]|120)(?![0-9])/)?.[1];
  if (n) return n;

  const t = s
    .replace(/남(?:자|성)?|여(?:자|성)?|[MWmw]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const n2 = t.match(/^(8[0-9]|9[0-9]|1[0-1][0-9]|120)$/)?.[1];
  if (n2) return n2;

  if (/^(XXS|XS|S|M|L|XL|2XL|3XL|4XL|FREE|F|LL|W)$/i.test(s.trim()) && s.trim().length <= 5) {
    return s.trim().toUpperCase();
  }
  if (!t) return "미분류";
  if (t.length < 12) return t;
  return "미분류";
}
