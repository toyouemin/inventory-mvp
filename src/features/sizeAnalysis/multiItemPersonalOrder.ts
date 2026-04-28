import { normalizeSize, preprocessCell } from "./normalize";
import { normalizePersonSizePolicy } from "./personSizePolicy";
import type { FieldMapping, NormalizedRow, SheetSnapshot } from "./types";

function cell(row: string[], index?: number): string | undefined {
  if (index === undefined || index < 0 || index >= row.length) return undefined;
  const v = row[index];
  return v == null ? undefined : String(v);
}

function guessRequestedClubFromFileName(fileName: string | undefined): string {
  const base = String(fileName ?? "")
    .replace(/\.[^.]+$/, "")
    .trim();
  return base || "미지정 클럽";
}

function dedupeAndNormalizeProductColumns(mapping: FieldMapping): number[] {
  const fromMapping = Array.isArray(mapping.productColumns) ? mapping.productColumns : [];
  const excluded = new Set<number>(
    [mapping.fields.club, mapping.fields.name, mapping.fields.gender, mapping.fields.note]
      .filter((x): x is number => typeof x === "number" && x >= 0)
  );
  const seen = new Set<number>();
  const out: number[] = [];
  for (const idx of fromMapping) {
    if (!Number.isInteger(idx) || idx < 0) continue;
    if (excluded.has(idx)) continue;
    if (seen.has(idx)) continue;
    seen.add(idx);
    out.push(idx);
  }
  return out;
}

function isUnisexProductHeader(headerText: string): boolean {
  const t = String(headerText ?? "");
  if (/\(\s*공용\s*\)|\[\s*공용\s*\]/i.test(t)) return true;
  return /공용/i.test(t);
}

function stripAllGenderTokensForUnisexSize(sizeRaw: string | undefined): string {
  return String(sizeRaw ?? "")
    .replace(/남자|여자|남성|여성|남|여|[MW]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractNumericUnisexSize(sizeRaw: string | undefined): string | undefined {
  const cleaned = stripAllGenderTokensForUnisexSize(sizeRaw);
  if (!cleaned) return undefined;
  const m = cleaned.match(/(?:^|[^0-9])(80|85|90|95|100|105|110|115|120)(?![0-9])/);
  return m?.[1];
}

function unisexStandardizedSize(rawSize: string | undefined, parsedSize: string | undefined): string | undefined {
  const numeric = extractNumericUnisexSize(rawSize);
  if (numeric) return numeric;
  if (/^[MW]\d{2,3}$/i.test(String(parsedSize ?? ""))) {
    return String(parsedSize).slice(1);
  }
  const normalizedParsed = normalizeSize(parsedSize);
  if (/^\d{2,3}$/.test(String(normalizedParsed ?? ""))) return normalizedParsed;
  return undefined;
}

export function parseMultiItemPersonalOrder(
  jobId: string,
  sheet: SheetSnapshot,
  mapping: FieldMapping,
  opts?: { requestedClubName?: string }
): NormalizedRow[] {
  const out: NormalizedRow[] = [];
  const start = mapping.headerRowIndex + 1;
  const productCols = dedupeAndNormalizeProductColumns(mapping);
  if (productCols.length === 0) return out;

  const requestedClub = String(opts?.requestedClubName ?? "").trim() || "미지정 클럽";
  const fallbackClub = guessRequestedClubFromFileName(requestedClub);
  const header = sheet.rows[mapping.headerRowIndex] ?? [];

  for (let i = start; i < sheet.rows.length; i += 1) {
    const row = sheet.rows[i] ?? [];
    const nameRaw = cell(row, mapping.fields.name);
    const genderRaw = cell(row, mapping.fields.gender);
    const explicitClubRaw = cell(row, mapping.fields.club);
    const normalizedName = preprocessCell(nameRaw);
    if (!normalizedName) continue;
    const clubRaw = preprocessCell(explicitClubRaw) ? explicitClubRaw : fallbackClub;
    const clubNorm = preprocessCell(clubRaw);

    for (const productCol of productCols) {
      const sizeRaw = cell(row, productCol);
      if (!preprocessCell(sizeRaw)) continue;
      const productNameRaw = String(header[productCol] ?? "").trim() || `상품${productCol + 1}`;
      const unisexMode = isUnisexProductHeader(productNameRaw);
      const pol = normalizePersonSizePolicy(sizeRaw, genderRaw);
      const standardizedSize = unisexMode
        ? unisexStandardizedSize(sizeRaw, pol.standardizedSize)
        : pol.standardizedSize;
      const genderNormalized = unisexMode ? "공용" : pol.genderNormalized;
      const parseReason = unisexMode ? `${pol.parseReason} / 상품헤더(공용) 적용` : pol.parseReason;
      out.push({
        jobId,
        sourceSheet: sheet.name,
        sourceRowIndex: i,
        sourceGroupIndex: productCol,
        clubNameRaw: clubRaw,
        clubNameNormalized: clubNorm,
        memberNameRaw: nameRaw,
        memberName: nameRaw,
        genderRaw,
        itemRaw: productNameRaw,
        sizeRaw,
        qtyRaw: "1",
        standardizedSize,
        genderNormalized,
        qtyParsed: 1,
        parseStatus: pol.parseStatus,
        parseConfidence: pol.parseConfidence,
        parseReason,
        userCorrected: false,
        excluded: false,
        metaJson: {
          productColumnIndex: productCol,
          productName: productNameRaw,
        },
      });
    }
  }

  return out;
}
