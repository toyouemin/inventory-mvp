import { normalizeCategoryLabel } from "./categoryNormalize";
import { normalizeSkuForMatch } from "./skuNormalize";

/**
 * 상품 CSV: 컬럼값만 사용(상품명·성별·사이즈 추론 없음). color는 trim만 하고 파싱·정규화하지 않음(라벨 전용).
 * 필수 헤더(15개): SKU, 카테고리, 상품명, 이미지url, color, gender, size, stock, wholesalePrice, msrpPrice,
 * salePrice, extraPrice, memo, memo2, 수량변경일 — `productStockExportShared` 첫 시트와 동일.
 *
 * --- 헤더 ---
 * 위 이름이 **모두 존재**하면 통과합니다. **순서·총 컬럼 개수는 제한하지 않으며**, 그 외 컬럼은 매핑·파싱에서 사용하지 않습니다.
 *
 * --- 재고가 0으로만 저장되는 흔한 원인 (color/gender 공백 행) ---
 * 1) 데이터 행 셀 수가 부족하면 필수 인덱스까지 뒤를 ""로 패딩합니다. color·gender를 비울 때 구분자를 덜 넣으면
 *    값이 밀려 size·stock 인덱스가 어긋날 수 있습니다.
 * 2) 가운데 빈 color/gender는 반드시 `,,` 또는 탭 구분에서 빈 칸을 맞춰야 합니다.
 * 3) **TSV(탭 구분)** 지원: 구분자는 **헤더 줄**에서 `\t` → `,` → `;` 순으로 시도해 필수 15개가 모두 인식되면 채택.
 *
 * 디버그: .env.local 에 `DEBUG_CSV_SKU=T21AC01NP` (normalizeSkuForMatch 기준으로 비교)
 *        또는 `DEBUG_CSV_PRODUCT_PIPELINE=1` 이면 칸 수 부족 시 원본 라인·cells 요약 로그.
 */

const REQUIRED_HEADERS = [
  "SKU",
  "카테고리",
  "상품명",
  "이미지url",
  "color",
  "gender",
  "size",
  "stock",
  "wholesalePrice",
  "msrpPrice",
  "salePrice",
  "extraPrice",
  "memo",
  "memo2",
  "수량변경일",
] as const;

export type ColMap = Record<(typeof REQUIRED_HEADERS)[number], number>;

export type ParsedCsvRow = {
  sku: string;
  category: string;
  name: string;
  imageUrl: string;
  color: string;
  gender: string;
  size: string;
  stock: number;
  wholesale: number;
  msrp: number;
  sale: number;
  extra: number;
  memo: string | null;
  memo2: string | null;
  dataRowIndex: number;
};

const EXPECTED_COL_COUNT = REQUIRED_HEADERS.length;

function envFlag(name: string) {
  return String(process.env[name] ?? "").trim() === "1";
}

function debugSkuMatches(sku: string) {
  const want = String(process.env.DEBUG_CSV_SKU ?? "").trim();
  return want.length > 0 && normalizeSkuForMatch(sku) === normalizeSkuForMatch(want);
}

function logPipelineMismatch(
  kind: string,
  ctx: {
    fileLine1: number;
    rawLine: string;
    cellCount: number;
    cells: string[];
    col?: ColMap;
    /** 필수 컬럼 인덱스 상한+1(미만이면 패딩) */
    expectedMinCells?: number;
  }
) {
  const { fileLine1, rawLine, cellCount, cells, col, expectedMinCells } = ctx;
  const base = {
    kind,
    fileLine1,
    cellCount,
    expectedMinCells: expectedMinCells ?? EXPECTED_COL_COUNT,
    rawLinePreview: rawLine.length > 500 ? `${rawLine.slice(0, 500)}…` : rawLine,
    cells,
  };
  if (col) {
    console.warn(
      "[csvProductPipeline]",
      JSON.stringify({
        ...base,
        colIndices: { size: col.size, stock: col.stock },
        sizeRaw: cells[col.size],
        stockRaw: cells[col.stock],
      })
    );
  } else {
    console.warn("[csvProductPipeline]", JSON.stringify(base));
  }
}

function logDebugSkuRow(
  fileLine1: number,
  rawLine: string,
  cells: string[],
  col: ColMap,
  phase: "after-normalize"
) {
  console.info(
    "[csvProductPipeline][DEBUG_CSV_SKU]",
    JSON.stringify({
      phase,
      fileLine1,
      cellCount: cells.length,
      rawLine: rawLine.length > 800 ? `${rawLine.slice(0, 800)}…` : rawLine,
      cells,
      colIndices: {
        color: col.color,
        gender: col.gender,
        size: col.size,
        stock: col.stock,
      },
      colorRaw: cells[col.color],
      genderRaw: cells[col.gender],
      sizeRaw: cells[col.size],
      stockRaw: cells[col.stock],
    })
  );
}

/** 필수 컬럼 인덱스까지 셀 배열 확보: 부족하면 뒤에 "" 패딩. 추가 셀은 읽지 않음(잘라내지 않음). */
function maxRequiredColumnIndex(col: ColMap): number {
  let m = -1;
  for (const h of REQUIRED_HEADERS) {
    m = Math.max(m, col[h]);
  }
  return m;
}

