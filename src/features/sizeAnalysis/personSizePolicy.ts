import { rowEligibleForDuplicatePersonGroup, rowExcludedByEmptyQuantity } from "./clubSizeAggModes";
import { labelExcludeForDisplay } from "./excludeReasonLabels";
import type { NormalizedRow, StructureType } from "./types";
import { duplicateGroupKeyFromRow, duplicateGroupKeyFromRowWithSize } from "./duplicateKeyNormalize";
import { extractSizeGenderQty, normalizeGender, normalizeGenderFromColumn, normalizeSize } from "./normalize";

const NUMERIC_SIZES = new Set(["80", "85", "90", "95", "100", "105", "110", "115", "120"]);

/** 80~120 숫자만 (다른 자릿수와 붙지 않게) */
const NUM_SIZE_IN_TEXT = /(?<![0-9])(80|85|90|95|100|105|110|115|120)(?![0-9])/g;
const GENDER_MARK_RE = /남자|여자|남|여|[MWmw]/g;

/** M100 / W90 (공백 허용) */
const MW_NUMERIC = /^([MWmw])\s*(\d{2,3})$/;
/** size가 숫자만 */
const DIGITS_ONLY = /^(\d{2,3})$/;

export type PersonSizePolicyResult = {
  standardizedSize: string | undefined;
  genderNormalized: "남" | "여" | "공용" | undefined;
  parseStatus: NormalizedRow["parseStatus"];
  parseConfidence: number;
  parseReason: string;
};

/**
 * 사이즈 문자열 전용: 공백·`-` 제거, `()`는 제거하되 안쪽 글자는 남김.
 */
export function preprocessSizeForGenderNumParse(input: string): string {
  return String(input)
    .replace(/[()]/g, "")
    .replace(/-/g, "")
    .replace(/\s+/g, "");
}

function markerToMwLine(marker: string): "M" | "W" | null {
  const t = marker;
  if (/^남자$|^남$|^[Mm]$/.test(t)) return "M";
  if (/^여자$|^여$|^[Ww]$/.test(t)) return "W";
  return null;
}

function uniqueMwLineFromGenderMarkers(s: string): "M" | "W" | null {
  GENDER_MARK_RE.lastIndex = 0;
  const lines = new Set<"M" | "W">();
  let m: RegExpExecArray | null;
  while ((m = GENDER_MARK_RE.exec(s)) !== null) {
    const line = markerToMwLine(m[0]!);
    if (line) lines.add(line);
  }
  if (lines.size !== 1) return null;
  return [...lines][0]!;
}

function uniqueNumericSizeFromString(s: string): string | null {
  NUM_SIZE_IN_TEXT.lastIndex = 0;
  const found: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = NUM_SIZE_IN_TEXT.exec(s)) !== null) {
    found.push(m[1]!);
  }
  if (found.length === 0) return null;
  const distinct = new Set(found);
  if (distinct.size !== 1) return null;
  return found[0]!;
}

/**
 * 한 덩어리 문자열에서 성별 토큰 + 80~120 숫자가 모두 있으면 M100/W90 및 수정완료(corrected).
 * (Prisma/UI 상 `corrected` = 수정완료)
 */
export function tryFixedMwFromGenderAndNumericInString(text: string | undefined): PersonSizePolicyResult | null {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  const s = preprocessSizeForGenderNumParse(raw);
  if (!s) return null;
  const line = uniqueMwLineFromGenderMarkers(s);
  const num = uniqueNumericSizeFromString(s);
  if (line == null || num == null || !NUMERIC_SIZES.has(num)) return null;
  const letter = line;
  const genderNormalized: "남" | "여" = letter === "M" ? "남" : "여";
  return {
    standardizedSize: `${letter}${num}`,
    genderNormalized,
    parseStatus: "corrected",
    parseConfidence: 0.93,
    parseReason: "성별+숫자사이즈(80~120) 결합 → 표준 M/W 접두",
  };
}

