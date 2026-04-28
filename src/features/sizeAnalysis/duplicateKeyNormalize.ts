/**
 * 중복 그룹 key 전용 정규화. `clubNameRaw`·`memberNameRaw`는 덮어쓰지 않고,
 * key 계산에만 `normalize*ForDuplicate` + 아래 `duplicateGroupKey*` 를 사용합니다.
 *
 * - `duplicateGroupKeyFromRow` — **single_row / repeated / unknown** 등: 클럽 + 이름만(기존과 동일)
 * - `duplicateGroupKeyFromRowWithSize` — **size_matrix** 전용: 클럽 + 이름 + 표시 사이즈
 * - `duplicateGroupKeyFromRowWithItemAndSize` — **multi_item_personal_order** 전용: 클럽 + 이름 + 상품 + 사이즈
 */

import { matrixDisplayFromSizeFields } from "./matrixSizeDisplay";

export function normalizeNameForDuplicate(name: string) {
  return String(name || "")
    .replace(/\s+/g, "")
    .trim();
}

export function normalizeClubForDuplicate(club: string) {
  return String(club || "")
    .split("/")[0]!
    .replace(/\s+/g, "")
    .trim();
}

/** 사이즈 토큰 비교용(공백 제거, 대소문자 통일) */
export function normalizeSizeForDuplicateKey(size: string) {
  return String(size || "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

type RowForDupKey = {
  clubNameRaw?: string | null;
  clubNameNormalized?: string | null;
  memberNameRaw?: string | null;
  memberName?: string | null;
};

type RowForDupKeyWithSize = RowForDupKey & {
  standardizedSize?: string | null;
  sizeRaw?: string | null;
  genderNormalized?: string | null;
  genderRaw?: string | null;
};

/**
 * key = normalizeClub + "::" + normalizeName (이름이 비어 있으면 null)
 * single_row_person / repeated_slots / unknown 의 중복 기준(기존과 동일)
 */
export function duplicateGroupKeyFromRow(r: RowForDupKey): string | null {
  const name = normalizeNameForDuplicate(String(r.memberNameRaw ?? r.memberName ?? ""));
  if (!name) return null;
  const club = normalizeClubForDuplicate(String(r.clubNameRaw ?? r.clubNameNormalized ?? ""));
  return `${club}::${name}`;
}

/**
 * key = normalizeClub + "::" + normalizeName + "::" + normalizeSize
 * size_matrix 전용 — 표시용 사이즈는 `matrixDisplayFromSizeFields` 기준
 */
export function duplicateGroupKeyFromRowWithSize(r: RowForDupKeyWithSize): string | null {
  const name = normalizeNameForDuplicate(String(r.memberNameRaw ?? r.memberName ?? ""));
  if (!name) return null;
  const club = normalizeClubForDuplicate(String(r.clubNameRaw ?? r.clubNameNormalized ?? ""));

  const gCol = String(r.genderNormalized ?? r.genderRaw ?? "").trim();
  const { size: displaySize } = matrixDisplayFromSizeFields(
    r.standardizedSize,
    r.sizeRaw,
    gCol || undefined
  );
  const sz = String(displaySize ?? "").trim();
  if (!sz || sz === "미분류") return null;
  const sizeKey = normalizeSizeForDuplicateKey(sz);
  if (!sizeKey) return null;
  return `${club}::${name}::${sizeKey}`;
}

type RowForDupKeyWithItemAndSize = RowForDupKeyWithSize & {
  itemRaw?: string | null;
};

export function duplicateGroupKeyFromRowWithItemAndSize(r: RowForDupKeyWithItemAndSize): string | null {
  const name = normalizeNameForDuplicate(String(r.memberNameRaw ?? r.memberName ?? ""));
  if (!name) return null;
  const club = normalizeClubForDuplicate(String(r.clubNameRaw ?? r.clubNameNormalized ?? ""));
  const item = normalizeNameForDuplicate(String(r.itemRaw ?? ""));
  if (!item) return null;

  const gCol = String(r.genderNormalized ?? r.genderRaw ?? "").trim();
  const { size: displaySize } = matrixDisplayFromSizeFields(
    r.standardizedSize,
    r.sizeRaw,
    gCol || undefined
  );
  const sz = String(displaySize ?? "").trim();
  if (!sz || sz === "미분류") return null;
  const sizeKey = normalizeSizeForDuplicateKey(sz);
  if (!sizeKey) return null;
  return `${club}::${name}::${item}::${sizeKey}`;
}