function normalizeDataRowCellCount(
  cells: string[],
  fileLine1: number,
  rawLine: string,
  col: ColMap
): string[] {
  const need = maxRequiredColumnIndex(col) + 1;
  const n = cells.length;
  if (n >= need) return cells;

  if (envFlag("DEBUG_CSV_PRODUCT_PIPELINE")) {
    logPipelineMismatch("cells_short_will_pad_trailing", {
      fileLine1,
      rawLine,
      cellCount: n,
      cells,
      col,
      expectedMinCells: need,
    });
  }
  const out = cells.slice();
  while (out.length < need) out.push("");
  return out;
}

function detectDelimiter(line: string) {
  const comma = (line.match(/,/g) ?? []).length;
  const tab = (line.match(/\t/g) ?? []).length;
  const semi = (line.match(/;/g) ?? []).length;
  if (tab >= comma && tab >= semi) return "\t";
  if (semi >= comma && semi >= tab) return ";";
  return ",";
}

/** 셀 앞뒤 공백 제거 + UTF-8 BOM(U+FEFF) 등 제거(특히 첫 컬럼 SKU) */
function stripCellValue(s: string): string {
  return String(s ?? "")
    .replace(/^\uFEFF+/, "")
    .replace(/\uFEFF/g, "")
    .trim();
}

/**
 * 헤더 줄로 구분자 확정. 데이터 행에 쉼표가 많아도(숫자 포맷 등) TSV를 올바르게 쓰려면 탭 우선.
 */