/**
 * size 열·성별 열 기준 (사이즈분석 people 경로) 정규화.
 * - M/W+숫자 → 최우선, gender와 불일치해도 인정 → 자동확정
 * - 숫자만(80~120) → 남→M, 여→W 보정 → 수정완료(corrected)
 * - 그 외 S/M/L/XL 등 → normalizeSize → 자동확정
 * - size 없음/비정상 → 검토필요
 */
export function normalizePersonSizePolicy(sizeRaw: string | undefined, genderRaw: string | undefined): PersonSizePolicyResult {
  const genderFromCol = normalizeGenderFromColumn(genderRaw);
  const raw = String(sizeRaw ?? "").trim();
  if (!raw) {
    return {
      standardizedSize: undefined,
      genderNormalized: genderFromCol,
      parseStatus: "needs_review",
      parseConfidence: 0.2,
      parseReason: "사이즈 없음",
    };
  }

  const fromGenderNum = tryFixedMwFromGenderAndNumericInString(raw);
  if (fromGenderNum) {
    return fromGenderNum;
  }

  const m1 = raw.match(MW_NUMERIC);
  if (m1) {
    const letter = m1[1]!.toUpperCase() as "M" | "W";
    const num = m1[2]!;
    if (NUMERIC_SIZES.has(num)) {
      return {
        standardizedSize: `${letter}${num}`,
        genderNormalized: genderFromCol,
        parseStatus: "auto_confirmed",
        parseConfidence: 0.95,
        parseReason: "접두(M/W) 사이즈",
      };
    }
    return {
      standardizedSize: undefined,
      genderNormalized: genderFromCol,
      parseStatus: "needs_review",
      parseConfidence: 0.25,
      parseReason: "M/W+숫자이나 유효 치수가 아님",
    };
  }

  const m2 = raw.match(DIGITS_ONLY);
  if (m2) {
    const num = m2[1]!;
    if (NUMERIC_SIZES.has(num)) {
      if (genderFromCol === "남") {
        return {
          standardizedSize: `M${num}`,
          genderNormalized: genderFromCol,
          parseStatus: "corrected",
          parseConfidence: 0.9,
          parseReason: "숫자 사이즈 + 성별(남) → M접두",
        };
      }
      if (genderFromCol === "여") {
        return {
          standardizedSize: `W${num}`,
          genderNormalized: genderFromCol,
          parseStatus: "corrected",
          parseConfidence: 0.9,
          parseReason: "숫자 사이즈 + 성별(여) → W접두",
        };
      }
      return {
        standardizedSize: undefined,
        genderNormalized: genderFromCol,
        parseStatus: "needs_review",
        parseConfidence: 0.35,
        parseReason: "숫자만 — 성별(남/여)로 접두 보정 불가(공용/미입력)",
      };
    }
  }

  const st = normalizeSize(raw);
  if (st) {
    return {
      standardizedSize: st,
      genderNormalized: genderFromCol,
      parseStatus: "auto_confirmed",
      parseConfidence: 0.86,
      parseReason: "알파/기존 토큰 사이즈",
    };
  }

  return {
    standardizedSize: undefined,
    genderNormalized: genderFromCol,
    parseStatus: "needs_review",
    parseConfidence: 0.3,
    parseReason: "사이즈 정규화 불가",
  };
}

/** size/성별 열로 실패한 경우에만 합쳐진 텍스트로 보조(레거시) */
export function normalizePersonWithFallback(sizeRaw: string | undefined, genderRaw: string | undefined, mergedFallback: string): PersonSizePolicyResult {
  const primary = normalizePersonSizePolicy(sizeRaw, genderRaw);
  if (primary.standardizedSize) return primary;
  const mergedFixed = tryFixedMwFromGenderAndNumericInString(mergedFallback);
  if (mergedFixed) return mergedFixed;
  const p = extractSizeGenderQty(mergedFallback);
  if (p.size) {
    return {
      standardizedSize: p.size,
      genderNormalized: p.gender ?? primary.genderNormalized,
      parseStatus: p.status as NormalizedRow["parseStatus"],
      parseConfidence: p.confidence,
      parseReason: `레거시 텍스트 파싱: ${p.reason}`,
    };
  }
  return primary;
}

