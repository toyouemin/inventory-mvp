"use server";

import { supabaseServer } from "@/lib/supabaseClient";
import { revalidatePath } from "next/cache";
import { normalizeSizeWithMeta } from "./sizeUtils";

const LOG_MOVES = process.env.LOG_MOVES === "1";

function resolveProductImageUrl(sku: string, imageUrl: string | null | undefined): string | null {
  const explicit = (imageUrl ?? "").trim();
  if (explicit) return explicit;
  return null;
}

/* -----------------------------
 * Helpers: CSV delimiter detect + robust parsing
 * ----------------------------- */
function detectDelimiter(line: string) {
  const comma = (line.match(/,/g) ?? []).length;
  const tab = (line.match(/\t/g) ?? []).length;
  const semi = (line.match(/;/g) ?? []).length;

  if (tab >= comma && tab >= semi) return "\t";
  if (semi >= comma && semi >= tab) return ";";
  return ",";
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];

    if (c === '"') {
      // CSV rule: "" -> "
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (c === delimiter && !inQuotes) {
      result.push(current.trim());
      current = "";
      continue;
    }

    current += c;
  }

  result.push(current.trim());
  return result;
}

function toIntOrNaN(v: string | undefined) {
  if (v == null) return NaN;
  const s = String(v).trim().replace(/,/g, "");
  if (!s) return NaN;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : NaN;
}

const KNOWN_COLOR_CODES = new Set([
  "BK", "BL", "WH", "RD", "LM", "NV", "GY", "GR", "PK", "BE", "BR", "IV", "KH", "OR", "YL", "PU", "GN", "SB",
]);
const KNOWN_COLOR_NAMES = new Set([
  "블랙",
  "화이트",
  "형광",
  "네이비",
  "레드",
  "핑크",
  "라임",
  "그레이",
  "회색",
  "차콜",
  "브라운",
  "베이지",
  "카키",
  "오렌지",
  "옐로우",
  "그린",
  "민트",
  "소라",
  "블루",
  "퍼플",
]);
const KNOWN_COLOR_NAMES_BY_LENGTH_DESC = Array.from(KNOWN_COLOR_NAMES).sort(
  (a, b) => b.length - a.length
);
const KNOWN_GENDER_TOKENS = new Set(["남", "여", "남성", "여성", "MEN", "WOMEN", "MENS", "WOMENS"]);
const KNOWN_SIZE_TOKENS = new Set(["XS", "S", "M", "L", "XL", "XXL", "XXXL", "FREE", "OS"]);

function normalizeGenderToken(token: string): string | null {
  const t = token.trim().toUpperCase();
  if (t === "남" || t === "남성" || t === "MEN" || t === "MENS") return "남";
  if (t === "여" || t === "여성" || t === "WOMEN" || t === "WOMENS") return "여";
  if (t === "공용" || t === "UNISEX") return "공용";
  return null;
}

function normalizeColorToken(token: string): string | null {
  const t = token.trim();
  const up = t.toUpperCase();
  if (/^[A-Z]{2,3}$/.test(up) && KNOWN_COLOR_CODES.has(up)) return up;
  if (KNOWN_COLOR_NAMES.has(t)) return t;
  return null;
}

function normalizeSizeToken(token: string): string | null {
  const t = token.trim().toUpperCase();
  if (/^\d+$/.test(t)) return t;
  if (KNOWN_SIZE_TOKENS.has(t)) return t;
  return null;
}

type NameSpecParts = {
  baseName: string;
  color: string | null;
  gender: string | null;
  sizeHint: string | null;
  optionTag: string | null;
  optionParts: string[];
};

function normalizeSpaces(text: string): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function unwrapSquareBracketName(nameSpec: string): { inner: string; wrapped: boolean; suffix: string } {
  const s = normalizeSpaces(nameSpec ?? "");
  const m = s.match(/^\[\s*(.*?)\s*\](.*)$/);
  if (!m) return { inner: s, wrapped: false, suffix: "" };
  return { inner: normalizeSpaces(m[1]), wrapped: true, suffix: normalizeSpaces(m[2] ?? "") };
}

function wrapSquareBracketName(inner: string, wrapped: boolean, suffix = ""): string {
  const normalizedInner = normalizeSpaces(inner);
  const normalizedSuffix = normalizeSpaces(suffix);
  if (!wrapped) return normalizeSpaces(`${normalizedInner} ${normalizedSuffix}`);
  return normalizedSuffix ? `[${normalizedInner}]${normalizedSuffix}` : `[${normalizedInner}]`;
}

function normalizeNameForCompare(nameSpec: string): string {
  const normalized = normalizeNameSpecForSku(nameSpec ?? "");
  return normalizeTextForCompare(normalized);
}

const STYLE_TOKENS = [
  "루즈핏",
  "롱기장",
  "숏기장",
  "세미와이드",
  "와이드",
  "슬림핏",
  "오버핏",
];

function isLikelySizeOptionToken(token: string): boolean {
  const t = token.trim();
  if (!t) return false;
  if (/^(?:[mMwW]\s*\d+)$/.test(t)) return true;
  if (/^\d+$/.test(t)) return true;
  if (/^공용\s*\d+$/i.test(t)) return true;
  if (/^(xs|s|m|l|xl|xxl|xxxl|free|os)$/i.test(t)) return true;
  return false;
}

function isLikelyStyleOptionToken(token: string): boolean {
  const t = token.trim();
  if (!t) return false;
  if (/^\d+부(?:남자|여자|남|여)?$/.test(t)) return true;
  if (/^(남|여|공용).+/.test(t) && (t.includes("핏") || t.includes("기장"))) return true;
  return STYLE_TOKENS.some((s) => t.includes(s));
}

