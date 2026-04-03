import { normalizeSizeWithMeta } from "./sizeUtils";
import { decomposeVariantSize } from "./variantOptions";

function detectDelimiter(line: string) {
  const comma = (line.match(/,/g) ?? []).length;
  const tab = (line.match(/\t/g) ?? []).length;
  const semi = (line.match(/;/g) ?? []).length;

  if (tab >= comma && tab >= semi) return "\t";
  if (semi >= comma && semi >= tab) return ";";
  return ",";
}

/**
 * @param preserveCellTrimIndices 셀 인덱스가 여기 포함되면 앞뒤 공백을 제거하지 않음(SKU·STOCK 원문 보존용).
 */
function parseCsvLine(line: string, delimiter: string, preserveCellTrimIndices?: Set<number>): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  const pushCell = () => {
    const idx = result.length;
    const raw = current;
    result.push(preserveCellTrimIndices?.has(idx) ? raw : raw.trim());
    current = "";
  };

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
      pushCell();
      continue;
    }

    current += c;
  }

  pushCell();
  return result;
}

function toIntOrNaN(v: string | undefined) {
  if (v == null) return NaN;
  const s = String(v).trim().replace(/,/g, "");
  if (!s) return NaN;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : NaN;
}

/** 재고: 천단위 쉼표·앞뒤 공백만 파싱용으로 처리, 그 외 값은 바꾸지 않음(Math.max 등 없음). */
function parseStockIntPreservingValue(v: string | undefined): number {
  if (v == null) return NaN;
  const s = String(v).replace(/,/g, "").trim();
  if (!s) return NaN;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : NaN;
}