function inferDelimiterFromHeaderLine(line: string): string {
  for (const delimiter of ["\t", ",", ";"] as const) {
    const cells = parseCsvLine(line, delimiter);
    if (buildColMapFromHeaderCells(cells).error === null) return delimiter;
  }
  return detectDelimiter(line);
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  const pushCell = () => {
    result.push(stripCellValue(current));
    current = "";
  };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
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

function parseNumberCell(v: string | undefined, fallback = 0): number {
  const s = String(v ?? "")
    .replace(/\uFEFF/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/\u200B/g, "")
    .replace(/\r/g, "")
    .replace(/\n/g, "")
    .replace(/,/g, "")
    .trim();
  if (!s) return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

/**
 * 헤더 셀 배열에서 REQUIRED_HEADERS 이름별 인덱스만 매핑합니다. 그 외 헤더는 무시합니다.
 * 필수 이름이 하나라도 없으면 error.
 */
function buildColMapFromHeaderCells(headerCells: string[]): { col: ColMap; error: string | null } {
  const stripped = headerCells.map((h) => stripCellValue(String(h ?? "")));
  const missing: string[] = [];
  const col = {} as ColMap;

  for (const req of REQUIRED_HEADERS) {
    const idx = stripped.findIndex((h) => h === req);
    if (idx < 0) missing.push(req);
    else col[req] = idx;
  }

  if (missing.length > 0) {
    return {
      col: {} as ColMap,
      error: `CSV 오류: 필수 컬럼이 누락되었습니다.\n누락된 필수 컬럼: ${missing.join(", ")}`,
    };
  }

  return { col, error: null };
}

function assertHeaders(rawHeaders: string[]): ColMap {
  const cells = rawHeaders.map((h) => stripCellValue(String(h ?? "")));
  const { col, error } = buildColMapFromHeaderCells(cells);
  if (error) throw new Error(error);
  return col;
}

function aoaRowIsEmpty(row: string[]): boolean {
  return row.every((c) => stripCellValue(String(c ?? "")) === "");
}

/**
 * XLSX 등에서 읽은 2차원 배열(첫 시트)을 CSV 파이프라인과 동일 규칙으로 파싱합니다.
 * 헤더·데이터는 `runProductCsvPipeline`과 동일한 검증(assertHeaders / normalizeDataRowCellCount)을 사용합니다.
 */
export function runProductPipelineFromAoa(maybeAoa: unknown[][]): { rows: ParsedCsvRow[]; skippedRows: number[] } {
  const aoa: string[][] = (maybeAoa ?? []).map((row) =>
    (row ?? []).map((c) => {
      if (c == null) return "";
      if (typeof c === "string") return c;
      if (typeof c === "number" || typeof c === "boolean") return String(c);
      return String(c);
    })
  );

  const headerIndex = aoa.findIndex((row) => !aoaRowIsEmpty(row));
  if (headerIndex < 0) {
    throw new Error("엑셀 첫 번째 시트가 비어 있습니다.");
  }

  const headerForAssert = aoa[headerIndex].map((c) => String(c ?? ""));
  const col = assertHeaders(headerForAssert);

  const rows: ParsedCsvRow[] = [];
  const skippedRows: number[] = [];
  let dataRowIndex = 0;

  for (let i = headerIndex + 1; i < aoa.length; i += 1) {
    if (aoaRowIsEmpty(aoa[i] ?? [])) continue;
    const fileLine1 = i + 1;
    const parsed = normalizeDataRowCellCount(
      (aoa[i] ?? []).map((c) => stripCellValue(String(c))),
      fileLine1,
      (aoa[i] ?? []).join("\t"),
      col
    );
    const rawLine = (aoa[i] ?? []).join("\t");

    const sku = normalizeSkuForMatch((parsed[col.SKU] ?? "") as string);
    if (!sku) {
      skippedRows.push(i + 1);
      continue;
    }

    const name = (parsed[col["상품명"]] ?? "").trim();
    if (!name) {
      skippedRows.push(i + 1);
      continue;
    }

    dataRowIndex += 1;

    if (debugSkuMatches(sku)) {
      logDebugSkuRow(fileLine1, rawLine, parsed, col, "after-normalize");
    }

    const category = normalizeCategoryLabel((parsed[col.카테고리] ?? "") as string);
    const imageUrl = String(parsed[col.이미지url] ?? "").trim();
    const color = (parsed[col.color] ?? "").trim();
    const gender = (parsed[col.gender] ?? "").trim();
    const size = (parsed[col.size] ?? "").trim();
    const stockRaw = parsed[col.stock];
    const stock = parseNumberCell(stockRaw, 0);
    const wholesale = parseNumberCell(parsed[col.wholesalePrice], 0);
    const sale = parseNumberCell(parsed[col.salePrice], 0);
    const msrp = parseNumberCell(parsed[col.msrpPrice], 0);
    const extra = parseNumberCell(parsed[col.extraPrice], 0);
    const memoRaw = (parsed[col.memo] ?? "").trim();
    const memo2Raw = (parsed[col.memo2] ?? "").trim();

    rows.push({
      sku,
      category,
      name,
      imageUrl,
      color,
      gender,
      size,
      stock,
      wholesale,
      msrp,
      sale,
      extra,
      memo: memoRaw ? memoRaw : null,
      memo2: memo2Raw ? memo2Raw : null,
      dataRowIndex,
    });
  }

  if (rows.length === 0) {
    throw new Error("CSV 오류: 유효한 데이터 행이 없습니다. (SKU·상품명 필수)");
  }

  return { rows, skippedRows };
}

export function runProductCsvPipeline(text: string): { rows: ParsedCsvRow[]; skippedRows: number[] } {
  const rawLines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const headerLineIndex = rawLines.findIndex((l) => (l ?? "").trim().length > 0);
  if (headerLineIndex < 0) throw new Error("CSV 오류: 헤더 라인이 없습니다.");

  const headerLineRaw = rawLines[headerLineIndex] ?? "";
  const delimiter = inferDelimiterFromHeaderLine(headerLineRaw);
  const headerCells = parseCsvLine(headerLineRaw, delimiter);
  const col = assertHeaders(headerCells);

  const rows: ParsedCsvRow[] = [];
  const skippedRows: number[] = [];
  let dataRowIndex = 0;

  for (let i = headerLineIndex + 1; i < rawLines.length; i++) {
    if (!rawLines[i] || rawLines[i].trim() === "") continue;
    const rawLine = rawLines[i];
    const fileLine1 = i + 1;
    const parsed = parseCsvLine(rawLine, delimiter);
    const cells = normalizeDataRowCellCount(parsed, fileLine1, rawLine, col);

    const sku = normalizeSkuForMatch(cells[col.SKU] ?? "");
    if (!sku) {
      skippedRows.push(i + 1);
      continue;
    }

    const name = (cells[col["상품명"]] ?? "").trim();
    if (!name) {
      skippedRows.push(i + 1);
      continue;
    }

    dataRowIndex += 1;

    if (debugSkuMatches(sku)) {
      logDebugSkuRow(fileLine1, rawLine, cells, col, "after-normalize");
    }

    const category = normalizeCategoryLabel(cells[col.카테고리] ?? "");
    const imageUrl = String(cells[col.이미지url] ?? "").trim();
    const color = (cells[col.color] ?? "").trim();
    const gender = (cells[col.gender] ?? "").trim();
    const size = (cells[col.size] ?? "").trim();
    const stockRaw = cells[col.stock];
    const stock = parseNumberCell(stockRaw, 0);
    const wholesale = parseNumberCell(cells[col.wholesalePrice], 0);
    const sale = parseNumberCell(cells[col.salePrice], 0);
    const msrp = parseNumberCell(cells[col.msrpPrice], 0);
    const extra = parseNumberCell(cells[col.extraPrice], 0);
    const memoRaw = (cells[col.memo] ?? "").trim();
    const memo2Raw = (cells[col.memo2] ?? "").trim();

    rows.push({
      sku,
      category,
      name,
      imageUrl,
      color,
      gender,
      size,
      stock,
      wholesale,
      msrp,
      sale,
      extra,
      memo: memoRaw ? memoRaw : null,
      memo2: memo2Raw ? memo2Raw : null,
      dataRowIndex,
    });
  }

  if (rows.length === 0) throw new Error("CSV 오류: 유효한 데이터 행이 없습니다. (SKU·상품명 필수)");

  return { rows, skippedRows };
}