function collectOptionPart(
  token: string,
  optionParts: string[],
  state: { color: string | null; gender: string | null; sizeHint: string | null }
): boolean {
  const t = normalizeSpaces(token);
  if (!t) return false;
  const color = normalizeColorToken(t);
  const gender = normalizeGenderToken(t);
  const size = normalizeSizeToken(t) ?? (isLikelySizeOptionToken(t) ? t.toUpperCase().replace(/\s+/g, "") : null);
  const style = isLikelyStyleOptionToken(t);
  if (!color && !gender && !size && !style) return false;
  optionParts.push(t);
  if (!state.color && color) state.color = color;
  if (!state.gender && gender) state.gender = gender;
  if (!state.sizeHint && size) state.sizeHint = size;
  return true;
}

function makeOptionState(color: string | null, gender: string | null, sizeHint: string | null) {
  return { color, gender, sizeHint };
}

function splitNameSpecParts(nameSpec: string): NameSpecParts {
  const { inner, wrapped, suffix } = unwrapSquareBracketName(nameSpec ?? "");
  let base = inner;
  let color: string | null = null;
  let gender: string | null = null;
  let sizeHint: string | null = null;
  const optionParts: string[] = [];

  const leadingVariantMatch = base.match(/^(\d+부(?:남자|여자))\s+(.*)$/);
  if (leadingVariantMatch) {
    const leading = normalizeSpaces(leadingVariantMatch[1]);
    optionParts.push(leading);
    base = normalizeSpaces(leadingVariantMatch[2]);
    if (!gender) {
      if (leading.endsWith("남자")) gender = "남";
      if (leading.endsWith("여자")) gender = "여";
    }
  }

  while (true) {
    const before = base;

    const genderTail = base.match(/\s+(남|여|공용)\s*$/);
    if (genderTail) {
      collectOptionPart(genderTail[1], optionParts, { color, gender, sizeHint });
      if (!gender) gender = normalizeGenderToken(genderTail[1]) ?? genderTail[1];
      base = normalizeSpaces(base.replace(/\s+(남|여|공용)\s*$/, ""));
    }

    const match = base.match(/\s*\(([^()]+)\)\s*$/);
    if (match) {
      const token = match[1].trim();
      const state = makeOptionState(color, gender, sizeHint);
      if (collectOptionPart(token, optionParts, state)) {
        color = state.color;
        gender = state.gender;
        sizeHint = state.sizeHint;
        base = normalizeSpaces(base.replace(/\s*\(([^()]+)\)\s*$/, ""));
      }
    }

    if (before === base) break;
  }

  // 끝의 복합 성별-변형 토큰 분리 (예: 남루즈핏, 여롱기장).
  const genderVariantTail = base.match(/\s+((남|여)[^\s\]]+)\s*$/);
  if (genderVariantTail) {
    const detectedTag = normalizeSpaces(genderVariantTail[1]);
    const detectedGender = normalizeGenderToken(genderVariantTail[2]);
    optionParts.push(detectedTag);
    if (!gender && detectedGender) gender = detectedGender;
    base = normalizeSpaces(base.replace(/\s+((남|여)[^\s\]]+)\s*$/, ""));
  }

  // 괄호 없이 문자열 끝에 직접 붙은 색상명도 분리 (예: ...화이트, ...형광)
  // 상품명 본체는 유지하고 끝 색상명만 제거한다.
  for (const colorName of KNOWN_COLOR_NAMES_BY_LENGTH_DESC) {
    if (base.endsWith(colorName) && base.length > colorName.length) {
      optionParts.push(colorName);
      if (!color) color = colorName;
      base = normalizeSpaces(base.slice(0, -colorName.length));
      break;
    }
  }

  // 문자열 끝에 색상코드가 직접 붙은 패턴도 분리 (예: TRS-800GR, TRS-800OR)
  // 숫자/영문 본체 뒤에 2~3자리 색상코드가 붙는 경우만 처리해 과도한 제거를 방지한다.
  const tailColorCodeMatch = base.match(/^(.*[0-9A-Z])([A-Z]{2,3})$/i);
  if (tailColorCodeMatch) {
    const code = tailColorCodeMatch[2].toUpperCase();
    if (KNOWN_COLOR_CODES.has(code)) {
      optionParts.push(code);
      if (!color) color = code;
      base = normalizeSpaces(tailColorCodeMatch[1]);
    }
  }

  // 마지막 단어가 옵션 후보라면 공통명에서 분리
  const tailWordMatch = base.match(/\s+([^\s\]]+)\s*$/);
  if (tailWordMatch) {
    const state = makeOptionState(color, gender, sizeHint);
    const tailWord = normalizeSpaces(tailWordMatch[1]);
    if (collectOptionPart(tailWord, optionParts, state)) {
      color = state.color;
      gender = state.gender;
      sizeHint = state.sizeHint;
      base = normalizeSpaces(base.replace(/\s+([^\s\]]+)\s*$/, ""));
    }
  }

  const uniqueOptionParts = optionParts.filter((p, idx) => optionParts.findIndex((x) => x === p) === idx);
  const optionTag = uniqueOptionParts.length > 0 ? uniqueOptionParts.join(" / ") : null;
  return {
    baseName: wrapSquareBracketName(base, wrapped, suffix),
    color,
    gender,
    sizeHint,
    optionTag,
    optionParts: uniqueOptionParts,
  };
}

function normalizeNameSpecForSku(nameSpec: string): string {
  return normalizeSpaces(splitNameSpecParts(nameSpec).baseName);
}

function normalizeTextForCompare(v: unknown): string {
  return normalizeSpaces(String(v ?? "")).toUpperCase();
}

function sameTextForCompare(a: unknown, b: unknown): boolean {
  return normalizeTextForCompare(a) === normalizeTextForCompare(b);
}