function mwLine(standardizedSize: string | undefined): "M" | "W" | null {
  if (!standardizedSize) return null;
  if (/^M\d{2,3}$/i.test(standardizedSize)) return "M";
  if (/^W\d{2,3}$/i.test(standardizedSize)) return "W";
  return null;
}

function normalizeBinaryGender(raw: string | undefined): "남" | "여" | null {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  if (/^(남|남자|m)$/i.test(t)) return "남";
  if (/^(여|여자|w)$/i.test(t)) return "여";
  const g = normalizeGender(t);
  return g === "남" || g === "여" ? g : null;
}

function lineForKeepPreference(r: NormalizedRow): "M" | "W" | null {
  const fromStd = mwLine(r.standardizedSize);
  if (fromStd) return fromStd;
  const raw = String(r.sizeRaw ?? "").trim();
  if (/^남|남자/i.test(raw)) return "M";
  if (/^여|여자/i.test(raw)) return "W";
  return null;
}

function pickKeepIndex(indices: number[], rows: NormalizedRow[]): number {
  const first = rows[indices[0]!]!;
  const g = normalizeBinaryGender(first.genderNormalized ?? first.genderRaw);
  if (g === "남") {
    const want = indices.find((i) => lineForKeepPreference(rows[i]!) === "M");
    if (want != null) return want;
  } else if (g === "여") {
    const want = indices.find((i) => lineForKeepPreference(rows[i]!) === "W");
    if (want != null) return want;
  }
  return indices[0]!;
}

/**
 * 중복 기준:
 * - **size_matrix**: 클럽 + 이름 + 표시 사이즈 — 0/빈 수량 제외 행은 맵에 넣지 않음
 * - **그 외 구조**: 클럽 + 이름만(기존과 동일)
 * - 유지행 선택: 성별(남/여)에 맞는 M/W 계열 우선, 없으면 입력 첫 행
 * - 검토필요(needs_review) 및 사이즈 없음·미분류 행은 중복 처리하지 않음(검토 우선, analyzeDuplicateRows와 동일)
 */
export function applyDuplicateSizePolicy(rows: NormalizedRow[], structureType: StructureType): NormalizedRow[] {
  const isMatrix = structureType === "size_matrix";

  function keyForRow(r: NormalizedRow): string | null {
    return isMatrix ? duplicateGroupKeyFromRowWithSize(r) : duplicateGroupKeyFromRow(r);
  }

  const result = rows.map((r) => ({ ...r }));
  const byPerson = new Map<string, number[]>();
  const excludeIdx = new Set<number>();

  result.forEach((r, i) => {
    if (isMatrix && rowExcludedByEmptyQuantity(r)) return;
    if (r.excluded) return;
    if (!rowEligibleForDuplicatePersonGroup(r)) return;
    const k = keyForRow(r);
    if (!k) return;
    if (!byPerson.has(k)) byPerson.set(k, []);
    byPerson.get(k)!.push(i);
  });

  for (const indices of byPerson.values()) {
    if (indices.length < 2) continue;
    const keepIdx = pickKeepIndex(indices, result);
    for (const i of indices) {
      if (i !== keepIdx) {
        excludeIdx.add(i);
      }
    }
  }

  for (let i = 0; i < result.length; i += 1) {
    if (!excludeIdx.has(i)) continue;
    const prev = result[i]!;
    const excludeReason = "duplicate_person_group";
    const excludeDetail = isMatrix
      ? "same_club_same_name_same_size_keep_one"
      : "same_club_same_name_keep_one";
    const display = labelExcludeForDisplay({
      excluded: true,
      parseStatus: "excluded",
      excludeReason,
      excludeDetail,
    });
    result[i] = {
      ...prev,
      excluded: true,
      parseStatus: "excluded",
      parseConfidence: 0.78,
      excludeReason,
      excludeDetail,
      parseReason: display || prev.parseReason,
    };
  }

  return result;
}
