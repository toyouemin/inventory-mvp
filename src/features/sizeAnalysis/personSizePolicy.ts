import { labelExcludeForDisplay } from "./excludeReasonLabels";
import type { NormalizedRow } from "./types";
import { extractSizeGenderQty, normalizeGender, normalizeSize, preprocessCell } from "./normalize";

const NUMERIC_SIZES = new Set(["80", "85", "90", "95", "100", "105", "110", "115", "120"]);

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
 * size 열·성별 열 기준 (사이즈분석 people 경로) 정규화.
 * - M/W+숫자 → 최우선, gender와 불일치해도 인정 → 자동확정
 * - 숫자만(80~120) → 남→M, 여→W 보정 → 수정완료(corrected)
 * - 그 외 S/M/L/XL 등 → normalizeSize → 자동확정
 * - size 없음/비정상 → 검토필요
 */
export function normalizePersonSizePolicy(sizeRaw: string | undefined, genderRaw: string | undefined): PersonSizePolicyResult {
  const genderFromCol = normalizeGender(genderRaw);
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
  if (/^M\d{2,3}$/.test(standardizedSize)) return "M";
  if (/^W\d{2,3}$/.test(standardizedSize)) return "W";
  return null;
}

/** 클럽·이름이 모두 없을 때 쓰는 placeholder 그룹 키 — 동일 인물 판단 불가, 중복 제외 대상이 아님 */
export const DUPLICATE_KEY_NO_PERSON = "__NO_CLUB__::__NO_NAME__" as const;

/**
 * 인물(클럽+이름) 그룹 키. 서로 다른 이름/클럽은 `::`로 분리·placeholder로 빈 셀 전역 병합 방지.
 */
export function personGroupKeyForDuplicate(r: NormalizedRow): string {
  const c =
    (r.clubNameNormalized && String(r.clubNameNormalized).trim()) || preprocessCell(r.clubNameRaw) || "";
  const clubNameNormalized = c || "__NO_CLUB__";
  const memberName = String(r.memberNameRaw ?? "").trim() || "__NO_NAME__";
  return `${clubNameNormalized}::${memberName}`;
}

function orderKey(r: NormalizedRow): number {
  return (r.sourceRowIndex ?? 0) * 1_000_000 + (r.sourceGroupIndex ?? 0);
}

/**
 * 동일 인물(이름+클럽)·여러 행: M vs W가 동시에 있을 때만 성별로 한쪽 excluded.
 * 동일 사이즈 문자열이 반복되면 첫 번째만 유지.
 */
export function applyDuplicateSizePolicy(rows: NormalizedRow[]): NormalizedRow[] {
  const result = rows.map((r) => ({ ...r }));
  const byKey = new Map<string, number[]>();
  result.forEach((r, i) => {
    const k = personGroupKeyForDuplicate(r);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(i);
  });

  const excludeIdx = new Set<number>();
  const mwFilterIdx = new Set<number>();
  const sameSizeDupIdx = new Set<number>();

  for (const [key, indices] of byKey.entries()) {
    console.log("duplicate-group", key, indices.length);
    if (key === DUPLICATE_KEY_NO_PERSON) {
      continue;
    }
    if (indices.length < 2) {
      continue;
    }
    const sortedIdx = [...indices].sort((a, b) => orderKey(result[a]!) - orderKey(result[b]!));
    const g = result[sortedIdx[0]!]!.genderNormalized ?? normalizeGender(result[sortedIdx[0]!]!.genderRaw);

    const withLine = sortedIdx.map((i) => ({
      i,
      line: mwLine(result[i]!.standardizedSize),
    }));
    const hasM = withLine.some((x) => x.line === "M");
    const hasW = withLine.some((x) => x.line === "W");

    if (g === "남" && hasM && hasW) {
      for (const x of withLine) {
        if (x.line === "W") {
          excludeIdx.add(x.i);
          mwFilterIdx.add(x.i);
        }
      }
    } else if (g === "여" && hasM && hasW) {
      for (const x of withLine) {
        if (x.line === "M") {
          excludeIdx.add(x.i);
          mwFilterIdx.add(x.i);
        }
      }
    }

    const afterMw = withLine.filter((x) => !mwFilterIdx.has(x.i));
    const seenSize = new Set<string>();
    for (const x of afterMw) {
      const sz = result[x.i]!.standardizedSize ?? "";
      if (sz === "") continue;
      if (seenSize.has(sz)) {
        excludeIdx.add(x.i);
        sameSizeDupIdx.add(x.i);
      } else {
        seenSize.add(sz);
      }
    }
  }

  for (let i = 0; i < result.length; i += 1) {
    if (!excludeIdx.has(i)) continue;
    const prev = result[i]!;
    let excludeReason: string;
    let excludeDetail: string | undefined;
    if (mwFilterIdx.has(i)) {
      excludeReason = "duplicate_gender_filter";
    } else if (sameSizeDupIdx.has(i)) {
      excludeReason = "duplicate_first_row_kept";
      excludeDetail = "duplicate_same_size";
    } else {
      console.warn("applyDuplicateSizePolicy: unclassified exclude index", i);
      excludeReason = "duplicate_gender_filter";
    }
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