function buildOptionValue(rawSize: string, optionTag: string | null, sizeHint: string | null): string {
  const raw = normalizeSpaces(rawSize);
  const tag = normalizeSpaces(optionTag ?? "");
  const hint = normalizeSpaces(sizeHint ?? "");

  if (raw && tag) {
    const rawNorm = normalizeTextForCompare(raw);
    const tagNorm = normalizeTextForCompare(tag);
    if (rawNorm === tagNorm || rawNorm.includes(tagNorm) || tagNorm.includes(rawNorm)) {
      return raw;
    }
    return `${tag} / ${raw}`;
  }
  if (raw) return raw;
  if (tag) return tag;
  if (hint) return hint;
  return "";
}

type CsvColMap = {
  sku: number;
  category: number;
  name: number;
  imageUrl: number;
  size: number;
  stock: number;
  wholesale: number;
  msrp: number;
  sale: number;
  extra: number;
  memo: number;
  memo2: number;
};

type ParsedCsvRow = {
  sku: string;
  category: string | null;
  rawNameSpec: string;
  nameSpec: string;
  color: string | null;
  gender: string | null;
  optionTag: string | null;
  optionParts: string[];
  imageUrl: string | null;
  rawSize: string;
  size: string;
  stockVal: number;
  wholesale: number | null;
  msrp: number | null;
  sale: number | null;
  extra: number | null;
  memo: string | null;
  memo2: string | null;
  /** 헤더 제외, 유효 SKU가 있는 데이터 행 기준 번호(1부터) */
  dataRowIndex: number;
};

/** 다운로드와 동일하게 영문 컬럼 허용(필수 11 + 선택 memo2, 표기·대소문자 무관, 공백 무시). */
const REQUIRED_CSV_COLUMNS = [
  "sku",
  "category",
  "name",
  "imageurl",
  "size",
  "stock",
  "wholesaleprice",
  "msrpprice",
  "saleprice",
  "extraprice",
  "memo",
] as const;
const OPTIONAL_CSV_COLUMNS = ["memo2"] as const;

function assertStrictProductCsvHeaders(rawHeaders: string[]): CsvColMap {
  const normalized = rawHeaders.map((h) => h.trim().toLowerCase().replace(/\s/g, ""));
  if (
    normalized.length !== REQUIRED_CSV_COLUMNS.length &&
    normalized.length !== REQUIRED_CSV_COLUMNS.length + OPTIONAL_CSV_COLUMNS.length
  ) {
    throw new Error(
      `CSV 오류: 헤더는 11개 또는 12개 컬럼이어야 합니다.\n필요: sku, category, name, imageUrl, size, stock, wholesalePrice, msrpPrice, salePrice, extraPrice, memo (+선택: memo2)\n현재 ${normalized.length}개: ${rawHeaders.join(", ")}`
    );
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`CSV 오류: 헤더에 중복된 컬럼명이 있습니다. (${rawHeaders.join(", ")})`);
  }
  for (const req of REQUIRED_CSV_COLUMNS) {
    if (!normalized.includes(req)) {
      throw new Error(
        `CSV 오류: 필수 컬럼이 없습니다 (누락: ${req}).\n필요(순서 무관): sku, category, name, imageUrl, size, stock, wholesalePrice, msrpPrice, salePrice, extraPrice, memo (+선택: memo2)\n현재: ${rawHeaders.join(", ")}`
      );
    }
  }
  const idx = (key: string) => normalized.indexOf(key);
  return {
    sku: idx("sku"),
    category: idx("category"),
    name: idx("name"),
    imageUrl: idx("imageurl"),
    size: idx("size"),
    stock: idx("stock"),
    wholesale: idx("wholesaleprice"),
    msrp: idx("msrpprice"),
    sale: idx("saleprice"),
    extra: idx("extraprice"),
    memo: idx("memo"),
    memo2: idx("memo2"),
  };
}

/** 같은 SKU에서 사이즈 있음/없음 혼재 금지. 사이즈 없음은 해당 SKU당 1행만. */
function validateSkuVariantRules(rows: ParsedCsvRow[]): void {
  const bySku = new Map<string, ParsedCsvRow[]>();
  for (const r of rows) {
    const arr = bySku.get(r.sku) ?? [];
    arr.push(r);
    bySku.set(r.sku, arr);
  }
  for (const [sku, arr] of bySku) {
    const hasEmpty = arr.some((r) => r.size === "");
    const hasFilled = arr.some((r) => r.size !== "");
    if (hasEmpty && hasFilled) {
      const nums = arr.map((r) => r.dataRowIndex).join(", ");
      throw new Error(
        `CSV 오류 (SKU: ${sku}): 사이즈가 비어 있는 행과 사이즈가 있는 행이 함께 있습니다. (데이터 행: ${nums})\n한 SKU는「전부 사이즈 비움(products.stock)」또는「전부 사이즈 지정(variant)」만 가능합니다.`
      );
    }
    if (hasEmpty && arr.length > 1) {
      throw new Error(
        `CSV 오류 (SKU: ${sku}): 사이즈가 없을 때는 한 SKU당 1행만 허용합니다. (${arr.length}행, 데이터 행: ${arr.map((r) => r.dataRowIndex).join(", ")})`
      );
    }
  }
}

/**
 * 보정 규칙:
 * - 동일 SKU 그룹에서 size가 모두 비어 있고 다중행일 때
 * - name 파싱에서 색상 옵션을 각 행마다 유일하게 추출할 수 있으면
 *   해당 값을 size(optionValue)로 자동 주입한다.
 * - 추출 실패/중복이면 기존 검증 로직이 에러를 내도록 그대로 둔다.
 */