const KNOWN_COLOR_CODES = new Set([
  "BK",
  "BL",
  "WH",
  "RD",
  "LM",
  "NV",
  "NY",
  "MT",
  "GY",
  "GR",
  "PK",
  "BE",
  "BR",
  "CH",
  "DG",
  "IV",
  "KH",
  "OR",
  "YL",
  "PU",
  "GN",
  "SB",
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

/**
 * CSV 재고를 어디에 둘지(변형 vs 단일 상품).
 * - true: `products.stock`은 0, 재고는 `product_variants` 행에만.
 * - false: `products.stock`에 반영, 변형 행은 없음(업로드 시 삽입 안 함).
 *
 * 규칙: 동일 SKU가 **2행 이상**이거나, **size 컬럼(rawSize)** 이 비어 있지 않으면 변형 모드.
 * 단일 행 + size 컬럼 공백이면 단일 상품 재고 — 상품명/SKU에서만 채워진 파생 `size`(예: BL)는 변형으로 보지 않음.
 */
export function csvGroupUsesVariantStock(group: ParsedCsvRow[]): boolean {
  if (group.length === 0) return false;
  if (group.length > 1) return true;
  return (group[0].rawSize ?? "").trim() !== "";
}

export type ParsedCsvRow = {
  /** DB·그룹 키 — CSV sku 셀 원문(해당 셀만 trim 생략) */
  sku: string;
  rawSkuFromCsv: string;
  rawStockFromCsv: string;
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
  /** stock 컬럼 숫자 파싱 결과(실패 시 0) */
  stockVal: number;
  wholesale: number | null;
  msrp: number | null;
  sale: number | null;
  extra: number | null;
  memo: string | null;
  memo2: string | null;
  /** 헤더 제외, 유효 SKU가 있는 데이터 행 기준 번호(1부터) */
  dataRowIndex: number;
  /** DB product_variants.option1/2/size — 파이프라인 끝에서 `size`(결합)에서 분리 */
  variantOption1: string;
  variantOption2: string;
  variantSizePure: string;
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
function parseCsvRows(
  lines: string[],
  delimiter: string,
  col: CsvColMap,
  headerLineIndex: number
): { rows: ParsedCsvRow[]; skippedRows: number[] } {
  const rows: ParsedCsvRow[] = [];
  const skippedRows: number[] = [];

  let dataRowIndex = 0; // 유효 SKU가 있는 데이터 행 기준(에러 메시지용)

  const preserveSkuStockTrim = new Set<number>();
  if (col.sku >= 0) preserveSkuStockTrim.add(col.sku);
  if (col.stock >= 0) preserveSkuStockTrim.add(col.stock);

  for (let i = headerLineIndex + 1; i < lines.length; i++) {
    if (!lines[i] || lines[i].trim() === "") continue;

    const cols = parseCsvLine(lines[i], delimiter, preserveSkuStockTrim);
    const rawSkuFromCsv = cols[col.sku] ?? "";
    if (rawSkuFromCsv === "") {
      // Excel/CSV에서 사용자가 보는 "파일 라인 번호(헤더 포함)" 기준으로 반환
      skippedRows.push(i + 1);
      continue;
    }
    const sku = rawSkuFromCsv;

    dataRowIndex += 1;

    const category = col.category >= 0 ? (cols[col.category] ?? "").trim() || null : null;
    const rawNameSpec = col.name >= 0 ? (cols[col.name] ?? "").trim() : "";
    const nameParts = mergeKnownColorFromSku(sku, splitNameSpecParts(rawNameSpec));
    const nameSpec = nameParts.baseName || rawNameSpec;
    const imageUrl = col.imageUrl >= 0 ? (cols[col.imageUrl] ?? "").trim() || null : null;
    const rawSize = col.size >= 0 ? (cols[col.size] ?? "").trim() || "" : "";
    let size = buildOptionValue(rawSize, nameParts.optionTag, nameParts.sizeHint);
    size = normalizeVariantSizeBySku(sku, size);
    if (size) {
      const normalizedSize = normalizeSizeWithMeta(size);
      size = normalizedSize.normalized;
      if (!normalizedSize.recoverable) {
        console.warn(
          `[CSV] size 보정 경고: 원본="${(cols[col.size] ?? "").trim()}" -> 정규화="${size}", reason=${normalizedSize.reason ?? "unknown"}`
        );
      }
    }
    const rawStockFromCsv = col.stock >= 0 ? String(cols[col.stock] ?? "") : "";
    const stockRaw = col.stock >= 0 ? parseStockIntPreservingValue(cols[col.stock]) : NaN;
    const stockVal = Number.isFinite(stockRaw) ? stockRaw : 0;
    const wholesale = col.wholesale >= 0 ? toIntOrNaN(cols[col.wholesale]) : null;
    const msrp = col.msrp >= 0 ? toIntOrNaN(cols[col.msrp]) : null;
    const sale = col.sale >= 0 ? toIntOrNaN(cols[col.sale]) : null;
    const extra = col.extra >= 0 ? toIntOrNaN(cols[col.extra]) : null;
    const memo = col.memo >= 0 ? (cols[col.memo] ?? "").trim() || null : null;
    const memo2 = col.memo2 >= 0 ? (cols[col.memo2] ?? "").trim() || null : null;

    rows.push({
      sku,
      rawSkuFromCsv,
      rawStockFromCsv,
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
      variantOption1: "",
      variantOption2: "",
      variantSizePure: "",
    });
  }

  return { rows, skippedRows };
}

function inferColorCodeFromSku(sku: string): string | null {
  const m = /([A-Z]{2,3})$/i.exec((sku ?? "").trim());
  if (!m) return null;
  return m[1].toUpperCase();
}

/** 상품명에 색이 없고 SKU 끝만 NY·BK 등인 경우에도 옵션(size)에 색 태그가 붙도록 보강 */
function mergeKnownColorFromSku(sku: string, parts: NameSpecParts): NameSpecParts {
  const code = inferColorCodeFromSku(sku);
  if (!code || !KNOWN_COLOR_CODES.has(code)) return parts;
  const codeNorm = normalizeTextForCompare(code);
  const already = parts.optionParts.some((p) => normalizeTextForCompare(p) === codeNorm);
  if (already) return parts;
  const optionParts = [code, ...parts.optionParts];
  const uniqueOptionParts = optionParts.filter((p, idx) => optionParts.findIndex((x) => x === p) === idx);
  const optionTag = uniqueOptionParts.length > 0 ? uniqueOptionParts.join(" / ") : null;
  return {
    ...parts,
    color: parts.color ?? code,
    optionParts: uniqueOptionParts,
    optionTag,
  };
}

function looksLikeTerminalSizeToken(token: string): boolean {
  const v = (token ?? "").trim().toUpperCase();
  if (!v) return false;
  if (/^[WM]\D*\d+/.test(v)) return true;
  if (/^\d+$/.test(v)) return true;
  if (/^(XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|FREE|OS)$/.test(v)) return true;
  return false;
}

function normalizeVariantSizeBySku(sku: string, size: string): string {
  const trimmed = (size ?? "").trim();
  if (!trimmed) return "";
  const parts = trimmed
    .split("/")
    .map((x) => x.trim())
    .filter(Boolean);
  if (parts.length !== 2) return trimmed;

  const first = parts[0];
  const second = parts[1];
  if (!/^(남|여|공용|UNISEX)$/i.test(first)) return trimmed;
  if (!looksLikeTerminalSizeToken(second)) return trimmed;

  const colorRaw = inferColorCodeFromSku(sku);
  const color = colorRaw && KNOWN_COLOR_CODES.has(colorRaw) ? colorRaw : null;
  if (!color) return trimmed;
  return `${first} / ${color} / ${second}`;
}

/** name 컬럼: trim + 연속 공백 정리. */
function normalizeCsvNameWhitespace(raw: string): string {
  return normalizeSpaces((raw ?? "").trim());
}

function normalizeBaseNameForSkuGroupCompare(baseName: string): string {
  return normalizeTextForCompare(normalizeCsvNameWhitespace(baseName));
}

/**
 * 동일 SKU: rawNameSpec은 행마다 유지. split 결과(옵션·성별·sizeHint 등)는 행별 원문 기준.
 * products.name_spec용 공통 baseName만 첫 non-empty 행 기준 대표값으로 통일.
 */
function unifySkuGroupCanonicalBase(group: ParsedCsvRow[]): void {
  if (group.length <= 1) return;

  let canonicalBaseName: string | null = null;
  let canonicalCompareKey: string | null = null;
  for (const r of group) {
    const raw = normalizeCsvNameWhitespace(r.rawNameSpec ?? "");
    if (!raw) continue;
    const np = mergeKnownColorFromSku(r.sku, splitNameSpecParts(r.rawNameSpec ?? ""));
    const baseTrimmed = normalizeCsvNameWhitespace(np.baseName ?? "");
    if (baseTrimmed) {
      canonicalBaseName = np.baseName;
      canonicalCompareKey = normalizeBaseNameForSkuGroupCompare(np.baseName);
      break;
    }
  }

  if (canonicalBaseName && canonicalCompareKey) {
    const divergent: Array<{ dataRowIndex: number; baseName: string; rawNameSpec: string }> = [];
    for (const r of group) {
      const raw = normalizeCsvNameWhitespace(r.rawNameSpec ?? "");
      if (!raw) continue;
      const np = mergeKnownColorFromSku(r.sku, splitNameSpecParts(r.rawNameSpec ?? ""));
      const rowBase = np.baseName ?? "";
      if (!normalizeCsvNameWhitespace(rowBase)) continue;
      if (normalizeBaseNameForSkuGroupCompare(rowBase) !== canonicalCompareKey) {
        divergent.push({
          dataRowIndex: r.dataRowIndex,
          baseName: rowBase,
          rawNameSpec: r.rawNameSpec ?? "",
        });
      }
    }
    if (divergent.length > 0) {
      console.warn(
        `[CSV] SKU ${group[0]?.sku ?? "?"}: 같은 SKU에서 공통 상품명(base)이 서로 다릅니다. 대표 base만 nameSpec에 쓰고, 각 행 raw name·옵션(부수/성별/사이즈)은 유지합니다.`,
        { representativeBaseName: canonicalBaseName, divergentRows: divergent }
      );
    }
  }

  for (const r of group) {
    const nameParts = mergeKnownColorFromSku(r.sku, splitNameSpecParts(r.rawNameSpec ?? ""));
    if (canonicalBaseName) {
      r.nameSpec = canonicalBaseName;
    }
    r.color = nameParts.color;
    r.gender = nameParts.gender;
    r.optionTag = nameParts.optionTag;
    r.optionParts = nameParts.optionParts;
    let size = buildOptionValue(r.rawSize, nameParts.optionTag, nameParts.sizeHint);
    size = normalizeVariantSizeBySku(r.sku, size);
    if (size) {
      const normalizedSize = normalizeSizeWithMeta(size);
      r.size = normalizedSize.normalized;
    } else {
      r.size = "";
    }
  }
}

/** Within each SKU group, fill empty common fields from another row with same SKU. Do NOT fill size/stock/memo. If two non-empty values conflict, throw. Run before validateSkuConsistency. */
function normalizeSkuGroups(rows: ParsedCsvRow[]): void {
  const bySku = new Map<string, ParsedCsvRow[]>();
  for (const r of rows) {
    const arr = bySku.get(r.sku) ?? [];
    arr.push(r);
    bySku.set(r.sku, arr);
  }
  const strictCommonKeys: (keyof ParsedCsvRow)[] = ["category", "imageUrl", "wholesale", "msrp", "sale", "extra"];
  const isEmpty = (val: unknown): boolean =>
    val === null || val === undefined || (typeof val === "string" && val.trim() === "");

  for (const [, group] of bySku) {
    if (group.length <= 1) continue;
    unifySkuGroupCanonicalBase(group);

    const canon: Partial<ParsedCsvRow> = {};
    for (const r of group) {
      for (const key of strictCommonKeys) {
        const val = r[key];
        if (isEmpty(val)) continue;
        const existing = canon[key];
        const same =
          key === "category" || key === "imageUrl"
            ? sameTextForCompare(existing, val)
            : String(existing) === String(val);
        if (existing !== undefined && !same) {
          const skus = [...new Set(group.map((x) => x.sku))].join(", ");
          const keyLabelMap: Record<string, string> = {
            category: "category 불일치",
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
      for (const key of strictCommonKeys) {
        if (isEmpty(r[key]) && (canon as Record<string, unknown>)[key] !== undefined) {
          (r as Record<string, unknown>)[key] = (canon as Record<string, unknown>)[key];
        }
      }
    }

    let fallbackNameSpec: string | undefined;
    for (const r of group) {
      if (!isEmpty(r.nameSpec)) {
        fallbackNameSpec = String(r.nameSpec);
        break;
      }
    }
    if (fallbackNameSpec !== undefined) {
      for (const r of group) {
        if (isEmpty(r.nameSpec)) (r as ParsedCsvRow).nameSpec = fallbackNameSpec;
      }
    }
  }
}

/** Same SKU must have identical common fields (category/image/price). name(raw) 차이는 허용·경고만. size, stock, memo, memo2 may differ. */
function validateSkuConsistency(rows: ParsedCsvRow[]): void {
  const bySku = new Map<string, ParsedCsvRow[]>();
  for (const r of rows) {
    const arr = bySku.get(r.sku) ?? [];
    arr.push(r);
    bySku.set(r.sku, arr);
  }
  for (const [, arr] of bySku) {
    if (arr.length <= 1) continue;
    const first = arr[0];
    for (let i = 1; i < arr.length; i++) {
      const r = arr[i];
      const mismatchFields: string[] = [];
      if (!sameTextForCompare(first.category ?? "", r.category ?? "")) mismatchFields.push("category 불일치");
      if (!sameTextForCompare(first.imageUrl ?? "", r.imageUrl ?? "")) mismatchFields.push("imageUrl 불일치");
      if (String(first.wholesale ?? "") !== String(r.wholesale ?? "")) mismatchFields.push("wholesalePrice 불일치");
      if (String(first.msrp ?? "") !== String(r.msrp ?? "")) mismatchFields.push("msrpPrice 불일치");
      if (String(first.sale ?? "") !== String(r.sale ?? "")) mismatchFields.push("salePrice 불일치");
      if (String(first.extra ?? "") !== String(r.extra ?? "")) mismatchFields.push("extraPrice 불일치");

      if (normalizeNameForCompare(first.nameSpec ?? "") !== normalizeNameForCompare(r.nameSpec ?? "")) {
        console.warn(
          `[CSV] SKU ${first.sku}: 통일된 nameSpec이 행마다 다릅니다. (행 ${first.dataRowIndex}: "${first.nameSpec ?? ""}" vs 행 ${r.dataRowIndex}: "${r.nameSpec ?? ""}")`
        );
      }

      if (mismatchFields.length > 0) {
        throw new Error(
          `CSV 오류 (SKU: ${first.sku}): 동일한 SKU의 공통 상품 정보가 일치하지 않습니다. (${mismatchFields.join(", ")} / 데이터 행: ${first.dataRowIndex}, ${r.dataRowIndex})`
        );
      }
    }
  }
}

function finalizeVariantDbFields(rows: ParsedCsvRow[]): void {
  for (const r of rows) {
    const d = decomposeVariantSize(r.size);
    r.variantOption1 = d.option1;
    r.variantOption2 = d.option2;
    r.variantSizePure = d.size;
  }
}

export function runProductCsvPipeline(text: string): { rows: ParsedCsvRow[]; skippedRows: number[] } {
  const rawLines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const headerLineIndex = rawLines.findIndex((l) => (l ?? "").trim().length > 0);
  if (headerLineIndex < 0) throw new Error("CSV 오류: 헤더 라인이 없습니다.");
  const delimiter = detectDelimiter(rawLines[headerLineIndex] ?? "");
  const rawHeaders = parseCsvLine(rawLines[headerLineIndex] ?? "", delimiter);
  const col = assertStrictProductCsvHeaders(rawHeaders);
  const { rows, skippedRows } = parseCsvRows(rawLines, delimiter, col, headerLineIndex);
  if (rows.length === 0) throw new Error("CSV 오류: 유효한 SKU가 있는 데이터 행이 없습니다.");
  normalizeSkuGroups(rows);
  autofillOptionValueFromName(rows);
  validateSkuVariantRules(rows);
  validateSkuConsistency(rows);
  finalizeVariantDbFields(rows);
  return { rows, skippedRows };
}
