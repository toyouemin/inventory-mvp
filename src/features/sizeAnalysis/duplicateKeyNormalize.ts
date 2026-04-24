/**
 * 중복 그룹 key 전용 정규화. `clubNameRaw`·`memberNameRaw`는 덮어쓰지 않고,
 * key 계산에만 `normalize*ForDuplicate` + `duplicateGroupKeyFromRow`를 사용합니다.
 */

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

type RowForDupKey = {
  clubNameRaw?: string | null;
  clubNameNormalized?: string | null;
  memberNameRaw?: string | null;
  memberName?: string | null;
};

/** key = normalizeClubForDuplicate + "::" + normalizeNameForDuplicate, 이름이 비어 있으면 null */
export function duplicateGroupKeyFromRow(r: RowForDupKey): string | null {
  const name = normalizeNameForDuplicate(String(r.memberNameRaw ?? r.memberName ?? ""));
  if (!name) return null;
  const club = normalizeClubForDuplicate(String(r.clubNameRaw ?? r.clubNameNormalized ?? ""));
  return `${club}::${name}`;
}