function autofillOptionValueFromName(rows: ParsedCsvRow[]): void {
  const bySku = new Map<string, ParsedCsvRow[]>();
  for (const r of rows) {
    const arr = bySku.get(r.sku) ?? [];
    arr.push(r);
    bySku.set(r.sku, arr);
  }

  for (const [sku, group] of bySku) {
    if (group.length <= 1) continue;
    if (group.some((r) => (r.size ?? "").trim() !== "")) continue;

    const optionCandidates = group.map((r) => {
      const color = normalizeSpaces(r.color ?? "");
      if (color) return color;
      const fromParts = (r.optionParts ?? [])
        .map((p) => normalizeSpaces(p))
        .find((p) => normalizeColorToken(p) !== null);
      return fromParts ?? "";
    });

    if (optionCandidates.some((v) => normalizeSpaces(v) === "")) continue;

    const normalizedForDup = optionCandidates.map((v) => normalizeTextForCompare(v));
    if (new Set(normalizedForDup).size !== normalizedForDup.length) continue;

    for (let i = 0; i < group.length; i++) {
      group[i].size = normalizeSpaces(optionCandidates[i]);
    }
    console.info(
      `[autofill-option][${sku}] size 비어있는 ${group.length}행에 name 기반 옵션 주입: ${optionCandidates.join(", ")}`
    );
  }
}

async function zeroAllVariantStocks(productId: string): Promise<void> {
  const { error } = await supabaseServer.from("product_variants").update({ stock: 0 }).eq("product_id", productId);
  if (error) throw new Error(error.message);
}

/** CSV에 없는 기존 size(variant 행)는 재고 0으로 동기화 (행 삭제 없음). */
async function zeroVariantStockNotInSizes(productId: string, sizesInCsv: Set<string>): Promise<void> {
  const { data: variants, error } = await supabaseServer
    .from("product_variants")
    .select("id, size")
    .eq("product_id", productId);
  if (error) throw new Error(error.message);
  for (const v of variants ?? []) {
    if (!sizesInCsv.has(v.size)) {
      const { error: uErr } = await supabaseServer.from("product_variants").update({ stock: 0 }).eq("id", v.id);
      if (uErr) throw new Error(uErr.message);
    }
  }
}

function parseCsvRows(
  lines: string[],
  delimiter: string,
  col: CsvColMap,
  headerLineIndex: number
): { rows: ParsedCsvRow[]; skippedRows: number[] } {
  const rows: ParsedCsvRow[] = [];
  const skippedRows: number[] = [];

  let dataRowIndex = 0; // 유효 SKU가 있는 데이터 행 기준(에러 메시지용)

  for (let i = headerLineIndex + 1; i < lines.length; i++) {
    if (!lines[i] || lines[i].trim() === "") continue;

    const cols = parseCsvLine(lines[i], delimiter);
    const sku = (cols[col.sku] ?? "").trim();
    if (!sku) {
      // Excel/CSV에서 사용자가 보는 "파일 라인 번호(헤더 포함)" 기준으로 반환
      skippedRows.push(i + 1);
      continue;
    }

    dataRowIndex += 1;

    const category = col.category >= 0 ? (cols[col.category] ?? "").trim() || null : null;
    const rawNameSpec = col.name >= 0 ? (cols[col.name] ?? "").trim() : "";
    const nameParts = splitNameSpecParts(rawNameSpec);
    const nameSpec = nameParts.baseName || rawNameSpec;
    const imageUrl = col.imageUrl >= 0 ? (cols[col.imageUrl] ?? "").trim() || null : null;
    const rawSize = col.size >= 0 ? (cols[col.size] ?? "").trim() || "" : "";
    let size = buildOptionValue(rawSize, nameParts.optionTag, nameParts.sizeHint);
    if (size) {
      const normalizedSize = normalizeSizeWithMeta(size);
      size = normalizedSize.normalized;
      if (!normalizedSize.recoverable) {
        console.warn(
          `[CSV] size 보정 경고: 원본="${(cols[col.size] ?? "").trim()}" -> 정규화="${size}", reason=${normalizedSize.reason ?? "unknown"}`
        );
      }
    }
    const stockRaw = col.stock >= 0 ? toIntOrNaN(cols[col.stock]) : NaN;
    const stockVal = Number.isFinite(stockRaw) ? Math.max(0, stockRaw) : 0;
    const wholesale = col.wholesale >= 0 ? toIntOrNaN(cols[col.wholesale]) : null;
    const msrp = col.msrp >= 0 ? toIntOrNaN(cols[col.msrp]) : null;
    const sale = col.sale >= 0 ? toIntOrNaN(cols[col.sale]) : null;
    const extra = col.extra >= 0 ? toIntOrNaN(cols[col.extra]) : null;
    const memo = col.memo >= 0 ? (cols[col.memo] ?? "").trim() || null : null;
    const memo2 = col.memo2 >= 0 ? (cols[col.memo2] ?? "").trim() || null : null;

    rows.push({
      sku,
      category,
      rawNameSpec,
      nameSpec,
      color: nameParts.color,
      gender: nameParts.gender,
      optionTag: nameParts.optionTag,
      optionParts: nameParts.optionParts,
      imageUrl,
      rawSize,
      size,
      stockVal,
      wholesale: wholesale != null && Number.isFinite(wholesale) ? wholesale : null,
      msrp: msrp != null && Number.isFinite(msrp) ? msrp : null,
      sale: sale != null && Number.isFinite(sale) ? sale : null,
      extra: extra != null && Number.isFinite(extra) ? extra : null,
      memo,
      memo2,
      dataRowIndex,
    });
  }

  return { rows, skippedRows };
}

/** Within each SKU group, fill empty common fields from another row with same SKU. Do NOT fill size/stock/memo. If two non-empty values conflict, throw. Run before validateSkuConsistency. */
function normalizeSkuGroups(rows: ParsedCsvRow[]): void {
  const bySku = new Map<string, ParsedCsvRow[]>();
  for (const r of rows) {
    const arr = bySku.get(r.sku) ?? [];
    arr.push(r);
    bySku.set(r.sku, arr);
  }
  const fillableKeys: (keyof ParsedCsvRow)[] = ["category", "nameSpec", "imageUrl", "wholesale", "msrp", "sale", "extra"];
  const isEmpty = (val: unknown): boolean =>
    val === null || val === undefined || (typeof val === "string" && val.trim() === "");

  for (const [, group] of bySku) {
    if (group.length <= 1) continue;
    const canon: Partial<ParsedCsvRow> = {};
    for (const r of group) {
      r.nameSpec = normalizeNameSpecForSku(r.rawNameSpec ?? r.nameSpec);
    }
    for (const r of group) {
      for (const key of fillableKeys) {
        const val =
          key === "nameSpec"
            ? normalizeNameSpecForSku(r.rawNameSpec ?? String(r[key] ?? ""))
            : r[key];
        if (isEmpty(val)) continue;
        const existing = canon[key];
        const same =
          key === "nameSpec"
            ? normalizeNameForCompare(String(existing ?? "")) === normalizeNameForCompare(String(val ?? ""))
            : key === "category" || key === "imageUrl"
              ? sameTextForCompare(existing, val)
              : String(existing) === String(val);
        if (existing !== undefined && !same) {
          const skus = [...new Set(group.map((x) => x.sku))].join(", ");
          const keyLabelMap: Record<string, string> = {
            category: "category 불일치",
            nameSpec: "name 불일치",
            imageUrl: "imageUrl 불일치",
            wholesale: "wholesalePrice 불일치",
            msrp: "msrpPrice 불일치",
            sale: "salePrice 불일치",
            extra: "extraPrice 불일치",
          };
          throw new Error(
            `CSV 오류 (SKU: ${skus}): 동일한 SKU의 공통 상품 정보가 서로 다릅니다. (${keyLabelMap[String(key)] ?? String(key)} / 데이터 행: ${group
              .map((x) => x.dataRowIndex)
              .join(", ")})`
          );
        }
        if (existing === undefined) (canon as Record<string, unknown>)[key] = val;
      }
    }
    for (const r of group) {
      for (const key of fillableKeys) {
        if (isEmpty(r[key]) && (canon as Record<string, unknown>)[key] !== undefined) {
          (r as Record<string, unknown>)[key] = (canon as Record<string, unknown>)[key];
        }
      }
    }
  }
}

/** Same SKU must have identical common fields (category/name/image/price). Only size, stock, memo, memo2 may differ. */
function validateSkuConsistency(rows: ParsedCsvRow[]): void {
  const bySku = new Map<string, ParsedCsvRow[]>();
  for (const r of rows) {
    const arr = bySku.get(r.sku) ?? [];
    arr.push(r);
    bySku.set(r.sku, arr);
  }
  for (const [, arr] of bySku) {
    if (arr.length <= 1) continue;
    const rowSnapshots = arr.map((row) => {
      const commonName = normalizeNameSpecForSku(row.rawNameSpec ?? row.nameSpec ?? "");
      return {
        sku: row.sku,
        rowIndex: row.dataRowIndex,
        raw: row.rawNameSpec ?? "",
        commonName,
        optionParts: row.optionParts ?? [],
        rawSize: row.rawSize ?? "",
      };
    });
    for (const row of arr) {
      const snapshot = rowSnapshots.find((x) => x.rowIndex === row.dataRowIndex);
      console.log("[normalize-name]", snapshot ?? {
        sku: row.sku,
        rowIndex: row.dataRowIndex,
        raw: row.rawNameSpec ?? "",
        commonName: normalizeNameSpecForSku(row.rawNameSpec ?? row.nameSpec ?? ""),
        optionParts: row.optionParts ?? [],
        rawSize: row.rawSize ?? "",
      });
    }
    const first = arr[0];
    const firstSnapshot = rowSnapshots.find((x) => x.rowIndex === first.dataRowIndex);
    const firstName = firstSnapshot?.commonName ?? normalizeNameSpecForSku(first.rawNameSpec ?? first.nameSpec ?? "");
    for (let i = 1; i < arr.length; i++) {
      const r = arr[i];
      const rowSnapshot = rowSnapshots.find((x) => x.rowIndex === r.dataRowIndex);
      const rowName = rowSnapshot?.commonName ?? normalizeNameSpecForSku(r.rawNameSpec ?? r.nameSpec ?? "");
      const mismatchFields: string[] = [];
      if (!sameTextForCompare(first.category ?? "", r.category ?? "")) mismatchFields.push("category 불일치");
      if (normalizeNameForCompare(firstName) !== normalizeNameForCompare(rowName)) mismatchFields.push("name 불일치");
      if (!sameTextForCompare(first.imageUrl ?? "", r.imageUrl ?? "")) mismatchFields.push("imageUrl 불일치");
      if (String(first.wholesale ?? "") !== String(r.wholesale ?? "")) mismatchFields.push("wholesalePrice 불일치");
      if (String(first.msrp ?? "") !== String(r.msrp ?? "")) mismatchFields.push("msrpPrice 불일치");
      if (String(first.sale ?? "") !== String(r.sale ?? "")) mismatchFields.push("salePrice 불일치");
      if (String(first.extra ?? "") !== String(r.extra ?? "")) mismatchFields.push("extraPrice 불일치");
      if (
        mismatchFields.length > 0
      ) {
        throw new Error(
          `CSV 오류 (SKU: ${first.sku}): 동일한 SKU의 공통 상품 정보가 일치하지 않습니다. (${mismatchFields.join(", ")} / 데이터 행: ${first.dataRowIndex}, ${r.dataRowIndex})`
        );
      }
    }
  }
}

async function deleteProductsNotInCsv(csvSkus: Set<string>): Promise<void> {
  const { data: all } = await supabaseServer.from("products").select("id, sku");
  if (!all) return;
  for (const p of all) {
    if (!csvSkus.has((p as { sku: string }).sku)) {
      await supabaseServer.from("products").delete().eq("id", (p as { id: string }).id);
    }
  }
}

/**
 * SKU별로 그룹 적용. variant 모드: products.stock=0, CSV에 없는 기존 size는 variant 재고 0.
 * 단일 재고 모드: products.stock 반영, 해당 상품의 모든 variant 재고 0.
 */
async function applyCsvProductRowsGrouped(rows: ParsedCsvRow[]): Promise<Set<string>> {
  const skuOrder: string[] = [];
  const bySku = new Map<string, ParsedCsvRow[]>();
  for (const r of rows) {
    if (!bySku.has(r.sku)) {
      skuOrder.push(r.sku);
      bySku.set(r.sku, []);
    }
    bySku.get(r.sku)!.push(r);
  }

  const csvSkus = new Set<string>();
  for (const sku of skuOrder) {
    const group = bySku.get(sku)!;
    csvSkus.add(sku);
    const row0 = group[0];
    const variantMode = row0.size !== "";

    const payload = {
      category: row0.category,
      name_spec: row0.nameSpec?.trim() || sku,
      image_url: resolveProductImageUrl(sku, row0.imageUrl),
      wholesale_price: row0.wholesale,
      msrp_price: row0.msrp,
      sale_price: row0.sale,
      extra_price: row0.extra,
    };

    const stockVal = variantMode ? 0 : row0.stockVal;
    let productId: string;
    const { data: existing } = await supabaseServer.from("products").select("id").eq("sku", sku).maybeSingle();
    if (existing?.id) {
      productId = existing.id;
      const { error: upErr } = await supabaseServer
        .from("products")
        .update({ ...payload, stock: stockVal })
        .eq("id", productId);
      if (upErr) throw new Error(upErr.message);
    } else {
      const { data: inserted, error: insErr } = await supabaseServer
        .from("products")
        .insert({ sku, ...payload, stock: stockVal })
        .select("id")
        .single();
      if (insErr) throw new Error(insErr.message);
      productId = inserted.id;
    }

    if (variantMode) {
      const sizesInCsv = new Set<string>();
      for (const r of group) {
        sizesInCsv.add(r.size);
        const { error: upsertErr } = await supabaseServer.from("product_variants").upsert(
          {
            product_id: productId,
            size: r.size,
            stock: r.stockVal,
            memo: r.memo,
            memo2: r.memo2,
          },
          { onConflict: "product_id,size" }
        );
        if (upsertErr) throw new Error(upsertErr.message);
      }
      await zeroVariantStockNotInSizes(productId, sizesInCsv);
    } else {
      await zeroAllVariantStocks(productId);
    }
  }
  return csvSkus;
}

/* -----------------------------
 * Products: create / update
 * ----------------------------- */

// 상품 추가 (variants 있으면 product_variants 삽입, 없으면 products.stock 사용)
export async function createProduct(data: {
  sku: string;
  category?: string | null;
  nameSpec: string;
  imageUrl?: string | null;
  wholesalePrice?: number | null;
  msrpPrice?: number | null;
  salePrice?: number | null;
  extraPrice?: number | null;
  memo?: string | null;
  memo2?: string | null;
  variants?: {
    size: string;
    stock: number;
    memo?: string | null;
    memo2?: string | null;
  }[];
}) {
  const sku = (data.sku ?? "").trim();
  if (!sku) return;

  const hasVariants = Array.isArray(data.variants) && data.variants.length > 0;

  const { data: inserted, error } = await supabaseServer.from("products").insert({
    sku,
    category: data.category?.trim() || null,
    name_spec: (data.nameSpec ?? "").trim(),
    image_url: resolveProductImageUrl(sku, data.imageUrl),
    wholesale_price:
      data.wholesalePrice != null && Number.isFinite(data.wholesalePrice) ? data.wholesalePrice : null,
    msrp_price: data.msrpPrice != null && Number.isFinite(data.msrpPrice) ? data.msrpPrice : null,
    sale_price: data.salePrice != null && Number.isFinite(data.salePrice) ? data.salePrice : null,
    extra_price: data.extraPrice != null && Number.isFinite(data.extraPrice) ? data.extraPrice : null,
    stock: 0,
  }).select("id").single();

  if (error) throw new Error(error.message);
  const productId = inserted.id;

  if (hasVariants && data.variants) {
    for (const v of data.variants) {
      const size = (v.size ?? "").trim();
      const stock = Number.isFinite(Number(v.stock)) ? Math.max(0, Number(v.stock)) : 0;
      const { error: vErr } = await supabaseServer.from("product_variants").insert({
        product_id: productId,
        size: size,
        stock,
        memo: v.memo?.trim() || null,
        memo2: v.memo2?.trim() || null,
      });
      if (vErr) throw new Error(vErr.message);
    }
  }

  revalidatePath("/products");
  revalidatePath("/status");
}

// 상품 수정
export async function updateProduct(
  productId: string,
  data: {
    sku?: string;
    category?: string | null;
    nameSpec?: string;
    imageUrl?: string | null;

    wholesalePrice?: number | null;
    msrpPrice?: number | null;
    salePrice?: number | null;
    extraPrice?: number | null;

    memo?: string | null;
    memo2?: string | null;
    variants?: {
      updates: Array<{
        id?: string;
        size: string;
        stock: number;
        memo?: string | null;
        memo2?: string | null;
      }>;
      deleteIds: string[];
    };
    stock?: number;
  }
) {
  if (!productId) return;

  const updateData: Record<string, unknown> = {};
  if (data.sku !== undefined) updateData.sku = data.sku.trim();
  if (data.category !== undefined) updateData.category = data.category?.trim() || null;
  if (data.nameSpec !== undefined) updateData.name_spec = data.nameSpec?.trim();
  if (data.imageUrl !== undefined) {
    let skuForImg = data.sku?.trim() ?? "";
    if (!skuForImg) {
      const { data: row } = await supabaseServer.from("products").select("sku").eq("id", productId).maybeSingle();
      skuForImg = (row?.sku as string | undefined)?.trim() ?? "";
    }
    updateData.image_url = resolveProductImageUrl(skuForImg, data.imageUrl);
  }

  if (data.wholesalePrice !== undefined) {
    updateData.wholesale_price =
      data.wholesalePrice != null && Number.isFinite(data.wholesalePrice) ? data.wholesalePrice : null;
  }
  if (data.msrpPrice !== undefined) {
    updateData.msrp_price = data.msrpPrice != null && Number.isFinite(data.msrpPrice) ? data.msrpPrice : null;
  }
  if (data.salePrice !== undefined) {
    updateData.sale_price = data.salePrice != null && Number.isFinite(data.salePrice) ? data.salePrice : null;
  }
  if (data.extraPrice !== undefined) {
    updateData.extra_price = data.extraPrice != null && Number.isFinite(data.extraPrice) ? data.extraPrice : null;
  }
  if (data.memo !== undefined) {
    updateData.memo = data.memo?.trim() || null;
  }
  if (data.memo2 !== undefined) {
    updateData.memo2 = data.memo2?.trim() || null;
  }

  if (data.stock !== undefined)
    updateData.stock = Number.isFinite(Number(data.stock)) ? Math.max(0, Number(data.stock)) : 0;
  if (data.variants && data.variants.updates.length > 0)
    updateData.stock = 0;

  const { error } = await supabaseServer.from("products").update(updateData).eq("id", productId);
  if (error) throw new Error(error.message);

  if (data.variants) {
    const { updates, deleteIds } = data.variants;
    for (const id of deleteIds) {
      if (id) {
        await supabaseServer.from("product_variants").delete().eq("id", id);
      }
    }
    for (const u of updates) {
      const size = (u.size ?? "").trim();
      const stock = Number.isFinite(Number(u.stock)) ? Math.max(0, Number(u.stock)) : 0;
      if (u.id) {
        await supabaseServer
          .from("product_variants")
          .update({ size, stock, memo: u.memo?.trim() || null, memo2: u.memo2?.trim() || null })
          .eq("id", u.id);
      } else {
        await supabaseServer.from("product_variants").insert({
          product_id: productId,
          size,
          stock,
          memo: u.memo?.trim() || null,
          memo2: u.memo2?.trim() || null,
        });
      }
    }
  }

  revalidatePath("/products");
  revalidatePath("/status");
}

// 상품 삭제 (cascade로 product_variants 자동 삭제)
export async function deleteProduct(productId: string) {
  if (!productId) return;
  const { error } = await supabaseServer.from("products").delete().eq("id", productId);
  if (error) throw new Error(error.message);
  revalidatePath("/products");
  revalidatePath("/status");
}

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Upload image to Supabase Storage bucket product-images; returns public URL. */
export async function uploadProductImage(formData: FormData): Promise<{ url: string }> {
  const file = formData.get("file") as File | null;
  if (!file || !(file instanceof File)) throw new Error("파일이 없습니다.");

  const type = file.type?.toLowerCase() ?? "";
  if (!ALLOWED_IMAGE_TYPES.includes(type)) {
    throw new Error("jpg, png, webp만 업로드할 수 있습니다.");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("파일 크기는 5MB 이하여야 합니다.");
  }

  const ext = type === "image/jpeg" ? "jpg" : type === "image/png" ? "png" : "webp";
  const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error } = await supabaseServer.storage.from("product-images").upload(path, file, {
    contentType: type,
    upsert: true,
  });

  if (error) throw new Error(error.message);

  const { data: urlData } = supabaseServer.storage.from("product-images").getPublicUrl(path);
  return { url: urlData.publicUrl };
}

/* -----------------------------
 * Stock: adjust + moves record
 * ----------------------------- */

// 재고 조정 (delta만큼 stock 변경 + moves 기록)
export async function adjustStock(productId: string, delta: number, note?: string | null) {
  if (!productId) return;
  if (!Number.isFinite(delta) || delta === 0) return;

  const { data: product, error: readErr } = await supabaseServer
    .from("products")
    .select("stock")
    .eq("id", productId)
    .single();

  if (readErr) throw new Error(readErr.message);

  const prev = (product?.stock ?? 0) as number;
  const next = Math.max(0, prev + delta);
  const actualDelta = next - prev;
  if (actualDelta === 0) return;

  const { error: upErr } = await supabaseServer.from("products").update({ stock: next }).eq("id", productId);
  if (upErr) throw new Error(upErr.message);

  if (LOG_MOVES) {
    const { error: moveErr } = await supabaseServer.from("moves").insert({
      product_id: productId,
      type: "adjust",
      qty: Math.abs(actualDelta),
      note: note?.trim() || null,
    });
    if (moveErr) throw new Error(moveErr.message);

    revalidatePath("/moves");
  }

  revalidatePath("/products");
  revalidatePath("/status");
}

// 입고/출고 기록 (필요하면 UI에서 이걸 쓰게 만들 수 있음)
export async function addMove(productId: string, type: "in" | "out", qty: number, note?: string | null) {
  if (!productId) return;
  if (!Number.isFinite(qty) || qty <= 0) return;

  const delta = type === "in" ? qty : -qty;
  await adjustStock(productId, delta, note ?? null);
}

/* -----------------------------
 * Size-based variants (product_variants table)
 * ----------------------------- */

export async function adjustVariantStock(
  variantId: string,
  delta: number,
  note?: string | null
) {
  if (!variantId || !Number.isFinite(delta) || delta === 0) return;

  const { data: row, error: readErr } = await supabaseServer
    .from("product_variants")
    .select("stock")
    .eq("id", variantId)
    .single();

  if (readErr || !row) throw new Error(readErr?.message ?? "Variant not found");

  const prev = Number(row.stock) ?? 0;
  const next = Math.max(0, prev + delta);
  const actualDelta = next - prev;
  if (actualDelta === 0) return;

  const { error: upErr } = await supabaseServer
    .from("product_variants")
    .update({ stock: next })
    .eq("id", variantId);

  if (upErr) throw new Error(upErr.message);

  if (LOG_MOVES) {
    const { data: v } = await supabaseServer.from("product_variants").select("product_id").eq("id", variantId).single();
    if (v?.product_id) {
      await supabaseServer.from("moves").insert({
        product_id: v.product_id,
        type: "adjust",
        qty: Math.abs(actualDelta),
        note: note?.trim() || null,
      });
    }
    revalidatePath("/moves");
  }

  revalidatePath("/products");
  revalidatePath("/status");
}

export async function updateVariantMemo(
  variantId: string,
  memo?: string | null,
  memo2?: string | null
) {
  if (!variantId) return;
  const { error } = await supabaseServer
    .from("product_variants")
    .update({
      memo: memo?.trim() || null,
      memo2: memo2?.trim() || null,
    })
    .eq("id", variantId);
  if (error) throw new Error(error.message);
  revalidatePath("/products");
  revalidatePath("/status");
}

export async function updateProductMemo(
  productId: string,
  memo?: string | null,
  memo2?: string | null
) {
  if (!productId) return;
  const { error } = await supabaseServer
    .from("products")
    .update({
      memo: memo?.trim() || null,
      memo2: memo2?.trim() || null,
    })
    .eq("id", productId);
  if (error) throw new Error(error.message);
  revalidatePath("/products");
  revalidatePath("/status");
}

/* -----------------------------
 * CSV Upload: 고정 10컬럼 + SKU 그룹 variant 동기화(stock 0)
 * ----------------------------- */

// 상품 CSV 업로드 (sku 기준 upsert). 항상 CSV 기준으로 완전 동기화(없는 SKU 삭제).
export async function uploadProductsCsv(formData: FormData) {
  const file = formData.get("file") as File | null;
  if (!file) return;

  const raw = await file.arrayBuffer();

  function decodeWithFallback(buf: ArrayBuffer) {
    // 1) utf-8 시도
    let t = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  
    // utf-8이 실패하면 보통 '�' (replacement char) 가 많이 생김
    const bad = (t.match(/\uFFFD/g) ?? []).length;
  
    // 2) 깨진 느낌이면 euc-kr 재시도 (엑셀/윈도우에서 흔함)
    if (bad > 0) {
      try {
        t = new TextDecoder("euc-kr", { fatal: false }).decode(buf);
      } catch {
        // 일부 환경에서 euc-kr 미지원이면 그대로 둠
      }
    }
  
    // BOM 제거
    return t.replace(/^\uFEFF/, "");
  }
  
  const text = decodeWithFallback(raw);

  const rawLines = text.split(/\r?\n/);
  const headerLineIndex = rawLines.findIndex((l) => (l ?? "").trim().length > 0);
  if (headerLineIndex < 0) {
    throw new Error("CSV 오류: 헤더 라인이 없습니다.");
  }

  const delimiter = detectDelimiter(rawLines[headerLineIndex] ?? "");

  const rawHeaders = parseCsvLine(rawLines[headerLineIndex] ?? "", delimiter);
  const col = assertStrictProductCsvHeaders(rawHeaders);

  const { rows, skippedRows } = parseCsvRows(rawLines, delimiter, col, headerLineIndex);
  if (rows.length === 0) {
    throw new Error("CSV 오류: 유효한 SKU가 있는 데이터 행이 없습니다.");
  }
  normalizeSkuGroups(rows);
  autofillOptionValueFromName(rows);
  validateSkuVariantRules(rows);
  validateSkuConsistency(rows);
  const csvSkus = await applyCsvProductRowsGrouped(rows);
  await deleteProductsNotInCsv(csvSkus);
  revalidatePath("/products");
  revalidatePath("/status");
  if (LOG_MOVES) revalidatePath("/moves");

  return {
    skippedCount: skippedRows.length,
    skippedRows,
  };
}
/* -----------------------------
 * Stock: move between locations (stub/implementation)
 * ----------------------------- */
/*
// 재고 이동(로케이션 이동) — 지금은 기능 연결용으로 최소 구현
export async function moveStock(input: {
  productId: string;
  fromLocationId?: string | null;
  toLocationId?: string | null;
  qty: number;
  note?: string | null;
}) {
  // ✅ 지금 DB에 location/balance 테이블이 없거나 아직 구현 전이면,
  // 일단 빌드 통과 + UI 동작 방지용으로 에러를 던져도 되고,
  // 최소로는 adjustStock/addMove로 대체할 수도 있어.

  // 임시: 단순 조정으로 처리(“이동”을 로그로 남기고 싶다면 moves.type="move" 같은 걸로 확장)
  // 여기선 일단 안전하게 아무것도 안 하고 리턴만.
  // 필요하면 나중에 supabase RPC로 from->to 차감/증가 트랜잭션 구현하자.
  return { ok: true };
}*/